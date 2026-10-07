// 작업 로그를 쓰는 화면 ↔ 서버 API (GET /business-events, API-238). 작업 로그 화면·수주 이력·LOT 이력·대시보드 최근 로그가 같이 쓴다.
// - 서버에는 대상 번호 칸이 없다. 기록할 때 변경 후·전 데이터에 넣은 번호(salesOrderNo 등)를 대상 테이블별로 찾아 쓴다.
// - 서버 사유는 'STOCK_FIRST: 문장' 한 줄이라 앞이 사유 코드(9.3)면 코드와 문장으로 나눈다.
// - 응답에 없는 값: 주체의 부서·직급, 원본 메시지의 채팅방(메신저 링크), 출하요청 품목 대상의 출하요청 id. 비워 둔다.
import type { BusinessEventView as ServerEvent, LotDetail, PageResult, SalesOrderDetail, SalesOrderSummary } from '@fantasteel/shared';
import type { BusinessEventFilter, BusinessEventPage, BusinessEventSubject, BusinessEventView, SalesOrderOption } from '@/api/businessEvents';
import type { RecentEventsData } from '@/api/dashboard';
import { serverRequest } from '@/api/http';
import { allPages, orEmpty } from '@/api/server/inspections';
import { isEventReasonCode, type EventReasonCode } from '@/codes';
import { targetHref, targetTableLabel } from '@/features/businessEvents/lib/eventTargets';
import type { DbTableName, JsonValue } from '@/mock/schema';
import type { TimelineEvent } from '@/mock/services';

/** 서버 최대 페이지 크기 */
const PAGE_SIZE = 100;

type Query = Record<string, string | number | undefined>;

/** 조건에 맞는 작업 로그를 limit건까지 (100건씩 나눠 읽는다) */
async function readEvents(query: Query, limit: number): Promise<{ items: ServerEvent[]; total: number }> {
  const items: ServerEvent[] = [];
  for (let page = 1; ; page++) {
    const result = await serverRequest<PageResult<ServerEvent>>('GET', '/business-events', { query: { ...query, page, size: Math.min(PAGE_SIZE, limit) } });
    items.push(...result.items);
    if (items.length >= limit || items.length >= result.total || result.items.length === 0) return { items: items.slice(0, limit), total: result.total };
  }
}

/** 서버가 JSON으로 준 jsonb 값 그대로 */
const asJson = (value: unknown): JsonValue | null => (value === undefined ? null : (value as JsonValue | null));

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** 변경 후 → 변경 전 순서로 처음 나오는 값 */
function fieldOf(e: ServerEvent, key: string): unknown {
  for (const data of [e.afterData, e.beforeData]) if (isRecord(data) && data[key] !== undefined && data[key] !== null) return data[key];
  return undefined;
}
const stringField = (e: ServerEvent, key: string): string | null => {
  const value = fieldOf(e, key);
  return typeof value === 'string' && value !== '' ? value : null;
};
const numberField = (e: ServerEvent, key: string): number | null => {
  const value = fieldOf(e, key);
  return typeof value === 'number' ? value : null;
};

/** 대상 테이블별로 기록 데이터에서 찾을 번호 (가짜 DB의 target_no와 같은 번호) */
const TARGET_NO_FIELDS: Partial<Record<string, string[]>> = {
  sales_order: ['salesOrderNo'],
  production_plan: ['productionPlanNo'],
  production_result: ['productionPlanNo', 'outputLotNo'],
  quality_inspection: ['lotNo'],
  lot: ['lotNo'],
  allocation: ['lotNo'],
  purchase_requisition: ['purchaseRequisitionNo'],
  purchase_order: ['purchaseOrderNo'],
  goods_receipt: ['goodsReceiptNo'],
  shipment_request: ['shipmentRequestNo'],
  mill_sheet: ['millSheetNo'],
};

function targetNoOf(e: ServerEvent): string | null {
  for (const key of TARGET_NO_FIELDS[e.targetType] ?? []) {
    const value = stringField(e, key);
    if (value) return value;
  }
  // 검사·LOT 대상은 연결 LOT이 곧 대상이다
  if ((e.targetType === 'quality_inspection' || e.targetType === 'lot') && e.lots.length === 1) return e.lots[0].lotNo;
  return null;
}

/** 번호가 없는 대상의 화면 이름 (가짜 DB eventTargetTextOf와 같은 규칙: 초안은 "초안 #id", 예약은 수주 번호) */
function targetTextOf(e: ServerEvent, targetNo: string | null): string {
  if (targetNo) return targetNo;
  if (e.targetType === 'action_draft') return `초안 #${e.targetId}`;
  if (e.targetType === 'reservation' && e.salesOrderNo) return e.salesOrderNo;
  return `#${e.targetId}`;
}

function reasonOf(reason: string | null): { reasonCode: EventReasonCode | null; reasonText: string | null } {
  if (!reason) return { reasonCode: null, reasonText: null };
  const match = /^([A-Z_]+):\s*(.*)$/s.exec(reason);
  if (match && isEventReasonCode(match[1])) return { reasonCode: match[1], reasonText: match[2] || null };
  return { reasonCode: null, reasonText: reason };
}

const actorNameOf = (e: ServerEvent) => (e.actorType === 'SYSTEM' ? '시스템' : (e.actorEmployeeName ?? '사용자'));

export function toEventView(e: ServerEvent): BusinessEventView {
  const targetNo = targetNoOf(e);
  return {
    id: e.id,
    eventNo: e.businessEventNo,
    businessEventType: e.businessEventType,
    businessEventTypeLabel: e.businessEventTypeLabel,
    actorType: e.actorType,
    actor:
      e.actorType === 'USER' && e.actorEmployeeId !== null
        ? { employeeId: e.actorEmployeeId, employeeName: e.actorEmployeeName ?? '', employeeNo: e.actorEmployeeNo ?? '', departmentName: '', jobGradeName: '' }
        : null,
    // 서버 대상은 ERD 테이블명이다
    targetType: e.targetType as DbTableName,
    targetTypeLabel: targetTableLabel(e.targetType),
    targetId: e.targetId,
    targetNo,
    targetText: targetTextOf(e, targetNo),
    targetHref: targetHref({
      targetType: e.targetType,
      targetId: e.targetId,
      targetNo,
      salesOrderId: e.salesOrderId,
      lotId: e.targetType === 'quality_inspection' ? (e.lots[0]?.lotId ?? null) : null,
      productionPlanId: numberField(e, 'productionPlanId'),
      purchaseOrderId: numberField(e, 'purchaseOrderId'),
      shipmentRequestId: numberField(e, 'shipmentRequestId'),
    }),
    salesOrderId: e.salesOrderId,
    salesOrderNo: e.salesOrderNo,
    beforeData: asJson(e.beforeData),
    afterData: asJson(e.afterData),
    ...reasonOf(e.reason),
    isAiAssisted: e.isAiAssisted,
    actionDraftId: e.actionDraftId,
    messageId: e.messageId,
    // 원본 메시지의 채팅방이 응답에 없어 메신저로 이동할 수 없다
    messageHref: null,
    occurredAt: e.occurredAt,
    lots: [...e.lots].sort((a, b) => a.lotNo.localeCompare(b.lotNo)).map((l) => ({ id: l.lotId, lotNo: l.lotNo, lotType: l.lotType })),
  };
}

function toTimelineEvent(e: ServerEvent): TimelineEvent {
  const view = toEventView(e);
  return {
    id: view.id,
    eventNo: view.eventNo,
    businessEventType: view.businessEventType,
    businessEventTypeLabel: view.businessEventTypeLabel,
    actorType: view.actorType,
    actorName: actorNameOf(e),
    targetType: view.targetType,
    targetId: view.targetId,
    targetNo: view.targetNo,
    targetText: view.targetText,
    salesOrderId: view.salesOrderId,
    reasonCode: view.reasonCode,
    reasonText: view.reasonText,
    beforeData: view.beforeData,
    afterData: view.afterData,
    messageId: view.messageId,
    actionDraftId: view.actionDraftId,
    occurredAt: view.occurredAt,
    lotNos: e.lots.map((l) => l.lotNo),
  };
}

/** 화면 머리에 보일 수주·LOT. 없는 id는 서버가 COM-003, 수주 조회 권한이 없으면 고객사는 비운다 */
async function subjectOf(filter: BusinessEventFilter, firstEvent: ServerEvent | undefined): Promise<BusinessEventSubject> {
  const [salesOrder, lot] = await Promise.all([
    filter.salesOrderId === undefined
      ? null
      : orEmpty<SalesOrderDetail | null>(() => serverRequest<SalesOrderDetail>('GET', `/sales-orders/${filter.salesOrderId}`), null).then((so) =>
          so
            ? { id: so.id, salesOrderNo: so.salesOrderNo, customerName: so.customerName }
            : { id: filter.salesOrderId ?? 0, salesOrderNo: firstEvent?.salesOrderNo ?? '', customerName: '' },
        ),
    filter.lotId === undefined ? null : serverRequest<LotDetail>('GET', `/lots/${filter.lotId}`).then((l) => ({ id: l.id, lotNo: l.lotNo, lotType: l.lotType })),
  ]);
  return { salesOrder, lot };
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 1000;

/** 작업 로그 화면: 수주·LOT을 고르면 이력 재현(오래된 순), 아니면 최신순 */
async function list(filter: BusinessEventFilter = {}): Promise<BusinessEventPage> {
  const sort = filter.salesOrderId !== undefined || filter.lotId !== undefined ? 'asc' : 'desc';
  const limit = Math.min(Math.max(filter.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const { items, total } = await readEvents(
    {
      salesOrderId: filter.salesOrderId,
      lotId: filter.lotId,
      businessEventType: filter.businessEventType,
      actorType: filter.actorType,
      targetType: filter.targetType,
      from: filter.from || undefined,
      to: filter.to || undefined,
      sort,
    },
    limit,
  );
  const subject = await subjectOf(filter, items[0]);
  return { ...subject, items: items.map(toEventView), total, sort };
}

/** 이력 재현용 수주 고르기. 서버에 번호 검색이 없어 목록을 읽어 거른다. 수주 조회 권한이 없으면 빈 결과 */
async function searchSalesOrders(keyword: string): Promise<SalesOrderOption[]> {
  const term = keyword.trim().toUpperCase();
  const rows = await orEmpty(() => allPages<SalesOrderSummary>('/sales-orders'), []);
  return rows
    .filter((so) => !term || so.salesOrderNo.toUpperCase().includes(term))
    .sort((a, b) => Number(b.salesOrderNo.toUpperCase() === term) - Number(a.salesOrderNo.toUpperCase() === term) || b.id - a.id)
    .slice(0, 10)
    .map((so) => ({ id: so.id, salesOrderNo: so.salesOrderNo, customerName: so.customerName }));
}

/** 수주 타임라인 (오래된 순, 전부) */
async function salesOrderTimeline(salesOrderId: number): Promise<TimelineEvent[]> {
  return (await readEvents({ salesOrderId, sort: 'asc' }, Number.MAX_SAFE_INTEGER)).items.map(toTimelineEvent);
}

/** LOT 타임라인 (오래된 순, 전부) */
async function lotTimeline(lotId: number): Promise<TimelineEvent[]> {
  return (await readEvents({ lotId, sort: 'asc' }, Number.MAX_SAFE_INTEGER)).items.map(toTimelineEvent);
}

/** 대시보드 최근 작업 로그 (최신순 limit건, 전체 건수) */
async function recentEvents(limit: number): Promise<RecentEventsData> {
  const { items, total } = await readEvents({ sort: 'desc' }, limit);
  return {
    totalCount: total,
    items: items.map((e) => {
      const view = toEventView(e);
      return {
        id: view.id,
        eventNo: view.eventNo,
        occurredAt: view.occurredAt,
        actorType: view.actorType,
        actorName: actorNameOf(e),
        businessEventTypeLabel: view.businessEventTypeLabel,
        targetNo: view.targetNo,
        reasonText: view.reasonText,
        isAiAssisted: view.isAiAssisted,
      };
    }),
  };
}

/**
 * 검사 등록 로그에 나온 항목 코드의 항목명. 서버 로그에는 코드만 있어서 화면이 이미 받은 검사 항목(현재 폼·불합격 항목)에서 찾는다.
 * 없는 코드는 화면이 '알 수 없는 항목'으로 보인다.
 */
export function inspectionItemNamesOf(known: readonly { inspectionItemCode: string; inspectionItemName: string }[]): Record<string, string> {
  return Object.fromEntries(known.map((i) => [i.inspectionItemCode, i.inspectionItemName]));
}

export const serverBusinessEventApi = { list, searchSalesOrders, salesOrderTimeline, lotTimeline, recentEvents };
