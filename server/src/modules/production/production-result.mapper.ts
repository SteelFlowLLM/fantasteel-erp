import { BUSINESS_EVENT_TYPE, LOT_TYPE, PROCESS_TYPE, calcWeightTon, sumTon, type LotType, type ProcessType, type ProductionResultView, type ResultInputLot } from '@fantasteel/shared';
import type { ResultViewRow } from './production-result.repository';

export interface ResultEventRow {
  targetId: number;
  businessEventType: string;
  afterData: unknown;
  actorEmployee: { employeeName: string } | null;
}

const isProduct = (lotType: string) => lotType === LOT_TYPE.SLAB || lotType === LOT_TYPE.COIL;

/** 실적 시뮬레이션 값: 실적 등록 로그 after_data의 simulation·randomSeed·plannedQty·lossQty·sampleLossRate (04 8장) */
export function simulationOf(events: readonly ResultEventRow[], resultId: number): ProductionResultView['simulation'] {
  const registered = events.find((e) => e.targetId === resultId && e.businessEventType === BUSINESS_EVENT_TYPE.PRODUCTION_RESULT_REGISTERED);
  const after = registered?.afterData as Record<string, unknown> | null | undefined;
  if (after?.simulation !== true) return null;
  const num = (v: unknown) => (typeof v === 'number' ? v : null);
  return { randomSeed: num(after.randomSeed), plannedQty: num(after.plannedQty), lossQty: num(after.lossQty), sampleLossRate: typeof after.sampleLossRate === 'string' ? after.sampleLossRate : null };
}

/** 작업 시작 로그에 남긴 연주 히트 (ERD production_result에 히트 칸이 없어 작업 로그 after_data에 둔다) */
export function startedHeatLotIdOf(events: readonly ResultEventRow[], resultId: number): number | null {
  const started = events.find((e) => e.targetId === resultId && e.businessEventType === BUSINESS_EVENT_TYPE.PRODUCTION_STARTED);
  const after = started?.afterData as { heatLotId?: unknown } | null | undefined;
  return typeof after?.heatLotId === 'number' ? after.heatLotId : null;
}

export function toResultView(r: ResultViewRow, events: readonly ResultEventRow[]): ProductionResultView {
  // 산출 LOT의 부모를 모은다. 같은 부모(예: 히트 → 슬래브 여러 매)는 한 번만
  const inputs = new Map<number, ResultInputLot>();
  for (const lot of r.lots) {
    for (const rel of lot.lotRelationsAsChildLot) {
      const prev = inputs.get(rel.parentLot.id);
      // 관계에 차감 톤이 없는 투입(히트→슬래브, 슬래브→코일)은 투입 LOT의 톤(히트 톤·슬래브 이론중량)을 쓴다
      const ton =
        rel.inputTon?.toFixed(3) ??
        (rel.parentLot.lotType === LOT_TYPE.HEAT ? (rel.parentLot.initialTon?.toFixed(3) ?? null) : rel.parentLot.lotType === LOT_TYPE.SLAB ? (rel.parentLot.item?.theoreticalWeightTon?.toFixed(3) ?? null) : null);
      if (prev && rel.inputTon === null) continue;
      inputs.set(rel.parentLot.id, {
        lotId: rel.parentLot.id,
        lotNo: rel.parentLot.lotNo,
        lotType: rel.parentLot.lotType as LotType,
        itemCode: rel.parentLot.item?.itemCode ?? null,
        inputTon: prev?.inputTon && ton ? sumTon([prev.inputTon, ton]) : (prev?.inputTon ?? ton),
      });
    }
  }
  const products = r.lots.filter((l) => isProduct(l.lotType));
  const tons = r.lots.filter((l) => !isProduct(l.lotType)).map((l) => l.initialTon?.toFixed(3) ?? '0');
  const productTons = products.map((l) => calcWeightTon(1, l.item?.theoreticalWeightTon?.toFixed(3) ?? '0'));
  // 투입 톤은 공정의 주 투입만: 제선 원료, 제강 용선(합금철 제외), 연주 히트, 열연 슬래브
  const mainInputs = [...inputs.values()].filter((i) => r.processType !== PROCESS_TYPE.STEELMAKING || i.lotType === LOT_TYPE.HOT_METAL);
  const inputTons = mainInputs.flatMap((i) => (i.inputTon ? [i.inputTon] : []));
  const mine = events.filter((e) => e.targetId === r.id);
  return {
    id: r.id,
    productionPlanId: r.productionPlanId,
    productionPlanNo: r.productionPlan?.productionPlanNo ?? null,
    processType: r.processType as ProcessType,
    blastFurnaceCode: r.blastFurnaceCode,
    converterCode: r.converterCode,
    startedAt: r.startedAt.toISOString(),
    completedAt: r.completedAt?.toISOString() ?? null,
    simulatedLossRate: r.simulatedLossRate?.toFixed(4) ?? null,
    inputs: [...inputs.values()],
    outputs: r.lots.map((l) => ({ lotId: l.id, lotNo: l.lotNo, lotType: l.lotType as LotType, itemCode: l.item?.itemCode ?? null, initialTon: l.initialTon?.toFixed(3) ?? null })),
    inputTon: inputTons.length > 0 ? sumTon(inputTons) : null,
    outputQty: products.length > 0 ? products.length : null,
    outputTon: r.lots.length === 0 ? null : sumTon([...tons, ...productTons]),
    startedHeatLotId: startedHeatLotIdOf(events, r.id),
    operatorName: (mine.at(-1) ?? mine[0])?.actorEmployee?.employeeName ?? null,
    isSimulated: simulationOf(events, r.id) !== null,
    simulation: simulationOf(events, r.id),
  };
}
