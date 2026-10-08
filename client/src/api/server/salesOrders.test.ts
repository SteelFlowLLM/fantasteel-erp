// 수주 서버 어댑터: 수주 상세의 생산 연결 탭은 생산계획 상세(GET /production-plans/:id), 재생산 계획 만들기는 POST /production-plans를 부른다.
import { afterEach, describe, expect, it } from 'vitest';
import { salesOrderApi } from '@/api/salesOrders';
import { fail, ok, page, stopFakeServer, useFakeServer, type ServerCall } from '@/api/server/serverTestKit';
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
