// 수주 api: 권한 확인(requireActor) + core 서비스 호출이 화면에서 쓰는 모양대로 동작하는지 (14.1 1단계, 14.2 취소, 9.3 코드).
import { describe, expect, it } from 'vitest';
import { ApiError, InputError } from '@/api/client';
import { salesOrderApi } from '@/api/salesOrders';
import { getMockDb } from '@/mock/db';
import type { MockTables } from '@/mock/schema';
import { checkInvariants } from '@/mock/services';
import { actAs, employeeIdOf, SEED_EMPLOYEE_NO } from '@/test/actors';

const SS275_SLAB = 'SL-SS275-250x1200x10000';

const read = <T>(reader: (tables: Readonly<MockTables>) => T): T => getMockDb().read(reader);
const itemIdOf = (itemCode: string) => read((t) => t.item.find((i) => i.itemCode === itemCode)?.id ?? 0);
const customerIdOf = (customerCode: string) => read((t) => t.customer.find((c) => c.customerCode === customerCode)?.id ?? 0);
const salesOrderIdOf = (salesOrderNo: string) => read((t) => t.salesOrder.find((s) => s.salesOrderNo === salesOrderNo)?.id ?? 0);
const countOf = (table: 'salesOrder' | 'reservation' | 'productionPlan' | 'businessEvent' | 'chatRoom') => read((t) => t[table].length);
const invariants = () => read((t) => checkInvariants(t));

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiError) return error.code;
    if (error instanceof InputError) return `INPUT:${Object.keys(error.fieldErrors).join(',')}`;
    throw error;
  }
  throw new Error('오류가 나지 않았어요');
}

/** 14.1 1단계: 가람중공업 SS275 슬래브 250×1200×10000 10매 (합격 가용 6매) */
async function create141() {
  actAs(SEED_EMPLOYEE_NO.sales);
  return salesOrderApi.create({ customerId: customerIdOf('CUS-01'), items: [{ itemId: itemIdOf(SS275_SLAB), orderedQty: '10', dueDate: '2026-10-20' }] });
}

describe('수주 조회 (REQ-SO-004·005)', () => {
  it('목록: 영업은 시드 수주(거래 5건 + 대시보드 시계열 4건)를 품목 요약과 함께 본다. 헤더 상태·납기 위험·재생산 필요는 계산값', async () => {
    actAs(SEED_EMPLOYEE_NO.sales);
    const rows = await salesOrderApi.list();
    expect(rows.map((r) => r.salesOrderNo).filter((no) => no.startsWith('SO-2609-'))).toEqual(['SO-2609-005', 'SO-2609-004', 'SO-2609-003', 'SO-2609-002', 'SO-2609-001']);
    expect(rows.filter((r) => r.salesOrderNo.startsWith('SO-2608-')).every((r) => r.status === 'SHIPPED')).toBe(true);
    const mixed = rows.find((r) => r.salesOrderNo === 'SO-2609-003');
    expect(mixed?.itemLines.map((l) => l.itemType)).toEqual(['COIL', 'SLAB']);
    expect(mixed?.workRoomId).not.toBeNull();
    expect(rows.find((r) => r.salesOrderNo === 'SO-2609-005')?.hasReproductionNeed).toBe(true);
    expect(rows.find((r) => r.salesOrderNo === 'SO-2609-001')?.status).toBe('SHIPPED');
  });

  it('목록·상세는 수주 조회 권한(수주 등록·취소 VIEW 이상)이 있어야 한다: 생산은 보고, 구매·물류는 COM-002', async () => {
    actAs(SEED_EMPLOYEE_NO.productionHead);
    expect(await salesOrderApi.list()).toHaveLength(read((t) => t.salesOrder.length));
    actAs(SEED_EMPLOYEE_NO.purchase);
    expect(await codeOf(salesOrderApi.list())).toBe('COM-002');
    actAs(SEED_EMPLOYEE_NO.logistics);
    expect(await codeOf(salesOrderApi.detail(salesOrderIdOf('SO-2609-001')))).toBe('COM-002');
  });

  it('상세: 충족 지표는 분모를 따로 준다(4.5) — 예약 ÷ 미출하, 생산중·검사합격·출하 ÷ 수주', async () => {
    actAs(SEED_EMPLOYEE_NO.sales);
    const shipped = await salesOrderApi.detail(salesOrderIdOf('SO-2609-001'));
    const item = shipped.items[0];
    expect(item?.measures.shipped).toEqual({ qty: 4, denominatorQty: 4, ratio: 1 });
    expect(item?.measures.reserved.denominatorQty).toBe(0);
    expect(item?.measures.reserved.ratio).toBeNull();
    expect(shipped.cancelBlock).toBe('SO-003');

    const surplus = await salesOrderApi.detail(salesOrderIdOf('SO-2609-004'));
    expect(surplus.items[0]?.measures).toMatchObject({
      reserved: { qty: 3, denominatorQty: 3 },
      inProduction: { qty: 0, denominatorQty: 3 },
      passed: { qty: 3, denominatorQty: 3 },
      shipped: { qty: 0, denominatorQty: 3 },
    });
    for (const so of [shipped, surplus]) for (const i of so.items) expect(i.measures.passed.qty).toBeLessThanOrEqual(i.orderedQty);
  });

  it('없는 수주는 COM-003', async () => {
    actAs(SEED_EMPLOYEE_NO.sales);
    expect(await codeOf(salesOrderApi.detail(99999))).toBe('COM-003');
    expect(await codeOf(salesOrderApi.timeline(99999))).toBe('COM-003');
  });
});

describe('수주 등록 미리보기 (저장 안 함)', () => {
  it('14.1: 10매 → 예약 가용 6 · 예약 6 · 부족 4 → 1히트 편성. 같은 규격 두 줄은 앞 줄이 먼저 예약한다', async () => {
    actAs(SEED_EMPLOYEE_NO.sales);
    const before = countOf('reservation');
    const [line] = await salesOrderApi.preview([{ itemId: itemIdOf(SS275_SLAB), orderedQty: 10 }]);
    expect(line).toMatchObject({ availableQty: 6, reserveQty: 6, shortageQty: 4, weightTon: '235.500' });
    expect(line?.formation).toMatchObject({ heatCount: 1, heatTon: '250.000', requiredSteelTon: '96.122' });
    const two = await salesOrderApi.preview([
      { itemId: itemIdOf(SS275_SLAB), orderedQty: 4 },
      { itemId: itemIdOf(SS275_SLAB), orderedQty: 4 },
    ]);
    expect(two.map((l) => [l.availableQty, l.reserveQty, l.shortageQty])).toEqual([
      [6, 4, 0],
      [2, 2, 2],
    ]);
    expect(countOf('reservation')).toBe(before);
  });

  it('미리보기도 SO-001·SO-002로 거른다', async () => {
    actAs(SEED_EMPLOYEE_NO.sales);
    expect(await codeOf(salesOrderApi.preview([{ itemId: itemIdOf('ORE01'), orderedQty: 1 }]))).toBe('SO-001');
    expect(await codeOf(salesOrderApi.preview([{ itemId: itemIdOf(SS275_SLAB), orderedQty: '10.5' }]))).toBe('SO-002');
  });
});

describe('수주 등록 (REQ-SO-001~003, 14.1 1단계)', () => {
  it('재고 우선 예약 6매 + 부족 4매 생산계획. 작업 로그는 수주 등록(USER) → 예약(SYSTEM, STOCK_FIRST) → 계획(SYSTEM, ORDER_SHORTAGE)', async () => {
    const result = await create141();
    expect(result).toMatchObject({ reservedQty: 6, shortageQty: 4 });
    expect(result.salesOrderNo).toMatch(/^SO-\d{4}-\d{3}$/);
    expect(result.productionPlanNos).toHaveLength(1);

    const detail = await salesOrderApi.detail(result.salesOrderId);
    expect(detail.ownerEmployeeId).toBe(employeeIdOf(SEED_EMPLOYEE_NO.sales));
    expect(detail.items[0]?.measures).toMatchObject({ reserved: { qty: 6, denominatorQty: 10 }, passed: { qty: 6, denominatorQty: 10 } });
    expect(detail.items[0]?.plannedQty).toBe(4);
    expect(detail.reservations.map((r) => [r.reservedQty, r.reservationStatus])).toEqual([[6, 'ACTIVE']]);

    const timeline = await salesOrderApi.timeline(result.salesOrderId);
    expect(timeline.map((e) => [e.businessEventType, e.actorType, e.reasonCode])).toEqual([
      ['SALES_ORDER_CREATED', 'USER', null],
      ['RESERVATION_CREATED', 'SYSTEM', 'STOCK_FIRST'],
      ['PRODUCTION_PLAN_CREATED', 'SYSTEM', 'ORDER_SHORTAGE'],
    ]);
    expect(timeline[1]?.actorName).toBe('시스템');

    const links = await salesOrderApi.productionLinks(result.salesOrderId);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      lineNo: 1,
      plan: { productionPlanStatus: 'PLANNED', formation: { shortageQty: 4, heatCount: 1, expectedSurplusSlabQty: 6 } },
    });
    expect(links[0]?.plan.heats).toHaveLength(1);
    expect(invariants()).toEqual([]);
  });

  it('14.2 혼합 수주: 코일·슬래브 품목이 각자 예약하고 부족분만 계획한다', async () => {
    actAs(SEED_EMPLOYEE_NO.sales);
    const result = await salesOrderApi.create({
      customerId: customerIdOf('CUS-02'),
      items: [
        { itemId: itemIdOf(SS275_SLAB), orderedQty: 2, dueDate: '2026-10-25' },
        { itemId: itemIdOf('CL-SS275-4.5x1500x544000'), orderedQty: 3, dueDate: '2026-10-30' },
      ],
    });
    expect(result).toMatchObject({ reservedQty: 2, shortageQty: 3 });
    const links = await salesOrderApi.productionLinks(result.salesOrderId);
    expect(links.map((l) => [l.lineNo, l.plan.item.itemType])).toEqual([[2, 'COIL']]);
  });

  it('권한·입력 오류: COM-002(생산 VIEW), SO-001, SO-002(글자를 지우지 않음), COM-003, 납기 누락 — 아무것도 저장되지 않는다', async () => {
    const before = countOf('salesOrder');
    const eventsBefore = countOf('businessEvent');
    const line = { itemId: itemIdOf(SS275_SLAB), orderedQty: '3', dueDate: '2026-10-20' };
    const base = { customerId: customerIdOf('CUS-01'), items: [line] };
    actAs(SEED_EMPLOYEE_NO.productionHead);
    expect(await codeOf(salesOrderApi.create(base))).toBe('COM-002');
    actAs(SEED_EMPLOYEE_NO.sales);
    expect(await codeOf(salesOrderApi.create({ ...base, items: [{ ...line, itemId: itemIdOf('ORE01') }] }))).toBe('SO-001');
    for (const qty of ['3매', '10.5', '0', '-1', '']) {
      expect(await codeOf(salesOrderApi.create({ ...base, items: [{ ...line, orderedQty: qty }] }))).toBe('SO-002');
    }
    expect(await codeOf(salesOrderApi.create({ ...base, customerId: 999 }))).toBe('COM-003');
    expect(await codeOf(salesOrderApi.create({ ...base, items: [{ ...line, dueDate: '' }] }))).toBe('INPUT:items.0.dueDate');
    expect(countOf('salesOrder')).toBe(before);
    expect(countOf('businessEvent')).toBe(eventsBefore);
  });
});

describe('수주 취소 (REQ-SO-006, BP-SO-02, 9.3 SO-003·SO-004)', () => {
  it('출고분 있으면 SO-003, 진행 중 출하요청 있으면 SO-004, 취소 권한 없으면 COM-002', async () => {
    actAs(SEED_EMPLOYEE_NO.sales);
    expect(await codeOf(salesOrderApi.cancel({ salesOrderId: salesOrderIdOf('SO-2609-001'), cancelReason: '고객 요청' }))).toBe('SO-003');
    expect(await codeOf(salesOrderApi.cancel({ salesOrderId: salesOrderIdOf('SO-2609-002'), cancelReason: '고객 요청' }))).toBe('SO-004');
    actAs(SEED_EMPLOYEE_NO.productionHead);
    expect(await codeOf(salesOrderApi.cancel({ salesOrderId: salesOrderIdOf('SO-2609-004'), cancelReason: '고객 요청' }))).toBe('COM-002');
  });

  it('시작 전 취소: 사유 필수 → 예약 RELEASED · 계획 CANCELLED · 품목 취소, 작업 로그와 COM-001(화면을 연 뒤 바뀜)', async () => {
    const created = await create141();
    const opened = await salesOrderApi.detail(created.salesOrderId);
    expect(await codeOf(salesOrderApi.cancel({ salesOrderId: created.salesOrderId, cancelReason: '  ' }))).toBe('INPUT:cancelReason');
    expect(
      await codeOf(salesOrderApi.cancel({ salesOrderId: created.salesOrderId, cancelReason: '고객 요청', expectedUpdatedAt: '2026-01-01T00:00:00.000Z' })),
    ).toBe('COM-001');

    await salesOrderApi.cancel({ salesOrderId: created.salesOrderId, cancelReason: '고객 요청', expectedUpdatedAt: opened.updatedAt });
    const after = await salesOrderApi.detail(created.salesOrderId);
    expect(after).toMatchObject({ status: 'CANCELLED', cancelReason: '고객 요청', cancelBlock: 'CANCELLED' });
    expect(after.reservations.map((r) => r.reservationStatus)).toEqual(['RELEASED']);
    const links = await salesOrderApi.productionLinks(created.salesOrderId);
    expect(links[0]?.plan.productionPlanStatus).toBe('CANCELLED');
    const types = (await salesOrderApi.timeline(created.salesOrderId)).map((e) => e.businessEventType);
    expect(types).toEqual(expect.arrayContaining(['SALES_ORDER_CANCELLED', 'RESERVATION_RELEASED', 'PRODUCTION_PLAN_CANCELLED']));
    expect(await codeOf(salesOrderApi.cancel({ salesOrderId: created.salesOrderId, cancelReason: '다시' }))).toBe('INPUT:salesOrderId');

    // 풀린 6매는 다시 예약 가용이 된다
    const [line] = await salesOrderApi.preview([{ itemId: itemIdOf(SS275_SLAB), orderedQty: 1 }]);
    expect(line?.availableQty).toBe(6);
    expect(invariants()).toEqual([]);
  });

  it('진행 중 계획이 있는 수주 취소: 계획은 수주 연결을 풀고 완료 후 여재(SURPLUS_CONVERTED). 생산 연결 탭에는 연결 해제로 남는다', async () => {
    actAs(SEED_EMPLOYEE_NO.salesHead);
    const soId = salesOrderIdOf('SO-2609-003');
    const before = await salesOrderApi.productionLinks(soId);
    expect(before.every((l) => l.plan.productionPlanStatus === 'IN_PROGRESS')).toBe(true);
    await salesOrderApi.cancel({ salesOrderId: soId, cancelReason: '고객 요청으로 취소' });
    const after = await salesOrderApi.productionLinks(soId);
    expect(after).toHaveLength(before.length);
    expect(after.every((l) => l.lineNo === null && l.plan.isSurplusOnCompletion)).toBe(true);
    const timeline = await salesOrderApi.timeline(soId);
    expect(timeline.filter((e) => e.businessEventType === 'SURPLUS_CONVERTED' && e.reasonCode === 'SURPLUS_CONVERSION').length).toBeGreaterThanOrEqual(
      before.length,
    );
    expect(invariants()).toEqual([]);
  });
});

describe('재생산 계획 (REQ-PRD-006, 14.1-6)', () => {
  it('재생산 필요 8매: 생산(USE)만 만든다. 만든 뒤에는 재생산 필요가 없어지고 다시 만들 수 없다', async () => {
    const soId = salesOrderIdOf('SO-2609-005');
    actAs(SEED_EMPLOYEE_NO.sales);
    const detail = await salesOrderApi.detail(soId);
    const item = detail.items[0];
    expect(item?.shortage.reproductionNeedQty).toBe(8);
    expect(await codeOf(salesOrderApi.createReproduction({ salesOrderItemId: item?.salesOrderItemId ?? 0 }))).toBe('COM-002');

    actAs(SEED_EMPLOYEE_NO.productionHead);
    const created = await salesOrderApi.createReproduction({ salesOrderItemId: item?.salesOrderItemId ?? 0 });
    expect(created).toMatchObject({ reservedFromSurplusQty: 0, shortageQty: 8 });
    expect(created.productionPlanNo).toMatch(/^PP-\d{4}-\d{4}$/);
    const after = await salesOrderApi.detail(soId);
    expect(after.items[0]?.shortage.reproductionNeedQty).toBe(0);
    expect(after.items[0]?.plans.some((p) => p.isReproduction && p.productionPlanStatus === 'PLANNED')).toBe(true);
    const timeline = await salesOrderApi.timeline(soId);
    expect(timeline.at(-1)).toMatchObject({ businessEventType: 'REPRODUCTION_PLAN_CREATED', actorType: 'USER', reasonCode: 'ORDER_SHORTAGE' });
    expect(await codeOf(salesOrderApi.createReproduction({ salesOrderItemId: item?.salesOrderItemId ?? 0 }))).toBe('INPUT:salesOrderItemId');
    expect(await codeOf(salesOrderApi.createReproduction({ salesOrderItemId: 99999 }))).toBe('COM-003');
    expect(invariants()).toEqual([]);
  });
});

describe('업무방 열기 (REQ-MSG-001)', () => {
  it('없으면 만들고(연 사람 + 고른 사람), 있으면 그 방에 새 멤버만 더한다. 없는 사원 COM-003, 수주 조회 권한 없으면 COM-002', async () => {
    const soId = salesOrderIdOf('SO-2609-001');
    actAs(SEED_EMPLOYEE_NO.sales);
    expect(await salesOrderApi.workRoom(soId)).toBeNull();
    const rooms = countOf('chatRoom');
    const first = await salesOrderApi.openWorkRoom({ salesOrderId: soId, memberEmployeeIds: [employeeIdOf(SEED_EMPLOYEE_NO.logistics)] });
    expect(first).toMatchObject({ created: true, chatRoomName: 'SO-2609-001 가람중공업' });
    expect(countOf('chatRoom')).toBe(rooms + 1);
    expect((await salesOrderApi.workRoom(soId))?.memberEmployeeIds).toHaveLength(2);

    actAs(SEED_EMPLOYEE_NO.productionHead);
    const again = await salesOrderApi.openWorkRoom({ salesOrderId: soId, memberEmployeeIds: [employeeIdOf(SEED_EMPLOYEE_NO.qualityHead)] });
    expect(again).toMatchObject({ created: false, chatRoomId: first.chatRoomId });
    expect((await salesOrderApi.workRoom(soId))?.memberEmployeeIds).toHaveLength(4);

    expect(await codeOf(salesOrderApi.openWorkRoom({ salesOrderId: soId, memberEmployeeIds: [99999] }))).toBe('COM-003');
    actAs(SEED_EMPLOYEE_NO.purchase);
    expect(await codeOf(salesOrderApi.openWorkRoom({ salesOrderId: soId, memberEmployeeIds: [] }))).toBe('COM-002');
    expect(countOf('chatRoom')).toBe(rooms + 1);
  });
});
