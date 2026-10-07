// 작업 로그 서버 어댑터: 작업 로그 화면(목록·머리·수주 찾기), 수주·LOT 이력, 대시보드 최근 로그.
import type { BusinessEventView as ServerEvent } from '@fantasteel/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { businessEventApi } from '@/api/businessEvents';
import { dashboardApi } from '@/api/dashboard';
import { salesOrderApi } from '@/api/salesOrders';
import { inspectionItemNamesOf, serverBusinessEventApi } from '@/api/server/businessEvents';
import { fail, ok, page, stopFakeServer, useFakeServer, type ServerCall } from '@/api/server/serverTestKit';
import { SEED_EMPLOYEE_NO } from '@/test/actors';

const event = (id: number, over: Partial<ServerEvent> = {}): ServerEvent => ({
  id,
  businessEventNo: `EV-261007-${String(id).padStart(3, '0')}`,
  businessEventType: 'SALES_ORDER_CREATED',
  businessEventTypeLabel: '수주 등록',
  actorType: 'USER',
  actorEmployeeId: 3,
  actorEmployeeNo: '2103003',
  actorEmployeeName: '박서영',
  targetType: 'sales_order',
  targetId: 1,
  salesOrderId: 1,
  salesOrderNo: 'SO-2610-001',
  beforeData: null,
  afterData: { salesOrderNo: 'SO-2610-001' },
  reason: null,
  isAiAssisted: false,
  actionDraftId: null,
  messageId: null,
  occurredAt: '2026-10-07T01:00:00.000Z',
  lots: [],
  ...over,
});

const created = event(1);
const planned = event(2, {
  businessEventType: 'PRODUCTION_PLAN_CREATED',
  businessEventTypeLabel: '생산계획 생성',
  targetType: 'production_plan',
  targetId: 7,
  afterData: { productionPlanNo: 'PP-2610-0001', salesOrderItemId: 1 },
  reason: 'ORDER_SHORTAGE: 재고 부족 10매를 생산계획으로',
});
const reserved = event(3, {
  businessEventType: 'RESERVATION_CREATED',
  businessEventTypeLabel: '예약 생성',
  actorType: 'SYSTEM',
  actorEmployeeId: null,
  actorEmployeeNo: null,
  actorEmployeeName: null,
  targetType: 'reservation',
  targetId: 4,
  afterData: { reservedQty: 1 },
  reason: '자동 예약: HT-01 합격으로 1매 예약',
  lots: [
    { lotId: 12, lotNo: 'HT-01-02', lotType: 'SLAB' },
    { lotId: 11, lotNo: 'HT-01-01', lotType: 'SLAB' },
  ],
});
const inspected = event(4, {
  businessEventType: 'INSPECTION_REGISTERED',
  businessEventTypeLabel: '검사 등록',
  actorEmployeeName: '서민지',
  targetType: 'quality_inspection',
  targetId: 9,
  salesOrderId: null,
  salesOrderNo: null,
  afterData: { inspectionResult: 'PASS', values: [{ inspectionItemCode: 'C', measuredValue: '0.1600' }] },
  lots: [{ lotId: 11, lotNo: 'HT-01-01', lotType: 'SLAB' }],
});
const resultEvent = event(5, { businessEventType: 'PRODUCTION_RESULT_REGISTERED', targetType: 'production_result', targetId: 3, afterData: { productionPlanId: 7, outputLotNo: 'HM-01' } });
const draft = event(6, { businessEventType: 'DRAFT_CREATED', targetType: 'action_draft', targetId: 5, afterData: null, messageId: 77, salesOrderId: null, salesOrderNo: null });

/** GET /business-events: sort·page·size를 지키는 가짜 서버 */
function respondEvents(call: ServerCall, rows: readonly ServerEvent[]) {
  const sorted = call.query.sort === 'desc' ? [...rows].reverse() : [...rows];
  const size = Number(call.query.size);
  const start = (Number(call.query.page) - 1) * size;
  return ok({ items: sorted.slice(start, start + size), page: Number(call.query.page), size, total: rows.length });
}

const eventCalls = (calls: ServerCall[]) => calls.filter((c) => c.path === '/business-events').map((c) => c.query);

afterEach(() => stopFakeServer());

describe('작업 로그 서버 어댑터 (api/server/businessEvents.ts)', () => {
  it('전체 작업 로그: 최신순으로 조건을 넘기고, 대상 번호·사유 코드·링크·주체를 화면 모양으로 바꾼다', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.productionHead, (c) => (c.path === '/business-events' ? respondEvents(c, [created, planned, reserved, inspected, resultEvent, draft]) : undefined));
    const result = await businessEventApi.list({ businessEventType: 'SALES_ORDER_CREATED', actorType: 'USER', targetType: 'sales_order', from: '2026-10-01', to: '', limit: 10 });
    expect(eventCalls(calls)).toEqual([{ businessEventType: 'SALES_ORDER_CREATED', actorType: 'USER', targetType: 'sales_order', from: '2026-10-01', sort: 'desc', page: '1', size: '10' }]);
    expect(result).toMatchObject({ sort: 'desc', total: 6, salesOrder: null, lot: null });
    const byId = new Map(result.items.map((e) => [e.id, e]));
    expect(result.items.map((e) => e.id)).toEqual([6, 5, 4, 3, 2, 1]);
    expect(byId.get(1)).toMatchObject({
      eventNo: 'EV-261007-001',
      targetNo: 'SO-2610-001',
      targetText: 'SO-2610-001',
      targetTypeLabel: '수주',
      targetHref: '/sales-orders/1',
      actor: { employeeId: 3, employeeName: '박서영', employeeNo: '2103003', departmentName: '', jobGradeName: '' },
      reasonCode: null,
      reasonText: null,
      messageHref: null,
    });
    expect(byId.get(2)).toMatchObject({ targetNo: 'PP-2610-0001', targetHref: '/production/plans?plan=7', reasonCode: 'ORDER_SHORTAGE', reasonText: '재고 부족 10매를 생산계획으로' });
    // 사유 코드가 아닌 앞말은 그대로 문장이다. 시스템 주체는 사원이 없다. LOT은 번호 순
    expect(byId.get(3)).toMatchObject({ actor: null, targetNo: null, targetText: 'SO-2610-001', reasonCode: null, reasonText: '자동 예약: HT-01 합격으로 1매 예약' });
    expect(byId.get(3)?.lots).toEqual([
      { id: 11, lotNo: 'HT-01-01', lotType: 'SLAB' },
      { id: 12, lotNo: 'HT-01-02', lotType: 'SLAB' },
    ]);
    expect(byId.get(4)).toMatchObject({ targetNo: 'HT-01-01', targetHref: '/quality/inspections?lot=11', salesOrderNo: null });
    expect(byId.get(5)).toMatchObject({ targetNo: 'HM-01', targetHref: '/production/results?plan=7' });
    expect(byId.get(6)).toMatchObject({ targetNo: null, targetText: '초안 #5', targetHref: '/action-drafts/5', messageId: 77, messageHref: null });
  });

  it('더 보기: 서버 한 쪽 최대 100건이라 limit만큼 나눠 읽는다', async () => {
    const many = Array.from({ length: 130 }, (_, i) => event(i + 1));
    const calls = useFakeServer(SEED_EMPLOYEE_NO.productionHead, (c) => (c.path === '/business-events' ? respondEvents(c, many) : undefined));
    const result = await businessEventApi.list({ limit: 120 });
    expect(eventCalls(calls).map((q) => [q.page, q.size])).toEqual([
      ['1', '100'],
      ['2', '100'],
    ]);
    expect(result.items).toHaveLength(120);
    expect(result.total).toBe(130);
  });

  it('수주 이력 재현: 오래된 순, 머리는 수주 상세. 수주 조회 권한이 없으면(구매) 이벤트의 수주 번호로 채우고 고객사는 비운다', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.sales, (c) => {
      if (c.path === '/business-events') return respondEvents(c, [created, planned]);
      if (c.path === '/sales-orders/1') return ok({ id: 1, salesOrderNo: 'SO-2610-001', customerName: '가람중공업' });
      return undefined;
    });
    const result = await businessEventApi.list({ salesOrderId: 1 });
    expect(eventCalls(calls)[0]).toMatchObject({ salesOrderId: '1', sort: 'asc' });
    expect(result).toMatchObject({ sort: 'asc', salesOrder: { id: 1, salesOrderNo: 'SO-2610-001', customerName: '가람중공업' }, lot: null });
    expect(result.items.map((e) => e.id)).toEqual([1, 2]);
    stopFakeServer();

    useFakeServer(SEED_EMPLOYEE_NO.purchase, (c) => (c.path === '/business-events' ? respondEvents(c, [created]) : c.path === '/sales-orders/1' ? fail(403, 'COM-002', '권한이 없습니다') : undefined));
    expect((await businessEventApi.list({ salesOrderId: 1 })).salesOrder).toEqual({ id: 1, salesOrderNo: 'SO-2610-001', customerName: '' });
  });

  it('LOT 이력 재현: 머리는 LOT 상세, 없는 LOT이면 COM-003', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.quality, (c) => {
      if (c.path === '/business-events') return respondEvents(c, c.query.lotId === '11' ? [reserved, inspected] : []);
      if (c.path === '/lots/11') return ok({ id: 11, lotNo: 'HT-01-01', lotType: 'SLAB' });
      return undefined;
    });
    const result = await businessEventApi.list({ lotId: 11 });
    expect(eventCalls(calls)[0]).toMatchObject({ lotId: '11', sort: 'asc' });
    expect(result.lot).toEqual({ id: 11, lotNo: 'HT-01-01', lotType: 'SLAB' });
    await expect(businessEventApi.list({ lotId: 99 })).rejects.toMatchObject({ code: 'COM-003' });
  });

  it('수주 찾기: 서버에 번호 검색이 없어 목록을 읽어 거르고, 수주 조회 권한이 없으면 빈 결과', async () => {
    const rows = [
      { id: 1, salesOrderNo: 'SO-2610-001', customerName: '가람중공업' },
      { id: 2, salesOrderNo: 'SO-2610-002', customerName: '나래조선' },
      { id: 3, salesOrderNo: 'SO-2609-010', customerName: '다온건설' },
    ];
    useFakeServer(SEED_EMPLOYEE_NO.sales, (c) => (c.path === '/sales-orders' ? ok(page(rows)) : undefined));
    expect(await businessEventApi.searchSalesOrders('2610')).toEqual([
      { id: 2, salesOrderNo: 'SO-2610-002', customerName: '나래조선' },
      { id: 1, salesOrderNo: 'SO-2610-001', customerName: '가람중공업' },
    ]);
    expect((await businessEventApi.searchSalesOrders('so-2610-001'))[0].id).toBe(1);
    stopFakeServer();

    useFakeServer(SEED_EMPLOYEE_NO.quality, (c) => (c.path === '/sales-orders' ? fail(403, 'COM-002', '권한이 없습니다') : undefined));
    expect(await businessEventApi.searchSalesOrders('SO')).toEqual([]);
  });

  it('수주 상세 이력: 서버 모드에서도 이 수주의 작업 로그를 오래된 순으로 전부 보인다', async () => {
    const many = Array.from({ length: 105 }, (_, i) => event(i + 1));
    const calls = useFakeServer(SEED_EMPLOYEE_NO.sales, (c) => (c.path === '/business-events' ? respondEvents(c, [...many, reserved]) : undefined));
    const timeline = await salesOrderApi.timeline(1);
    expect(timeline).toHaveLength(106);
    expect(eventCalls(calls).map((q) => [q.salesOrderId, q.sort, q.page])).toEqual([
      ['1', 'asc', '1'],
      ['1', 'asc', '2'],
    ]);
    expect(timeline[0]).toMatchObject({ eventNo: 'EV-261007-001', actorName: '박서영', targetText: 'SO-2610-001', lotNos: [] });
    expect(timeline[105]).toMatchObject({ actorType: 'SYSTEM', actorName: '시스템', lotNos: ['HT-01-02', 'HT-01-01'] });
  });

  it('LOT 타임라인과 검사 항목명: 로그의 코드를 화면이 받은 검사 항목에서 이름으로 찾는다', async () => {
    useFakeServer(SEED_EMPLOYEE_NO.quality, (c) => (c.path === '/business-events' ? respondEvents(c, [inspected]) : undefined));
    const history = await serverBusinessEventApi.lotTimeline(11);
    expect(history).toEqual([expect.objectContaining({ businessEventType: 'INSPECTION_REGISTERED', actorName: '서민지', targetNo: 'HT-01-01', afterData: inspected.afterData })]);
    expect(inspectionItemNamesOf([{ inspectionItemCode: 'C', inspectionItemName: '탄소' }])).toEqual({ C: '탄소' });
  });

  it('대시보드 최근 작업 로그: 최신순 20건과 전체 건수', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.purchase, (c) => (c.path === '/business-events' ? respondEvents(c, [created, planned, reserved]) : undefined));
    const widget = await dashboardApi.widget('RECENT_EVENTS');
    expect(eventCalls(calls)).toEqual([{ sort: 'desc', page: '1', size: '20' }]);
    expect(widget.totalCount).toBe(3);
    expect(widget.items.map((e) => [e.eventNo, e.actorName, e.businessEventTypeLabel, e.targetNo, e.reasonText])).toEqual([
      ['EV-261007-003', '시스템', '예약 생성', null, '자동 예약: HT-01 합격으로 1매 예약'],
      ['EV-261007-002', '박서영', '생산계획 생성', 'PP-2610-0001', '재고 부족 10매를 생산계획으로'],
      ['EV-261007-001', '박서영', '수주 등록', 'SO-2610-001', null],
    ]);
  });
});
