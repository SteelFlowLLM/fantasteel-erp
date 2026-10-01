// 이력 재현 (REQ-LOG-003, BP-LOG-01 Decision Replay): 수주·LOT 단위 시간순 타임라인. 동률은 이벤트 id 순.
// 작업 로그 화면(전체 필터·검색)은 다른 영역이 만든다. 이 파일은 수주 상세 '이력' 탭이 바로 쓸 읽기 모델이다.
import { BUSINESS_EVENT_TYPE_LABEL, type ActorType, type BusinessEventType, type EventReasonCode } from '@/codes';
import type { BusinessEventRow, JsonValue, MockTables } from '@/mock/schema';
import { employeeNameOf } from '@/mock/services/context';

type Tables = Readonly<MockTables>;

export interface TimelineEvent {
  id: number;
  eventNo: string;
  businessEventType: BusinessEventType;
  businessEventTypeLabel: string;
  actorType: ActorType;
  /** 사용자면 사원 이름, 시스템이면 '시스템' */
  actorName: string;
  targetType: string;
  targetId: number;
  targetNo: string | null;
  salesOrderId: number | null;
  reasonCode: EventReasonCode | null;
  reasonText: string | null;
  beforeData: JsonValue | null;
  afterData: JsonValue | null;
  messageId: number | null;
  actionDraftId: number | null;
  occurredAt: string;
  lotNos: string[];
}

const byTime = (a: BusinessEventRow, b: BusinessEventRow) => a.occurredAt.localeCompare(b.occurredAt) || a.id - b.id;

export function timelineEventOf(tables: Tables, e: BusinessEventRow): TimelineEvent {
  const lotIds = new Set(tables.businessEventLot.filter((l) => l.businessEventId === e.id).map((l) => l.lotId));
  return {
    id: e.id,
    eventNo: e.eventNo,
    businessEventType: e.businessEventType,
    businessEventTypeLabel: BUSINESS_EVENT_TYPE_LABEL[e.businessEventType],
    actorType: e.actorType,
    actorName: e.actorType === 'SYSTEM' ? '시스템' : (employeeNameOf(tables, e.actorEmployeeId) ?? '사용자'),
    targetType: e.targetType,
    targetId: e.targetId,
    targetNo: e.targetNo,
    salesOrderId: e.salesOrderId,
    reasonCode: e.reasonCode,
    reasonText: e.reasonText,
    beforeData: e.beforeData,
    afterData: e.afterData,
    messageId: e.messageId,
    actionDraftId: e.actionDraftId,
    occurredAt: e.occurredAt,
    lotNos: tables.lot.filter((l) => lotIds.has(l.id)).map((l) => l.lotNo),
  };
}

/** 수주 타임라인 (business_event.sales_order_id) */
export const salesOrderTimeline = (tables: Tables, salesOrderId: number): TimelineEvent[] =>
  tables.businessEvent.filter((e) => e.salesOrderId === salesOrderId).sort(byTime).map((e) => timelineEventOf(tables, e));

/** LOT 타임라인 (business_event_lot) */
export function lotTimeline(tables: Tables, lotId: number): TimelineEvent[] {
  const eventIds = new Set(tables.businessEventLot.filter((l) => l.lotId === lotId).map((l) => l.businessEventId));
  return tables.businessEvent.filter((e) => eventIds.has(e.id)).sort(byTime).map((e) => timelineEventOf(tables, e));
}
