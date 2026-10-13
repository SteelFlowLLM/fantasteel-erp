// 수주 서버 어댑터: 등록 미리보기는 서버 기준정보로 계산하고 고객사·규격 id는 서버 id 그대로 보낸다. 수주 상세의 생산 연결 탭은 생산계획 상세(GET /production-plans/:id), 재생산 계획 만들기는 POST /production-plans를 부른다.
import { afterEach, describe, expect, it } from 'vitest';
import { salesOrderApi } from '@/api/salesOrders';
import { fail, ok, page, stopFakeServer, useFakeServer, type ServerCall } from '@/api/server/serverTestKit';
import { planHeats } from '@/lib/heatPlanning';
import { calcHotRollingYieldRate } from '@/lib/weight';
import { SEED_EMPLOYEE_NO } from '@/test/actors';

afterEach(() => stopFakeServer());

const progress = { heatCount: 2, madeHeatQty: 1, castHeatQty: 1, slabQty: 6, coilQty: 0, passedQty: 4, pendingQty: 2, failedQty: 0, openWorkCount: 0, usableCoilQty: 0, hotRollingAllocatedQty: 0, ownRollableSlabQty: 0, allHeatsCast: false, remainingTargetQty: 1 };

/** 생산계획 상세 (편성표는 기준정보가 모자란 경우로 null) */
const planDetail = (id: number, productionPlanNo: string, over: Record<string, unknown> = {}) => ({
  id,
  productionPlanNo,
  productionPlanStatus: 'IN_PROGRESS',
  isReproduction: false,
  itemId: 5,
  itemCode: 'SL-SS275-250x1200x10000',
  itemName: '슬래브 SS275',
  itemType: 'SLAB',
  steelGradeCode: 'SS275',
  shortageQty: 5,
  heatCount: 2,
  salesOrderId: 9,
  salesOrderNo: 'SO-2610-0009',
  salesOrderItemId: 72,
  customerName: '한빛건설',
  dueDate: '2026-11-30',
  requiredMoltenSteelTon: null,
  heatsMadeQty: 1,
  heatsCastQty: 1,
  passedQty: 4,
  remainingTargetQty: 1,
  createdAt: '2026-10-01T00:00:00.000Z',
  salesOrderItem: { id: 72, orderedQty: 5, salesOrderItemStatus: 'OPEN' },
  formation: null,
  formationError: '계획 수율이 없어요',
  progress,
  lots: [],
  reproduction: null,
  canCancel: false,
  canConfirm: false,
  results: [],
  heats: [],
  createdEmployeeName: '생산 담당',
  cancelledAt: null,
  salesOrderOwnerName: '영업 담당',
  salesOrderLineNo: 2,
  updatedAt: '2026-10-02T00:00:00.000Z',
  ...over,
});

/** 수주 상세: 품목 2줄, 2번 품목에 계획 81, 취소 기록에 연결이 풀린 계획 PP-2610-0090 */
const salesOrder = {
  items: [{ salesOrderItemId: 71 }, { salesOrderItemId: 72 }],
  productionPlans: [{ id: 81, productionPlanNo: 'PP-2610-0081', salesOrderItemId: 72 }],
  cancellation: { unlinkedPlanNos: ['PP-2610-0090'] },
};

function respondLinks(c: ServerCall) {
  if (c.path === '/sales-orders/9') return ok(salesOrder);
  if (c.path === '/production-plans') return ok(page([{ id: 90, productionPlanNo: 'PP-2610-0090', customerName: null }, { id: 81, productionPlanNo: 'PP-2610-0081', customerName: '한빛건설' }]));
  if (c.path === '/production-plans/81') return ok(planDetail(81, 'PP-2610-0081'));
  if (c.path === '/production-plans/90') return ok(planDetail(90, 'PP-2610-0090', { salesOrderId: null, salesOrderNo: null, salesOrderItemId: null, salesOrderItem: null }));
  return undefined;
}

describe('수주 서버 어댑터 (api/server/salesOrders.ts)', () => {
  it('생산 연결: 연결된 계획은 품목 번호와 함께, 취소로 연결이 풀린 계획은 품목 번호 없이 계획 상세(실적 제외)를 돌려준다', async () => {
    useFakeServer(SEED_EMPLOYEE_NO.sales, respondLinks);
    const links = await salesOrderApi.productionLinks(9);
    expect(links.map((l) => [l.lineNo, l.plan.productionPlanNo, l.plan.productionPlanStatus])).toEqual([
      [2, 'PP-2610-0081', 'IN_PROGRESS'],
      [null, 'PP-2610-0090', 'IN_PROGRESS'],
    ]);
    expect(links[0].plan).toMatchObject({ formation: null, progress: { heatCount: 2, heatsMadeQty: 1, passedQty: 4, pendingQty: 2 }, salesOrder: { salesOrderNo: 'SO-2610-0009', lineNo: 2 } });
    expect(links[1].plan.salesOrder).toBeNull();
    expect('results' in links[0].plan).toBe(false);
  });

  it('생산 연결: 취소 기록이 없으면 계획 목록을 읽지 않고, 생산계획 조회 권한이 없으면(물류) 빈 목록', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.sales, (c) => (c.path === '/sales-orders/9' ? ok({ ...salesOrder, cancellation: null }) : respondLinks(c)));
    expect((await salesOrderApi.productionLinks(9)).map((l) => l.plan.id)).toEqual([81]);
    expect(calls.map((c) => c.path)).toEqual(['/sales-orders/9', '/production-plans/81']);
    stopFakeServer();

    useFakeServer(SEED_EMPLOYEE_NO.logistics, (c) => (c.path.startsWith('/production-plans') ? fail(403, 'COM-002', '권한이 없어요') : respondLinks(c)));
    expect(await salesOrderApi.productionLinks(9)).toEqual([]);
  });

  it('재생산 계획: 수주 품목 id로 POST /production-plans를 부르고 여재 예약 매수·새 계획을 돌려준다', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.productionHead, (c) =>
      c.method === 'POST' && c.path === '/production-plans' ? ok({ reservedFromSurplusQty: 1, plan: { id: 42, productionPlanNo: 'PP-2610-0042', shortageQty: 3 } }) : undefined,
    );
    expect(await salesOrderApi.createReproduction({ salesOrderItemId: 7 })).toEqual({ reservedFromSurplusQty: 1, productionPlanId: 42, productionPlanNo: 'PP-2610-0042', shortageQty: 3 });
    expect(calls.map((c) => [c.method, c.path, c.body])).toEqual([['POST', '/production-plans', { salesOrderItemId: 7 }]]);
  });

  it('재생산 계획: 여재로 다 채워 계획을 만들지 않았으면 계획 없음, 부족 0', async () => {
    useFakeServer(SEED_EMPLOYEE_NO.productionHead, () => ok({ reservedFromSurplusQty: 4, plan: null }));
    expect(await salesOrderApi.createReproduction({ salesOrderItemId: 7 })).toEqual({ reservedFromSurplusQty: 4, productionPlanId: null, productionPlanNo: null, shortageQty: 0 });
  });

  it('재생산 계획: 서버 오류 코드를 그대로 넘긴다 (권한 없음)', async () => {
    useFakeServer(SEED_EMPLOYEE_NO.sales, () => fail(403, 'COM-002', '권한이 없어요'));
    await expect(salesOrderApi.createReproduction({ salesOrderItemId: 7 })).rejects.toMatchObject({ code: 'COM-002' });
  });
});

describe('수주 등록 서버 모드: 규격·고객사 id는 서버 id, 미리보기는 서버 기준정보로 계산', () => {
  const slab = { id: 301, itemCode: 'SL-SM355C-250x1500x10000', itemName: 'SM355C 슬래브', itemType: 'SLAB', rawMaterialType: null, steelGradeId: 9, steelGradeCode: 'SM355C', theoreticalWeightTon: '29.438' };
  const coil = { ...slab, id: 302, itemCode: 'CL-SM355C-8x1500x300000', itemName: 'SM355C 코일', itemType: 'COIL', theoreticalWeightTon: '28.260' };
  const ore = { id: 1, itemCode: 'ORE01', itemName: '철광석', itemType: 'RAW_MATERIAL', rawMaterialType: 'IRON_ORE', steelGradeId: null, steelGradeCode: null, theoreticalWeightTon: null };
  const routings = (['SLAB', 'COIL'] as const).flatMap((itemType) => [
    { id: 1, itemType, processType: 'STEELMAKING', sequenceNo: 1, plannedYieldRate: '0.9500' },
    { id: 2, itemType, processType: 'CONTINUOUS_CASTING', sequenceNo: 2, plannedYieldRate: '0.9800' },
  ]);
  const mappings = [{ id: 40, steelGradeId: 9, steelGradeCode: 'SM355C', slabItem: { id: 301, itemCode: slab.itemCode, theoreticalWeightTon: '29.438' }, coilItem: { id: 302, itemCode: coil.itemCode, theoreticalWeightTon: '28.260' }, hotRollingYieldRate: '0.9600' }];
  const consumptions = [
    { id: 1, rawMaterialItemId: 1, rawMaterialItemCode: 'ORE01', rawMaterialType: 'IRON_ORE', steelGradeId: null, steelGradeCode: null, consumptionRate: '1.6000' },
    { id: 2, rawMaterialItemId: 4, rawMaterialItemCode: 'SMN01', rawMaterialType: 'FERROALLOY', steelGradeId: 9, steelGradeCode: 'SM355C', consumptionRate: '12.0000' },
  ];
  const stock = { totals: [], items: [{ itemId: 301, itemCode: slab.itemCode, availableQty: 2 }] };

  function respond(over: Partial<Record<string, unknown>> = {}) {
    const data: Record<string, unknown> = {
      '/items': [slab, coil, ore],
      '/routings': routings,
      '/spec-mappings': mappings,
      '/specific-consumptions': consumptions,
      '/production-settings': { id: 1, heatCapacityTon: '250.000', deliveryRiskDays: 3 },
      '/dashboard/widgets/product-stock': stock,
      ...over,
    };
    return (c: ServerCall) => (c.path in data ? ok(data[c.path]) : undefined);
  }

  it('미리보기: 서버에서 새로 만든 규격(서버 id)으로 예약 가용을 먼저 쓰고, 부족분 히트 편성을 서버 수율·히트 용량으로 계산한다', async () => {
    useFakeServer(SEED_EMPLOYEE_NO.sales, respond());
    const [slabLine, coilLine] = await salesOrderApi.preview([
      { itemId: 301, orderedQty: 6 },
      { itemId: 302, orderedQty: '3' },
    ]);
    expect(slabLine).toMatchObject({ itemId: 301, itemCode: slab.itemCode, itemType: 'SLAB', availableQty: 2, reserveQty: 2, shortageQty: 4, weightTon: '176.628' });
    expect(slabLine.formation).toEqual(
      planHeats({ productType: 'SLAB', shortageQty: 4, theoreticalWeightTon: '29.438', castingYieldRate: '0.9800', hotRollingYieldRate: null, heatCapacityTon: '250.000', slabTheoreticalWeightTon: '29.438' }),
    );
    expect(coilLine.formation).toEqual(
      planHeats({ productType: 'COIL', shortageQty: 3, theoreticalWeightTon: '28.260', castingYieldRate: '0.9800', hotRollingYieldRate: calcHotRollingYieldRate('28.260', '29.438'), heatCapacityTon: '250.000', slabTheoreticalWeightTon: '29.438' }),
    );
  });

  it('미리보기: 기준정보가 빠지면 MST-001, 원료·없는 규격은 SO-001', async () => {
    useFakeServer(SEED_EMPLOYEE_NO.sales, respond({ '/routings': routings.filter((r) => r.processType !== 'CONTINUOUS_CASTING') }));
    await expect(salesOrderApi.preview([{ itemId: 301, orderedQty: 6 }])).rejects.toMatchObject({ code: 'MST-001' });
    stopFakeServer();

    useFakeServer(SEED_EMPLOYEE_NO.sales, respond({ '/specific-consumptions': consumptions.filter((c) => c.rawMaterialType !== 'FERROALLOY') }));
    await expect(salesOrderApi.preview([{ itemId: 301, orderedQty: 6 }])).rejects.toMatchObject({ code: 'MST-001' });
    await expect(salesOrderApi.preview([{ itemId: 1, orderedQty: 1 }])).rejects.toMatchObject({ code: 'SO-001' });
    await expect(salesOrderApi.preview([{ itemId: 999, orderedQty: 1 }])).rejects.toMatchObject({ code: 'SO-001' });
  });

  it('미리보기: 매수가 1 이상 정수가 아니면 SO-002 (화면 입력 규칙과 같다)', async () => {
    useFakeServer(SEED_EMPLOYEE_NO.sales, respond());
    for (const orderedQty of ['1.5', '0', '-1', 'abc']) {
      await expect(salesOrderApi.preview([{ itemId: 301, orderedQty }])).rejects.toMatchObject({ code: 'SO-002' });
    }
    await expect(salesOrderApi.preview([{ itemId: 301, orderedQty: ' 6 ' }])).resolves.toHaveLength(1);
  });

  it('등록: 고른 서버 고객사·규격 id를 그대로 보내고 기준정보를 다시 읽지 않는다', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.sales, (c) =>
      c.method === 'POST' && c.path === '/sales-orders'
        ? ok({ salesOrderId: 9, salesOrderNo: 'SO-2610-0009', items: [{ salesOrderItemId: 72, itemId: 301, orderedQty: 6, orderedTon: '176.628', reservedQty: 2, shortageQty: 4, productionPlanNo: 'PP-2610-0081' }], totalReservedQty: 2, totalShortageQty: 4 })
        : undefined,
    );
    await salesOrderApi.create({ customerId: 52, items: [{ itemId: 301, orderedQty: 6, dueDate: '2026-11-30' }] });
    expect(calls.map((c) => [c.method, c.path])).toEqual([['POST', '/sales-orders']]);
    expect(calls[0].body).toEqual({ customerId: 52, items: [{ itemId: 301, orderedQty: 6, dueDate: '2026-11-30' }] });
  });
  it('미리보기: 같은 규격 두 줄은 앞 줄이 예약 가용을 먼저 쓴다', async () => {
    useFakeServer(SEED_EMPLOYEE_NO.sales, respond());
    const lines = await salesOrderApi.preview([
      { itemId: 301, orderedQty: 3 },
      { itemId: 301, orderedQty: 3 },
    ]);
    expect(lines.map((l) => [l.availableQty, l.reserveQty, l.shortageQty])).toEqual([
      [2, 2, 1],
      [0, 0, 3],
    ]);
  });

  it('등록: 숫자만 쓴 매수는 숫자로, 그 밖은 그대로 보내 서버가 거부하게 하고, 품목이 없으면 서버를 부르지 않고 SO-001', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.sales, () => ok({ salesOrderId: 9, salesOrderNo: 'SO-2610-0009', items: [], totalReservedQty: 0, totalShortageQty: 0 }));
    await salesOrderApi.create({ customerId: 52, items: [{ itemId: 301, orderedQty: ' 3 ', dueDate: '2026-11-30' }, { itemId: 302, orderedQty: '3매', dueDate: '2026-11-30' }] });
    expect((calls[0].body as { items: { orderedQty: unknown }[] }).items.map((i) => i.orderedQty)).toEqual([3, '3매']);
    await expect(salesOrderApi.create({ customerId: 52, items: [] })).rejects.toMatchObject({ code: 'SO-001' });
    expect(calls).toHaveLength(1);
  });
});

describe('수주 상세 서버 모드: 충족 지표 분모와 취소 내역', () => {
  const item = (salesOrderItemId: number, itemType: string, over: Record<string, unknown> = {}) => ({
    salesOrderItemId,
    itemId: 301,
    itemCode: 'SL-SM355C-250x1500x10000',
    itemName: 'SM355C 슬래브',
    itemType,
    theoreticalWeightTon: '29.438',
    orderedQty: 10,
    orderedTon: '294.380',
    dueDate: '2026-11-30',
    salesOrderItemStatus: 'OPEN',
    isDueRisk: false,
    shippedQty: 0,
    activeReservedQty: 4,
    passedQty: 2,
    inProductionQty: 5,
    plannedQty: 6,
    unshippedQty: 10,
    unsecuredQty: 6,
    additionalPlanQty: 0,
    openPlanRemainingQty: 6,
    reservationAvailableQty: 0,
    reproductionNeedQty: 0,
    progress: { qty: 0, denominatorQty: 10, ratio: 0 },
    ...over,
  });
  const order = {
    id: 9,
    salesOrderNo: 'SO-2610-0009',
    customerId: 52,
    customerName: '새고객',
    salesOrderStatus: 'CANCELLED',
    items: [item(71, 'SLAB'), item(72, 'COIL', { orderedQty: 3, unshippedQty: 0, activeReservedQty: 0 })],
    productionPlans: [],
    shipmentRequests: [],
    cancelBlock: null,
    cancellation: { cancelledAt: '2026-10-13T02:00:00.000Z', reason: '고객 요청', releasedReservations: [{ salesOrderItemId: 72, releasedQty: 3 }], cancelledPlanNos: ['PP-2610-0081'], unlinkedPlanNos: [] },
  };

  it('예약 몫의 분모는 미출하 매수(없으면 비율 없음), 생산중·합격 몫의 분모는 수주 매수이고, 해제한 예약은 품목 줄 번호·유형으로 보인다', async () => {
    useFakeServer(SEED_EMPLOYEE_NO.sales, (c: ServerCall) => {
      if (c.path === '/sales-orders/9') return ok(order);
      if (c.path === '/sales-orders/9/reservations') return ok([]);
      if (c.path === '/mill-sheets') return fail(403, 'COM-002', '권한이 없어요');
      return undefined;
    });
    const detail = await salesOrderApi.detail(9);
    expect(detail.items[0].measures).toMatchObject({
      reserved: { qty: 4, denominatorQty: 10, ratio: 0.4 },
      inProduction: { qty: 5, denominatorQty: 10, ratio: 0.5 },
      passed: { qty: 2, denominatorQty: 10, ratio: 0.2 },
    });
    expect(detail.items[1].measures.reserved).toEqual({ qty: 0, denominatorQty: 0, ratio: null });
    expect(detail).toMatchObject({ cancelledAt: '2026-10-13T02:00:00.000Z', cancelReason: '고객 요청', millSheets: [] });
    expect(detail.cancellation).toEqual({ releasedReserved: [{ lineNo: 2, itemType: 'COIL', qty: 3 }], cancelledPlanNos: ['PP-2610-0081'], unlinkedPlanNos: [] });
  });
});
