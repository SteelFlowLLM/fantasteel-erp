// 구매요청·발주 API (REQ-PUR-001~003, REQ-AUTH-004, BP-PUR-01, 업무 프로세스 10장·12.2).
// 권한은 이 층에서 먼저 확인하고(requireActor, 없으면 COM-002), 업무 규칙·작업 로그·알림은 core 서비스가 한다.
// - 구매요청 등록 = 바로 승인 대기(임시 저장 없음). 반려되면 요청자가 고쳐 다시 요청한다(resubmit).
// - 발주: 승인된 요청 품목을 품목의 기본 공급업체별로 묶어 공급업체 1곳당 발주 1건.
import { PERMISSION, type DraftStatus, type Permission, type PurchaseOrderStatus } from '@/codes';
import { requireActor } from '@/api/actor';
import { ApiError, mockMutation, mockQuery } from '@/api/client';
import { employeeBasicsOf } from '@/api/orgViews';
import { canView } from '@/lib/permissions';
import type { MockTables, PurchaseRequisitionRow } from '@/mock/schema';
import {
  actionDraftView,
  canApproveRequisition,
  createPurchaseOrders,
  createPurchaseRequisition,
  findById,
  listPurchaseOrders,
  listPurchaseRequisitions,
  orderableRequisitionItems,
  purchaseOrderView,
  requisitionView,
  resubmitPurchaseRequisition,
  userActor,
  type PurchaseOrderView,
  type RequisitionLineInput,
  type RequisitionView,
} from '@/mock/services';

export type { PurchaseOrderView, RequisitionLineInput, RequisitionSource, RequisitionView } from '@/mock/services';

type Tables = Readonly<MockTables>;

/** 구매요청 목록·상세를 볼 수 있는 권한 (조회 이상) */
export const REQUISITION_VIEW_PERMISSIONS: readonly Permission[] = [PERMISSION.PURCHASE_REQUISITION_CREATE, PERMISSION.PURCHASE_ORDER_CONFIRM];
/** 발주 목록을 볼 수 있는 권한 (조회 이상) */
export const PURCHASE_ORDER_VIEW_PERMISSIONS: readonly Permission[] = [
  PERMISSION.PURCHASE_ORDER_CONFIRM,
  PERMISSION.GOODS_RECEIPT_CONFIRM,
  PERMISSION.PURCHASE_REQUISITION_CREATE,
];

export const purchaseRequisitionKeys = {
  all: ['purchase-requisitions'] as const,
  list: () => ['purchase-requisitions', 'list'] as const,
  detail: (id: number) => ['purchase-requisitions', 'detail', id] as const,
  formContext: () => ['purchase-requisitions', 'form-context'] as const,
};

export const purchaseOrderKeys = {
  all: ['purchase-orders'] as const,
  list: () => ['purchase-orders', 'list'] as const,
  candidateItems: () => ['purchase-orders', 'candidate-items'] as const,
};



// ── 구매요청 ─────────────────────────────────────────

export interface RequisitionInput {
  /** YYYY-MM-DD 또는 '' */
  desiredReceiptDate: string;
  /** 요청 근거 */
  requestReason: string;
  items: readonly RequisitionLineInput[];
}

export interface RequisitionResubmitInput extends RequisitionInput {
  purchaseRequisitionId: number;
  expectedUpdatedAt: string;
}

/** 구매요청에 묶인 발주 줄 */
export interface RequisitionPurchaseOrderLine {
  purchaseOrderId: number;
  purchaseOrderNo: string;
  purchaseOrderStatus: PurchaseOrderStatus;
  supplierName: string;
  dueDate: string | null;
  purchaseRequisitionLineNo: number;
  itemName: string;
  orderedTon: string;
  receivedTon: string;
  scheduledReceiptTon: string;
}

export interface RequisitionDetail extends RequisitionView {
  requesterJobGradeName: string | null;
  /** 요청 부서의 지금 부서장 (승인권자). 없으면 null → PUR-001 */
  departmentHeadName: string | null;
  /** 보는 사원이 요청자인지 (반려 뒤 고쳐 다시 요청) */
  isRequester: boolean;
  /** 보는 사원이 승인·반려할 수 있는지 (요청 부서 부서장 + 승인 대기) */
  canApprove: boolean;
  purchaseOrderLines: RequisitionPurchaseOrderLine[];
  /** Message → ERP에서 온 요청이면 초안·원본 메시지 */
  sourceDraft: {
    id: number;
    draftStatus: DraftStatus;
    confirmedAt: string | null;
    message: { id: number; chatRoomId: number; chatRoomName: string | null; senderName: string | null; content: string | null; createdAt: string } | null;
  } | null;
}

/** 등록 창에 보이는 요청자·승인권자 */
export interface RequisitionFormContext {
  requesterName: string;
  departmentName: string;
  /** 소속 부서의 부서장. 없으면 등록할 수 없다(PUR-001) */
  headName: string | null;
}

function requisitionPurchaseOrderLines(tables: Tables, purchaseRequisition: PurchaseRequisitionRow): RequisitionPurchaseOrderLine[] {
  const purchaseRequisitionItems = tables.purchaseRequisitionItem.filter((i) => i.purchaseRequisitionId === purchaseRequisition.id);
  return purchaseRequisitionItems.flatMap((purchaseRequisitionItem) =>
    tables.purchaseOrderItem
      .filter((line) => line.purchaseRequisitionItemId === purchaseRequisitionItem.id)
      .flatMap((line) => {
        const po = findById(tables, 'purchaseOrder', line.purchaseOrderId);
        if (!po) return [];
        return [
          {
            purchaseOrderId: po.id,
            purchaseOrderNo: po.purchaseOrderNo,
            purchaseOrderStatus: po.purchaseOrderStatus,
            supplierName: findById(tables, 'supplier', po.supplierId)?.supplierName ?? '',
            dueDate: po.dueDate,
            purchaseRequisitionLineNo: purchaseRequisitionItem.lineNo,
            itemName: findById(tables, 'item', line.itemId)?.itemName ?? '',
            orderedTon: line.orderedTon,
            receivedTon: line.receivedTon,
            scheduledReceiptTon: line.scheduledReceiptTon,
          },
        ];
      }),
  );
}

function activeHeadNameOf(tables: Tables, departmentId: number): string | null {
  const headId = findById(tables, 'department', departmentId)?.headEmployeeId ?? null;
  const head = findById(tables, 'employee', headId);
  return head && head.isActive ? head.employeeName : null;
}

function requisitionDetailOf(tables: Tables, purchaseRequisition: PurchaseRequisitionRow, viewerId: number): RequisitionDetail {
  const requester = findById(tables, 'employee', purchaseRequisition.requesterId);
  const draft = purchaseRequisition.actionDraftId !== null && findById(tables, 'actionDraft', purchaseRequisition.actionDraftId) ? actionDraftView(tables, purchaseRequisition.actionDraftId) : null;
  return {
    ...requisitionView(tables, purchaseRequisition),
    requesterJobGradeName: requester ? employeeBasicsOf(tables, requester).jobGradeName : null,
    departmentHeadName: activeHeadNameOf(tables, purchaseRequisition.departmentId),
    isRequester: purchaseRequisition.requesterId === viewerId,
    canApprove: canApproveRequisition(tables, viewerId, purchaseRequisition),
    purchaseOrderLines: requisitionPurchaseOrderLines(tables, purchaseRequisition),
    sourceDraft: draft ? { id: draft.id, draftStatus: draft.draftStatus, confirmedAt: draft.confirmedAt, message: draft.message } : null,
  };
}

export const purchaseRequisitionApi = {
  /** 구매요청 목록 (최근 것부터) */
  list: (): Promise<RequisitionView[]> =>
    mockQuery((tables) => {
      requireActor(tables, { view: REQUISITION_VIEW_PERMISSIONS });
      return listPurchaseRequisitions(tables);
    }),

  /** 구매요청 한 건. 조회 권한이 없어도 요청자와 요청 부서의 부서장(승인권자)은 볼 수 있다. */
  detail: (id: number): Promise<RequisitionDetail> =>
    mockQuery((tables) => {
      const actor = requireActor(tables);
      const purchaseRequisition = findById(tables, 'purchaseRequisition', id);
      if (!purchaseRequisition) throw new ApiError('COM-003', `구매요청 ${id}`);
      const isApprover = findById(tables, 'department', purchaseRequisition.departmentId)?.headEmployeeId === actor.employee.id;
      if (!canView(actor, ...REQUISITION_VIEW_PERMISSIONS) && purchaseRequisition.requesterId !== actor.employee.id && !isApprover) {
        throw new ApiError('COM-002', '구매요청 조회 권한이 필요해요');
      }
      return requisitionDetailOf(tables, purchaseRequisition, actor.employee.id);
    }),

  /** 등록 창: 요청자·소속 부서·승인권자 */
  formContext: (): Promise<RequisitionFormContext> =>
    mockQuery((tables) => {
      const actor = requireActor(tables);
      return {
        requesterName: actor.employee.employeeName,
        departmentName: findById(tables, 'department', actor.employee.departmentId)?.departmentName ?? '-',
        headName: activeHeadNameOf(tables, actor.employee.departmentId),
      };
    }),

  /** 등록 = 바로 승인 대기. 요청자 소속 부서에 부서장이 없으면 PUR-001. 부서장에게 승인 요청 알림. */
  create: (input: RequisitionInput): Promise<RequisitionView> =>
    mockMutation((tx) => {
      const actor = requireActor(tx.tables, { use: [PERMISSION.PURCHASE_REQUISITION_CREATE] });
      const { purchaseRequisition } = createPurchaseRequisition(tx, userActor(actor.employee.id), {
        desiredReceiptDate: input.desiredReceiptDate || null,
        requestReason: input.requestReason.trim() || null,
        items: input.items,
      });
      return requisitionView(tx.tables, purchaseRequisition);
    }),

  /** 반려된 요청을 요청자가 고쳐 다시 요청 → 승인 대기 */
  resubmit: (input: RequisitionResubmitInput): Promise<RequisitionView> =>
    mockMutation((tx) => {
      const actor = requireActor(tx.tables, { use: [PERMISSION.PURCHASE_REQUISITION_CREATE] });
      const updated = resubmitPurchaseRequisition(tx, userActor(actor.employee.id), {
        purchaseRequisitionId: input.purchaseRequisitionId,
        desiredReceiptDate: input.desiredReceiptDate || null,
        requestReason: input.requestReason.trim() || null,
        items: input.items,
        expectedUpdatedAt: input.expectedUpdatedAt,
      });
      return requisitionView(tx.tables, updated);
    }),
};

// ── 발주 ─────────────────────────────────────────────

export type PurchaseOrderCandidateItem = ReturnType<typeof orderableRequisitionItems>[number];

export interface PurchaseOrderCreateInput {
  purchaseRequisitionItemIds: readonly number[];
  /** 입고예정일(납기). '' = 고른 요청의 가장 이른 희망 입고일 */
  dueDate: string;
}

export const purchaseOrderApi = {
  /** 발주 목록 (줄별 입고·원료 LOT 포함) */
  list: (): Promise<PurchaseOrderView[]> =>
    mockQuery((tables) => {
      requireActor(tables, { view: PURCHASE_ORDER_VIEW_PERMISSIONS });
      return listPurchaseOrders(tables);
    }),

  /** 발주할 수 있는 요청 품목: 승인됨·미발주, 품목의 기본 공급업체 포함 */
  candidateItems: (): Promise<PurchaseOrderCandidateItem[]> =>
    mockQuery((tables) => {
      requireActor(tables, { view: [PERMISSION.PURCHASE_ORDER_CONFIRM] });
      return orderableRequisitionItems(tables);
    }),

  /** 발주 확정: 공급업체 1곳당 발주 1건 (승인 전이면 PUR-002) */
  create: (input: PurchaseOrderCreateInput): Promise<PurchaseOrderView[]> =>
    mockMutation((tx) => {
      const actor = requireActor(tx.tables, { use: [PERMISSION.PURCHASE_ORDER_CONFIRM] });
      const purchaseOrders = createPurchaseOrders(tx, userActor(actor.employee.id), {
        purchaseRequisitionItemIds: input.purchaseRequisitionItemIds,
        dueDate: input.dueDate || null,
      });
      return purchaseOrders.map((po) => purchaseOrderView(tx.tables, po));
    }),
};
