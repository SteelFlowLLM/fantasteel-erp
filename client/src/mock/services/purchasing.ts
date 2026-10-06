// 구매요청·부서장 승인·발주·입고 (REQ-PUR-001~004, REQ-AUTH-004, REQ-LOT-003·004, BP-PUR-01·02, 업무 프로세스 10장).
// - 구매요청: 1건 = 원료 1품목(ERD). 등록 = 바로 WAITING_APPROVAL (임시 저장 없음). 요청자 소속 부서에 부서장이 없으면 PUR-001. 부서장에게 APPROVAL_REQUESTED 알림.
//   반려되면 요청자가 수량·희망 입고일·근거를 고쳐 다시 요청(→ WAITING_APPROVAL). 승인·반려는 요청자 소속 부서의 부서장만 (아니면 COM-002), 결과는 요청자에게 APPROVAL_RESULT.
//   MRP에서 만든 요청은 production_plan_id를 연결하고 같은 계획·원료로 진행 중인 구매요청을 두 번 만들지 않는다.
// - 발주: 공급업체 1곳당 발주 1건(서버와 같은 모양), 승인된 구매요청만(아니면 PUR-002), 원료의 기본 공급업체로만. 발주하면 구매요청 ORDERED.
// - 입고: 등록 = 확정(상태·수정 없음). 미입고량 초과 PUR-003. 원료 LOT RM-원료코드-YYMMDD-NNN(잔량 = 입고량), 품목 기본 야드. 입고 누계·미입고량은 입고 기록으로 계산(ERD), 발주 상태 갱신.
import type { PurchaseRequisitionStatus } from '@/codes';
import { decAdd, decCmp, decRound, decSub, decSum, TON_DIGITS } from '@/lib/decimal';
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
  txDate,
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

/** 발주 품목의 입고 누계 (ERD: 저장하지 않고 입고 기록으로 계산) */
export const receivedTonOf = (tables: Tables, purchaseOrderItemId: number): string =>
  decSum(tables.goodsReceipt.filter((g) => g.purchaseOrderItemId === purchaseOrderItemId).map((g) => g.receivedTon));

/** 발주 품목의 미입고량(입고예정) = 발주량 − 입고 누계 */
export const remainingTonOf = (tables: Tables, line: PurchaseOrderItemRow): string => decSub(line.orderedTon, receivedTonOf(tables, line.id));

export interface CreatePurchaseOrderInput {
  supplierId: number;
  items: readonly {
    purchaseRequisitionId: number;
    /** 톤 (소수 3자리), 요청량 이하 */
    orderedTon: string;
    /** 비우면 구매요청의 희망 입고일 */
    expectedReceiptDate?: string | null;
  }[];
}

/**
 * 발주 (REQ-PUR-003): 공급업체 1곳당 발주 1건에 승인된 구매요청 여러 개 (서버 POST purchase-orders와 같다).
 * 승인 전 PUR-002, 이미 발주한 요청 COM-001, 요청량 초과·원료의 기본 공급업체가 아님은 입력 오류. 발주한 요청은 ORDERED.
 */
export function createPurchaseOrder(tx: MockTx, actor: PersonActor, input: CreatePurchaseOrderInput): PurchaseOrderRow {
  if (input.items.length === 0) inputError('items', '발주할 구매요청을 골라 주세요');
  if (new Set(input.items.map((i) => i.purchaseRequisitionId)).size !== input.items.length) inputError('items', '같은 구매요청을 두 번 넣었어요');
  const supplier = mustGet(tx.tables, 'supplier', input.supplierId, '공급업체');
  const errors = new FieldErrors();
  const lines = input.items.map((line, index) => {
    const pr = mustGet(tx.tables, 'purchaseRequisition', line.purchaseRequisitionId, '구매요청');
    if (pr.purchaseRequisitionStatus === 'ORDERED' || orderedLineOf(tx.tables, pr.id)) throw new ApiError('COM-001', `${pr.purchaseRequisitionNo}는 이미 발주한 요청이에요`);
    if (pr.purchaseRequisitionStatus !== 'APPROVED') throw new ApiError('PUR-002', pr.purchaseRequisitionNo);
    const item = mustGet(tx.tables, 'item', pr.itemId, '원료');
    // 잘못된 공급업체 차단(API-149): 원료에 기본 공급업체가 있으면 그 공급업체로만 발주한다
    if (item.defaultSupplierId !== null && item.defaultSupplierId !== supplier.id) errors.add(`items.${index}.purchaseRequisitionId`, `${pr.purchaseRequisitionNo}의 원료는 기본 공급업체로 발주해 주세요`);
    const orderedTonText = checkDecimal(errors, `items.${index}.orderedTon`, line.orderedTon, { label: '발주량(톤)', scale: 3, integerDigits: 9, positive: true, required: true });
    const orderedTon = decRound(orderedTonText ?? '0', TON_DIGITS);
    if (orderedTonText !== null && decCmp(orderedTon, pr.requestedTon) > 0) errors.add(`items.${index}.orderedTon`, `${pr.purchaseRequisitionNo}의 요청량 ${pr.requestedTon}t보다 많이 발주할 수 없어요`);
    const expectedReceiptDate = checkDate(errors, `items.${index}.expectedReceiptDate`, line.expectedReceiptDate, '입고 예정일', false) ?? pr.desiredReceiptDate;
    return { pr, item, orderedTon, expectedReceiptDate };
  });
  errors.throwIfAny();
  for (const { pr } of lines) updateRow(tx, 'purchaseRequisition', pr.id, { purchaseRequisitionStatus: 'ORDERED' });
  const po = insertRow(tx, 'purchaseOrder', { purchaseOrderNo: issueBusinessNo(tx, 'PURCHASE_ORDER'), supplierId: supplier.id, purchaseOrderStatus: 'CONFIRMED' });
  for (const line of lines) {
    insertRow(tx, 'purchaseOrderItem', { purchaseOrderId: po.id, purchaseRequisitionId: line.pr.id, itemId: line.item.id, orderedTon: line.orderedTon, expectedReceiptDate: line.expectedReceiptDate });
  }
  const salesOrderIds = [...new Set(lines.map((l) => salesOrderIdOf(tx.tables, l.pr)).filter((id): id is number => id !== null))];
  recordBusinessEvent(tx, {
    businessEventType: 'PURCHASE_ORDER_CREATED',
    actor,
    targetType: 'purchase_order',
    targetId: po.id,
    targetNo: po.purchaseOrderNo,
    salesOrderId: salesOrderIds.length === 1 ? salesOrderIds[0] : null,
    afterData: {
      purchaseOrderNo: po.purchaseOrderNo,
      supplierName: supplier.supplierName,
      items: lines.map((l) => ({ purchaseRequisitionNo: l.pr.purchaseRequisitionNo, itemCode: l.item.itemCode, orderedTon: l.orderedTon, expectedReceiptDate: l.expectedReceiptDate })),
    },
  });
  return po;
}

/** 시드·시험용: 승인된 구매요청을 원료의 기본 공급업체별로 묶어 요청량 그대로 발주한다 (공급업체마다 createPurchaseOrder 1번) */
export function createPurchaseOrdersBySupplier(tx: MockTx, actor: PersonActor, purchaseRequisitionIds: readonly number[], expectedReceiptDate: string | null = null): PurchaseOrderRow[] {
  const requisitions = purchaseRequisitionIds.map((id) => mustGet(tx.tables, 'purchaseRequisition', id, '구매요청'));
  const supplierOf = (pr: PurchaseRequisitionRow) => mustGet(tx.tables, 'item', pr.itemId, '원료').defaultSupplierId;
  const supplierIds = [...new Set(requisitions.map(supplierOf))];
  return supplierIds.map((supplierId) => {
    if (supplierId === null) inputError('items', '기본 공급업체가 없는 원료예요');
    const group = requisitions.filter((pr) => supplierOf(pr) === supplierId);
    return createPurchaseOrder(tx, actor, { supplierId, items: group.map((pr) => ({ purchaseRequisitionId: pr.id, orderedTon: pr.requestedTon, expectedReceiptDate })) });
  });
}

/** 입고 확정 (REQ-PUR-004, BP-PUR-02): 입고 1건 = 원료 LOT 1개 */
export function receiveGoods(
  tx: MockTx,
  actor: PersonActor,
  input: { purchaseOrderItemId: number; receivedTon: string; receivedDate: string },
): { goodsReceipt: GoodsReceiptRow; lot: LotRow; purchaseOrder: PurchaseOrderRow } {
  const poItem = mustGet(tx.tables, 'purchaseOrderItem', input.purchaseOrderItemId, '발주 품목');
  const po = mustGet(tx.tables, 'purchaseOrder', poItem.purchaseOrderId, '발주');
  const item = mustGet(tx.tables, 'item', poItem.itemId, '원료');
  const errors = new FieldErrors();
  const receivedTonText = checkDecimal(errors, 'receivedTon', input.receivedTon, { label: '입고 톤', scale: 3, integerDigits: 9, positive: true, required: true });
  const receivedTon = receivedTonText === null ? null : decRound(receivedTonText, TON_DIGITS);
  const receivedDate = checkDate(errors, 'receivedDate', input.receivedDate, '입고일', true);
  // 실제로 들어온 원료를 기록하는 일이라 미래 날짜는 받지 않는다 (서버와 같은 규칙)
  if (receivedDate !== null && receivedDate > txDate(tx)) errors.add('receivedDate', '입고일은 오늘 이후로 할 수 없어요');
  errors.throwIfAny();
  const receivedBefore = receivedTonOf(tx.tables, poItem.id);
  const remainingBefore = decSub(poItem.orderedTon, receivedBefore);
  if (decCmp(receivedTon ?? '0', remainingBefore) > 0) throw new ApiError('PUR-003', `미입고 ${remainingBefore}t`);
  const goodsReceipt = insertRow(tx, 'goodsReceipt', {
    goodsReceiptNo: issueBusinessNo(tx, 'GOODS_RECEIPT'),
    purchaseOrderItemId: poItem.id,
    receivedTon: receivedTon ?? '0',
    receivedDate: receivedDate ?? '',
  });
  const lot = insertRow(tx, 'lot', {
    lotNo: issueRawMaterialLotNo(tx, item.itemCode, new Date(`${goodsReceipt.receivedDate}T12:00:00+09:00`)),
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
    producedDate: goodsReceipt.receivedDate,
    consumedAt: null,
    shippedAt: null,
  });
  const receivedTotal = decAdd(receivedBefore, goodsReceipt.receivedTon);
  const poLines = tx.tables.purchaseOrderItem.filter((l) => l.purchaseOrderId === po.id);
  const allReceived = poLines.every((l) => decCmp(remainingTonOf(tx.tables, l), 0) <= 0);
  const purchaseOrder = updateRow(tx, 'purchaseOrder', po.id, { purchaseOrderStatus: allReceived ? 'RECEIVED' : 'PARTIALLY_RECEIVED' }) ?? po;
  const pr = findById(tx.tables, 'purchaseRequisition', poItem.purchaseRequisitionId);
  recordBusinessEvent(tx, {
    businessEventType: 'GOODS_RECEIPT_CONFIRMED',
    actor,
    targetType: 'goods_receipt',
    targetId: goodsReceipt.id,
    targetNo: goodsReceipt.goodsReceiptNo,
    salesOrderId: pr ? salesOrderIdOf(tx.tables, pr) : null,
    beforeData: { receivedTon: receivedBefore, remainingTon: remainingBefore, purchaseOrderStatus: po.purchaseOrderStatus },
    afterData: {
      goodsReceiptNo: goodsReceipt.goodsReceiptNo,
      purchaseOrderNo: po.purchaseOrderNo,
      itemCode: item.itemCode,
      receivedTon: goodsReceipt.receivedTon,
      receivedDate: goodsReceipt.receivedDate,
      lotNo: lot.lotNo,
      purchaseOrderStatus: purchaseOrder.purchaseOrderStatus,
      remainingTon: decSub(poItem.orderedTon, receivedTotal),
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
  /** 발주한 사원 (ERD에 칸이 없어 작업 로그 PURCHASE_ORDER_CREATED로 본다) */
  orderedEmployeeName: string | null;
  createdAt: string;
  items: {
    id: number;
    purchaseRequisitionId: number;
    itemId: number;
    itemCode: string;
    itemName: string;
    purchaseRequisitionNo: string | null;
    orderedTon: string;
    expectedReceiptDate: string | null;
    /** 입고 누계 (입고 기록 합계) */
    receivedTon: string;
    /** 미입고량(입고예정) = 발주량 − 입고 누계 */
    remainingTon: string;
    goodsReceipts: { id: number; goodsReceiptNo: string; receivedTon: string; receivedDate: string; lotNo: string | null }[];
  }[];
}

const orderedEventOf = (tables: Tables, purchaseOrderId: number) =>
  tables.businessEvent.find((e) => e.businessEventType === 'PURCHASE_ORDER_CREATED' && e.targetType === 'purchase_order' && e.targetId === purchaseOrderId);

export function purchaseOrderView(tables: Tables, po: PurchaseOrderRow): PurchaseOrderView {
  return {
    id: po.id,
    purchaseOrderNo: po.purchaseOrderNo,
    supplierId: po.supplierId,
    supplierName: findById(tables, 'supplier', po.supplierId)?.supplierName ?? '',
    purchaseOrderStatus: po.purchaseOrderStatus,
    orderedEmployeeName: employeeNameOf(tables, orderedEventOf(tables, po.id)?.actorEmployeeId ?? null),
    createdAt: po.createdAt,
    items: tables.purchaseOrderItem
      .filter((l) => l.purchaseOrderId === po.id)
      .sort((a, b) => a.id - b.id)
      .map((l) => {
        const item = findById(tables, 'item', l.itemId);
        return {
          id: l.id,
          purchaseRequisitionId: l.purchaseRequisitionId,
          itemId: l.itemId,
          itemCode: item?.itemCode ?? '',
          itemName: item?.itemName ?? '',
          purchaseRequisitionNo: findById(tables, 'purchaseRequisition', l.purchaseRequisitionId)?.purchaseRequisitionNo ?? null,
          orderedTon: l.orderedTon,
          expectedReceiptDate: l.expectedReceiptDate,
          receivedTon: receivedTonOf(tables, l.id),
          remainingTon: remainingTonOf(tables, l),
          goodsReceipts: tables.goodsReceipt
            .filter((g) => g.purchaseOrderItemId === l.id)
            .map((g) => ({ id: g.id, goodsReceiptNo: g.goodsReceiptNo, receivedTon: g.receivedTon, receivedDate: g.receivedDate, lotNo: tables.lot.find((lot) => lot.goodsReceiptId === g.id)?.lotNo ?? null })),
        };
      }),
  };
}

export const listPurchaseOrders = (tables: Tables): PurchaseOrderView[] => [...tables.purchaseOrder].sort((a, b) => b.id - a.id).map((po) => purchaseOrderView(tables, po));

/** 입고할 수 있는 발주 품목 (미입고량 > 0) */
export const receivablePurchaseOrders = (tables: Tables): PurchaseOrderView[] =>
  listPurchaseOrders(tables).filter((po) => po.items.some((i) => decCmp(i.remainingTon, 0) > 0));

/** 입고 1건과 원료 LOT (서버 GoodsReceiptView와 같은 모양 + 화면용 공급업체·확정자) */
export interface GoodsReceiptView {
  id: number;
  goodsReceiptNo: string;
  purchaseOrderId: number;
  purchaseOrderNo: string;
  purchaseOrderItemId: number;
  itemId: number;
  itemCode: string;
  itemName: string;
  receivedTon: string;
  receivedDate: string;
  lotId: number | null;
  lotNo: string | null;
  yardId: number | null;
  yardName: string | null;
  createdAt: string;
  supplierName: string;
  /** 입고를 확정한 사원 (ERD에 칸이 없어 작업 로그 GOODS_RECEIPT_CONFIRMED로 본다) */
  confirmedEmployeeName: string | null;
}

export function goodsReceiptView(tables: Tables, g: GoodsReceiptRow): GoodsReceiptView {
  const poItem = findById(tables, 'purchaseOrderItem', g.purchaseOrderItemId);
  const po = findById(tables, 'purchaseOrder', poItem?.purchaseOrderId);
  const item = findById(tables, 'item', poItem?.itemId);
  const lot = tables.lot.find((l) => l.goodsReceiptId === g.id);
  const confirmed = tables.businessEvent.find((e) => e.businessEventType === 'GOODS_RECEIPT_CONFIRMED' && e.targetType === 'goods_receipt' && e.targetId === g.id);
  return {
    id: g.id,
    goodsReceiptNo: g.goodsReceiptNo,
    purchaseOrderId: po?.id ?? 0,
    purchaseOrderNo: po?.purchaseOrderNo ?? '',
    purchaseOrderItemId: g.purchaseOrderItemId,
    itemId: item?.id ?? 0,
    itemCode: item?.itemCode ?? '',
    itemName: item?.itemName ?? '',
    receivedTon: g.receivedTon,
    receivedDate: g.receivedDate,
    lotId: lot?.id ?? null,
    lotNo: lot?.lotNo ?? null,
    yardId: lot?.yardId ?? null,
    yardName: findById(tables, 'yard', lot?.yardId)?.yardName ?? null,
    createdAt: g.createdAt,
    supplierName: findById(tables, 'supplier', po?.supplierId)?.supplierName ?? '',
    confirmedEmployeeName: employeeNameOf(tables, confirmed?.actorEmployeeId ?? null),
  };
}

export const listGoodsReceipts = (tables: Tables): GoodsReceiptView[] => [...tables.goodsReceipt].sort((a, b) => b.id - a.id).map((g) => goodsReceiptView(tables, g));
