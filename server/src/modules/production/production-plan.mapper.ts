import {
  INSPECTION_RESULT,
  ITEM_TYPE,
  LOT_STATUS,
  LOT_TYPE,
  type AllocationPurpose,
  type DispositionStatus,
  type InspectionResult,
  type ItemType,
  type LotStatus,
  type LotType,
  type PlanHeat,
  type PlanLot,
  type PlanProgress,
  type ProcessType,
  type ProductionPlanStatus,
  type ProductionPlanSummary,
} from '@fantasteel/shared';
import type { PlanLotRow, PlanSummaryRow } from './production.repository';
import { planOpenRemainingQty, productJudgement } from './plan-progress.calculator';

const dateOnly = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/** 목록 한 줄. 진행 값은 목록이 계획들의 LOT을 한 번에 읽어 계산해 넘긴다 */
export function toPlanSummary(p: PlanSummaryRow, progress?: PlanProgress, requiredMoltenSteelTon: string | null = null): ProductionPlanSummary {
  const soItem = p.salesOrderItem;
  return {
    id: p.id,
    productionPlanNo: p.productionPlanNo,
    productionPlanStatus: p.productionPlanStatus as ProductionPlanStatus,
    isReproduction: p.isReproduction,
    itemId: p.itemId,
    itemCode: p.item.itemCode,
    itemName: p.item.itemName,
    itemType: p.item.itemType as ItemType,
    steelGradeCode: p.item.steelGrade?.steelGradeCode ?? null,
    shortageQty: p.shortageQty,
    heatCount: p.heatCount,
    salesOrderId: soItem?.salesOrder.id ?? null,
    salesOrderNo: soItem?.salesOrder.salesOrderNo ?? null,
    salesOrderItemId: soItem?.id ?? null,
    customerName: soItem?.salesOrder.customer.customerName ?? null,
    dueDate: dateOnly(soItem?.dueDate ?? null),
    requiredMoltenSteelTon,
    heatsMadeQty: progress?.madeHeatQty ?? 0,
    heatsCastQty: progress?.castHeatQty ?? 0,
    passedQty: progress?.passedQty ?? 0,
    remainingTargetQty: progress?.remainingTargetQty ?? 0,
    createdAt: p.createdAt.toISOString(),
  };
}

type InspectionRef = { inspectionResult: string } | null;
const resultOf = (q: InspectionRef) => (q?.inspectionResult ?? null) as InspectionResult | null;

/** 상위 히트: 슬래브는 부모 히트, 코일은 부모 슬래브의 부모 히트. 번호를 파싱하지 않고 lot_relation으로 찾는다 (BP-LOT-01) */
export function heatOfLot(lot: PlanLotRow): { id: number; lotNo: string; inspectionResult: InspectionResult | null } | null {
  for (const { parentLot } of lot.lotRelationsAsChildLot) {
    if (parentLot.lotType === LOT_TYPE.HEAT) return { id: parentLot.id, lotNo: parentLot.lotNo, inspectionResult: resultOf(parentLot.qualityInspection) };
    const heat = parentLot.lotRelationsAsChildLot.find((r) => r.parentLot.lotType === LOT_TYPE.HEAT)?.parentLot;
    if (heat) return { id: heat.id, lotNo: heat.lotNo, inspectionResult: resultOf(heat.qualityInspection) };
  }
  return null;
}

export function toPlanLot(lot: PlanLotRow): PlanLot {
  const isHeat = lot.lotType === LOT_TYPE.HEAT;
  const own = resultOf(lot.qualityInspection);
  const heat = isHeat ? null : heatOfLot(lot);
  const parentSlab = lot.lotType === LOT_TYPE.COIL ? lot.lotRelationsAsChildLot.find((r) => r.parentLot.lotType === LOT_TYPE.SLAB)?.parentLot : undefined;
  return {
    lotId: lot.id,
    lotNo: lot.lotNo,
    lotType: lot.lotType as LotType,
    lotStatus: lot.lotStatus as LotStatus,
    itemId: lot.itemId,
    itemCode: lot.item?.itemCode ?? null,
    initialTon: lot.initialTon?.toFixed(3) ?? null,
    producedDate: dateOnly(lot.producedDate),
    processType: (lot.productionResult?.processType ?? null) as ProcessType | null,
    productionResultId: lot.productionResultId,
    inspectionResult: own,
    heatLotId: heat?.id ?? null,
    heatLotNo: heat?.lotNo ?? null,
    heatInspectionResult: heat?.inspectionResult ?? null,
    judgement: isHeat ? productJudgement(own, own) : productJudgement(own, heat?.inspectionResult ?? null),
    remainingTon: lot.remainingTon?.toFixed(3) ?? null,
    dispositionStatus: (lot.dispositionStatus ?? null) as DispositionStatus | null,
    allocationPurpose: (lot.allocations[0]?.allocationPurpose ?? null) as AllocationPurpose | null,
    yardName: lot.yard?.yardName ?? null,
    parentSlabNo: parentSlab?.lotNo ?? null,
  };
}

/**
 * 계획 진행. 합격·판정 대기·불합격은 계획 규격 제품(슬래브 계획은 슬래브, 코일 계획은 코일)만 센다.
 * 판정 대기는 아직 재고 상태(AVAILABLE)인 것만 — 투입·출고된 LOT은 판정이 끝났다고 본다.
 */
export function planProgressOf(
  plan: { itemId: number; itemType: ItemType; heatCount: number; shortageQty?: number; productionPlanStatus?: ProductionPlanStatus; salesOrderItemId?: number | null },
  lots: readonly PlanLotRow[],
  results: readonly { completedAt: Date | null }[],
  hotRollingAllocatedQty = 0,
): PlanProgress {
  const heats = lots.filter((l) => l.lotType === LOT_TYPE.HEAT);
  const products = lots.filter((l) => l.itemId === plan.itemId && (l.lotType === LOT_TYPE.SLAB || l.lotType === LOT_TYPE.COIL)).map(toPlanLot);
  const passedQty = products.filter((p) => p.judgement === 'PASS').length;
  const pendingQty = products.filter((p) => p.judgement === 'PENDING' && p.lotStatus === LOT_STATUS.AVAILABLE).length;
  const failedQty = products.filter((p) => p.judgement === 'FAIL').length;
  const isCoil = plan.itemType === ITEM_TYPE.COIL;
  const coilQty = isCoil ? lots.filter((l) => l.lotType === LOT_TYPE.COIL).length : 0;
  const madeHeatQty = heats.length;
  const castHeatQty = heats.filter((h) => h._count.lotRelationsAsParentLot > 0).length;
  const ownRollableSlabQty = isCoil
    ? lots.map(toPlanLot).filter((l) => l.lotType === LOT_TYPE.SLAB && l.lotStatus === LOT_STATUS.AVAILABLE && l.judgement !== 'FAIL' && l.allocationPurpose === null).length
    : 0;
  // 수주 연결이 없으면(수주 취소로 해제) 남은 목표가 없다
  const remainingTargetQty =
    plan.productionPlanStatus === undefined || plan.salesOrderItemId === null
      ? 0
      : planOpenRemainingQty({ productionPlanStatus: plan.productionPlanStatus, shortageQty: plan.shortageQty ?? 0, passedQty, pendingQty });
  return {
    heatCount: plan.heatCount,
    madeHeatQty,
    castHeatQty,
    slabQty: lots.filter((l) => l.lotType === LOT_TYPE.SLAB).length,
    coilQty,
    passedQty,
    pendingQty,
    failedQty,
    openWorkCount: results.filter((r) => r.completedAt === null).length,
    usableCoilQty: isCoil ? coilQty - failedQty : 0,
    hotRollingAllocatedQty,
    ownRollableSlabQty,
    allHeatsCast: madeHeatQty >= plan.heatCount && castHeatQty >= plan.heatCount,
    remainingTargetQty,
  };
}

/** 편성 순번별 히트: 만든 히트를 생산 순으로 앞에서부터 채우고, 남은 순번은 아직 안 만든 히트 */
export function planHeatsOf(heatCount: number, lots: readonly PlanLotRow[]): PlanHeat[] {
  const heats = lots.filter((l) => l.lotType === LOT_TYPE.HEAT);
  const rows: PlanHeat[] = [];
  for (let seq = 1; seq <= Math.max(heatCount, heats.length); seq++) {
    const heat = heats[seq - 1];
    const slabQty = heat ? lots.filter((l) => l.lotType === LOT_TYPE.SLAB && l.lotRelationsAsChildLot.some((r) => r.parentLot.id === heat.id)).length : 0;
    rows.push({
      seq,
      heatLotId: heat?.id ?? null,
      heatNo: heat?.lotNo ?? null,
      converterCode: heat?.productionResult?.converterCode ?? null,
      producedDate: dateOnly(heat?.productionResult?.completedAt ?? null),
      heatTon: heat?.initialTon?.toFixed(3) ?? null,
      inspectionResult: heat ? (resultOf(heat.qualityInspection) ?? INSPECTION_RESULT.PENDING) : null,
      castDone: heat ? heat._count.lotRelationsAsParentLot > 0 : false,
      slabQty,
    });
  }
  return rows;
}
