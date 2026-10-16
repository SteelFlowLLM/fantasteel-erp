// 생산 서버 어댑터(api/server/production.ts): 생산계획 상세의 LOT 품질·재생산 판단, 취소, 히트 편성 확정, 작업 실적의 서버 경로·값 변환.
import type { ProductionPlanDetail as ServerPlanDetail, ProductionPlanSummary as ServerPlanSummary } from '@fantasteel/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { productionPlanApi } from '@/api/production';
import { productionResultApi } from '@/api/productionResults';
import { ok, page, stopFakeServer, useFakeServer, type ServerCall } from '@/api/server/serverTestKit';
import { SEED_EMPLOYEE_NO } from '@/test/actors';

afterEach(() => stopFakeServer());

const progress = { heatCount: 1, madeHeatQty: 0, castHeatQty: 0, slabQty: 0, coilQty: 0, usableCoilQty: 0, passedQty: 0, pendingQty: 0, failedQty: 0, hotRollingAllocatedQty: 0, ownRollableSlabQty: 0, allHeatsCast: false, remainingTargetQty: 4 };
const lot = (lotId: number, lotType: string, inspectionResult: string | null, heatInspectionResult: string | null) => ({
  lotId,
  lotNo: `LOT-${lotId}`,
  lotType,
  lotStatus: 'AVAILABLE',
  itemCode: 'SL-SS275-250x1200x10000',
  heatLotId: null,
  heatLotNo: null,
  producedDate: '2026-10-05',
  initialTon: null,
  remainingTon: null,
  inspectionResult,
  heatInspectionResult,
  dispositionStatus: null,
  allocationPurpose: null,
  yardName: null,
});

// 어댑터가 읽는 칸만 채운다
const detail = (overrides: Partial<ServerPlanDetail> = {}) =>
  ({
    id: 300,
    productionPlanNo: 'PP-2610-0001',
    productionPlanStatus: 'PLANNED',
    isReproduction: false,
    itemId: 11,
    itemCode: 'SL-SS275-250x1200x10000',
    itemName: 'SS275 슬래브',
    itemType: 'SLAB',
    steelGradeCode: 'SS275',
    theoreticalWeightTon: '23.550',
    heatCount: 1,
    salesOrderId: null,
    salesOrderNo: null,
    salesOrderItemId: null,
    salesOrderItem: null,
    formation: null,
    results: [],
    heats: [],
    progress,
    lots: [],
    reproduction: null,
    canCancel: true,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-12T01:00:00.000Z',
    ...overrides,
  }) as ServerPlanDetail;

const reproduction = (salesOrderItemStatus: string) => ({
  salesOrderItemId: 51,
  salesOrderId: 50,
  salesOrderNo: 'SO-2610-001',
  lineNo: 1,
  salesOrderItemStatus,
  orderedQty: 10,
  shippedQty: 0,
  unshippedQty: 10,
  activeReservedQty: 4,
  unsecuredQty: 6,
  openPlanRemainingQty: 0,
  additionalPlanQty: 6,
  reservationAvailableQty: 2,
  reproductionNeedQty: 4,
  openPlans: [],
});

describe('생산계획 서버 어댑터 — 상세', () => {
  it('LOT 품질: 원료·용선은 판정 없음, 자기 불합격 → 히트 불합격 → 판정 대기 → 히트 판정 대기 → 합격 순으로 본다', async () => {
    const lots = [lot(1, 'RAW_MATERIAL', null, null), lot(2, 'SLAB', 'FAIL', 'PASS'), lot(3, 'SLAB', 'PASS', 'FAIL'), lot(4, 'SLAB', 'PENDING', 'PASS'), lot(5, 'SLAB', 'PASS', 'PENDING'), lot(6, 'SLAB', 'PASS', 'PASS'), lot(7, 'HEAT', 'PASS', null)];
    useFakeServer(SEED_EMPLOYEE_NO.productionHead, (c) => (c.path === '/production-plans/300' ? ok(detail({ lots } as Partial<ServerPlanDetail>)) : undefined));
    const plan = await productionPlanApi.detail(300);
    expect(plan.lots.map((l) => l.quality)).toEqual(['NONE', 'FAIL', 'HEAT_FAILED', 'PENDING', 'HEAT_PENDING', 'PASS', 'PASS']);
  });

  it('재생산 판단: 여재로 채울 몫 = min(추가 계획 필요, 예약 가용), 진행중·부분출하 품목만 재생산할 수 있다', async () => {
    for (const [status, canReproduce] of [['OPEN', true], ['PARTIALLY_SHIPPED', true], ['SHIPPED', false], ['CANCELLED', false]] as const) {
      useFakeServer(SEED_EMPLOYEE_NO.productionHead, (c) => (c.path === '/production-plans/300' ? ok(detail({ reproduction: reproduction(status) } as Partial<ServerPlanDetail>)) : undefined));
      expect((await productionPlanApi.detail(300)).reproduction).toMatchObject({ surplusReserveQty: 2, reproductionNeedQty: 4, canReproduce });
      stopFakeServer();
    }
  });
});

describe('생산계획 서버 어댑터 — 취소·히트 편성 확정', () => {
  it('취소: 화면을 연 뒤 바뀌었으면 POST 없이 COM-001, 사유는 앞뒤 공백을 지우고 200자까지, 빈칸은 보내지 않는다', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.productionHead, (c) => (c.path === '/production-plans/300' || c.path === '/production-plans/300/cancel' ? ok(detail()) : undefined));
    await expect(productionPlanApi.cancel({ productionPlanId: 300, expectedUpdatedAt: '2026-10-12T00:00:00.000Z' })).rejects.toMatchObject({ code: 'COM-001' });
    expect(calls.map((c) => c.method)).toEqual(['GET']);

    await productionPlanApi.cancel({ productionPlanId: 300, reasonText: `  ${'가'.repeat(210)}  ` });
    await productionPlanApi.cancel({ productionPlanId: 300, reasonText: '   ' });
    const bodies = calls.filter((c) => c.method === 'POST').map((c) => c.body as { reason?: string });
    expect(bodies[0].reason).toHaveLength(200);
    expect(bodies[1]).toEqual({});
  });

  it('히트 편성 확정: confirm을 부르고 저장된 히트 수를 돌려준다. 화면을 연 뒤 바뀌었으면 부르지 않고 COM-001', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.productionHead, (c) => (c.path === '/production-plans/300' || c.path === '/production-plans/300/confirm' ? ok(detail({ heatCount: 3 })) : undefined));
    expect(await productionPlanApi.confirmHeatPlan({ productionPlanId: 300 })).toEqual({ id: 300, productionPlanNo: 'PP-2610-0001', heatCount: 3 });
    await expect(productionPlanApi.confirmHeatPlan({ productionPlanId: 300, expectedUpdatedAt: '2026-10-12T00:00:00.000Z' })).rejects.toMatchObject({ code: 'COM-001' });
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(['POST /production-plans/300/confirm', 'GET /production-plans/300']);
  });
});

describe('작업 실적 서버 어댑터', () => {
  const summary = (id: number, productionPlanStatus: string) => ({ ...detail({ id, productionPlanNo: `PP-2610-000${id}` }), productionPlanStatus }) as unknown as ServerPlanSummary;
  const workContext = {
    steelmakingYieldRate: '0.9000',
    castingYieldRate: '0.9800',
    heatCapacityTon: '250.000',
    hotMetalTonPerHeat: '277.778',
    hotMetalLots: [],
    hotMetalAvailableTon: '0.000',
    ironmakingMaterials: [],
    ferroalloys: [],
    heatsToMakeQty: 0,
    uncastHeats: [{ lotId: 901, lotNo: 'HT-BOF1-261005-001', heatTon: '250.000', maxSlabQty: 10, inspectionResult: null, completedAt: '2026-10-05T00:30:00.000Z' }],
    openWork: [{ productionResultId: 77, processType: 'CONTINUOUS_CASTING', startedAt: '2026-10-05T01:00:00.000Z', heatLotId: 901 }],
    lastBlastFurnaceCode: null,
    lastConverterCode: null,
    earliestIronmakingStartedAt: '2026-10-05T00:10:00.000Z',
    earliestSteelmakingStartedAt: null,
  };
  const result = { id: 88, outputs: [{ lotNo: 'HT-BOF1-261005-002' }] };

  it('계획 목록은 취소된 계획을 빼고, 작업 기준값의 판정 없는 히트는 판정 대기, 진행 중 작업에는 히트 번호를 붙인다', async () => {
    useFakeServer(SEED_EMPLOYEE_NO.productionHead, (c: ServerCall) => {
      if (c.path === '/production-plans' && c.method === 'GET') return ok(page([summary(1, 'PLANNED'), summary(2, 'CANCELLED'), summary(3, 'COMPLETED')]));
      if (c.path === '/production-plans/300') return ok(detail({ heats: [{ seq: 1, heatLotId: 901, heatNo: 'HT-BOF1-261005-001', converterCode: 'BOF1', producedDate: '2026-10-05', heatTon: '250.000', inspectionResult: null, castDone: false, slabQty: 0 }] } as Partial<ServerPlanDetail>));
      if (c.path === '/production-plans/300/work-context') return ok(workContext);
      return undefined;
    });
    expect((await productionResultApi.plans()).map((p) => p.productionPlanNo)).toEqual(['PP-2610-0001', 'PP-2610-0003']);
    const work = await productionResultApi.work(300);
    expect(work.uncastHeats[0]).toMatchObject({ heatLotId: 901, inspectionResult: 'PENDING', completedAt: '2026-10-05T00:30:00.000Z' });
    expect(work).toMatchObject({ earliestIronmakingStartedAt: '2026-10-05T00:10:00.000Z', earliestSteelmakingStartedAt: null });
    expect(work.openWork[0]).toMatchObject({ productionResultId: 77, heatNo: 'HT-BOF1-261005-001' });
  });

  it('작업 시작한 실적은 /complete로 완료하고, 아니면 시작·완료를 한 번에 보낸다. 고로·전로 코드는 대문자로', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.productionHead, () => ok(result));
    await productionResultApi.registerSteelmaking({ productionPlanId: 300, productionResultId: 77, converterCode: 'bof1', startedAt: '2026-10-05T01:00:00.000Z', completedAt: '2026-10-05T02:00:00.000Z', inputHotMetalTon: '277.778' });
    await productionResultApi.registerSteelmaking({ productionPlanId: 300, converterCode: ' bof1 ', startedAt: '2026-10-05T01:00:00.000Z', completedAt: '2026-10-05T02:00:00.000Z', inputHotMetalTon: '277.778' });
    await productionResultApi.registerIronmaking({ productionPlanId: 300, blastFurnaceCode: 'bf2', startedAt: '2026-10-05T00:00:00.000Z', completedAt: '2026-10-05T01:00:00.000Z', outputTon: '300' });
    expect(calls.map((c) => c.path)).toEqual(['/production-results/77/complete', '/production-results', '/production-results']);
    expect(calls[1].body).toMatchObject({ processType: 'STEELMAKING', converterCode: 'BOF1', inputHotMetalTon: '277.778' });
    expect(calls[2].body).toMatchObject({ processType: 'IRONMAKING', blastFurnaceCode: 'BF2', hotMetalTon: '300' });
  });
});
