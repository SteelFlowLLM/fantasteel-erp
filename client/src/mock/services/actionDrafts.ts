// Message → ERP 초안 (REQ-ACT-001~004, BP-ACT-01, 13.4, 업무 프로세스 10장 Action Draft).
// - 채팅 메시지에서 초안을 만든다(요구사항대로 모든 채팅방, PLAN 6-4). 요청자 = 메시지 보낸 사람, message_id 연결.
//   AI 추출은 아직 없다(PLAN 1-7): 생성(AI_GENERATED) 직후 확인 대기(WAITING_APPROVAL)로 두고 요청자가 칸을 직접 채운다.
// - 확정은 요청자만(아니면 COM-002). 필수값(원료 품목·수량(톤)·희망 입고일)이 비면 ACT-001 → APPROVED.
// - 실행은 업무 유형 등록부(REQ-ACT-004)를 거친다. PURCHASE_REQUISITION_CREATE만 P1으로 켜져 있고 나머지는 P2 '준비 중'.
//   구매요청을 만들면(action_draft_id) EXECUTED. 그 구매요청은 따로 부서장 승인을 거친다.
//   실행이 실패하면 상태를 바꾸지 않고 execution_result에 에러 코드·시도 횟수를 남긴다(APPROVED 유지, 다시 실행 가능).
// - 반려하면 REJECTED로 끝난다. 같은 초안을 두 번 실행하지 않는다.
import { ACTION_TYPE_GRADE, ACTION_TYPE_LABEL, type ActionType, type DraftStatus, type ErrorCode } from '@/codes';
import { ApiError, InputError } from '@/api/errors';
import { decCmp, isDecimalText } from '@/lib/decimal';
import { recordBusinessEvent } from '@/mock/businessEvents';
import type { ActionDraftRow, JsonValue, MockTables } from '@/mock/schema';
import { insertRow, updateRow, type MockTx } from '@/mock/store';
import { assertNotChanged, checkText, employeeNameOf, FieldErrors, findById, inputError, isDateText, mustGet, type PersonActor } from '@/mock/services/context';
import { createPurchaseRequisition } from '@/mock/services/purchasing';
import { postSystemMessage } from '@/mock/services/workRooms';

type Tables = Readonly<MockTables>;

/** 구매요청 초안 추출 스키마 (REQ-ACT-001: 원료 품목, 수량(톤), 희망 입고일, 요청자 — 요청자는 draft.requester_id) */
export type PurchaseRequisitionDraftPayload = {
  itemId: number | null;
  requiredTon: string | null;
  desiredReceiptDate: string | null;
  requestReason: string | null;
  /** 원본 메시지 글 (참고용 복사) */
  sourceText: string | null;
};

export interface ActionDraftField {
  key: keyof PurchaseRequisitionDraftPayload;
  label: string;
  required: boolean;
}

export interface ActionExecution {
  targetType: 'purchase_requisition';
  targetId: number;
  targetNo: string;
}

export interface ActionTypeDefinition {
  actionType: ActionType;
  label: string;
  grade: 'P1' | 'P2';
  fields: readonly ActionDraftField[];
  /** null = 준비 중(P2) */
  execute: ((tx: MockTx, actor: PersonActor, draft: ActionDraftRow) => ActionExecution) | null;
}

const PURCHASE_REQUISITION_FIELDS: readonly ActionDraftField[] = [
  { key: 'itemId', label: '원료 품목', required: true },
  { key: 'requiredTon', label: '수량(톤)', required: true },
  { key: 'desiredReceiptDate', label: '희망 입고일', required: true },
  { key: 'requestReason', label: '요청 근거', required: false },
];

function executePurchaseRequisition(tx: MockTx, actor: PersonActor, draft: ActionDraftRow): ActionExecution {
  const payload = draftPayloadOf(draft);
  const message = findById(tx.tables, 'message', draft.messageId);
  const { purchaseRequisition } = createPurchaseRequisition(tx, actor, {
    desiredReceiptDate: payload.desiredReceiptDate,
    requestReason: payload.requestReason ?? (message?.content ? `메시지: ${message.content}`.slice(0, 500) : null),
    items: [{ itemId: payload.itemId ?? 0, requiredTon: payload.requiredTon ?? '0', productionPlanId: null }],
    actionDraftId: draft.id,
    messageId: draft.messageId,
  });
  return { targetType: 'purchase_requisition', targetId: purchaseRequisition.id, targetNo: purchaseRequisition.purchaseRequisitionNo };
}

/** 업무 유형 등록부 (REQ-ACT-004): 유형 → 추출 스키마 + 실행 핸들러. P2 유형은 준비 중. */
export const ACTION_TYPE_REGISTRY: Record<ActionType, ActionTypeDefinition> = {
  PURCHASE_REQUISITION_CREATE: {
    actionType: 'PURCHASE_REQUISITION_CREATE',
    label: ACTION_TYPE_LABEL.PURCHASE_REQUISITION_CREATE,
    grade: ACTION_TYPE_GRADE.PURCHASE_REQUISITION_CREATE,
    fields: PURCHASE_REQUISITION_FIELDS,
    execute: executePurchaseRequisition,
  },
  SHIPMENT_REQUEST_CREATE: { actionType: 'SHIPMENT_REQUEST_CREATE', label: ACTION_TYPE_LABEL.SHIPMENT_REQUEST_CREATE, grade: ACTION_TYPE_GRADE.SHIPMENT_REQUEST_CREATE, fields: [], execute: null },
  SALES_ORDER_CREATE: { actionType: 'SALES_ORDER_CREATE', label: ACTION_TYPE_LABEL.SALES_ORDER_CREATE, grade: ACTION_TYPE_GRADE.SALES_ORDER_CREATE, fields: [], execute: null },
  PRODUCTION_PLAN_CREATE: { actionType: 'PRODUCTION_PLAN_CREATE', label: ACTION_TYPE_LABEL.PRODUCTION_PLAN_CREATE, grade: ACTION_TYPE_GRADE.PRODUCTION_PLAN_CREATE, fields: [], execute: null },
  ALLOCATION_CONFIRM: { actionType: 'ALLOCATION_CONFIRM', label: ACTION_TYPE_LABEL.ALLOCATION_CONFIRM, grade: ACTION_TYPE_GRADE.ALLOCATION_CONFIRM, fields: [], execute: null },
  REPRODUCTION_PLAN_CREATE: { actionType: 'REPRODUCTION_PLAN_CREATE', label: ACTION_TYPE_LABEL.REPRODUCTION_PLAN_CREATE, grade: ACTION_TYPE_GRADE.REPRODUCTION_PLAN_CREATE, fields: [], execute: null },
};

const isRecord = (value: JsonValue): value is { [key: string]: JsonValue } => typeof value === 'object' && value !== null && !Array.isArray(value);

/** 저장된 payload(jsonb)를 구매요청 초안 값으로 읽는다 */
export function draftPayloadOf(draft: ActionDraftRow): PurchaseRequisitionDraftPayload {
  const p = isRecord(draft.payload) ? draft.payload : {};
  const str = (v: JsonValue | undefined) => (typeof v === 'string' && v.trim() !== '' ? v : null);
  return {
    itemId: typeof p.itemId === 'number' ? p.itemId : null,
    requiredTon: str(p.requiredTon),
    desiredReceiptDate: str(p.desiredReceiptDate),
    requestReason: str(p.requestReason),
    sourceText: str(p.sourceText),
  };
}

/** 확정 전에 비어 있거나 기준정보와 맞지 않는 필수 칸 (표시명) */
export function unresolvedDraftFields(tables: Tables, draft: ActionDraftRow): string[] {
  const definition = ACTION_TYPE_REGISTRY[draft.actionType];
  if (draft.actionType !== 'PURCHASE_REQUISITION_CREATE') return definition.fields.filter((f) => f.required).map((f) => f.label);
  const p = draftPayloadOf(draft);
  const missing: string[] = [];
  const item = findById(tables, 'item', p.itemId);
  if (!item || item.itemType !== 'RAW_MATERIAL') missing.push('원료 품목');
  if (!p.requiredTon || !isDecimalText(p.requiredTon) || decCmp(p.requiredTon, 0) <= 0 || !/^\d{1,9}(\.\d{1,3})?$/.test(p.requiredTon)) missing.push('수량(톤)');
  if (!p.desiredReceiptDate || !isDateText(p.desiredReceiptDate)) missing.push('희망 입고일');
  return missing;
}

const draftSnapshot = (draft: ActionDraftRow) => ({ id: draft.id, actionType: draft.actionType, draftStatus: draft.draftStatus, payload: draft.payload, requesterId: draft.requesterId, messageId: draft.messageId });

function salesOrderIdOfMessage(tables: Tables, messageId: number | null): number | null {
  const message = findById(tables, 'message', messageId);
  return findById(tables, 'chatRoom', message?.chatRoomId)?.salesOrderId ?? null;
}

/**
 * 메시지에서 초안을 만든다 (REQ-ACT-001). 만드는 사람은 그 방 멤버여야 한다(아니면 COM-002).
 * 같은 메시지·유형으로 반려되지 않은 초안이 있으면 새로 만들지 않고 그것을 돌려준다(중복 방지).
 */
export function createDraftFromMessage(tx: MockTx, actor: PersonActor, input: { messageId: number; actionType?: ActionType }): { draft: ActionDraftRow; created: boolean } {
  const actionType = input.actionType ?? 'PURCHASE_REQUISITION_CREATE';
  const definition = ACTION_TYPE_REGISTRY[actionType];
  if (!definition.execute) inputError('actionType', `${definition.label}은 준비 중인 업무 유형이에요`);
  const message = mustGet(tx.tables, 'message', input.messageId, '메시지');
  if (!tx.tables.chatRoomMember.some((m) => m.chatRoomId === message.chatRoomId && m.employeeId === actor.employeeId)) throw new ApiError('COM-002', '채팅방 멤버만 초안을 만들 수 있어요');
  if (!tx.tables.employee.some((e) => e.id === message.senderId)) inputError('messageId', '사원이 보낸 메시지에서만 초안을 만들 수 있어요');
  const existing = tx.tables.actionDraft.find((d) => d.messageId === message.id && d.actionType === actionType && d.draftStatus !== 'REJECTED');
  if (existing) return { draft: existing, created: false };
  const payload: PurchaseRequisitionDraftPayload = { itemId: null, requiredTon: null, desiredReceiptDate: null, requestReason: null, sourceText: message.content };
  const draft = insertRow(tx, 'actionDraft', {
    actionType,
    draftStatus: 'AI_GENERATED',
    payload,
    requesterId: message.senderId,
    messageId: message.id,
    executionResult: null,
    rejectReason: null,
    confirmedAt: null,
    executedAt: null,
    rejectedAt: null,
  });
  recordBusinessEvent(tx, {
    businessEventType: 'DRAFT_CREATED',
    actor,
    targetType: 'action_draft',
    targetId: draft.id,
    targetNo: null,
    salesOrderId: salesOrderIdOfMessage(tx.tables, message.id),
    afterData: draftSnapshot(draft),
    reasonText: 'AI 자동 추출 준비 중 — 요청자가 직접 입력',
    actionDraftId: draft.id,
    messageId: message.id,
  });
  const waiting = updateRow(tx, 'actionDraft', draft.id, { draftStatus: 'WAITING_APPROVAL' }) ?? draft;
  return { draft: waiting, created: true };
}

function requesterDraft(tables: Tables, actor: PersonActor, actionDraftId: number, expectedUpdatedAt: string | null | undefined, allowed: readonly DraftStatus[]): ActionDraftRow {
  const draft = mustGet(tables, 'actionDraft', actionDraftId, '초안');
  assertNotChanged(draft.updatedAt, expectedUpdatedAt, '초안');
  if (draft.requesterId !== actor.employeeId) throw new ApiError('COM-002', '요청자만 확인·확정할 수 있어요');
  if (!allowed.includes(draft.draftStatus)) inputError('actionDraftId', '이 상태의 초안은 바꿀 수 없어요');
  return draft;
}

/** 요청자가 칸을 고친다 (확인 대기일 때만). 넘긴 칸만 바꾼다. 형식이 틀리면 입력 오류. */
export function updateDraft(
  tx: MockTx,
  actor: PersonActor,
  input: { actionDraftId: number; payload: Partial<Omit<PurchaseRequisitionDraftPayload, 'sourceText'>>; expectedUpdatedAt?: string | null },
): ActionDraftRow {
  const draft = requesterDraft(tx.tables, actor, input.actionDraftId, input.expectedUpdatedAt, ['AI_GENERATED', 'WAITING_APPROVAL']);
  const current = draftPayloadOf(draft);
  const errors = new FieldErrors();
  const next: PurchaseRequisitionDraftPayload = { ...current };
  if (input.payload.itemId !== undefined) {
    if (input.payload.itemId !== null) {
      const item = findById(tx.tables, 'item', input.payload.itemId);
      if (!item || item.itemType !== 'RAW_MATERIAL') errors.add('itemId', '원료 품목을 골라 주세요');
    }
    next.itemId = input.payload.itemId;
  }
  if (input.payload.requiredTon !== undefined) {
    const text = (input.payload.requiredTon ?? '').trim();
    if (text && !/^\d{1,9}(\.\d{1,3})?$/.test(text)) errors.add('requiredTon', '수량(톤)은 소수 3자리까지 숫자로 입력해 주세요');
    next.requiredTon = text || null;
  }
  if (input.payload.desiredReceiptDate !== undefined) {
    const text = (input.payload.desiredReceiptDate ?? '').trim();
    if (text && !isDateText(text)) errors.add('desiredReceiptDate', '희망 입고일은 YYYY-MM-DD 형식의 날짜로 입력해 주세요');
    next.desiredReceiptDate = text || null;
  }
  if (input.payload.requestReason !== undefined) next.requestReason = checkText(errors, 'requestReason', input.payload.requestReason, '요청 근거', 500, false);
  errors.throwIfAny();
  return updateRow(tx, 'actionDraft', draft.id, { payload: next, draftStatus: 'WAITING_APPROVAL' }) ?? draft;
}

export interface DraftExecutionOutcome {
  draft: ActionDraftRow;
  executed: boolean;
  target: ActionExecution | null;
  errorCode: ErrorCode | null;
  errorMessage: string | null;
}

function attemptsOf(draft: ActionDraftRow): number {
  const result = draft.executionResult;
  if (result === null || !isRecord(result)) return 0;
  return typeof result.attempts === 'number' ? result.attempts : 0;
}

/** 등록부의 핸들러로 실행한다. 실패하면 APPROVED 그대로 두고 결과만 남긴다. */
function runHandler(tx: MockTx, actor: PersonActor, draft: ActionDraftRow): DraftExecutionOutcome {
  const definition = ACTION_TYPE_REGISTRY[draft.actionType];
  if (tx.tables.purchaseRequisition.some((p) => p.actionDraftId === draft.id)) inputError('actionDraftId', '이미 실행한 초안이에요');
  const attempts = attemptsOf(draft) + 1;
  if (!definition.execute) inputError('actionType', `${definition.label}은 준비 중인 업무 유형이에요`);
  try {
    const target = definition.execute(tx, actor, draft);
    const executed =
      updateRow(tx, 'actionDraft', draft.id, { draftStatus: 'EXECUTED', executedAt: tx.nowIso, executionResult: { ...target, attempts, errorCode: null } }) ?? draft;
    recordBusinessEvent(tx, {
      businessEventType: 'DRAFT_EXECUTED',
      actor,
      targetType: 'action_draft',
      targetId: draft.id,
      salesOrderId: salesOrderIdOfMessage(tx.tables, draft.messageId),
      beforeData: { draftStatus: draft.draftStatus },
      afterData: { draftStatus: 'EXECUTED', targetType: target.targetType, targetId: target.targetId, targetNo: target.targetNo },
      actionDraftId: draft.id,
      messageId: draft.messageId,
    });
    const message = findById(tx.tables, 'message', draft.messageId);
    if (message) postSystemMessage(tx, message.chatRoomId, `초안 #${draft.id}로 구매요청 ${target.targetNo}을 만들었어요. 부서장 승인을 기다려요`);
    return { draft: executed, executed: true, target, errorCode: null, errorMessage: null };
  } catch (error) {
    if (!(error instanceof ApiError) && !(error instanceof InputError)) throw error;
    const errorCode = error instanceof ApiError ? error.code : null;
    const failed =
      updateRow(tx, 'actionDraft', draft.id, { executionResult: { attempts, errorCode, message: error.message, targetType: null, targetId: null, targetNo: null } }) ?? draft;
    return { draft: failed, executed: false, target: null, errorCode, errorMessage: error.message };
  }
}

/**
 * 요청자 확정 (13.4): 필수값 확인(ACT-001) → APPROVED(DRAFT_CONFIRMED, 사유 DRAFT_CONFIRMED) → 핸들러 실행 → EXECUTED(DRAFT_EXECUTED).
 */
export function confirmDraft(tx: MockTx, actor: PersonActor, input: { actionDraftId: number; expectedUpdatedAt?: string | null }): DraftExecutionOutcome {
  const draft = requesterDraft(tx.tables, actor, input.actionDraftId, input.expectedUpdatedAt, ['AI_GENERATED', 'WAITING_APPROVAL']);
  const unresolved = unresolvedDraftFields(tx.tables, draft);
  if (unresolved.length > 0) throw new ApiError('ACT-001', unresolved.join(', '));
  const approved = updateRow(tx, 'actionDraft', draft.id, { draftStatus: 'APPROVED', confirmedAt: tx.nowIso }) ?? draft;
  recordBusinessEvent(tx, {
    businessEventType: 'DRAFT_CONFIRMED',
    actor,
    targetType: 'action_draft',
    targetId: draft.id,
    salesOrderId: salesOrderIdOfMessage(tx.tables, draft.messageId),
    beforeData: draftSnapshot(draft),
    afterData: draftSnapshot(approved),
    reasonCode: 'DRAFT_CONFIRMED',
    reasonText: '요청자가 초안을 확인·확정',
    actionDraftId: draft.id,
    messageId: draft.messageId,
  });
  return runHandler(tx, actor, approved);
}

/** 확정했지만 실행에 실패한 초안을 다시 실행한다 (요청자만) */
export function executeDraft(tx: MockTx, actor: PersonActor, input: { actionDraftId: number }): DraftExecutionOutcome {
  const draft = requesterDraft(tx.tables, actor, input.actionDraftId, null, ['APPROVED']);
  return runHandler(tx, actor, draft);
}

/** 요청자 반려 → REJECTED (사유 필수) */
export function rejectDraft(tx: MockTx, actor: PersonActor, input: { actionDraftId: number; rejectReason: string; expectedUpdatedAt?: string | null }): ActionDraftRow {
  const draft = requesterDraft(tx.tables, actor, input.actionDraftId, input.expectedUpdatedAt, ['AI_GENERATED', 'WAITING_APPROVAL']);
  const errors = new FieldErrors();
  const rejectReason = checkText(errors, 'rejectReason', input.rejectReason, '반려 사유', 500, true);
  errors.throwIfAny();
  const rejected = updateRow(tx, 'actionDraft', draft.id, { draftStatus: 'REJECTED', rejectReason, rejectedAt: tx.nowIso }) ?? draft;
  recordBusinessEvent(tx, {
    businessEventType: 'DRAFT_REJECTED',
    actor,
    targetType: 'action_draft',
    targetId: draft.id,
    salesOrderId: salesOrderIdOfMessage(tx.tables, draft.messageId),
    beforeData: draftSnapshot(draft),
    afterData: draftSnapshot(rejected),
    reasonText: rejectReason,
    actionDraftId: draft.id,
    messageId: draft.messageId,
  });
  return rejected;
}

// ── 조회 ──────────────────────────────────────────────

export interface ActionDraftView {
  id: number;
  actionType: ActionType;
  actionTypeLabel: string;
  draftStatus: DraftStatus;
  payload: PurchaseRequisitionDraftPayload;
  itemCode: string | null;
  itemName: string | null;
  requesterId: number;
  requesterName: string | null;
  message: { id: number; chatRoomId: number; chatRoomName: string | null; senderName: string | null; content: string | null; createdAt: string } | null;
  /** 확정 전 채워야 할 칸 */
  unresolvedFields: string[];
  purchaseRequisition: { id: number; purchaseRequisitionNo: string; purchaseRequisitionStatus: string } | null;
  executionResult: JsonValue | null;
  rejectReason: string | null;
  createdAt: string;
  updatedAt: string;
  confirmedAt: string | null;
  executedAt: string | null;
  rejectedAt: string | null;
}

export function actionDraftView(tables: Tables, actionDraftId: number): ActionDraftView {
  const draft = mustGet(tables, 'actionDraft', actionDraftId, '초안');
  const payload = draftPayloadOf(draft);
  const item = findById(tables, 'item', payload.itemId);
  const message = findById(tables, 'message', draft.messageId);
  const room = findById(tables, 'chatRoom', message?.chatRoomId);
  const pr = tables.purchaseRequisition.find((p) => p.actionDraftId === draft.id);
  return {
    id: draft.id,
    actionType: draft.actionType,
    actionTypeLabel: ACTION_TYPE_LABEL[draft.actionType],
    draftStatus: draft.draftStatus,
    payload,
    itemCode: item?.itemCode ?? null,
    itemName: item?.itemName ?? null,
    requesterId: draft.requesterId,
    requesterName: employeeNameOf(tables, draft.requesterId),
    message: message
      ? { id: message.id, chatRoomId: message.chatRoomId, chatRoomName: room?.chatRoomName ?? null, senderName: employeeNameOf(tables, message.senderId), content: message.content, createdAt: message.createdAt }
      : null,
    unresolvedFields: draft.draftStatus === 'AI_GENERATED' || draft.draftStatus === 'WAITING_APPROVAL' ? unresolvedDraftFields(tables, draft) : [],
    purchaseRequisition: pr ? { id: pr.id, purchaseRequisitionNo: pr.purchaseRequisitionNo, purchaseRequisitionStatus: pr.purchaseRequisitionStatus } : null,
    executionResult: draft.executionResult,
    rejectReason: draft.rejectReason,
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
    confirmedAt: draft.confirmedAt,
    executedAt: draft.executedAt,
    rejectedAt: draft.rejectedAt,
  };
}

export const listActionDrafts = (tables: Tables, filter: { requesterId?: number } = {}): ActionDraftView[] =>
  tables.actionDraft
    .filter((d) => filter.requesterId === undefined || d.requesterId === filter.requesterId)
    .sort((a, b) => b.id - a.id)
    .map((d) => actionDraftView(tables, d.id));
