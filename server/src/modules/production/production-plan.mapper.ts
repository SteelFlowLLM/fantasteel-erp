import {
  ITEM_TYPE,
  LOT_STATUS,
  LOT_TYPE,
  type InspectionResult,
  type ItemType,
  type LotStatus,
  type LotType,
  type PlanLot,
  type PlanProgress,
  type ProcessType,
  type ProductionPlanStatus,
  type ProductionPlanSummary,
} from '@fantasteel/shared';
import type { PlanLotRow, PlanSummaryRow } from './production.repository';
import { productJudgement } from './plan-progress.calculator';

const dateOnly = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

export function toPlanSummary(p: PlanSummaryRow): ProductionPlanSummary {
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
  };
}

/**
 * 계획 진행. 합격·판정 대기·불합격은 계획 규격 제품(슬래브 계획은 슬래브, 코일 계획은 코일)만 센다.
 * 판정 대기는 아직 재고 상태(AVAILABLE)인 것만 — 투입·출고된 LOT은 판정이 끝났다고 본다.
 */
export function planProgressOf(
  plan: { itemId: number; itemType: ItemType; heatCount: number },
  lots: readonly PlanLotRow[],
  results: readonly { completedAt: Date | null }[],
): PlanProgress {
  const heats = lots.filter((l) => l.lotType === LOT_TYPE.HEAT);
  const products = lots.filter((l) => l.itemId === plan.itemId && (l.lotType === LOT_TYPE.SLAB || l.lotType === LOT_TYPE.COIL)).map(toPlanLot);
  return {
    heatCount: plan.heatCount,
    madeHeatQty: heats.length,
    castHeatQty: heats.filter((h) => h._count.lotRelationsAsParentLot > 0).length,
    slabQty: lots.filter((l) => l.lotType === LOT_TYPE.SLAB).length,
    coilQty: plan.itemType === ITEM_TYPE.COIL ? lots.filter((l) => l.lotType === LOT_TYPE.COIL).length : 0,
    passedQty: products.filter((p) => p.judgement === 'PASS').length,
    pendingQty: products.filter((p) => p.judgement === 'PENDING' && p.lotStatus === LOT_STATUS.AVAILABLE).length,
    failedQty: products.filter((p) => p.judgement === 'FAIL').length,
    openWorkCount: results.filter((r) => r.completedAt === null).length,
  };
}
