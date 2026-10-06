// 구매요청·승인 화면 ↔ 서버 API (server/src/modules/purchasing). 서버 응답을 화면이 쓰는 모양(가짜 DB와 같은 타입)으로 바꾼다.
// 구매요청 id는 서버 id를 그대로 쓰고, 원료·사원·부서 id는 화면(가짜 DB) id로 맞춘다(api/server/masterIds.ts).
// 서버에 없어 비워 두는 것:
// - 반려 일시(rejectedAt): 작업 로그에만 있다.
// - 출처 초안(sourceDraft): Message → ERP 초안 조회가 서버에 없다.
// 승인권자·직급·등록 창 정보는 조직 정보(가짜 DB와 서버 시드가 같다)에서 읽는다.
import type { PageResult, ProductionPlanSummary, PurchaseRequisitionDetail, PurchaseRequisitionSummary } from '@fantasteel/shared';
import { actingEmployeeId } from '@/api/actor';
import { ApiError, InputError } from '@/api/errors';
import { serverRequest } from '@/api/http';
import { employeeBasicsOf } from '@/api/orgViews';
import type { ApprovalInput, RejectInput } from '@/api/approvals';
import type { PurchaseOrderCandidateItem, RequisitionDetail, RequisitionInput, RequisitionPurchaseOrderLine, RequisitionResubmitInput, RequisitionView } from '@/api/purchasing';
import { mockEmployeeIdOf, mockItemOf, serverItemIdOf } from '@/api/server/masterIds';
import { serverRequisitionPurchaseOrderLines } from '@/api/server/purchaseOrders';
import { getMockDb } from '@/mock/db';
import type { MockTables } from '@/mock/schema';
import { requisitionSourceOf } from '@/mock/services';

const PAGE_SIZE = 100;

const readMock = <T>(reader: (tables: Readonly<MockTables>) => T): T => getMockDb().read(reader);

async function listAll(query: Record<string, string | number | undefined> = {}): Promise<PurchaseRequisitionSummary[]> {
  const rows: PurchaseRequisitionSummary[] = [];
  for (let page = 1; ; page++) {
    const result = await serverRequest<PageResult<PurchaseRequisitionSummary>>('GET', '/purchase-requisitions', { query: { ...query, page, size: PAGE_SIZE } });
    rows.push(...result.items);
    if (rows.length >= result.total || result.items.length === 0) return rows;
  }
}

function toView(row: PurchaseRequisitionSummary | PurchaseRequisitionDetail): RequisitionView {
  const detail = 'requestReason' in row ? row : null;
  return {
    id: row.id,
    purchaseRequisitionNo: row.purchaseRequisitionNo,
    purchaseRequisitionStatus: row.purchaseRequisitionStatus,
    source: requisitionSourceOf(row),
    itemId: mockItemOf(row.itemCode)?.id ?? row.itemId,
    itemCode: row.itemCode,
    itemName: row.itemName,
    requestedTon: row.requestedTon,
    productionPlanId: row.productionPlanId,
    productionPlanNo: row.productionPlanNo,
    purchaseOrderNo: row.purchaseOrderNo,
    requesterId: mockEmployeeIdOf(row.requesterName, row.requesterId),
    requesterName: row.requesterName,
    departmentId: readMock((t) => t.department.find((d) => d.departmentName === row.departmentName)?.id) ?? row.departmentId,
    departmentName: row.departmentName,
    approverName: row.approverName,
    desiredReceiptDate: row.desiredReceiptDate,
    requestReason: detail?.requestReason ?? null,
    rejectReason: detail?.rejectReason ?? null,
    actionDraftId: row.actionDraftId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    approvedAt: row.approvedAt,
    rejectedAt: null,
  };
}

/** 부서의 지금 부서장 (재직 중일 때만) */
const activeHeadOf = (tables: Readonly<MockTables>, departmentId: number | null) => {
  const headId = tables.department.find((d) => d.id === departmentId)?.headEmployeeId ?? null;
  const head = tables.employee.find((e) => e.id === headId);
  return head && head.isActive ? head : undefined;
};

function toDetail(row: PurchaseRequisitionDetail, purchaseOrderLines: RequisitionPurchaseOrderLine[]): RequisitionDetail {
  const view = toView(row);
  const viewerId = actingEmployeeId();
  return readMock((tables) => {
    const requester = tables.employee.find((e) => e.id === view.requesterId);
    const head = activeHeadOf(tables, view.departmentId);
    const isRequester = view.requesterId === viewerId;
    return {
      ...view,
      requesterJobGradeName: requester ? employeeBasicsOf(tables, requester).jobGradeName : null,
      departmentHeadName: head?.employeeName ?? null,
      isRequester,
      canApprove: view.purchaseRequisitionStatus === 'WAITING_APPROVAL' && head !== undefined && head.id === viewerId && !isRequester,
      purchaseOrderLines,
      sourceDraft: null,
    };
  });
}

/** MRP 화면은 아직 가짜 DB라 계획 id가 가짜 DB id다. 계획 번호로 서버 계획을 찾고, 없으면 엉뚱한 계획에 묶지 않도록 막는다 */
async function serverPlanIdOf(mockPlanId: number | null | undefined): Promise<number | null> {
  if (mockPlanId === null || mockPlanId === undefined) return null;
  const planNo = readMock((t) => t.productionPlan.find((p) => p.id === mockPlanId)?.productionPlanNo);
  for (let page = 1; planNo; page++) {
    const result = await serverRequest<PageResult<ProductionPlanSummary>>('GET', '/production-plans', { query: { page, size: PAGE_SIZE } });
    const found = result.items.find((p) => p.productionPlanNo === planNo);
    if (found) return found.id;
    if (page * PAGE_SIZE >= result.total || result.items.length === 0) break;
  }
  const message = '서버에서 근거 생산계획을 찾을 수 없어요';
  throw new InputError(message, { productionPlanId: message });
}

const requestBody = (input: RequisitionInput) => ({
  requestedTon: input.requestedTon,
  desiredReceiptDate: input.desiredReceiptDate,
  requestReason: input.requestReason.trim() || null,
});

export const serverPurchaseRequisitionApi = {
  list: async (): Promise<RequisitionView[]> => (await listAll()).map(toView),

  detail: async (id: number): Promise<RequisitionDetail> => {
    const row = await serverRequest<PurchaseRequisitionDetail>('GET', `/purchase-requisitions/${id}`);
    return toDetail(row, row.purchaseOrderNo === null ? [] : await serverRequisitionPurchaseOrderLines(row.id));
  },

  /** 발주 후보: 서버에서 승인됨(APPROVED) = 아직 발주하지 않은 요청. 공급업체는 원료의 기본 공급업체 */
  orderable: async (): Promise<PurchaseOrderCandidateItem[]> =>
    (await listAll({ purchaseRequisitionStatus: 'APPROVED' }))
      .map((row) => ({ ...toView(row), supplierId: row.defaultSupplierId, supplierName: row.defaultSupplierName }))
      .sort((a, b) => a.id - b.id),

  create: async (input: RequisitionInput): Promise<RequisitionView> => {
    const [itemId, productionPlanId] = await Promise.all([serverItemIdOf(input.itemId), serverPlanIdOf(input.productionPlanId)]);
    return toView(await serverRequest<PurchaseRequisitionDetail>('POST', '/purchase-requisitions', { body: { itemId, productionPlanId, ...requestBody(input) } }));
  },

  /** 서버는 상태(반려됨)로 동시 수정을 막아 expectedUpdatedAt은 보내지 않는다 */
  resubmit: async (input: RequisitionResubmitInput): Promise<RequisitionView> =>
    toView(await serverRequest<PurchaseRequisitionDetail>('POST', `/purchase-requisitions/${input.purchaseRequisitionId}/resubmit`, { body: requestBody(input) })),
};

export const serverApprovalApi = {
  /** 셸 배지: 서버 승인함 건수. 부서장이 아니면 0 */
  countWaiting: async (): Promise<number> => {
    try {
      return (await serverRequest<PageResult<PurchaseRequisitionSummary>>('GET', '/purchase-requisitions', { query: { approvable: 'true', page: 1, size: 1 } })).total;
    } catch (e) {
      if (e instanceof ApiError && e.code === 'COM-002') return 0;
      throw e;
    }
  },

  /** 승인함 (먼저 온 것부터) */
  inbox: async (): Promise<RequisitionView[]> => (await listAll({ approvable: 'true' })).map(toView).sort((a, b) => a.id - b.id),

  /** 서버는 승인 대기가 아니면 COM-001로 막아 expectedUpdatedAt은 보내지 않는다 */
  approve: async (input: ApprovalInput): Promise<RequisitionView> =>
    toView(await serverRequest<PurchaseRequisitionDetail>('POST', `/purchase-requisitions/${input.purchaseRequisitionId}/approve`)),

  reject: async (input: RejectInput): Promise<RequisitionView> =>
    toView(await serverRequest<PurchaseRequisitionDetail>('POST', `/purchase-requisitions/${input.purchaseRequisitionId}/reject`, { body: { rejectReason: input.rejectReason } })),
};
