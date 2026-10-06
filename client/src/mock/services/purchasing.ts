// 구매요청·부서장 승인·발주·입고 (REQ-PUR-001~004, REQ-AUTH-004, REQ-LOT-003·004, BP-PUR-01·02, 업무 프로세스 10장).
// - 구매요청: 등록 = 바로 WAITING_APPROVAL (임시 저장 없음). 요청자 소속 부서에 부서장이 없으면 PUR-001. 부서장에게 APPROVAL_REQUESTED 알림.
//   반려되면 요청자가 고쳐 다시 요청(→ WAITING_APPROVAL). 승인·반려는 요청 부서(department_id)의 부서장만 (아니면 COM-002), 결과는 요청자에게 APPROVAL_RESULT.
//   MRP에서 만든 줄은 production_plan_id를 연결하고 같은 계획·원료의 구매요청을 두 번 만들지 않는다.
// - 발주: 승인된 요청 품목만(아니면 PUR-002). 품목의 기본 공급업체별로 발주 1건에 여러 줄. 요청의 모든 품목을 발주하면 ORDERED.
// - 입고: 등록 = 확정(상태·수정 없음). 미입고량 초과 PUR-003. 원료 LOT RM-원료코드-YYMMDD-NNN(잔량 = 입고량), 품목 기본 야드. 발주 입고 누계·입고예정·상태 갱신.
import type { PurchaseRequisitionStatus } from '@/codes';
import { decAdd, decCmp, decRound, decSub, decSum, TON_DIGITS } from '@/lib/decimal';
import { recordBusinessEvent } from '@/mock/businessEvents';
import type { GoodsReceiptRow, LotRow, MockTables, PurchaseOrderItemRow, PurchaseOrderRow, PurchaseRequisitionItemRow, PurchaseRequisitionRow } from '@/mock/schema';
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

export interface RequisitionLineInput {
  itemId: number;
  /** 톤 (소수 3자리) */
  requiredTon: string;
  /** MRP 근거 생산계획 */
  productionPlanId?: number | null;
}

export interface CreateRequisitionInput {
  desiredReceiptDate?: string | null;
  /** 요청 근거 */
  requestReason?: string | null;
  items: readonly RequisitionLineInput[];
  /** Message → ERP 초안에서 만들 때 */
  actionDraftId?: number | null;
  messageId?: number | null;
}

/** 출처(계산값): Message → ERP 초안 / MRP 계획 / 직접 */
export type RequisitionSource = 'MESSAGE' | 'MRP' | 'DIRECT';
export function requisitionSourceOf(tables: Tables, pr: PurchaseRequisitionRow): RequisitionSource {
  if (pr.actionDraftId !== null) return 'MESSAGE';
  return tables.purchaseRequisitionItem.some((i) => i.purchaseRequisitionId === pr.id && i.productionPlanId !== null) ? 'MRP' : 'DIRECT';
}

const prSnapshot = (tables: Tables, pr: PurchaseRequisitionRow) => ({
  purchaseRequisitionNo: pr.purchaseRequisitionNo,
  purchaseRequisitionStatus: pr.purchaseRequisitionStatus,
  departmentId: pr.departmentId,
  desiredReceiptDate: pr.desiredReceiptDate,
  requestReason: pr.requestReason,
  rejectReason: pr.rejectReason,
  approverId: pr.approverId,
  items: tables.purchaseRequisitionItem
    .filter((i) => i.purchaseRequisitionId === pr.id)
    .map((i) => ({ lineNo: i.lineNo, itemCode: findById(tables, 'item', i.itemId)?.itemCode ?? '', requiredTon: i.requiredTon, productionPlanId: i.productionPlanId })),
});

/** 요청 품목 줄 확인 (원료만, 톤 > 0, 계획 중복 금지) */
function validateRequisitionLines(tables: Tables, lines: readonly RequisitionLineInput[], excludeRequisitionId?: number): RequisitionLineInput[] {
  if (lines.length === 0) inputError('items', '원료 품목을 하나 이상 넣어 주세요');
  const errors = new FieldErrors();
  const seen = new Set<number>();
  const valid = lines.map((line, index) => {
    const item = mustGet(tables, 'item', line.itemId, '원료 품목');
    if (item.itemType !== 'RAW_MATERIAL') errors.add(`items.${index}.itemId`, '원료 품목만 구매요청할 수 있어요');
    if (seen.has(item.id)) errors.add(`items.${index}.itemId`, '같은 원료를 두 줄에 넣었어요');
    seen.add(item.id);
    // 톤은 소수 3자리 문자열로 저장한다('100' → '100.000', core 0장)
    const requiredTonText = checkDecimal(errors, `items.${index}.requiredTon`, line.requiredTon, { label: '수량(톤)', scale: 3, integerDigits: 9, positive: true, required: true });
    const requiredTon = requiredTonText === null ? null : decRound(requiredTonText, TON_DIGITS);
    const productionPlanId = line.productionPlanId ?? null;
    if (productionPlanId !== null) {
      mustGet(tables, 'productionPlan', productionPlanId, '생산계획');
      const duplicate = tables.purchaseRequisitionItem.find(
        (i) => i.productionPlanId === productionPlanId && i.itemId === item.id && i.purchaseRequisitionId !== excludeRequisitionId,
      );
      if (duplicate) {
        const no = findById(tables, 'purchaseRequisition', duplicate.purchaseRequisitionId)?.purchaseRequisitionNo ?? '';
        errors.add(`items.${index}.itemId`, `이 생산계획의 ${item.itemName} 구매요청이 이미 있어요 (${no})`);
      }
    }
    return { itemId: item.id, requiredTon: requiredTon ?? '0', productionPlanId };
  });
  errors.throwIfAny();
  return valid;
}

function headOfRequesterDepartment(tables: Tables, requesterId: number): { departmentId: number; headEmployeeId: number } {
  const requester = mustGet(tables, 'employee', requesterId, '요청자');
  const department = mustGet(tables, 'department', requester.departmentId, '부서');
  if (department.headEmployeeId === null || !tables.employee.some((e) => e.id === department.headEmployeeId && e.isActive)) throw new ApiError('PUR-001', department.departmentName);
  return { departmentId: department.id, headEmployeeId: department.headEmployeeId };
}

function salesOrderIdOfLines(tables: Tables, lines: readonly { productionPlanId: number | null }[]): number | null {
  const ids = [...new Set(lines.map((l) => salesOrderIdOfPlan(tables, findById(tables, 'productionPlan', l.productionPlanId))).filter((id): id is number => id !== null))];
  return ids.length === 1 ? ids[0] : null;
}

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

/** 구매요청 등록 (REQ-PUR-001). 요청자 = 요청한 사원, 부서 = 요청 시점 소속 부서. */
export function createPurchaseRequisition(tx: MockTx, actor: PersonActor, input: CreateRequisitionInput): { purchaseRequisition: PurchaseRequisitionRow; items: PurchaseRequisitionItemRow[] } {
  const { departmentId, headEmployeeId } = headOfRequesterDepartment(tx.tables, actor.employeeId);
  const lines = validateRequisitionLines(tx.tables, input.items);
  const errors = new FieldErrors();
  const desiredReceiptDate = checkDate(errors, 'desiredReceiptDate', input.desiredReceiptDate, '희망 입고일', false);
  const requestReason = checkText(errors, 'requestReason', input.requestReason, '요청 근거', 500, false);
  errors.throwIfAny();
  if (input.actionDraftId && tx.tables.purchaseRequisition.some((p) => p.actionDraftId === input.actionDraftId)) {
    inputError('actionDraftId', '이 초안으로 만든 구매요청이 이미 있어요');
  }
  const pr = insertRow(tx, 'purchaseRequisition', {
    purchaseRequisitionNo: issueBusinessNo(tx, 'PURCHASE_REQUISITION'),
    requesterId: actor.employeeId,
    departmentId,
    approverId: null,
    purchaseRequisitionStatus: 'WAITING_APPROVAL',
    desiredReceiptDate,
    requestReason,
    rejectReason: null,
    actionDraftId: input.actionDraftId ?? null,
    approvedAt: null,
    rejectedAt: null,
  });
  const items = lines.map((line, index) =>
    insertRow(tx, 'purchaseRequisitionItem', { purchaseRequisitionId: pr.id, lineNo: index + 1, itemId: line.itemId, requiredTon: line.requiredTon, productionPlanId: line.productionPlanId ?? null }),
  );
  const event = recordBusinessEvent(tx, {
    businessEventType: 'PURCHASE_REQUISITION_CREATED',
    actor,
    targetType: 'purchase_requisition',
    targetId: pr.id,
    targetNo: pr.purchaseRequisitionNo,
    salesOrderId: salesOrderIdOfLines(tx.tables, items),
    afterData: prSnapshot(tx.tables, pr),
    actionDraftId: input.actionDraftId ?? null,
    messageId: input.messageId ?? null,
  });
  notifyApprover(tx, pr, headEmployeeId, event.id);
  return { purchaseRequisition: pr, items };
}

/** 반려된 구매요청을 요청자가 고쳐 다시 요청한다 (→ WAITING_APPROVAL). 요청 부서는 재요청 시점 소속으로 바꾼다 (REQ-AUTH-004). */
export function resubmitPurchaseRequisition(
  tx: MockTx,
  actor: PersonActor,
  input: { purchaseRequisitionId: number; desiredReceiptDate?: string | null; requestReason?: string | null; items: readonly RequisitionLineInput[]; expectedUpdatedAt?: string | null },
): PurchaseRequisitionRow {
  const pr = mustGet(tx.tables, 'purchaseRequisition', input.purchaseRequisitionId, '구매요청');
  assertNotChanged(pr.updatedAt, input.expectedUpdatedAt, '구매요청');
  if (pr.requesterId !== actor.employeeId) throw new ApiError('COM-002', '요청자만 고칠 수 있어요');
  if (pr.purchaseRequisitionStatus !== 'REJECTED') inputError('purchaseRequisitionId', '반려된 구매요청만 고쳐 다시 요청할 수 있어요');
  const { departmentId, headEmployeeId } = headOfRequesterDepartment(tx.tables, actor.employeeId);
  const lines = validateRequisitionLines(tx.tables, input.items, pr.id);
  const errors = new FieldErrors();
  const desiredReceiptDate = checkDate(errors, 'desiredReceiptDate', input.desiredReceiptDate, '희망 입고일', false);
  const requestReason = checkText(errors, 'requestReason', input.requestReason, '요청 근거', 500, false);
  errors.throwIfAny();
  const before = prSnapshot(tx.tables, pr);
  tx.tables.purchaseRequisitionItem.splice(0, tx.tables.purchaseRequisitionItem.length, ...tx.tables.purchaseRequisitionItem.filter((i) => i.purchaseRequisitionId !== pr.id));
  lines.forEach((line, index) =>
    insertRow(tx, 'purchaseRequisitionItem', { purchaseRequisitionId: pr.id, lineNo: index + 1, itemId: line.itemId, requiredTon: line.requiredTon, productionPlanId: line.productionPlanId ?? null }),
  );
  const updated =
    updateRow(tx, 'purchaseRequisition', pr.id, {
      purchaseRequisitionStatus: 'WAITING_APPROVAL',
      departmentId, // 다시 요청한 시점의 요청자 소속 부서 = 승인 부서 (알림 받는 부서장과 승인권자를 맞춘다, REQ-AUTH-004)
      desiredReceiptDate,
      requestReason,
      rejectReason: null,
      rejectedAt: null,
      approverId: null,
    }) ?? pr;
  const event = recordBusinessEvent(tx, {
    businessEventType: 'PURCHASE_REQUISITION_CREATED',
    actor,
    targetType: 'purchase_requisition',
    targetId: pr.id,
    targetNo: pr.purchaseRequisitionNo,
    salesOrderId: salesOrderIdOfLines(tx.tables, lines.map((l) => ({ productionPlanId: l.productionPlanId ?? null }))),
    beforeData: before,
    afterData: prSnapshot(tx.tables, updated),
    reasonText: '반려 후 고쳐 다시 요청',
    actionDraftId: pr.actionDraftId,
  });
  notifyApprover(tx, updated, headEmployeeId, event.id);
  return updated;
}

/** 이 사원이 이 구매요청을 승인·반려할 수 있는지 (요청 부서의 부서장, REQ-AUTH-004) */
export function canApproveRequisition(tables: Tables, employeeId: number, pr: PurchaseRequisitionRow): boolean {
  return pr.purchaseRequisitionStatus === 'WAITING_APPROVAL' && findById(tables, 'department', pr.departmentId)?.headEmployeeId === employeeId;
}

function waitingRequisitionForHead(tables: Tables, actor: PersonActor, id: number, expectedUpdatedAt: string | null | undefined): PurchaseRequisitionRow {
  const pr = mustGet(tables, 'purchaseRequisition', id, '구매요청');
  assertNotChanged(pr.updatedAt, expectedUpdatedAt, '구매요청');
  if (pr.purchaseRequisitionStatus !== 'WAITING_APPROVAL') inputError('purchaseRequisitionId', '승인 대기 중인 구매요청이 아니에요');
  const department = mustGet(tables, 'department', pr.departmentId, '부서');
  if (department.headEmployeeId === null) throw new ApiError('PUR-001', department.departmentName);
  if (department.headEmployeeId !== actor.employeeId) throw new ApiError('COM-002', '요청 부서의 부서장만 승인·반려할 수 있어요');
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
  const items = tx.tables.purchaseRequisitionItem.filter((i) => i.purchaseRequisitionId === pr.id);
  const event = recordBusinessEvent(tx, {
    businessEventType: 'PURCHASE_REQUISITION_APPROVED',
    actor,
    targetType: 'purchase_requisition',
    targetId: pr.id,
    targetNo: pr.purchaseRequisitionNo,
    salesOrderId: salesOrderIdOfLines(tx.tables, items),
    beforeData: before,
    afterData: prSnapshot(tx.tables, updated),
    actionDraftId: pr.actionDraftId,
  });
  notifyResult(tx, updated, event.id, true);
  return updated;
}

/** 부서장 반려 (사유 필수) */
export function rejectPurchaseRequisition(tx: MockTx, actor: PersonActor, input: { purchaseRequisitionId: number; rejectReason: string; expectedUpdatedAt?: string | null }): PurchaseRequisitionRow {
  const pr = waitingRequisitionForHead(tx.tables, actor, input.purchaseRequisitionId, input.expectedUpdatedAt);
  const errors = new FieldErrors();
  const rejectReason = checkText(errors, 'rejectReason', input.rejectReason, '반려 사유', 500, true);
  errors.throwIfAny();
  const before = prSnapshot(tx.tables, pr);
  const updated = updateRow(tx, 'purchaseRequisition', pr.id, { purchaseRequisitionStatus: 'REJECTED', approverId: actor.employeeId, rejectedAt: tx.nowIso, rejectReason }) ?? pr;
  const items = tx.tables.purchaseRequisitionItem.filter((i) => i.purchaseRequisitionId === pr.id);
  const event = recordBusinessEvent(tx, {
    businessEventType: 'PURCHASE_REQUISITION_REJECTED',
    actor,
    targetType: 'purchase_requisition',
    targetId: pr.id,
    targetNo: pr.purchaseRequisitionNo,
    salesOrderId: salesOrderIdOfLines(tx.tables, items),
    beforeData: before,
    afterData: prSnapshot(tx.tables, updated),
    reasonText: rejectReason,
    actionDraftId: pr.actionDraftId,
  });
  notifyResult(tx, updated, event.id, false);
  return updated;
}

/** 발주한 요청 품목인지 */
const orderedLineOf = (tables: Tables, prItemId: number): PurchaseOrderItemRow | undefined => tables.purchaseOrderItem.find((l) => l.purchaseRequisitionItemId === prItemId);

/**
 * 발주 (REQ-PUR-003): 승인된 요청 품목을 기본 공급업체별로 묶어 공급업체 1곳당 발주 1건.
 * 발주량 = 요청 톤. 납기(입고예정일) = 입력값, 없으면 묶인 요청의 가장 이른 희망 입고일.
 */
export function createPurchaseOrders(tx: MockTx, actor: PersonActor, input: { purchaseRequisitionItemIds: readonly number[]; dueDate?: string | null }): PurchaseOrderRow[] {
  const ids = [...new Set(input.purchaseRequisitionItemIds)];
  if (ids.length === 0) inputError('purchaseRequisitionItemIds', '발주할 요청 품목을 골라 주세요');
  const errors = new FieldErrors();
  const dueDate = checkDate(errors, 'dueDate', input.dueDate, '입고예정일', false);
  errors.throwIfAny();
  const lines = ids.map((id) => {
    const prItem = mustGet(tx.tables, 'purchaseRequisitionItem', id, '구매요청 품목');
    const pr = mustGet(tx.tables, 'purchaseRequisition', prItem.purchaseRequisitionId, '구매요청');
    if (orderedLineOf(tx.tables, prItem.id)) inputError('purchaseRequisitionItemIds', `${pr.purchaseRequisitionNo} ${prItem.lineNo}번 품목은 이미 발주했어요`);
    if (pr.purchaseRequisitionStatus !== 'APPROVED') throw new ApiError('PUR-002', pr.purchaseRequisitionNo);
    const item = mustGet(tx.tables, 'item', prItem.itemId, '원료');
    if (item.defaultSupplierId === null) inputError('purchaseRequisitionItemIds', `${item.itemName}에 기본 공급업체가 없어요`);
    return { prItem, pr, item, supplierId: item.defaultSupplierId };
  });
  const supplierIds = [...new Set(lines.map((l) => l.supplierId))];
  const purchaseOrders = supplierIds.map((supplierId) => {
    const group = lines.filter((l) => l.supplierId === supplierId);
    const groupDue = dueDate ?? group.map((l) => l.pr.desiredReceiptDate).filter((d): d is string => d !== null).sort()[0] ?? null;
    const po = insertRow(tx, 'purchaseOrder', { purchaseOrderNo: issueBusinessNo(tx, 'PURCHASE_ORDER'), supplierId, purchaseOrderStatus: 'CONFIRMED', dueDate: groupDue, orderedEmployeeId: actor.employeeId });
    const poItems = group.map((l, index) =>
      insertRow(tx, 'purchaseOrderItem', {
        purchaseOrderId: po.id,
        lineNo: index + 1,
        itemId: l.item.id,
        purchaseRequisitionItemId: l.prItem.id,
        orderedTon: l.prItem.requiredTon,
        receivedTon: '0.000',
        scheduledReceiptTon: l.prItem.requiredTon,
      }),
    );
    recordBusinessEvent(tx, {
      businessEventType: 'PURCHASE_ORDER_CREATED',
      actor,
      targetType: 'purchase_order',
      targetId: po.id,
      targetNo: po.purchaseOrderNo,
      salesOrderId: salesOrderIdOfLines(tx.tables, group.map((l) => l.prItem)),
      afterData: {
        purchaseOrderNo: po.purchaseOrderNo,
        supplierName: findById(tx.tables, 'supplier', supplierId)?.supplierName ?? '',
        dueDate: po.dueDate,
        lines: poItems.map((i, n) => ({ lineNo: i.lineNo, itemCode: group[n].item.itemCode, orderedTon: i.orderedTon, purchaseRequisitionNo: group[n].pr.purchaseRequisitionNo })),
      },
    });
    return po;
  });
  for (const prId of [...new Set(lines.map((l) => l.pr.id))]) {
    const prItems = tx.tables.purchaseRequisitionItem.filter((i) => i.purchaseRequisitionId === prId);
    if (prItems.every((i) => orderedLineOf(tx.tables, i.id))) updateRow(tx, 'purchaseRequisition', prId, { purchaseRequisitionStatus: 'ORDERED' });
  }
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
  const prItem = findById(tx.tables, 'purchaseRequisitionItem', poItem.purchaseRequisitionItemId);
  recordBusinessEvent(tx, {
    businessEventType: 'GOODS_RECEIPT_CONFIRMED',
    actor,
    targetType: 'goods_receipt',
    targetId: goodsReceipt.id,
    targetNo: goodsReceipt.goodsReceiptNo,
    salesOrderId: salesOrderIdOfPlan(tx.tables, findById(tx.tables, 'productionPlan', prItem?.productionPlanId)),
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
  departmentId: number;
  departmentName: string | null;
  approverName: string | null;
  desiredReceiptDate: string | null;
  requestReason: string | null;
  rejectReason: string | null;
  actionDraftId: number | null;
  createdAt: string;
  updatedAt: string;
  approvedAt: string | null;
  rejectedAt: string | null;
}

/** 요청 품목 한 줄 (발주 후보가 쓴다) */
function requisitionLineView(tables: Tables, line: PurchaseRequisitionItemRow) {
  const item = findById(tables, 'item', line.itemId);
  const poLine = orderedLineOf(tables, line.id);
  return {
    id: line.id,
    lineNo: line.lineNo,
    itemId: line.itemId,
    itemCode: item?.itemCode ?? '',
    itemName: item?.itemName ?? '',
    requiredTon: line.requiredTon,
    productionPlanId: line.productionPlanId,
    productionPlanNo: findById(tables, 'productionPlan', line.productionPlanId)?.productionPlanNo ?? null,
    purchaseOrderNo: poLine ? (findById(tables, 'purchaseOrder', poLine.purchaseOrderId)?.purchaseOrderNo ?? null) : null,
  };
}

export function requisitionView(tables: Tables, pr: PurchaseRequisitionRow): RequisitionView {
  // 가짜 DB 테이블은 아직 품목 줄 구조라 첫 줄을 이 요청의 원료로 읽는다 (화면은 ERD 모양을 먼저 쓴다)
  const firstLine = tables.purchaseRequisitionItem.filter((i) => i.purchaseRequisitionId === pr.id).sort((a, b) => a.lineNo - b.lineNo)[0];
  const line = firstLine ? requisitionLineView(tables, firstLine) : null;
  return {
    id: pr.id,
    purchaseRequisitionNo: pr.purchaseRequisitionNo,
    purchaseRequisitionStatus: pr.purchaseRequisitionStatus,
    source: requisitionSourceOf(tables, pr),
    itemId: line?.itemId ?? 0,
    itemCode: line?.itemCode ?? '',
    itemName: line?.itemName ?? '',
    requestedTon: line?.requiredTon ?? '0.000',
    productionPlanId: line?.productionPlanId ?? null,
    productionPlanNo: line?.productionPlanNo ?? null,
    purchaseOrderNo: line?.purchaseOrderNo ?? null,
    requesterId: pr.requesterId,
    requesterName: employeeNameOf(tables, pr.requesterId),
    departmentId: pr.departmentId,
    departmentName: findById(tables, 'department', pr.departmentId)?.departmentName ?? null,
    approverName: employeeNameOf(tables, pr.approverId),
    desiredReceiptDate: pr.desiredReceiptDate,
    requestReason: pr.requestReason,
    rejectReason: pr.rejectReason,
    actionDraftId: pr.actionDraftId,
    createdAt: pr.createdAt,
    updatedAt: pr.updatedAt,
    approvedAt: pr.approvedAt,
    rejectedAt: pr.rejectedAt,
  };
}

export const listPurchaseRequisitions = (tables: Tables): RequisitionView[] => [...tables.purchaseRequisition].sort((a, b) => b.id - a.id).map((pr) => requisitionView(tables, pr));

/** 승인함: 이 사원이 부서장인 부서의 승인 대기 구매요청 */
export function approvalInbox(tables: Tables, employeeId: number): RequisitionView[] {
  return tables.purchaseRequisition.filter((pr) => canApproveRequisition(tables, employeeId, pr)).sort((a, b) => a.id - b.id).map((pr) => requisitionView(tables, pr));
}

/** 발주할 수 있는 요청 품목 (승인됨·미발주), 기본 공급업체 포함 */
export function orderableRequisitionItems(tables: Tables): (ReturnType<typeof requisitionLineView> & { purchaseRequisitionId: number; purchaseRequisitionNo: string; desiredReceiptDate: string | null; supplierId: number | null; supplierName: string | null })[] {
  return tables.purchaseRequisition
    .filter((pr) => pr.purchaseRequisitionStatus === 'APPROVED')
    .flatMap((pr) =>
      tables.purchaseRequisitionItem
        .filter((line) => line.purchaseRequisitionId === pr.id)
        .sort((a, b) => a.lineNo - b.lineNo)
        .map((line) => requisitionLineView(tables, line))
        .filter((i) => i.purchaseOrderNo === null)
        .map((i) => {
          const supplierId = findById(tables, 'item', i.itemId)?.defaultSupplierId ?? null;
          return { ...i, purchaseRequisitionId: pr.id, purchaseRequisitionNo: pr.purchaseRequisitionNo, desiredReceiptDate: pr.desiredReceiptDate, supplierId, supplierName: findById(tables, 'supplier', supplierId)?.supplierName ?? null };
        }),
    );
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
        const prItem = findById(tables, 'purchaseRequisitionItem', l.purchaseRequisitionItemId);
        return {
          id: l.id,
          lineNo: l.lineNo,
          itemId: l.itemId,
          itemCode: item?.itemCode ?? '',
          itemName: item?.itemName ?? '',
          purchaseRequisitionNo: findById(tables, 'purchaseRequisition', prItem?.purchaseRequisitionId)?.purchaseRequisitionNo ?? null,
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
