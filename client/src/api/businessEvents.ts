// 작업 로그(Decision Replay) 조회 API — docs/api/business-event.md 의 모양 그대로. 조회 전용.
import type { ActorType, BusinessEventType, EventReasonCode, EventTargetType, LotType } from '@fantasteel/shared';
import { api } from './client';

export interface BusinessEventLot { id: number; lotNo: string; lotType: LotType }

export interface BusinessEventView {
  id: number;
  occurredAt: string;
  actorType: ActorType;
  /** 사용자면 사원 이름, 시스템이면 "시스템" */
  actorLabel: string;
  actor: { employeeId: number; employeeNo: string; employeeName: string; departmentName: string; jobGrade: string } | null;
  eventType: BusinessEventType;
  eventTypeLabel: string;
  targetType: EventTargetType;
  targetId: number | null;
  targetNo: string | null;
  salesOrderId: number | null;
  salesOrderNo: string | null;
  lotIds: number[];
  lots: BusinessEventLot[];
  summary: string;
  before: unknown | null;
  after: unknown | null;
  reasonCode: EventReasonCode | null;
  reason: string | null;
  /** AI 초안으로 확정한 작업 (P2 — v2에서는 항상 false) */
  isAiAssisted: boolean;
  messageId: number | null;
  actionDraftId: number | null;
  /** lotId + includeLineage 조회에서 요청한 LOT이 아니라 조상·자손 LOT의 이벤트이면 true */
  isLineageOnly: boolean;
}

export interface BusinessEventListResponse {
  items: BusinessEventView[];
  nextCursor: number | null;
  hasMore: boolean;
  order: 'asc' | 'desc';
}

export interface BusinessEventQuery {
  salesOrderId?: number;
  lotId?: number;
  includeLineage?: boolean;
  eventType?: BusinessEventType;
  actorType?: ActorType;
  targetType?: EventTargetType;
  /** YYYY-MM-DD 또는 ISO */
  from?: string;
  to?: string;
  q?: string;
  limit?: number;
  cursor?: number;
  order?: 'asc' | 'desc';
}

/** GET /search?q= (docs/api/dashboard.md) — 수주번호를 id로 풀 때만 쓴다. */
export interface SearchHit {
  kind: 'SALES_ORDER' | 'LOT' | 'PRODUCTION_PLAN' | 'PURCHASE_REQUISITION' | 'SHIPMENT_REQUEST' | 'MILL_SHEET';
  kindLabel: string;
  label: string;
  linkPath: string;
}

export const businessEventApi = {
  list: (q: BusinessEventQuery = {}) => api.get<BusinessEventListResponse>('/business-events', { ...q }),
  get: (id: number) => api.get<BusinessEventView>(`/business-events/${id}`),
  /** 수주번호 일부로 수주를 찾는다 (통합 검색에서 수주만 걸러낸다). id는 linkPath 끝의 숫자. */
  searchSalesOrders: async (q: string): Promise<{ id: number; salesOrderNo: string }[]> => {
    const hits = await api.get<SearchHit[]>('/search', { q });
    return hits
      .filter((h) => h.kind === 'SALES_ORDER')
      .map((h) => ({ id: Number(h.linkPath.split('/').pop()), salesOrderNo: h.label }))
      .filter((h) => Number.isInteger(h.id));
  },
};
