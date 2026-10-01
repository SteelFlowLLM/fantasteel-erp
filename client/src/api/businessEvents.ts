// 작업 로그 조회와 이력 재현 (REQ-LOG-001~003, BP-LOG-01, 업무 프로세스 12.2 GET /business-events?salesOrderId=).
// - 기록은 각 업무 변경이 같은 트랜잭션 안에서 recordBusinessEvent로 남긴다. 여기는 읽기만 한다(수정·삭제 없음).
// - 이력 재현: 수주(business_event.sales_order_id) 또는 LOT(business_event_lot) 단위, 오래된 순, 같은 시각이면 id 순.
// - 전체 작업 로그는 최신순. 필터: 유형(29개), 주체(사용자·시스템), 대상(테이블), 기간(Asia/Seoul 날짜, 시작·끝 포함).
// - 작업 로그는 모든 사원이 여는 화면이라(screens.ts) 로그인한 사용 중 사원인지만 확인한다.
import { BUSINESS_EVENT_TYPE_LABEL, type ActorType, type BusinessEventType, type EventReasonCode, type LotType } from '@/codes';
import { requireActor } from '@/api/actor';
import { ApiError, mockQuery } from '@/api/client';
import { targetHref, targetTableLabel } from '@/features/businessEvents/lib/eventTargets';
import { toSeoulDateString } from '@/lib/seoulDate';
import type { BusinessEventRow, DbTableName, IsoDateTime, JsonValue, MockTables } from '@/mock/schema';
import { findRow } from '@/mock/store';

export interface BusinessEventFilter {
  /** 이력 재현: 수주 단위 */
  salesOrderId?: number;
  /** 이력 재현: LOT 단위 (business_event_lot) */
  lotId?: number;
  businessEventType?: BusinessEventType;
  actorType?: ActorType;
  targetType?: DbTableName;
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
  targetType: DbTableName;
  targetTypeLabel: string;
  targetId: number;
  targetNo: string | null;
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
  occurredAt: IsoDateTime;
  lots: EventLotView[];
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
const MAX_LIMIT = 1000;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export const businessEventKeys = {
  all: ['business-events'] as const,
  list: (filter: BusinessEventFilter) => ['business-events', 'list', filter] as const,
  salesOrderOptions: (keyword: string) => ['business-events', 'sales-order-options', keyword] as const,
};

/** 수주·LOT을 고르면 이력 재현(오래된 순) */
export const isReplayFilter = (filter: BusinessEventFilter): boolean => filter.salesOrderId !== undefined || filter.lotId !== undefined;

/** 오래된 순, 같은 시각이면 id 순 (업무 프로세스 BP-LOG-01 "동률은 이벤트 ID 순") */
export const compareEventsAsc = (a: Pick<BusinessEventRow, 'occurredAt' | 'id'>, b: Pick<BusinessEventRow, 'occurredAt' | 'id'>): number =>
  Date.parse(a.occurredAt) - Date.parse(b.occurredAt) || a.id - b.id;

function actorOf(tables: Readonly<MockTables>, employeeId: number | null): EventActorView | null {
  const employee = findRow(tables, 'employee', employeeId);
  if (!employee) return null;
  return {
    employeeId: employee.id,
    employeeName: employee.employeeName,
    employeeNo: employee.employeeNo,
    departmentName: findRow(tables, 'department', employee.departmentId)?.departmentName ?? '',
    jobGradeName: findRow(tables, 'jobGrade', employee.jobGradeId)?.jobGradeName ?? '',
  };
}

function toView(tables: Readonly<MockTables>, row: BusinessEventRow, lotsByEvent: Map<number, EventLotView[]>): BusinessEventView {
  const salesOrder = findRow(tables, 'salesOrder', row.salesOrderId);
  const message = findRow(tables, 'message', row.messageId);
  const inspectedLotId = row.targetType === 'quality_inspection' ? (findRow(tables, 'qualityInspection', row.targetId)?.lotId ?? null) : null;
  const productionPlanId = row.targetType === 'production_result' ? (findRow(tables, 'productionResult', row.targetId)?.productionPlanId ?? null) : null;
  const receivedItemId = row.targetType === 'goods_receipt' ? (findRow(tables, 'goodsReceipt', row.targetId)?.purchaseOrderItemId ?? null) : null;
  const purchaseOrderId = receivedItemId === null ? null : (findRow(tables, 'purchaseOrderItem', receivedItemId)?.purchaseOrderId ?? null);
  return {
    id: row.id,
    eventNo: row.eventNo,
    businessEventType: row.businessEventType,
    businessEventTypeLabel: BUSINESS_EVENT_TYPE_LABEL[row.businessEventType],
    actorType: row.actorType,
    actor: row.actorType === 'USER' ? actorOf(tables, row.actorEmployeeId) : null,
    targetType: row.targetType,
    targetTypeLabel: targetTableLabel(row.targetType),
    targetId: row.targetId,
    targetNo: row.targetNo,
    targetHref: targetHref({ targetType: row.targetType, targetId: row.targetId, targetNo: row.targetNo, salesOrderId: row.salesOrderId, lotId: inspectedLotId, productionPlanId, purchaseOrderId }),
    salesOrderId: row.salesOrderId,
    salesOrderNo: salesOrder?.salesOrderNo ?? null,
    beforeData: row.beforeData,
    afterData: row.afterData,
    reasonCode: row.reasonCode,
    reasonText: row.reasonText,
    isAiAssisted: row.isAiAssisted,
    actionDraftId: row.actionDraftId,
    messageId: row.messageId,
    messageHref: message ? `/messenger?room=${message.chatRoomId}&message=${message.id}` : null,
    occurredAt: row.occurredAt,
    lots: lotsByEvent.get(row.id) ?? [],
  };
}

function subjectOf(tables: Readonly<MockTables>, filter: BusinessEventFilter): BusinessEventSubject {
  let salesOrder: BusinessEventSubject['salesOrder'] = null;
  if (filter.salesOrderId !== undefined) {
    const so = findRow(tables, 'salesOrder', filter.salesOrderId);
    if (!so) throw new ApiError('COM-003', `수주 ${filter.salesOrderId}`);
    salesOrder = { id: so.id, salesOrderNo: so.salesOrderNo, customerName: findRow(tables, 'customer', so.customerId)?.customerName ?? '' };
  }
  let lot: BusinessEventSubject['lot'] = null;
  if (filter.lotId !== undefined) {
    const row = findRow(tables, 'lot', filter.lotId);
    if (!row) throw new ApiError('COM-003', `LOT ${filter.lotId}`);
    lot = { id: row.id, lotNo: row.lotNo, lotType: row.lotType };
  }
  return { salesOrder, lot };
}

/** 조건에 맞는 작업 로그 행 (정렬 전) */
export function filterBusinessEvents(tables: Readonly<MockTables>, filter: BusinessEventFilter): BusinessEventRow[] {
  const lotEventIds =
    filter.lotId !== undefined ? new Set(tables.businessEventLot.filter((link) => link.lotId === filter.lotId).map((link) => link.businessEventId)) : null;
  const from = filter.from && DATE_ONLY.test(filter.from) ? filter.from : null;
  const to = filter.to && DATE_ONLY.test(filter.to) ? filter.to : null;
  return tables.businessEvent.filter((event) => {
    if (filter.salesOrderId !== undefined && event.salesOrderId !== filter.salesOrderId) return false;
    if (lotEventIds && !lotEventIds.has(event.id)) return false;
    if (filter.businessEventType && event.businessEventType !== filter.businessEventType) return false;
    if (filter.actorType && event.actorType !== filter.actorType) return false;
    if (filter.targetType && event.targetType !== filter.targetType) return false;
    if (from || to) {
      const day = toSeoulDateString(new Date(event.occurredAt));
      if (from && day < from) return false;
      if (to && day > to) return false;
    }
    return true;
  });
}

export const businessEventApi = {
  /** 작업 로그 목록. 수주·LOT을 고르면 이력 재현(오래된 순), 아니면 최신순. 없는 수주·LOT id는 COM-003. */
  list: (filter: BusinessEventFilter = {}): Promise<BusinessEventPage> =>
    mockQuery((tables) => {
      requireActor(tables);
      const subject = subjectOf(tables, filter);
      const sort = isReplayFilter(filter) ? 'asc' : 'desc';
      const rows = filterBusinessEvents(tables, filter).sort((a, b) => (sort === 'asc' ? compareEventsAsc(a, b) : compareEventsAsc(b, a)));
      const limit = Math.min(Math.max(filter.limit ?? BUSINESS_EVENT_PAGE_SIZE, 1), MAX_LIMIT);
      const page = rows.slice(0, limit);
      const pageIds = new Set(page.map((row) => row.id));
      const lotsByEvent = new Map<number, EventLotView[]>();
      for (const link of tables.businessEventLot) {
        if (!pageIds.has(link.businessEventId)) continue;
        const lot = findRow(tables, 'lot', link.lotId);
        if (!lot) continue;
        const list = lotsByEvent.get(link.businessEventId) ?? [];
        list.push({ id: lot.id, lotNo: lot.lotNo, lotType: lot.lotType });
        lotsByEvent.set(link.businessEventId, list);
      }
      for (const list of lotsByEvent.values()) list.sort((a, b) => a.lotNo.localeCompare(b.lotNo));
      return { ...subject, items: page.map((row) => toView(tables, row, lotsByEvent)), total: rows.length, sort };
    }),

  /** 이력 재현용 수주 고르기: 수주번호 일부로 찾는다 (취소된 수주 포함, 최근 순 10건) */
  searchSalesOrders: (keyword: string): Promise<SalesOrderOption[]> =>
    mockQuery((tables) => {
      requireActor(tables);
      const term = keyword.trim().toUpperCase();
      return tables.salesOrder
        .filter((so) => !term || so.salesOrderNo.toUpperCase().includes(term))
        .sort((a, b) => Number(b.salesOrderNo.toUpperCase() === term) - Number(a.salesOrderNo.toUpperCase() === term) || b.id - a.id)
        .slice(0, 10)
        .map((so) => ({ id: so.id, salesOrderNo: so.salesOrderNo, customerName: findRow(tables, 'customer', so.customerId)?.customerName ?? '' }));
    }),
};
