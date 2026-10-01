// 실적 시뮬레이션 (REQ-PRD-007, 업무 프로세스 8장 BP-SEED-01). 작업 실적 화면에서 생산계획을 골라 실행한다(PRODUCTION_RESULT_CONFIRM).
// - 남은 공정의 실적을 모두 만든다: 히트마다 제선(필요 용선이 없을 때만) → 제강 → 연주, 코일 계획은 적격 슬래브가 있으면 열연까지.
// - 계획 수율은 고정: 용선 = 히트 용량 ÷ 제강 수율, 히트 톤 = 용선 × 제강 수율, 계획 슬래브 = floor(히트 톤 × 연주 수율 ÷ 슬래브 1매 이론중량).
// - 연주에서만 0~5% 샘플 손실률 → 손실 매수 = floor(계획 슬래브 × 손실률). 열연은 추가 손실 없음(슬래브 1매 = 코일 1개).
// - 같은 난수 시드 → 같은 결과. 시드·손실률·손실 매수·is_simulated를 실적에 저장한다. 검사값은 넣지 않는다.
// - 갓 연주한 슬래브는 판정 대기라 열연 배정을 할 수 없다 → 열연은 적격 슬래브가 있을 때만 (없으면 skippedRolling에 이유).
import { decCmp, decSum } from '@/lib/decimal';
import { hotMetalTonFor } from '@/lib/mrp';
import { createSeededRandom, drawSampleLossRate, lossQtyOf } from '@/lib/simulationLoss';
import type { MockTx } from '@/mock/store';
import { inputError, mustGet, productionSettingOf, productItemTypeOf, routingYieldOf, type PersonActor } from '@/mock/services/context';
import { confirmRollingAllocations, registerHotRolling, rollingPlanView, rollingRecommendation } from '@/mock/services/rolling';
import { maxCastingQtyOf, registerCasting, registerIronmaking, registerSteelmaking } from '@/mock/services/productionResults';

export interface SimulationInput {
  productionPlanId: number;
  /** 난수 시드 (생략하면 실행 시각으로 정하고 결과에 보여 준다) */
  randomSeed?: number | null;
  blastFurnaceCode?: string;
  converterCode?: string;
}

export interface SimulationStep {
  processType: 'IRONMAKING' | 'STEELMAKING' | 'CONTINUOUS_CASTING' | 'HOT_ROLLING';
  productionResultId: number;
  outputLotNos: string[];
  /** 연주: 계획 슬래브·샘플 손실률·손실 매수·실적 매수 */
  plannedQty?: number;
  sampleLossRate?: string;
  lossQty?: number;
  outputQty?: number;
}

export interface SimulationResult {
  productionPlanId: number;
  randomSeed: number;
  steps: SimulationStep[];
  skippedRolling: string | null;
}

const HOUR = 3_600_000;
const DURATION = { IRONMAKING: 4 * HOUR, STEELMAKING: 1 * HOUR, CONTINUOUS_CASTING: 2 * HOUR, HOT_ROLLING: 2 * HOUR } as const;

export function simulatePlan(tx: MockTx, actor: PersonActor, input: SimulationInput): SimulationResult {
  const plan = mustGet(tx.tables, 'productionPlan', input.productionPlanId, '생산계획');
  if (plan.productionPlanStatus === 'CANCELLED' || plan.productionPlanStatus === 'COMPLETED') inputError('productionPlanId', '계획·진행중인 생산계획만 시뮬레이션해요');
  const randomSeed = input.randomSeed ?? Math.floor(tx.now.getTime() / 1000) % 2_147_483_647;
  const random = createSeededRandom(randomSeed);
  const simulation = { randomSeed };
  const item = mustGet(tx.tables, 'item', plan.itemId, '규격');
  const productType = productItemTypeOf(item);
  const heatCapacity = productionSettingOf(tx.tables).heatCapacityTon;
  const hotMetalPerHeat = hotMetalTonFor(heatCapacity, routingYieldOf(tx.tables, productType, 'STEELMAKING'));
  const blastFurnaceCode = input.blastFurnaceCode ?? 'BF2';
  const converterCode = input.converterCode ?? 'BOF1';

  const heats = () => tx.tables.lot.filter((l) => l.productionPlanId === plan.id && l.lotType === 'HEAT').sort((a, b) => a.id - b.id);
  const uncastHeats = () => heats().filter((h) => !tx.tables.lot.some((l) => l.heatLotId === h.id && l.lotType === 'SLAB'));
  const heatsToMake = Math.max(0, plan.heatCount - heats().length);
  const willRoll = productType === 'COIL' && plan.salesOrderItemId !== null;

  // 시각: 모두 지금(tx 시각)에 끝나도록 거꾸로 배치한다
  const totalMs = heatsToMake * (DURATION.IRONMAKING + DURATION.STEELMAKING + DURATION.CONTINUOUS_CASTING) + uncastHeats().length * DURATION.CONTINUOUS_CASTING + (willRoll ? DURATION.HOT_ROLLING : 0);
  let cursor = tx.now.getTime() - totalMs;
  const nextSlot = (ms: number) => {
    const startedAt = new Date(cursor).toISOString();
    cursor += ms;
    return { startedAt, completedAt: new Date(cursor).toISOString() };
  };

  const steps: SimulationStep[] = [];
  const cast = (heatLotId: number) => {
    const heat = mustGet(tx.tables, 'lot', heatLotId, '히트');
    const plannedQty = maxCastingQtyOf(tx, plan, heat);
    if (plannedQty < 1) inputError('productionPlanId', `${heat.lotNo}에서 연주할 수 있는 슬래브가 없어요`);
    const sampleLossRate = drawSampleLossRate(random);
    const lossQty = lossQtyOf(plannedQty, sampleLossRate);
    const outputQty = plannedQty - lossQty;
    const { result, slabLots } = registerCasting(tx, actor, {
      productionPlanId: plan.id,
      heatLotId,
      outputQty,
      ...nextSlot(DURATION.CONTINUOUS_CASTING),
      simulation: { randomSeed, sampleLossRate, lossQty },
    });
    steps.push({ processType: 'CONTINUOUS_CASTING', productionResultId: result.id, outputLotNos: slabLots.map((s) => s.lotNo), plannedQty, sampleLossRate, lossQty, outputQty });
  };

  // 이미 제강한(연주 전) 히트부터 연주
  for (const heat of uncastHeats()) cast(heat.id);

  for (let n = 0; n < heatsToMake; n += 1) {
    const ironmakingSlot = nextSlot(DURATION.IRONMAKING);
    const availableHotMetal = decSum(
      tx.tables.lot.filter((l) => l.lotType === 'HOT_METAL' && l.lotStatus === 'AVAILABLE').map((l) => l.remainingTon ?? '0'),
    );
    if (decCmp(availableHotMetal, hotMetalPerHeat) < 0) {
      const { result, hotMetalLot } = registerIronmaking(tx, actor, { productionPlanId: plan.id, blastFurnaceCode, outputTon: hotMetalPerHeat, ...ironmakingSlot, simulation });
      steps.push({ processType: 'IRONMAKING', productionResultId: result.id, outputLotNos: [hotMetalLot.lotNo] });
    }
    const { result, heatLot } = registerSteelmaking(tx, actor, { productionPlanId: plan.id, converterCode, inputHotMetalTon: hotMetalPerHeat, ...nextSlot(DURATION.STEELMAKING), simulation });
    steps.push({ processType: 'STEELMAKING', productionResultId: result.id, outputLotNos: [heatLot.lotNo] });
    cast(heatLot.id);
  }

  let skippedRolling: string | null = null;
  if (productType === 'COIL') {
    if (!willRoll) skippedRolling = '수주 연결이 없는 코일 계획이라 열연하지 않아요';
    else {
      const recommendation = rollingRecommendation(tx.tables, plan.id);
      if (recommendation.lots.length > 0) confirmRollingAllocations(tx, actor, { productionPlanId: plan.id, lotIds: recommendation.lots.map((l) => l.lotId) });
      if (rollingPlanView(tx.tables, plan.id).allocatedQty > 0) {
        const { coilLots, resultId } = registerHotRolling(tx, actor, { productionPlanId: plan.id, ...nextSlot(DURATION.HOT_ROLLING), simulation });
        steps.push({ processType: 'HOT_ROLLING', productionResultId: resultId, outputLotNos: coilLots.map((c) => c.lotNo) });
      } else {
        skippedRolling = '열연할 적격 슬래브가 없어요. 슬래브 검사 합격 뒤 다시 실행하면 열연해요';
      }
    }
  }
  return { productionPlanId: plan.id, randomSeed, steps, skippedRolling };
}
