// 구매요청·부서장 승인·발주·입고 (REQ-PUR-001~004, REQ-AUTH-004, REQ-LOT-003·004, BP-PUR-01·02, 업무 프로세스 10장).
// - 구매요청: 1건 = 원료 1품목(ERD). 등록 = 바로 WAITING_APPROVAL (임시 저장 없음). 요청자 소속 부서에 부서장이 없으면 PUR-001. 부서장에게 APPROVAL_REQUESTED 알림.
//   반려되면 요청자가 수량·희망 입고일·근거를 고쳐 다시 요청(→ WAITING_APPROVAL). 승인·반려는 요청자 소속 부서의 부서장만 (아니면 COM-002), 결과는 요청자에게 APPROVAL_RESULT.
//   MRP에서 만든 요청은 production_plan_id를 연결하고 같은 계획·원료로 진행 중인 구매요청을 두 번 만들지 않는다.
// - 발주: 승인된 구매요청만(아니면 PUR-002). 원료의 기본 공급업체별로 발주 1건에 여러 품목. 발주하면 구매요청 ORDERED.
// - 입고: 등록 = 확정(상태·수정 없음). 미입고량 초과 PUR-003. 원료 LOT RM-원료코드-YYMMDD-NNN(잔량 = 입고량), 품목 기본 야드. 발주 입고 누계·입고예정·상태 갱신.
import type { PurchaseRequisitionStatus } from '@/codes';
import { decAdd, decCmp, decRound, decSub, TON_DIGITS } from '@/lib/decimal';
import { recordBusinessEvent } from '@/mock/businessEvents';
import type { GoodsReceiptRow, LotRow, MockTables, PurchaseOrderItemRow, PurchaseOrderRow, PurchaseRequisitionRow } from '@/mock/schema';
import { issueBusinessNo, issueRawMaterialLotNo } from '@/mock/sequence';
import { insertRow, updateRow, type MockTx } from '@/mock/store';
import { createNotifications } from '@/mock/services/notifications';
import {
  ApiError,
  assertNotChanged,
  checkDate,
  checkDecimal,
  checkText,
  employeeNameOf,
  FieldErrors,
  findById,
  inputError,
  mustGet,
  salesOrderIdOfPlan,
  type PersonActor,
} from '@/mock/services/context';

type Tables = Readonly<MockTables>;

export interface CreateRequisitionInput {
  itemId: number;
  /** 톤 (소수 3자리) */
  requestedTon: string;
  desiredReceiptDate: string | null;
  /** 요청 근거 */
  requestReason?: string | null;
  /** MRP 근거 생산계획 */
  productionPlanId?: number | null;
  /** Message → ERP 초안에서 만들 때 */
  actionDraftId?: number | null;
  messageId?: number | null;
}

/** 출처(계산값): Message → ERP 초안 / MRP 계획 / 직접 */
export type RequisitionSource = 'MESSAGE' | 'MRP' | 'DIRECT';
export function requisitionSourceOf(pr: PurchaseRequisitionRow): RequisitionSource {
  if (pr.actionDraftId !== null) return 'MESSAGE';
  return pr.productionPlanId !== null ? 'MRP' : 'DIRECT';
}

const prSnapshot = (tables: Tables, pr: PurchaseRequisitionRow) => ({
  purchaseRequisitionNo: pr.purchaseRequisitionNo,
  purchaseRequisitionStatus: pr.purchaseRequisitionStatus,
  itemCode: findById(tables, 'item', pr.itemId)?.itemCode ?? '',
  requestedTon: pr.requestedTon,
  desiredReceiptDate: pr.desiredReceiptDate,
  requestReason: pr.requestReason,
  rejectReason: pr.rejectReason,
  approverId: pr.approverId,
  productionPlanId: pr.productionPlanId,
});

/** 같은 계획·원료로 다시 요청하면 중복인 상태. 반려된 요청은 고쳐 다시 요청하므로 막지 않는다 (서버와 같다) */
const OPEN_STATUSES: readonly PurchaseRequisitionStatus[] = ['WAITING_APPROVAL', 'APPROVED', 'ORDERED'];

/** 요청 값 확인 (원료만, 톤 > 0, 희망 입고일 필수, 계획 중복 금지) */
function validateRequisition(
  tables: Tables,
  input: { itemId: number; requestedTon: string; desiredReceiptDate: string | null | undefined; requestReason?: string | null; productionPlanId?: number | null },
  excludeRequisitionId?: number,
) {
  const item = mustGet(tables, 'item', input.itemId, '원료 품목');
  const errors = new FieldErrors();
  if (item.itemType !== 'RAW_MATERIAL') errors.add('itemId', '원료 품목만 구매요청할 수 있어요');
  // 톤은 소수 3자리 문자열로 저장한다('100' → '100.000', core 0장)
  const requestedTonText = checkDecimal(errors, 'requestedTon', input.requestedTon, { label: '수량(톤)', scale: 3, integerDigits: 9, positive: true, required: true });
  const desiredReceiptDate = checkDate(errors, 'desiredReceiptDate', input.desiredReceiptDate, '희망 입고일', true);
  const requestReason = checkText(errors, 'requestReason', input.requestReason, '요청 근거', 500, false);
  const productionPlanId = input.productionPlanId ?? null;
  if (productionPlanId !== null) {
    mustGet(tables, 'productionPlan', productionPlanId, '생산계획');
    const duplicate = tables.purchaseRequisition.find(
      (p) => p.productionPlanId === productionPlanId && p.itemId === item.id && p.id !== excludeRequisitionId && OPEN_STATUSES.includes(p.purchaseRequisitionStatus),
    );
    if (duplicate) errors.add('itemId', `이 생산계획의 ${item.itemName} 구매요청이 이미 있어요 (${duplicate.purchaseRequisitionNo})`);
  }
  errors.throwIfAny();
  return { itemId: item.id, requestedTon: decRound(requestedTonText ?? '0', TON_DIGITS), desiredReceiptDate: desiredReceiptDate ?? '', requestReason, productionPlanId };
}

/** 요청 부서 = 요청자의 지금 소속 부서 (ERD에 요청 부서 칸이 없다) */
export function requisitionDepartmentId(tables: Tables, pr: PurchaseRequisitionRow): number | null {
  return findById(tables, 'employee', pr.requesterId)?.departmentId ?? null;
}

function headOfRequesterDepartment(tables: Tables, requesterId: number): { departmentId: number; headEmployeeId: number } {
  const requester = mustGet(tables, 'employee', requesterId, '요청자');
  const department = mustGet(tables, 'department', requester.departmentId, '부서');
  if (department.headEmployeeId === null || !tables.employee.some((e) => e.id === department.headEmployeeId && e.isActive)) throw new ApiError('PUR-001', department.departmentName);
  return { departmentId: department.id, headEmployeeId: department.headEmployeeId };
}

const salesOrderIdOf = (tables: Tables, pr: PurchaseRequisitionRow) => salesOrderIdOfPlan(tables, findById(tables, 'productionPlan', pr.productionPlanId));

function notifyApprover(tx: MockTx, pr: PurchaseRequisitionRow, headEmployeeId: number, businessEventId: number): void {
  createNotifications(tx, {
    notificationType: 'APPROVAL_REQUESTED',
    title: `구매요청 ${pr.purchaseRequisitionNo} 승인 요청`,
    body: `${employeeNameOf(tx.tables, pr.requesterId) ?? ''}님이 구매요청 승인을 요청했어요`,
    linkPath: `/approvals?pr=${pr.id}`,
    recipientEmployeeIds: [headEmployeeId],
    businessEventId,
  });
}

/** 구매요청 등록 (REQ-PUR-001). 요청자 = 요청한 사원. */
export function createPurchaseRequisition(tx: MockTx, actor: PersonActor, input: CreateRequisitionInput): PurchaseRequisitionRow {
  const { headEmployeeId } = headOfRequesterDepartment(tx.tables, actor.employeeId);
  const values = validateRequisition(tx.tables, input);
  if (input.actionDraftId && tx.tables.purchaseRequisition.some((p) => p.actionDraftId === input.actionDraftId)) {
    inputError('actionDraftId', '이 초안으로 만든 구매요청이 이미 있어요');
  }
  const pr = insertRow(tx, 'purchaseRequisition', {
    purchaseRequisitionNo: issueBusinessNo(tx, 'PURCHASE_REQUISITION'),
    ...values,
    requesterId: actor.employeeId,
    approverId: null,
    approvedAt: null,
    rejectReason: null,
    actionDraftId: input.actionDraftId ?? null,
    purchaseRequisitionStatus: 'WAITING_APPROVAL',
  });
  const event = recordBusinessEvent(tx, {
    businessEventType: 'PURCHASE_REQUISITION_CREATED',
    actor,
    targetType: 'purchase_requisition',
    targetId: pr.id,
    targetNo: pr.purchaseRequisitionNo,
    salesOrderId: salesOrderIdOf(tx.tables, pr),
    afterData: prSnapshot(tx.tables, pr),
    actionDraftId: input.actionDraftId ?? null,
    messageId: input.messageId ?? null,
  });
  notifyApprover(tx, pr, headEmployeeId, event.id);
  return pr;
}

/** 반려된 구매요청을 요청자가 수량·희망 입고일·근거를 고쳐 다시 요청한다 (→ WAITING_APPROVAL). 원료 품목은 바꾸지 않는다. */
export function resubmitPurchaseRequisition(
  tx: MockTx,
  actor: PersonActor,
  input: { purchaseRequisitionId: number; requestedTon: string; desiredReceiptDate: string | null; requestReason?: string | null; expectedUpdatedAt?: string | null },
): PurchaseRequisitionRow {
  const pr = mustGet(tx.tables, 'purchaseRequisition', input.purchaseRequisitionId, '구매요청');
  assertNotChanged(pr.updatedAt, input.expectedUpdatedAt, '구매요청');
  if (pr.requesterId !== actor.employeeId) throw new ApiError('COM-002', '요청자만 고칠 수 있어요');
  if (pr.purchaseRequisitionStatus !== 'REJECTED') inputError('purchaseRequisitionId', '반려된 구매요청만 고쳐 다시 요청할 수 있어요');
  const { headEmployeeId } = headOfRequesterDepartment(tx.tables, actor.employeeId);
  const values = validateRequisition(tx.tables, { ...input, itemId: pr.itemId, productionPlanId: pr.productionPlanId }, pr.id);
  const before = prSnapshot(tx.tables, pr);
  const updated =
    updateRow(tx, 'purchaseRequisition', pr.id, {
      purchaseRequisitionStatus: 'WAITING_APPROVAL',
      requestedTon: values.requestedTon,
      desiredReceiptDate: values.desiredReceiptDate,
      requestReason: values.requestReason,
      rejectReason: null,
      approverId: null,
    }) ?? pr;
  const event = recordBusinessEvent(tx, {
    businessEventType: 'PURCHASE_REQUISITION_CREATED',
    actor,
    targetType: 'purchase_requisition',
    targetId: pr.id,
    targetNo: pr.purchaseRequisitionNo,
    salesOrderId: salesOrderIdOf(tx.tables, pr),
    beforeData: before,
    afterData: prSnapshot(tx.tables, updated),
    reasonText: '반려 후 고쳐 다시 요청',
    actionDraftId: pr.actionDraftId,
  });
  notifyApprover(tx, updated, headEmployeeId, event.id);
  return updated;
}

/** 이 사원이 이 구매요청을 승인·반려할 수 있는지 (요청자 소속 부서의 부서장, REQ-AUTH-004) */
export function canApproveRequisition(tables: Tables, employeeId: number, pr: PurchaseRequisitionRow): boolean {
  return pr.purchaseRequisitionStatus === 'WAITING_APPROVAL' && findById(tables, 'department', requisitionDepartmentId(tables, pr))?.headEmployeeId === employeeId;
}

function waitingRequisitionForHead(tables: Tables, actor: PersonActor, id: number, expectedUpdatedAt: string | null | undefined): PurchaseRequisitionRow {
  const pr = mustGet(tables, 'purchaseRequisition', id, '구매요청');
  assertNotChanged(pr.updatedAt, expectedUpdatedAt, '구매요청');
  if (pr.purchaseRequisitionStatus !== 'WAITING_APPROVAL') inputError('purchaseRequisitionId', '승인 대기 중인 구매요청이 아니에요');
  const department = mustGet(tables, 'department', requisitionDepartmentId(tables, pr), '부서');
  if (department.headEmployeeId === null) throw new ApiError('PUR-001', department.departmentName);
  if (department.headEmployeeId !== actor.employeeId) throw new ApiError('COM-002', '요청자 소속 부서의 부서장만 승인·반려할 수 있어요');
  return pr;
}

function notifyResult(tx: MockTx, pr: PurchaseRequisitionRow, businessEventId: number, approved: boolean): void {
  createNotifications(tx, {
    notificationType: 'APPROVAL_RESULT',
    title: `구매요청 ${pr.purchaseRequisitionNo} ${approved ? '승인' : '반려'}`,
    body: approved ? '부서장이 승인했어요. 발주를 진행할 수 있어요' : `반려 사유: ${pr.rejectReason ?? ''}`,
    linkPath: `/purchase-requisitions?pr=${pr.id}`,
    recipientEmployeeIds: [pr.requesterId],
    businessEventId,
  });
}

/** 부서장 승인 (REQ-PUR-002) */
export function approvePurchaseRequisition(tx: MockTx, actor: PersonActor, input: { purchaseRequisitionId: number; expectedUpdatedAt?: string | null }): PurchaseRequisitionRow {
  const pr = waitingRequisitionForHead(tx.tables, actor, input.purchaseRequisitionId, input.expectedUpdatedAt);
  const before = prSnapshot(tx.tables, pr);
  const updated = updateRow(tx, 'purchaseRequisition', pr.id, { purchaseRequisitionStatus: 'APPROVED', approverId: actor.employeeId, approvedAt: tx.nowIso }) ?? pr;
  const event = recordBusinessEvent(tx, {
    businessEventType: 'PURCHASE_REQUISITION_APPROVED',
    actor,
    targetType: 'purchase_requisition',
    targetId: pr.id,
    targetNo: pr.purchaseRequisitionNo,
    salesOrderId: salesOrderIdOf(tx.tables, pr),
    beforeData: before,
    afterData: prSnapshot(tx.tables, updated),
    actionDraftId: pr.actionDraftId,
  });
  notifyResult(tx, updated, event.id, true);
  return updated;
}

/** 부서장 반려 (사유 필수). 반려 시각은 ERD에 칸이 없어 작업 로그로 본다 */
export function rejectPurchaseRequisition(tx: MockTx, actor: PersonActor, input: { purchaseRequisitionId: number; rejectReason: string; expectedUpdatedAt?: string | null }): PurchaseRequisitionRow {
  const pr = waitingRequisitionForHead(tx.tables, actor, input.purchaseRequisitionId, input.expectedUpdatedAt);
  const errors = new FieldErrors();
  const rejectReason = checkText(errors, 'rejectReason', input.rejectReason, '반려 사유', 500, true);
  errors.throwIfAny();
  const before = prSnapshot(tx.tables, pr);
  const updated = updateRow(tx, 'purchaseRequisition', pr.id, { purchaseRequisitionStatus: 'REJECTED', approverId: actor.employeeId, rejectReason }) ?? pr;
  const event = recordBusinessEvent(tx, {
    businessEventType: 'PURCHASE_REQUISITION_REJECTED',
    actor,
    targetType: 'purchase_requisition',
    targetId: pr.id,
    targetNo: pr.purchaseRequisitionNo,
    salesOrderId: salesOrderIdOf(tx.tables, pr),
    beforeData: before,
    afterData: prSnapshot(tx.tables, updated),
    reasonText: rejectReason,
    actionDraftId: pr.actionDraftId,
  });
  notifyResult(tx, updated, event.id, false);
  return updated;
}

/** 이 구매요청을 담은 발주 품목 (발주 품목 1행 = 구매요청 1건) */
const orderedLineOf = (tables: Tables, purchaseRequisitionId: number): PurchaseOrderItemRow | undefined =>
  tables.purchaseOrderItem.find((l) => l.purchaseRequisitionId === purchaseRequisitionId);

/**
 * 발주 (REQ-PUR-003): 승인된 구매요청을 원료의 기본 공급업체별로 묶어 공급업체 1곳당 발주 1건.
 * 발주량 = 요청 톤. 납기(입고예정일) = 입력값, 없으면 묶인 요청의 가장 이른 희망 입고일.
 */
export function createPurchaseOrders(tx: MockTx, actor: PersonActor, input: { purchaseRequisitionIds: readonly number[]; dueDate?: string | null }): PurchaseOrderRow[] {
  const ids = [...new Set(input.purchaseRequisitionIds)];
  if (ids.length === 0) inputError('purchaseRequisitionIds', '발주할 구매요청을 골라 주세요');
  const errors = new FieldErrors();
  const dueDate = checkDate(errors, 'dueDate', input.dueDate, '입고예정일', false);
  errors.throwIfAny();
  const lines = ids.map((id) => {
    const pr = mustGet(tx.tables, 'purchaseRequisition', id, '구매요청');
    if (orderedLineOf(tx.tables, pr.id)) inputError('purchaseRequisitionIds', `${pr.purchaseRequisitionNo}는 이미 발주했어요`);
    if (pr.purchaseRequisitionStatus !== 'APPROVED') throw new ApiError('PUR-002', pr.purchaseRequisitionNo);
    const item = mustGet(tx.tables, 'item', pr.itemId, '원료');
    if (item.defaultSupplierId === null) inputError('purchaseRequisitionIds', `${item.itemName}에 기본 공급업체가 없어요`);
    return { pr, item, supplierId: item.defaultSupplierId };
  });
  const supplierIds = [...new Set(lines.map((l) => l.supplierId))];
  const purchaseOrders = supplierIds.map((supplierId) => {
    const group = lines.filter((l) => l.supplierId === supplierId);
    const groupDue = dueDate ?? group.map((l) => l.pr.desiredReceiptDate).sort()[0] ?? null;
    const po = insertRow(tx, 'purchaseOrder', { purchaseOrderNo: issueBusinessNo(tx, 'PURCHASE_ORDER'), supplierId, purchaseOrderStatus: 'CONFIRMED', dueDate: groupDue, orderedEmployeeId: actor.employeeId });
    const poItems = group.map((l, index) =>
      insertRow(tx, 'purchaseOrderItem', {
        purchaseOrderId: po.id,
        lineNo: index + 1,
        itemId: l.item.id,
        purchaseRequisitionId: l.pr.id,
        orderedTon: l.pr.requestedTon,
        receivedTon: '0.000',
        scheduledReceiptTon: l.pr.requestedTon,
      }),
    );
    const salesOrderIds = [...new Set(group.map((l) => salesOrderIdOf(tx.tables, l.pr)).filter((id): id is number => id !== null))];
    recordBusinessEvent(tx, {
      businessEventType: 'PURCHASE_ORDER_CREATED',
      actor,
      targetType: 'purchase_order',
      targetId: po.id,
      targetNo: po.purchaseOrderNo,
      salesOrderId: salesOrderIds.length === 1 ? salesOrderIds[0] : null,
      afterData: {
        purchaseOrderNo: po.purchaseOrderNo,
        supplierName: findById(tx.tables, 'supplier', supplierId)?.supplierName ?? '',
        dueDate: po.dueDate,
        lines: poItems.map((i, n) => ({ lineNo: i.lineNo, itemCode: group[n].item.itemCode, orderedTon: i.orderedTon, purchaseRequisitionNo: group[n].pr.purchaseRequisitionNo })),
      },
    });
    return po;
  });
  for (const { pr } of lines) updateRow(tx, 'purchaseRequisition', pr.id, { purchaseRequisitionStatus: 'ORDERED' });
  return purchaseOrders;
}

/** 입고 확정 (REQ-PUR-004, BP-PUR-02): 입고 1건 = 원료 LOT 1개 */
export function receiveGoods(
  tx: MockTx,
  actor: PersonActor,
  input: { purchaseOrderItemId: number; receivedTon: string; receiptDate: string },
): { goodsReceipt: GoodsReceiptRow; lot: LotRow; purchaseOrder: PurchaseOrderRow } {
  const poItem = mustGet(tx.tables, 'purchaseOrderItem', input.purchaseOrderItemId, '발주 품목');
  const po = mustGet(tx.tables, 'purchaseOrder', poItem.purchaseOrderId, '발주');
  const item = mustGet(tx.tables, 'item', poItem.itemId, '원료');
  const errors = new FieldErrors();
  const receivedTonText = checkDecimal(errors, 'receivedTon', input.receivedTon, { label: '입고 톤', scale: 3, integerDigits: 9, positive: true, required: true });
  const receivedTon = receivedTonText === null ? null : decRound(receivedTonText, TON_DIGITS);
  const receiptDate = checkDate(errors, 'receiptDate', input.receiptDate, '입고일', true);
  errors.throwIfAny();
  if (decCmp(receivedTon ?? '0', poItem.scheduledReceiptTon) > 0) throw new ApiError('PUR-003', `미입고 ${poItem.scheduledReceiptTon}t`);
  const goodsReceipt = insertRow(tx, 'goodsReceipt', {
    goodsReceiptNo: issueBusinessNo(tx, 'GOODS_RECEIPT'),
    purchaseOrderItemId: poItem.id,
    receivedTon: receivedTon ?? '0',
    receiptDate: receiptDate ?? '',
    yardId: item.defaultYardId,
    confirmedEmployeeId: actor.employeeId,
    confirmedAt: tx.nowIso,
  });
  const lot = insertRow(tx, 'lot', {
    lotNo: issueRawMaterialLotNo(tx, item.itemCode, new Date(`${goodsReceipt.receiptDate}T12:00:00+09:00`)),
    lotType: 'RAW_MATERIAL',
    lotStatus: 'AVAILABLE',
    itemId: item.id,
    steelGradeId: null,
    heatLotId: null,
    initialTon: goodsReceipt.receivedTon,
    remainingTon: goodsReceipt.receivedTon,
    blastFurnaceCode: null,
    converterCode: null,
    yardId: item.defaultYardId,
    goodsReceiptId: goodsReceipt.id,
    productionResultId: null,
    productionPlanId: null,
    isPassed: null,
    dispositionStatus: null,
    dispositionReason: null,
    dispositionAt: null,
    surplusAt: null,
    producedDate: goodsReceipt.receiptDate,
    consumedAt: null,
    shippedAt: null,
  });
  const receivedTotal = decAdd(poItem.receivedTon, goodsReceipt.receivedTon);
  updateRow(tx, 'purchaseOrderItem', poItem.id, { receivedTon: receivedTotal, scheduledReceiptTon: decSub(poItem.orderedTon, receivedTotal) });
  const poLines = tx.tables.purchaseOrderItem.filter((l) => l.purchaseOrderId === po.id);
  const allReceived = poLines.every((l) => decCmp(l.scheduledReceiptTon, 0) <= 0);
  const purchaseOrder = updateRow(tx, 'purchaseOrder', po.id, { purchaseOrderStatus: allReceived ? 'RECEIVED' : 'PARTIALLY_RECEIVED' }) ?? po;
  const pr = findById(tx.tables, 'purchaseRequisition', poItem.purchaseRequisitionId);
  recordBusinessEvent(tx, {
    businessEventType: 'GOODS_RECEIPT_CONFIRMED',
    actor,
    targetType: 'goods_receipt',
    targetId: goodsReceipt.id,
    targetNo: goodsReceipt.goodsReceiptNo,
    salesOrderId: pr ? salesOrderIdOf(tx.tables, pr) : null,
    beforeData: { receivedTon: poItem.receivedTon, scheduledReceiptTon: poItem.scheduledReceiptTon, purchaseOrderStatus: po.purchaseOrderStatus },
    afterData: {
      goodsReceiptNo: goodsReceipt.goodsReceiptNo,
      purchaseOrderNo: po.purchaseOrderNo,
      itemCode: item.itemCode,
      receivedTon: goodsReceipt.receivedTon,
      receiptDate: goodsReceipt.receiptDate,
      lotNo: lot.lotNo,
      purchaseOrderStatus: purchaseOrder.purchaseOrderStatus,
      scheduledReceiptTon: decSub(poItem.orderedTon, receivedTotal),
    },
    lotIds: [lot.id],
  });
  return { goodsReceipt, lot, purchaseOrder };
}

// ── 조회 ──────────────────────────────────────────────

/** 구매요청 1건 = 원료 1품목 (ERD purchase_requisition, 서버 PurchaseRequisitionSummary와 같은 모양) */
export interface RequisitionView {
  id: number;
  purchaseRequisitionNo: string;
  purchaseRequisitionStatus: PurchaseRequisitionStatus;
  source: RequisitionSource;
  itemId: number;
  itemCode: string;
  itemName: string;
  requestedTon: string;
  productionPlanId: number | null;
  productionPlanNo: string | null;
  /** 발주했으면 발주번호 */
  purchaseOrderNo: string | null;
  requesterId: number;
  requesterName: string | null;
  /** 요청자의 지금 소속 부서 */
  departmentId: number | null;
  departmentName: string | null;
  approverName: string | null;
  desiredReceiptDate: string;
  requestReason: string | null;
  rejectReason: string | null;
  actionDraftId: number | null;
  createdAt: string;
  updatedAt: string;
  approvedAt: string | null;
  /** 작업 로그의 반려 시각 (ERD에 칸이 없다) */
  rejectedAt: string | null;
}

/** 반려된 요청의 마지막 반려 작업 로그 시각 */
function rejectedAtOf(tables: Tables, pr: PurchaseRequisitionRow): string | null {
  if (pr.purchaseRequisitionStatus !== 'REJECTED') return null;
  const events = tables.businessEvent.filter((e) => e.businessEventType === 'PURCHASE_REQUISITION_REJECTED' && e.targetType === 'purchase_requisition' && e.targetId === pr.id);
  return events.at(-1)?.createdAt ?? null;
}

export function requisitionView(tables: Tables, pr: PurchaseRequisitionRow): RequisitionView {
  const item = findById(tables, 'item', pr.itemId);
  const poLine = orderedLineOf(tables, pr.id);
  const departmentId = requisitionDepartmentId(tables, pr);
  return {
    id: pr.id,
    purchaseRequisitionNo: pr.purchaseRequisitionNo,
    purchaseRequisitionStatus: pr.purchaseRequisitionStatus,
    source: requisitionSourceOf(pr),
    itemId: pr.itemId,
    itemCode: item?.itemCode ?? '',
    itemName: item?.itemName ?? '',
    requestedTon: pr.requestedTon,
    productionPlanId: pr.productionPlanId,
    productionPlanNo: findById(tables, 'productionPlan', pr.productionPlanId)?.productionPlanNo ?? null,
    purchaseOrderNo: poLine ? (findById(tables, 'purchaseOrder', poLine.purchaseOrderId)?.purchaseOrderNo ?? null) : null,
    requesterId: pr.requesterId,
    requesterName: employeeNameOf(tables, pr.requesterId),
    departmentId,
    departmentName: findById(tables, 'department', departmentId)?.departmentName ?? null,
    approverName: employeeNameOf(tables, pr.approverId),
    desiredReceiptDate: pr.desiredReceiptDate,
    requestReason: pr.requestReason,
    rejectReason: pr.rejectReason,
    actionDraftId: pr.actionDraftId,
    createdAt: pr.createdAt,
    updatedAt: pr.updatedAt,
    approvedAt: pr.approvedAt,
    rejectedAt: rejectedAtOf(tables, pr),
  };
}

export const listPurchaseRequisitions = (tables: Tables): RequisitionView[] => [...tables.purchaseRequisition].sort((a, b) => b.id - a.id).map((pr) => requisitionView(tables, pr));

/** 승인함: 이 사원이 부서장인 부서의 승인 대기 구매요청 */
export function approvalInbox(tables: Tables, employeeId: number): RequisitionView[] {
  return tables.purchaseRequisition.filter((pr) => canApproveRequisition(tables, employeeId, pr)).sort((a, b) => a.id - b.id).map((pr) => requisitionView(tables, pr));
}

/** 발주할 수 있는 구매요청 (승인됨·미발주), 원료의 기본 공급업체 포함 */
export function orderableRequisitions(tables: Tables): (RequisitionView & { supplierId: number | null; supplierName: string | null })[] {
  return tables.purchaseRequisition
    .filter((pr) => pr.purchaseRequisitionStatus === 'APPROVED' && !orderedLineOf(tables, pr.id))
    .sort((a, b) => a.id - b.id)
    .map((pr) => {
      const supplierId = findById(tables, 'item', pr.itemId)?.defaultSupplierId ?? null;
      return { ...requisitionView(tables, pr), supplierId, supplierName: findById(tables, 'supplier', supplierId)?.supplierName ?? null };
    });
}

export interface PurchaseOrderView {
  id: number;
  purchaseOrderNo: string;
  supplierId: number;
  supplierName: string;
  purchaseOrderStatus: PurchaseOrderRow['purchaseOrderStatus'];
  dueDate: string | null;
  orderedEmployeeName: string | null;
  createdAt: string;
  items: {
    id: number;
    lineNo: number;
    itemId: number;
    itemCode: string;
    itemName: string;
    purchaseRequisitionNo: string | null;
    orderedTon: string;
    receivedTon: string;
    /** 입고예정 (미입고량) */
    scheduledReceiptTon: string;
    goodsReceipts: { id: number; goodsReceiptNo: string; receivedTon: string; receiptDate: string; lotNo: string | null }[];
  }[];
}

export function purchaseOrderView(tables: Tables, po: PurchaseOrderRow): PurchaseOrderView {
  return {
    id: po.id,
    purchaseOrderNo: po.purchaseOrderNo,
    supplierId: po.supplierId,
    supplierName: findById(tables, 'supplier', po.supplierId)?.supplierName ?? '',
    purchaseOrderStatus: po.purchaseOrderStatus,
    dueDate: po.dueDate,
    orderedEmployeeName: employeeNameOf(tables, po.orderedEmployeeId),
    createdAt: po.createdAt,
    items: tables.purchaseOrderItem
      .filter((l) => l.purchaseOrderId === po.id)
      .sort((a, b) => a.lineNo - b.lineNo)
      .map((l) => {
        const item = findById(tables, 'item', l.itemId);
        return {
          id: l.id,
          lineNo: l.lineNo,
          itemId: l.itemId,
          itemCode: item?.itemCode ?? '',
          itemName: item?.itemName ?? '',
          purchaseRequisitionNo: findById(tables, 'purchaseRequisition', l.purchaseRequisitionId)?.purchaseRequisitionNo ?? null,
          orderedTon: l.orderedTon,
          receivedTon: l.receivedTon,
          scheduledReceiptTon: l.scheduledReceiptTon,
          goodsReceipts: tables.goodsReceipt
            .filter((g) => g.purchaseOrderItemId === l.id)
            .map((g) => ({ id: g.id, goodsReceiptNo: g.goodsReceiptNo, receivedTon: g.receivedTon, receiptDate: g.receiptDate, lotNo: tables.lot.find((lot) => lot.goodsReceiptId === g.id)?.lotNo ?? null })),
        };
      }),
  };
}

export const listPurchaseOrders = (tables: Tables): PurchaseOrderView[] => [...tables.purchaseOrder].sort((a, b) => b.id - a.id).map((po) => purchaseOrderView(tables, po));

/** 입고할 수 있는 발주 품목 (미입고량 > 0) */
export const receivablePurchaseOrders = (tables: Tables): PurchaseOrderView[] =>
  listPurchaseOrders(tables).filter((po) => po.items.some((i) => decCmp(i.scheduledReceiptTon, 0) > 0));

export function listGoodsReceipts(tables: Tables): { id: number; goodsReceiptNo: string; purchaseOrderNo: string; supplierName: string; itemCode: string; itemName: string; receivedTon: string; receiptDate: string; yardName: string | null; lotNo: string | null; confirmedEmployeeName: string | null; confirmedAt: string }[] {
  return [...tables.goodsReceipt]
    .sort((a, b) => b.id - a.id)
    .map((g) => {
      const poItem = findById(tables, 'purchaseOrderItem', g.purchaseOrderItemId);
      const po = findById(tables, 'purchaseOrder', poItem?.purchaseOrderId);
      const item = findById(tables, 'item', poItem?.itemId);
      return {
        id: g.id,
        goodsReceiptNo: g.goodsReceiptNo,
        purchaseOrderNo: po?.purchaseOrderNo ?? '',
        supplierName: findById(tables, 'supplier', po?.supplierId)?.supplierName ?? '',
        itemCode: item?.itemCode ?? '',
        itemName: item?.itemName ?? '',
        receivedTon: g.receivedTon,
        receiptDate: g.receiptDate,
        yardName: findById(tables, 'yard', g.yardId)?.yardName ?? null,
        lotNo: tables.lot.find((l) => l.goodsReceiptId === g.id)?.lotNo ?? null,
        confirmedEmployeeName: employeeNameOf(tables, g.confirmedEmployeeId),
        confirmedAt: g.confirmedAt,
      };
    });
}
