// 작업 실적·실적 시뮬레이션 api (REQ-PRD-003·007, REQ-LOT-001~004, BP-PRD-02 모든 행, 8장)
import { describe, expect, it } from 'vitest';
import { InputError } from '@/api/client';
import { productionResultApi } from '@/api/productionResults';
import { createSalesOrderForTest, eventsOf, lotOf, lotsOfPlan, planIdOf, planOf, readDb, stockRawMaterialsForTest } from '@/api/productionTestKit';
import { resetToSeed } from '@/mock/db';
import { checkInvariants } from '@/mock/services';
import { actAs, SEED_EMPLOYEE_NO } from '@/test/actors';

const IRONMAKING_NO = '1709007';
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const clean = () => expect(readDb((t) => checkInvariants(t))).toEqual([]);

describe('작업 실적 조회', () => {
  it('작업 실적 조회 권한이면 볼 수 있고(품질), 없으면 COM-002(영업)', async () => {
    actAs(SEED_EMPLOYEE_NO.quality);
    const plans = await productionResultApi.plans();
    expect(plans.some((p) => p.productionPlanNo === 'PP-2609-0004')).toBe(true);
    expect(plans.every((p) => p.productionPlanStatus !== 'CANCELLED')).toBe(true);
    const work = await productionResultApi.work(planIdOf('PP-2609-0004'));
    expect(work).toMatchObject({ isOpen: true, heatsToMakeQty: 0, hotMetalTonPerHeat: '277.778' });
    expect(work.uncastHeats).toEqual([expect.objectContaining({ heatLotNo: 'HT-BOF1-260918-001', maxSlabQty: 10, inspectionResult: 'PENDING' })]);
    expect(work.ironmakingMaterials.map((m) => m.itemCode).sort()).toEqual(['COL01', 'LIM01', 'ORE01']);
    expect(work.ferroalloys.map((m) => m.itemCode)).toEqual(['SMN01']);

    actAs(SEED_EMPLOYEE_NO.sales);
    await expect(productionResultApi.plans()).rejects.toMatchObject({ code: 'COM-002' });
  });
});

describe('제선 실적 (원료 FIFO 차감 → 용선, 원료→용선 기간 기반)', () => {
  it('용선 LOT HM-고로-YYMMDD-NN을 만들고 차감한 원료 LOT만 기간 기반으로 잇는다', async () => {
    actAs(IRONMAKING_NO);
    const planId = planIdOf('PP-2609-0004');
    const oreBefore = readDb((t) => t.lot.filter((l) => l.lotNo.startsWith('RM-ORE01')).map((l) => l.remainingTon));
    const startedAt = hoursAgo(5);
    const completedAt = hoursAgo(1);
    const result = await productionResultApi.registerIronmaking({ productionPlanId: planId, blastFurnaceCode: 'bf2', startedAt, completedAt, outputTon: '100.000' });
    expect(result.outputLotNos[0]).toMatch(/^HM-BF2-\d{6}-\d{2}$/);
    const hotMetal = lotOf(result.outputLotNos[0]);
    expect(hotMetal).toMatchObject({ lotType: 'HOT_METAL', initialTon: '100.000', remainingTon: '100.000' });
    const relations = readDb((t) => t.lotRelation.filter((r) => r.childLotId === hotMetal.id));
    expect(relations.length).toBeGreaterThanOrEqual(3);
    expect(relations.every((r) => r.lotRelationEvidence === 'PERIOD_BASED' && r.periodStartedAt === startedAt && r.periodEndedAt === completedAt)).toBe(true);
    // 철광석 160t (= 100 × 1.6) 차감
    const oreRelationTon = readDb((t) =>
      relations.filter((r) => t.lot.find((l) => l.id === r.parentLotId)?.lotNo.startsWith('RM-ORE01')).reduce((sum, r) => sum + Number(r.inputTon), 0),
    );
    expect(oreRelationTon).toBeCloseTo(160, 3);
    expect(readDb((t) => t.lot.filter((l) => l.lotNo.startsWith('RM-ORE01')).map((l) => l.remainingTon))).not.toEqual(oreBefore);
    expect(eventsOf('PRODUCTION_RESULT_REGISTERED').some((e) => e.targetNo === hotMetal.lotNo)).toBe(true);
    clean();
  });

  it('원료가 모자라면 아무것도 저장하지 않고 입력 오류, 용선량 0은 거부, 생산 담당이 아니면 COM-002', async () => {
    actAs(IRONMAKING_NO);
    const planId = planIdOf('PP-2609-0004');
    const lotCount = readDb((t) => t.lot.length);
    const base = { productionPlanId: planId, blastFurnaceCode: 'BF2', startedAt: hoursAgo(5), completedAt: hoursAgo(1) };
    await expect(productionResultApi.registerIronmaking({ ...base, outputTon: '99999.000' })).rejects.toBeInstanceOf(InputError);
    await expect(productionResultApi.registerIronmaking({ ...base, outputTon: '0' })).rejects.toMatchObject({ fieldErrors: { outputTon: expect.any(String) } });
    await expect(productionResultApi.registerIronmaking({ ...base, completedAt: hoursAgo(9), outputTon: '10.000' })).rejects.toMatchObject({ fieldErrors: { completedAt: expect.any(String) } });
    expect(readDb((t) => t.lot.length)).toBe(lotCount);
    actAs(SEED_EMPLOYEE_NO.quality);
    await expect(productionResultApi.registerIronmaking({ ...base, outputTon: '10.000' })).rejects.toMatchObject({ code: 'COM-002' });
  });

  it('작업 시작만 기록한 뒤 같은 실적으로 완료한다 (작업 상태값 없음)', async () => {
    actAs(IRONMAKING_NO);
    const planId = planIdOf('PP-2609-0004');
    const startedAt = hoursAgo(3);
    const { productionResultId } = await productionResultApi.startWork({ productionPlanId: planId, processType: 'IRONMAKING', startedAt, blastFurnaceCode: 'BF2' });
    const started = readDb((t) => t.productionResult.find((r) => r.id === productionResultId));
    expect(started).toMatchObject({ completedAt: null, startedAt });
    const done = await productionResultApi.registerIronmaking({ productionPlanId: planId, blastFurnaceCode: 'BF2', startedAt, completedAt: hoursAgo(1), outputTon: '50.000', productionResultId });
    expect(done.productionResultId).toBe(productionResultId);
    expect(readDb((t) => t.productionResult.find((r) => r.id === productionResultId)?.completedAt)).not.toBeNull();
    await expect(productionResultApi.startWork({ productionPlanId: planId, processType: 'STEELMAKING', startedAt, converterCode: '전로' })).rejects.toMatchObject({
      fieldErrors: { converterCode: expect.any(String) },
    });
  });
});

describe('제강·연주 실적', () => {
  it('편성한 히트를 모두 만들었으면 제강을 거부한다', async () => {
    actAs(SEED_EMPLOYEE_NO.steelmaking);
    await expect(
      productionResultApi.registerSteelmaking({ productionPlanId: planIdOf('PP-2609-0004'), converterCode: 'BOF1', startedAt: hoursAgo(2), completedAt: hoursAgo(1), inputHotMetalTon: '100.000' }),
    ).rejects.toBeInstanceOf(InputError);
  });

  it('연주: 히트 최대 매수를 넘으면 거부, 정상 등록하면 슬래브 히트번호-SS와 검사 대상, 계획 완료', async () => {
    actAs(SEED_EMPLOYEE_NO.steelmaking);
    const planId = planIdOf('PP-2609-0004');
    const heat = lotOf('HT-BOF1-260918-001');
    const base = { productionPlanId: planId, heatLotId: heat.id, startedAt: hoursAgo(3), completedAt: hoursAgo(1) };
    await expect(productionResultApi.registerCasting({ ...base, outputQty: 11 })).rejects.toMatchObject({ fieldErrors: { outputQty: expect.stringContaining('최대 10매') } });
    await expect(productionResultApi.registerCasting({ ...base, outputQty: 2.5 })).rejects.toBeInstanceOf(InputError);
    actAs(SEED_EMPLOYEE_NO.sales);
    await expect(productionResultApi.registerCasting({ ...base, outputQty: 10 })).rejects.toMatchObject({ code: 'COM-002' });

    actAs(SEED_EMPLOYEE_NO.steelmaking);
    const result = await productionResultApi.registerCasting({ ...base, outputQty: 10 });
    expect(result.outputLotNos).toHaveLength(10);
    expect(result.outputLotNos[0]).toBe('HT-BOF1-260918-001-01');
    const slabs = lotsOfPlan(planId, 'SLAB');
    expect(slabs.every((s) => s.heatLotId === heat.id && s.isPassed === null)).toBe(true);
    expect(readDb((t) => t.qualityInspection.filter((q) => slabs.some((s) => s.id === q.lotId)))).toHaveLength(10);
    expect(planOf(planId).productionPlanStatus).toBe('COMPLETED');
    await expect(productionResultApi.registerCasting({ ...base, outputQty: 1 })).rejects.toBeInstanceOf(InputError);
    clean();
  });

  it('없는 계획은 COM-003', async () => {
    actAs(SEED_EMPLOYEE_NO.steelmaking);
    await expect(productionResultApi.work(99999)).rejects.toMatchObject({ code: 'COM-003' });
    await expect(
      productionResultApi.registerSteelmaking({ productionPlanId: 99999, converterCode: 'BOF1', startedAt: hoursAgo(2), completedAt: hoursAgo(1), inputHotMetalTon: '1.000' }),
    ).rejects.toMatchObject({ code: 'COM-003' });
  });
});

describe('실적 시뮬레이션 (REQ-PRD-007)', () => {
  async function simulateNewSphcPlan(seed: number) {
    await stockRawMaterialsForTest();
    const { planIds } = await createSalesOrderForTest('CUS-04', [{ itemCode: 'SL-SPHC-220x1400x9500', orderedQty: 3, dueDate: '2026-12-01' }]);
    actAs(SEED_EMPLOYEE_NO.steelmaking);
    const result = await productionResultApi.simulate({ productionPlanId: planIds[0], randomSeed: seed });
    return { planId: planIds[0], result };
  }

  it('남은 공정을 모두 만들고 연주에서만 손실(floor), 시드·손실률·손실 매수·is_simulated를 저장한다. 같은 시드 → 같은 결과', async () => {
    const first = await simulateNewSphcPlan(20261001);
    expect(first.result.randomSeed).toBe(20261001);
    expect(first.result.steps.map((s) => s.processType)).toContain('CONTINUOUS_CASTING');
    const casting = first.result.steps.find((s) => s.processType === 'CONTINUOUS_CASTING');
    expect(Number(casting?.sampleLossRate)).toBeLessThanOrEqual(0.05);
    expect(casting?.lossQty).toBe(Math.floor((casting?.plannedQty ?? 0) * Number(casting?.sampleLossRate)));
    expect(casting?.outputQty).toBe((casting?.plannedQty ?? 0) - (casting?.lossQty ?? 0));
    const castingRow = readDb((t) => t.productionResult.find((r) => r.id === casting?.productionResultId));
    expect(castingRow).toMatchObject({ isSimulated: true, randomSeed: 20261001, sampleLossRate: casting?.sampleLossRate, lossQty: casting?.lossQty });
    expect(planOf(first.planId).productionPlanStatus).toBe('COMPLETED');
    clean();

    resetToSeed();
    const second = await simulateNewSphcPlan(20261001);
    const shape = (steps: typeof first.result.steps) => steps.map((s) => [s.processType, s.outputLotNos, s.plannedQty, s.sampleLossRate, s.lossQty, s.outputQty]);
    expect(shape(second.result.steps)).toEqual(shape(first.result.steps));
  });

  it('시드 범위·완료된 계획·권한을 확인한다', async () => {
    actAs(SEED_EMPLOYEE_NO.steelmaking);
    await expect(productionResultApi.simulate({ productionPlanId: planIdOf('PP-2609-0004'), randomSeed: -1 })).rejects.toMatchObject({ fieldErrors: { randomSeed: expect.any(String) } });
    await expect(productionResultApi.simulate({ productionPlanId: planIdOf('PP-2609-0001') })).rejects.toBeInstanceOf(InputError);
    await expect(productionResultApi.simulate({ productionPlanId: 99999 })).rejects.toMatchObject({ code: 'COM-003' });
    actAs(SEED_EMPLOYEE_NO.quality);
    await expect(productionResultApi.simulate({ productionPlanId: planIdOf('PP-2609-0004') })).rejects.toMatchObject({ code: 'COM-002' });
  });
});
