// business-event 모듈 응답 타입 (docs/backend/business-event.md, REQ-LOG-001·003, GET /business-events). 시각은 ISO 8601.
import type { ActorType, BusinessEventType, LotType } from './codes';

/** 작업 로그 정렬: asc = 이력 재현(오래된 순, 기본), desc = 최신순 */
export const BUSINESS_EVENT_SORT = {
  ASC: 'asc',
  DESC: 'desc',
} as const;
export type BusinessEventSort = (typeof BUSINESS_EVENT_SORT)[keyof typeof BUSINESS_EVENT_SORT];

/** 이벤트에 연결된 LOT (business_event_lot) */
export interface BusinessEventLotView {
  lotId: number;
  lotNo: string;
  lotType: LotType;
}

/** 작업 로그 한 건 (API-238) */
export interface BusinessEventView {
  id: number;
  businessEventNo: string;
  businessEventType: BusinessEventType;
  /** BUSINESS_EVENT_TYPE_LABEL */
  businessEventTypeLabel: string;
  actorType: ActorType;
  /** SYSTEM이면 null */
  actorEmployeeId: number | null;
  actorEmployeeNo: string | null;
  actorEmployeeName: string | null;
  /** 대상 테이블명(ERD)과 id */
  targetType: string;
  targetId: number;
  salesOrderId: number | null;
  salesOrderNo: string | null;
  /** 변경 전·후 (jsonb 그대로) */
  beforeData: unknown;
  afterData: unknown;
  /** 사유 코드(9.3)와 문장. 예: 'STOCK_FIRST: 합격 재고 6매 예약' */
  reason: string | null;
  isAiAssisted: boolean;
  actionDraftId: number | null;
  messageId: number | null;
  /** 발생 시각 (created_at) */
  occurredAt: string;
  lots: BusinessEventLotView[];
}
