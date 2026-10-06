import { BUSINESS_EVENT_TYPE, LOT_TYPE, calcWeightTon, sumTon, type LotType, type ProcessType, type ProductionResultView, type ResultInputLot } from '@fantasteel/shared';
import type { ResultViewRow } from './production-result.repository';

export interface ResultEventRow {
  targetId: number;
  businessEventType: string;
  afterData: unknown;
  actorEmployee: { employeeName: string } | null;
}

const isProduct = (lotType: string) => lotType === LOT_TYPE.SLAB || lotType === LOT_TYPE.COIL;

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
      const ton = rel.inputTon?.toFixed(3) ?? null;
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
  const inputTons = [...inputs.values()].flatMap((i) => (i.inputTon ? [i.inputTon] : []));
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
  };
}
