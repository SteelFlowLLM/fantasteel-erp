// 작업 로그 기록기 (REQ-LOG-001·002). 다음 단계의 모든 변경 처리는 같은 트랜잭션 안에서 이 함수를 부른다
// (컨벤션 6장: businessEventRecorder.record(tx, …)). 수정·삭제 함수는 두지 않는다.
import { BUSINESS_EVENT_TYPE, isEventReasonCode, type BusinessEventType, type EventReasonCode } from '@/codes';
import type { BusinessEventRow, DbTableName, JsonValue } from '@/mock/schema';
import { issueEventNo } from '@/mock/sequence';
import { insertRow, type MockTx } from '@/mock/store';

/** 주체: 사람이 실행(AI 초안을 사람이 확정한 경우 포함)이면 USER, 자동 예약·자동 판정 등은 SYSTEM */
export type BusinessEventActor = { actorType: 'USER'; employeeId: number } | { actorType: 'SYSTEM' };

export interface RecordBusinessEventInput {
  businessEventType: BusinessEventType;
  actor: BusinessEventActor;
  /** 대상 테이블명 (용어 사전 DB명, 예: sales_order, lot) */
  targetType: DbTableName;
  targetId: number;
  /** 업무번호·LOT 번호 표시용 */
  targetNo?: string | null;
  /** 수주 타임라인에 묶을 수주 (REQ-LOG-003) */
  salesOrderId?: number | null;
  beforeData?: JsonValue | null;
  afterData?: JsonValue | null;
  /** 업무 프로세스 9.3의 제안값 8개만 쓴다 */
  reasonCode?: EventReasonCode | null;
  /** 사람이 읽을 사유 */
  reasonText?: string | null;
  actionDraftId?: number | null;
  messageId?: number | null;
  /** 이벤트가 걸친 LOT (LOT 타임라인용, business_event_lot) */
  lotIds?: readonly number[];
  /** 생략하면 트랜잭션 시각 */
  occurredAt?: string;
}

const EVENT_TYPES = new Set<string>(Object.values(BUSINESS_EVENT_TYPE));

const snapshotOf = (value: JsonValue | null | undefined): JsonValue | null => (value === undefined || value === null ? null : structuredClone(value));

export function recordBusinessEvent(tx: MockTx, input: RecordBusinessEventInput): BusinessEventRow {
  if (!EVENT_TYPES.has(input.businessEventType)) throw new Error(`작업 로그 이벤트 유형이 아니에요: ${input.businessEventType}`);
  if (input.reasonCode !== undefined && input.reasonCode !== null && !isEventReasonCode(input.reasonCode)) {
    throw new Error(`작업 로그 사유 코드가 아니에요: ${String(input.reasonCode)}`);
  }
  const actor = input.actor;
  if (actor.actorType === 'USER' && !tx.tables.employee.some((e) => e.id === actor.employeeId)) {
    throw new Error(`작업 로그 주체 사원이 없어요: ${actor.employeeId}`);
  }

  const occurredAt = input.occurredAt ?? tx.nowIso;
  const row = insertRow(tx, 'businessEvent', {
    eventNo: issueEventNo(tx, new Date(occurredAt)),
    businessEventType: input.businessEventType,
    actorType: actor.actorType,
    actorEmployeeId: actor.actorType === 'USER' ? actor.employeeId : null,
    targetType: input.targetType,
    targetId: input.targetId,
    targetNo: input.targetNo ?? null,
    salesOrderId: input.salesOrderId ?? null,
    beforeData: snapshotOf(input.beforeData),
    afterData: snapshotOf(input.afterData),
    reasonCode: input.reasonCode ?? null,
    reasonText: input.reasonText ?? null,
    isAiAssisted: false,
    actionDraftId: input.actionDraftId ?? null,
    messageId: input.messageId ?? null,
    occurredAt,
  });

  for (const lotId of new Set(input.lotIds ?? [])) insertRow(tx, 'businessEventLot', { businessEventId: row.id, lotId });
  return row;
}
