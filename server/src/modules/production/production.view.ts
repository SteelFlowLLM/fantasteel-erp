import { PROCESS_ORDER, type ProcessCode } from '@fantasteel/shared';
import type { Prisma } from '../../generated/prisma/client';
import type { LotRow, PlanRow, ResultRow } from './production.repository';

// 응답 모양. Decimal·Date는 전역 인터셉터가 문자열로 바꾼다 (docs/api/production.md 의 타입과 같게 유지).

type SpecRow = PlanRow['productSpec'];

export interface SpecView {
  id: number;
  specCode: string;
  itemType: string;
  steelGradeCode: string;
  thicknessMm: Prisma.Decimal;
  widthMm: Prisma.Decimal;
  lengthMm: Prisma.Decimal;
  theoreticalWeightTon: Prisma.Decimal;
}

export function toSpecView(s: Pick<SpecRow, 'id' | 'specCode' | 'thicknessMm' | 'widthMm' | 'lengthMm' | 'theoreticalWeightTon'> & { item: { itemType: string }; steelGrade: { steelGradeCode: string } }): SpecView {
  return {
    id: s.id, specCode: s.specCode, itemType: s.item.itemType, steelGradeCode: s.steelGrade.steelGradeCode,
    thicknessMm: s.thicknessMm, widthMm: s.widthMm, lengthMm: s.lengthMm, theoreticalWeightTon: s.theoreticalWeightTon,
  };
}

/** 연주에서 만들 슬래브 규격 (코일 계획이면 매핑된 슬래브 규격). 매핑이 없으면 null. */
export function slabSpecOf(plan: PlanRow) {
  if (plan.productSpec.item.itemType === 'SLAB') return plan.productSpec;
  return plan.productSpec.coilMapping?.slabSpec ?? null;
}

export interface ProcessProgressView { processCode: ProcessCode; totalCount: number; startedCount: number; completedCount: number }

export function toPlanSummary(plan: PlanRow) {
  const item = plan.salesOrderItem;
  const slabSpec = slabSpecOf(plan);
  const progress: ProcessProgressView[] = PROCESS_ORDER.map((processCode) => {
    const rows = plan.productionResults.filter((r) => r.processCode === processCode);
    return {
      processCode,
      totalCount: rows.length,
      startedCount: rows.filter((r) => r.productionResultStatus === 'STARTED').length,
      completedCount: rows.filter((r) => r.productionResultStatus === 'COMPLETED').length,
    };
  }).filter((p) => p.totalCount > 0);
  const open = plan.productionResults.some((r) => r.productionResultStatus !== 'COMPLETED');
  return {
    id: plan.id,
    productionPlanNo: plan.productionPlanNo,
    productionPlanStatus: plan.productionPlanStatus,
    isReproduction: plan.isReproduction,
    itemType: plan.productSpec.item.itemType,
    productSpec: toSpecView(plan.productSpec),
    slabSpec: slabSpec ? toSpecView(slabSpec) : null,
    steelGrade: { id: plan.steelGrade.id, steelGradeCode: plan.steelGrade.steelGradeCode, steelGradeName: plan.steelGrade.steelGradeName },
    salesOrder: item
      ? {
          salesOrderId: item.salesOrderId,
          salesOrderNo: item.salesOrder.salesOrderNo,
          salesOrderItemId: item.id,
          lineNo: item.lineNo,
          orderedQty: item.orderedQty,
          salesOrderItemStatus: item.salesOrderItemStatus,
          customerName: item.salesOrder.customer.customerName,
          dueDate: item.salesOrder.dueDate,
          ownerEmployeeName: item.salesOrder.ownerEmployee.employeeName,
        }
      : null,
    shortageQty: plan.shortageQty,
    shortageTon: plan.productSpec.theoreticalWeightTon.mul(plan.shortageQty),
    surplusUseQty: plan.surplusUseQty,
    heatCount: plan.heatCount,
    plannedSlabQty: plan.plannedSlabQty,
    requiredInputTon: plan.requiredInputTon,
    cumulativeYieldRate: plan.cumulativeYieldRate,
    progress,
    /** 생산 담당이 할 일이 남았는지: 편성 전이거나, 대기·작업 중인 실적이 있다 */
    needsAction: plan.productionPlanStatus === 'PLANNED' || (['CONFIRMED', 'IN_PROGRESS'].includes(plan.productionPlanStatus) && open),
    createdAt: plan.createdAt,
    confirmedAt: plan.confirmedAt,
    completedAt: plan.completedAt,
    cancelledAt: plan.cancelledAt,
  };
}
export type PlanSummaryView = ReturnType<typeof toPlanSummary>;

export function toLotView(l: LotRow, coilSalesOrderItemId?: number | null) {
  const isEligible = l.lotStatus === 'IN_STOCK' && l.isPassed === true && l.heatLot?.isPassed === true;
  return {
    id: l.id,
    lotNo: l.lotNo,
    lotType: l.lotType,
    lotStatus: l.lotStatus,
    /** 자기 검사 결과. null = 검사 전 */
    isPassed: l.isPassed,
    heatLotId: l.heatLot?.id ?? null,
    heatLotNo: l.heatLot?.lotNo ?? null,
    /** 상위 히트 성분 검사 결과 (히트·용선 LOT은 null) */
    heatIsPassed: l.heatLot?.isPassed ?? null,
    /** 적격 = 자기 검사 합격 + 상위 히트 합격 + 미소진 */
    isEligible,
    /** 코일 수주 품목의 열연 투입용으로 잡혀 있는 슬래브인지 */
    isEarmarked: l.lotType === 'SLAB' && isEligible && !!coilSalesOrderItemId && l.salesOrderItemId === coilSalesOrderItemId,
    /** CONFIRMED 배정이 있으면 그 배정 id */
    confirmedAllocationId: l.allocations[0]?.id ?? null,
    productSpecId: l.productSpecId,
    specCode: l.productSpec?.specCode ?? null,
    weightTon: l.productSpec?.theoreticalWeightTon ?? null,
    initialTon: l.initialTon,
    remainingTon: l.remainingTon,
    salesOrderItemId: l.salesOrderItemId,
    productionPlanId: l.productionPlanId,
    productionResultId: l.productionResultId,
    dispositionStatus: l.dispositionStatus,
    producedAt: l.producedAt,
  };
}
export type LotView = ReturnType<typeof toLotView>;

export function toResultView(r: ResultRow, defaultHotMetalTon: Prisma.Decimal | null = null) {
  return {
    id: r.id,
    productionPlanId: r.productionPlanId,
    productionPlanNo: r.productionPlan?.productionPlanNo ?? null,
    processCode: r.processCode,
    heatSeq: r.heatSeq,
    productionResultStatus: r.productionResultStatus,
    startedAt: r.startedAt,
    completedAt: r.completedAt,
    blastFurnaceNo: r.blastFurnaceNo,
    converterNo: r.converterNo,
    inputTon: r.inputTon,
    outputTon: r.outputTon,
    plannedQty: r.plannedQty,
    outputQty: r.outputQty,
    lossQty: r.lossQty,
    sampledLossRate: r.sampledLossRate,
    isSimulated: r.isSimulated,
    operatorEmployeeId: r.operatorEmployeeId,
    /** 대기·작업 중인 제선 실적에만: 이 계획에 아직 필요한 용선 톤 (hotMetalTon 기본값) */
    defaultHotMetalTon,
    lots: r.lots,
  };
}
export type ResultView = ReturnType<typeof toResultView>;
