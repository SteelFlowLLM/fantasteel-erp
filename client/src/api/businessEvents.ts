// 작업 로그 조회와 이력 재현 (REQ-LOG-001~003, BP-LOG-01, 업무 프로세스 12.2 GET /business-events?salesOrderId=).
// - 기록은 서버가 각 업무 변경과 같은 트랜잭션에서 남긴다. 여기는 읽기만 한다(수정·삭제 없음).
// - 이력 재현: 수주(business_event.sales_order_id) 또는 LOT(business_event_lot) 단위, 오래된 순, 같은 시각이면 id 순.
// - 전체 작업 로그는 최신순. 필터: 유형(31개), 주체(사용자·시스템), 대상(테이블), 기간(Asia/Seoul 날짜, 시작·끝 포함).
// - 작업 로그는 모든 사원이 여는 화면이다(screens.ts). 서버를 부른다 (api/server/businessEvents.ts).
import { type ActorType, type BusinessEventType, type EventReasonCode, type LotType } from '@/codes';
import { serverBusinessEventApi } from '@/api/server/businessEvents';
import { type TargetFilterTable } from '@/features/businessEvents/lib/eventTargets';
import type { JsonValue } from '@/lib/json';

export interface BusinessEventFilter {
  /** 이력 재현: 수주 단위 */
  salesOrderId?: number;
  /** 이력 재현: LOT 단위 (business_event_lot) */
  lotId?: number;
  businessEventType?: BusinessEventType;
  actorType?: ActorType;
  targetType?: TargetFilterTable;
  /** YYYY-MM-DD (Asia/Seoul, 포함) */
  from?: string;
  /** YYYY-MM-DD (Asia/Seoul, 포함) */
  to?: string;
  /** 불러올 건수 (더 보기로 늘린다) */
  limit?: number;
}

export interface EventActorView {
  employeeId: number;
  employeeName: string;
  employeeNo: string;
  departmentName: string;
  jobGradeName: string;
}

export interface EventLotView {
  id: number;
  lotNo: string;
  lotType: LotType;
}

export interface BusinessEventView {
  id: number;
  eventNo: string;
  businessEventType: BusinessEventType;
  businessEventTypeLabel: string;
  actorType: ActorType;
  actor: EventActorView | null;
  /** 대상 테이블 DB명 (ERD) */
  targetType: string;
  targetTypeLabel: string;
  targetId: number;
  targetNo: string | null;
  /** 화면에 보일 대상: 대상 번호, 없으면 이벤트가 가진 값으로 만든 이름 (예약 "SO-… 품목 1 · 6매", 초안 "초안 #3") */
  targetText: string;
  targetHref: string | null;
  salesOrderId: number | null;
  salesOrderNo: string | null;
  beforeData: JsonValue | null;
  afterData: JsonValue | null;
  reasonCode: EventReasonCode | null;
  reasonText: string | null;
  /** AI 경유 (P2 준비 중). 지금은 늘 false */
  isAiAssisted: boolean;
  actionDraftId: number | null;
  messageId: number | null;
  /** 원본 메시지가 있는 채팅방 (메신저로 이동) */
  messageHref: string | null;
  occurredAt: string;
  lots: EventLotView[];
}

/** 수주·LOT 단위 이력 타임라인 한 건 (REQ-LOG-003) */
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

export interface BusinessEventSubject {
  salesOrder: { id: number; salesOrderNo: string; customerName: string } | null;
  lot: { id: number; lotNo: string; lotType: LotType } | null;
}

export interface BusinessEventPage extends BusinessEventSubject {
  items: BusinessEventView[];
  /** 조건에 맞는 전체 건수 */
  total: number;
  /** asc = 이력 재현(오래된 순), desc = 전체 작업 로그(최신순) */
  sort: 'asc' | 'desc';
}

export interface SalesOrderOption {
  id: number;
  salesOrderNo: string;
  customerName: string;
}

export const BUSINESS_EVENT_PAGE_SIZE = 50;

export const businessEventKeys = {
  all: ['business-events'] as const,
  list: (filter: BusinessEventFilter) => ['business-events', 'list', filter] as const,
  salesOrderOptions: (keyword: string) => ['business-events', 'sales-order-options', keyword] as const,
};

/** 수주·LOT을 고르면 이력 재현(오래된 순) */
export const isReplayFilter = (filter: BusinessEventFilter): boolean => filter.salesOrderId !== undefined || filter.lotId !== undefined;

/** 오래된 순, 같은 시각이면 id 순 (업무 프로세스 BP-LOG-01 "동률은 이벤트 ID 순") */
export const compareEventsAsc = (a: { occurredAt: string; id: number }, b: { occurredAt: string; id: number }): number =>
  Date.parse(a.occurredAt) - Date.parse(b.occurredAt) || a.id - b.id;

export const businessEventApi = {
  /** 작업 로그 목록. 수주·LOT을 고르면 이력 재현(오래된 순), 아니면 최신순. 없는 수주·LOT id는 COM-003. */
  list: (filter: BusinessEventFilter = {}): Promise<BusinessEventPage> => serverBusinessEventApi.list(filter),
  /** 이력 재현용 수주 고르기: 수주번호 일부로 찾는다 (취소된 수주 포함, 최근 순 10건) */
  searchSalesOrders: (keyword: string): Promise<SalesOrderOption[]> => serverBusinessEventApi.searchSalesOrders(keyword),
};
