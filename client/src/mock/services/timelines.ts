// 이력 재현 (REQ-LOG-003, BP-LOG-01 Decision Replay): 수주·LOT 단위 시간순 타임라인. 동률은 이벤트 id 순.
// 작업 로그 화면(전체 필터·검색)은 다른 영역이 만든다. 이 파일은 수주 상세 '이력' 탭이 바로 쓸 읽기 모델이다.
import { BUSINESS_EVENT_TYPE_LABEL, type ActorType, type BusinessEventType, type EventReasonCode } from '@/codes';
import type { BusinessEventRow, JsonValue, MockTables } from '@/mock/schema';
import { employeeNameOf, qtyUnitOfItem } from '@/mock/services/context';

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
  /** 화면에 보일 대상: 대상 번호, 없으면 이벤트가 가진 값으로 만든 이름 (eventTargetTextOf) */
  targetText: string;
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

const isJsonRecord = (value: JsonValue | null): value is { [key: string]: JsonValue } => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * 작업 로그 대상의 화면 이름. 대상 번호(target_no)가 있으면 그대로 쓰고, 없으면 이벤트가 가진 값으로 만든다.
 * - 예약(번호 없음): 수주 번호 + 품목 번호 + 매수(after_data) — "SO-2610-001 품목 1 · 6매"
 * - Action Draft(업무 번호 없음, 9.1): "초안 #3"
 * - 그 밖: "#대상 id"
 */
export function eventTargetTextOf(tables: Tables, e: Pick<BusinessEventRow, 'targetType' | 'targetId' | 'targetNo' | 'salesOrderId' | 'afterData'>): string {
  if (e.targetNo) return e.targetNo;
  if (e.targetType === 'action_draft') return `초안 #${e.targetId}`;
  if (e.targetType === 'reservation') {
    const after = isJsonRecord(e.afterData) ? e.afterData : {};
    const salesOrderNo = tables.salesOrder.find((so) => so.id === e.salesOrderId)?.salesOrderNo;
    const soItemId = typeof after.salesOrderItemId === 'number' ? after.salesOrderItemId : null;
    const lineNo = tables.salesOrderItem.find((i) => i.id === soItemId)?.lineNo;
    const itemId = typeof after.itemId === 'number' ? after.itemId : null;
    const qty = typeof after.reservedQty === 'number' ? `${after.reservedQty}${qtyUnitOfItem(tables, itemId)}` : null;
    const head = [salesOrderNo, lineNo === undefined ? null : `품목 ${lineNo}`].filter(Boolean).join(' ');
    const text = [head, qty].filter(Boolean).join(' · ');
    if (text) return text;
  }
  return `#${e.targetId}`;
}

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
    targetText: eventTargetTextOf(tables, e),
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
