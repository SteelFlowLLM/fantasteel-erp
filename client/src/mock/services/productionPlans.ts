// 생산계획·히트 편성·재생산 (REQ-PRD-001·002·006, BP-PRD-01, BP-QC-01, 업무 프로세스 4.4·4.5·10장).
// 상태: PLANNED → IN_PROGRESS(첫 작업 실적) → COMPLETED(산출 완료), PLANNED에서만 CANCELLED. CONFIRMED 없음(PLAN 6-3).
import type { PlanHeatView, PlanProgress, ProductionPlanView, ProductionResultView } from '@/api/production';
import { ALLOCATION_PURPOSE_LABEL, PRODUCT_QTY_UNIT, type ProductItemType } from '@/codes';
import { decMul, decSum } from '@/lib/decimal';
import { planHeats, type HeatPlan } from '@/lib/heatPlanning';
import { reproductionNeedQty, shortageOf, type Shortage } from '@/lib/inventoryMath';
import { recordBusinessEvent, type BusinessEventActor } from '@/mock/businessEvents';
import type { ItemRow, LotRow, MockTables, ProductionPlanRow, SalesOrderItemRow } from '@/mock/schema';
import { issueBusinessNo } from '@/mock/sequence';
import { insertRow, updateRow, type MockTx } from '@/mock/store';
import { releaseAllocationRow } from '@/mock/services/allocations';
import {
  assertNotChanged,
  castingSlabSpecOf,
  employeeNameOf,
  findById,
  hotRollingYieldOf,
  inputError,
  mustGet,
  productionSettingOf,
  productItemTypeOf,
  routingYieldOf,
  salesOrderIdOfPlan,
  slabSpecOfCoil,
  steelGradeCodeOf,
  SYSTEM_ACTOR,
  theoreticalWeightOf,
  ApiError,
  type PersonActor,
} from '@/mock/services/context';
import { activeReservedQtyOfItem, confirmedAllocationOf, heatOf, lotEligibility, reservationPoolOf } from '@/mock/services/inventoryPool';
import { reserveUpToShortage } from '@/mock/services/reservations';

type Tables = Readonly<MockTables>;

export const planSnapshot = (p: ProductionPlanRow) => ({
  id: p.id,
  productionPlanNo: p.productionPlanNo,
  salesOrderItemId: p.salesOrderItemId,
  itemId: p.itemId,
  shortageQty: p.shortageQty,
  cumulativeYieldRate: p.cumulativeYieldRate,
  requiredSteelTon: p.requiredSteelTon,
  heatCount: p.heatCount,
  productionPlanStatus: p.productionPlanStatus,
  isReproduction: p.isReproduction,
  isSurplusOnCompletion: p.isSurplusOnCompletion,
});

/** 기준정보로 히트를 편성한다. 수율·배합 원단위·규격 매핑이 없으면 MST-001 (BP-PRD-01 "확정하지 않는다"). */
export function planHeatsFor(tables: Tables, item: ItemRow, shortageQty: number): HeatPlan {
  const productType: ProductItemType = productItemTypeOf(item);
  routingYieldOf(tables, productType, 'STEELMAKING');
  const castingYieldRate = routingYieldOf(tables, productType, 'CONTINUOUS_CASTING');
  const hotRollingYieldRate = productType === 'COIL' ? hotRollingYieldOf(tables, item) : null;
  const slabSpec = productType === 'COIL' ? slabSpecOfCoil(tables, item) : item;
  assertConsumptionsReady(tables, item.steelGradeId);
  return planHeats({
    productType,
    shortageQty,
    theoreticalWeightTon: theoreticalWeightOf(item),
    castingYieldRate,
    hotRollingYieldRate,
    heatCapacityTon: productionSettingOf(tables).heatCapacityTon,
    slabTheoreticalWeightTon: theoreticalWeightOf(slabSpec),
  });
}

/** 배합 원단위 확인: 철광석·석탄·석회석(공통)과 강종의 합금철이 있어야 한다 */
function assertConsumptionsReady(tables: Tables, steelGradeId: number | null): void {
  for (const material of tables.item.filter((i) => i.itemType === 'RAW_MATERIAL')) {
    const isAlloy = material.rawMaterialType === 'FERROALLOY';
    const found = tables.specificConsumption.some((c) => c.itemId === material.id && (isAlloy ? c.steelGradeId === steelGradeId : c.steelGradeId === null));
    if (!found && !isAlloy) throw new ApiError('MST-001', `배합 원단위(${material.itemName})`);
  }
  const anyAlloy = tables.specificConsumption.some((c) => c.steelGradeId === steelGradeId && tables.item.find((i) => i.id === c.itemId)?.rawMaterialType === 'FERROALLOY');
  if (!anyAlloy) throw new ApiError('MST-001', `합금철 원단위(${steelGradeCodeOf(tables, steelGradeId) ?? '강종'})`);
}

export interface CreatePlanInput {
  salesOrderItemId: number | null;
  itemId: number;
  shortageQty: number;
  isReproduction: boolean;
  createdEmployeeId: number;
  /** 작업 로그 사유. 생략하면 "품목 1 부족 4매로 생산계획 생성 (히트 1개)"처럼 만든다 */
  reasonText?: string | null;
}

/** 생산계획 생성 사유 문구 (업무 프로세스 9.3 "사람이 읽을 사유") */
function planCreatedReasonOf(tables: Tables, input: CreatePlanInput, item: ItemRow, heatCount: number): string {
  const lineNo = tables.salesOrderItem.find((i) => i.id === input.salesOrderItemId)?.lineNo;
  const qtyText = `${input.shortageQty}${PRODUCT_QTY_UNIT[productItemTypeOf(item)]}`;
  const what = input.isReproduction ? `여재·진행 계획으로 채우지 못한 ${qtyText} 재생산 계획 생성` : `부족 ${qtyText}로 생산계획 생성`;
  return `${lineNo === undefined ? '' : `품목 ${lineNo} `}${what} (히트 ${heatCount}개)`;
}

/**
 * 부족 매수의 생산계획을 히트 편성까지 계산해 만든다 (REQ-PRD-001·002). 이벤트: PRODUCTION_PLAN_CREATED 또는
 * REPRODUCTION_PLAN_CREATED, 사유 ORDER_SHORTAGE.
 */
export function createProductionPlan(tx: MockTx, actor: BusinessEventActor, input: CreatePlanInput): ProductionPlanRow {
  const item = mustGet(tx.tables, 'item', input.itemId, '규격');
  const formation = planHeatsFor(tx.tables, item, input.shortageQty);
  const plan = insertRow(tx, 'productionPlan', {
    productionPlanNo: issueBusinessNo(tx, 'PRODUCTION_PLAN'),
    salesOrderItemId: input.salesOrderItemId,
    itemId: item.id,
    shortageQty: input.shortageQty,
    cumulativeYieldRate: formation.cumulativeYieldRate,
    requiredSteelTon: formation.requiredSteelTon,
    heatCount: formation.heatCount,
    productionPlanStatus: 'PLANNED',
    isReproduction: input.isReproduction,
    isSurplusOnCompletion: false,
    createdEmployeeId: input.createdEmployeeId,
    cancelledAt: null,
  });
  recordBusinessEvent(tx, {
    businessEventType: input.isReproduction ? 'REPRODUCTION_PLAN_CREATED' : 'PRODUCTION_PLAN_CREATED',
    actor,
    targetType: 'production_plan',
    targetId: plan.id,
    targetNo: plan.productionPlanNo,
    salesOrderId: salesOrderIdOfPlan(tx.tables, plan),
    afterData: { ...planSnapshot(plan), targetWeightTon: formation.targetWeightTon, heatTon: formation.heatTon, expectedSurplusSlabQty: formation.expectedSurplusSlabQty },
    reasonCode: 'ORDER_SHORTAGE',
    reasonText: input.reasonText ?? planCreatedReasonOf(tx.tables, input, item, formation.heatCount),
  });
  return plan;
}

// ── 진행·잔여 목표 ────────────────────────────────────────

const isPassedProduct = (tables: Tables, lot: LotRow) => lot.isPassed === true && heatOf(tables, lot)?.isPassed === true;
const isFailedProduct = (tables: Tables, lot: LotRow) => lot.isPassed === false || heatOf(tables, lot)?.isPassed === false;

export function planProgressOf(tables: Tables, plan: ProductionPlanRow): PlanProgress {
  const item = findById(tables, 'item', plan.itemId);
  const productType = item?.itemType === 'COIL' ? 'COIL' : 'SLAB';
  const lots = tables.lot.filter((l) => l.productionPlanId === plan.id);
  const heats = lots.filter((l) => l.lotType === 'HEAT');
  const slabs = lots.filter((l) => l.lotType === 'SLAB');
  const coils = lots.filter((l) => l.lotType === 'COIL');
  const castHeatIds = new Set(slabs.map((s) => s.heatLotId));
  const heatsCastQty = heats.filter((h) => castHeatIds.has(h.id)).length;
  const products = productType === 'SLAB' ? slabs : coils;
  const passedQty = products.filter((l) => isPassedProduct(tables, l)).length;
  const pendingQty = products.filter((l) => lotEligibility(tables, l) === 'PENDING').length;
  const failedQty = products.filter((l) => isFailedProduct(tables, l)).length;
  const usableCoilQty = coils.filter((c) => !isFailedProduct(tables, c)).length;
  const hotRollingAllocatedQty = tables.allocation.filter((a) => a.productionPlanId === plan.id && a.allocationPurpose === 'HOT_ROLLING' && a.allocationStatus === 'CONFIRMED').length;
  const ownEligibleSlabs = productType === 'COIL' ? slabs.filter((s) => lotEligibility(tables, s) === 'ELIGIBLE' && !confirmedAllocationOf(tables, s.id)) : [];
  const ownPendingSlabQty = productType === 'COIL' ? slabs.filter((s) => lotEligibility(tables, s) === 'PENDING').length : 0;
  const ownRollableSlabQty = ownEligibleSlabs.length + ownPendingSlabQty;
  // 적격 자기 슬래브 중 다른 수주가 예약으로 가져가지 않은 몫만 (슬래브 규격 예약 가용 한도)
  const slabPoolAvailableQty = ownEligibleSlabs[0]?.itemId ? Math.max(0, reservationPoolOf(tables, ownEligibleSlabs[0].itemId).availableQty) : 0;
  const ownAllocatableSlabQty = ownPendingSlabQty + Math.min(ownEligibleSlabs.length, slabPoolAvailableQty);
  const allHeatsCast = heats.length >= plan.heatCount && heatsCastQty >= plan.heatCount;
  const linked = plan.salesOrderItemId !== null;
  const outputComplete = plan.productionPlanStatus !== 'CANCELLED' && allHeatsCast && (productType === 'SLAB' || !linked || usableCoilQty >= plan.shortageQty);
  let remainingTargetQty = 0;
  if (plan.productionPlanStatus !== 'CANCELLED' && linked) {
    const open = Math.max(0, plan.shortageQty - passedQty);
    const stillRolling = productType === 'COIL' && plan.productionPlanStatus !== 'COMPLETED';
    const potential = pendingQty + (stillRolling ? hotRollingAllocatedQty + ownAllocatableSlabQty : 0);
    remainingTargetQty = allHeatsCast ? Math.min(open, potential) : open;
  }
  return {
    heatCount: plan.heatCount,
    heatsMadeQty: heats.length,
    heatsCastQty,
    hotMetalTon: decSum(lots.filter((l) => l.lotType === 'HOT_METAL').map((l) => l.initialTon ?? '0')),
    slabQty: slabs.length,
    coilQty: coils.length,
    usableCoilQty,
    passedQty,
    pendingQty,
    failedQty,
    hotRollingAllocatedQty,
    ownRollableSlabQty,
    ownAllocatableSlabQty,
    allHeatsCast,
    outputComplete,
    remainingTargetQty,
  };
}

/** 같은 수주 품목의 진행 계획(취소 제외) 잔여 목표 합계 */
export function openPlanRemainingQtyOf(tables: Tables, salesOrderItemId: number): number {
  return tables.productionPlan
    .filter((p) => p.salesOrderItemId === salesOrderItemId && p.productionPlanStatus !== 'CANCELLED')
    .reduce((sum, p) => sum + planProgressOf(tables, p).remainingTargetQty, 0);
}

export interface ItemShortage extends Shortage {
  activeReservedQty: number;
  openPlanRemainingQty: number;
  /** 같은 규격의 예약 가용(여재 포함) */
  reservationAvailableQty: number;
  /** 재생산 필요 매수 = max(0, 추가 계획 필요 − 예약 가용) (14.1-6) */
  reproductionNeedQty: number;
}

/** 수주 품목의 부족 (4.5) */
export function itemShortageOf(tables: Tables, soItem: SalesOrderItemRow): ItemShortage {
  const activeReservedQty = activeReservedQtyOfItem(tables, soItem.id);
  const openPlanRemainingQty = openPlanRemainingQtyOf(tables, soItem.id);
  const cancelled = soItem.salesOrderItemStatus === 'CANCELLED';
  const shortage = cancelled
    ? { unshippedQty: 0, unsecuredQty: 0, additionalPlanQty: 0 }
    : shortageOf({ orderedQty: soItem.orderedQty, shippedQty: soItem.shippedQty, activeReservedQty, openPlanRemainingQty });
  const available = Math.max(0, reservationPoolOf(tables, soItem.itemId).availableQty);
  return {
    ...shortage,
    activeReservedQty,
    openPlanRemainingQty,
    reservationAvailableQty: available,
    reproductionNeedQty: reproductionNeedQty(shortage.additionalPlanQty, available),
  };
}

/**
 * 계획 상태를 실적에 맞춘다: 실적이 있으면 IN_PROGRESS, 산출 완료면 COMPLETED.
 * 코일 계획이 완료되면 열연하지 않고 남은 이 계획의 적격 슬래브를 여재로 표시한다 (REQ-PRD-004).
 */
export function refreshPlanStatus(tx: MockTx, planId: number): ProductionPlanRow {
  const plan = mustGet(tx.tables, 'productionPlan', planId, '생산계획');
  if (plan.productionPlanStatus === 'CANCELLED') return plan;
  const progress = planProgressOf(tx.tables, plan);
  const hasResult = tx.tables.productionResult.some((r) => r.productionPlanId === plan.id);
  const next = progress.outputComplete ? 'COMPLETED' : hasResult ? 'IN_PROGRESS' : 'PLANNED';
  if (next === plan.productionPlanStatus) return plan;
  const updated = updateRow(tx, 'productionPlan', plan.id, { productionPlanStatus: next }) ?? plan;
  if (next === 'COMPLETED') markLeftoverSlabsAsSurplus(tx, updated);
  return updated;
}

/** 이 계획의 적격·미배정 슬래브 중 아직 여재 표시가 없는 것을 여재로 (SURPLUS_CONVERTED) */
export function markLeftoverSlabsAsSurplus(tx: MockTx, plan: ProductionPlanRow): void {
  const item = findById(tx.tables, 'item', plan.itemId);
  if (item?.itemType !== 'COIL' && plan.salesOrderItemId !== null) return;
  const slabs = tx.tables.lot.filter(
    (l) => l.productionPlanId === plan.id && l.lotType === 'SLAB' && l.surplusAt === null && lotEligibility(tx.tables, l) === 'ELIGIBLE' && !confirmedAllocationOf(tx.tables, l.id),
  );
  if (slabs.length === 0) return;
  for (const slab of slabs) updateRow(tx, 'lot', slab.id, { surplusAt: tx.nowIso });
  recordBusinessEvent(tx, {
    businessEventType: 'SURPLUS_CONVERTED',
    actor: SYSTEM_ACTOR,
    targetType: 'production_plan',
    targetId: plan.id,
    targetNo: plan.productionPlanNo,
    salesOrderId: salesOrderIdOfPlan(tx.tables, plan),
    afterData: { lotNos: slabs.map((s) => s.lotNo), surplusQty: slabs.length },
    reasonCode: 'SURPLUS_CONVERSION',
    reasonText: `계획 완료 후 남은 합격 슬래브 ${slabs.length}${PRODUCT_QTY_UNIT.SLAB}를 여재로 전환`,
    lotIds: slabs.map((s) => s.id),
  });
}

/**
 * 히트 편성 확정 (REQ-PRD-002, 서버 API-204와 같은 규칙): 시작 전(PLANNED) 계획의 편성을 지금 기준정보로 다시 계산해 저장한다.
 * 기준정보가 모자라면 MST-001. 공통 코드에 확정 이벤트가 없어 작업 로그는 남기지 않는다(서버와 같다).
 */
export function confirmHeatPlan(tx: MockTx, input: { productionPlanId: number; expectedUpdatedAt?: string | null }): ProductionPlanRow {
  const plan = mustGet(tx.tables, 'productionPlan', input.productionPlanId, '생산계획');
  assertNotChanged(plan.updatedAt, input.expectedUpdatedAt, '생산계획');
  if (plan.productionPlanStatus !== 'PLANNED') inputError('productionPlanId', '작업을 시작한 계획은 히트 편성을 바꿀 수 없어요');
  const formation = planHeatsFor(tx.tables, mustGet(tx.tables, 'item', plan.itemId, '규격'), plan.shortageQty);
  const values = { heatCount: formation.heatCount, cumulativeYieldRate: formation.cumulativeYieldRate, requiredSteelTon: formation.requiredSteelTon };
  if (values.heatCount === plan.heatCount && values.cumulativeYieldRate === plan.cumulativeYieldRate && values.requiredSteelTon === plan.requiredSteelTon) return plan;
  return updateRow(tx, 'productionPlan', plan.id, values) ?? plan;
}

/** 생산 담당의 계획 취소: PLANNED일 때만 (10장). 열연 배정은 해제한다. */
export function cancelProductionPlan(tx: MockTx, actor: PersonActor, input: { productionPlanId: number; reasonText?: string | null; expectedUpdatedAt?: string | null }): ProductionPlanRow {
  const plan = mustGet(tx.tables, 'productionPlan', input.productionPlanId, '생산계획');
  assertNotChanged(plan.updatedAt, input.expectedUpdatedAt, '생산계획');
  if (plan.productionPlanStatus !== 'PLANNED') inputError('productionPlanId', '작업을 시작하기 전(계획 상태)에만 취소할 수 있어요');
  return cancelPlanRow(tx, actor, plan, { reasonCode: null, reasonText: input.reasonText?.trim() || '생산계획 취소' });
}

/** 계획을 CANCELLED로 바꾸고 이벤트를 남긴다 (수주 취소에서도 쓴다) */
export function cancelPlanRow(tx: MockTx, actor: BusinessEventActor, plan: ProductionPlanRow, reason: { reasonCode: 'ORDER_CANCELLED' | null; reasonText: string }): ProductionPlanRow {
  const before = planSnapshot(plan);
  const salesOrderId = salesOrderIdOfPlan(tx.tables, plan);
  for (const allocation of tx.tables.allocation.filter((a) => a.productionPlanId === plan.id && a.allocationStatus === 'CONFIRMED')) {
    releaseAllocationRow(tx, actor, allocation, {
      reasonCode: reason.reasonCode,
      reasonText: `생산계획 ${plan.productionPlanNo} 취소로 ${ALLOCATION_PURPOSE_LABEL[allocation.allocationPurpose]} 배정 해제`,
    });
  }
  const updated = updateRow(tx, 'productionPlan', plan.id, { productionPlanStatus: 'CANCELLED', cancelledAt: tx.nowIso }) ?? plan;
  recordBusinessEvent(tx, {
    businessEventType: 'PRODUCTION_PLAN_CANCELLED',
    actor,
    targetType: 'production_plan',
    targetId: plan.id,
    targetNo: plan.productionPlanNo,
    salesOrderId,
    beforeData: before,
    afterData: planSnapshot(updated),
    reasonCode: reason.reasonCode,
    reasonText: reason.reasonText,
  });
  return updated;
}

/**
 * 재생산 계획 (REQ-PRD-006, 14.1-6). 사람이 만든다(자동 생성 안 함).
 * 먼저 같은 규격의 여재(예약 가용)로 미확보분을 예약하고, 그래도 '추가 계획 필요'가 남을 때만 is_reproduction 계획을 만든다.
 * 남는 것이 없으면 입력 오류.
 */
export function createReproductionPlan(tx: MockTx, actor: PersonActor, input: { salesOrderItemId: number }): { reservedFromSurplusQty: number; plan: ProductionPlanRow | null } {
  const soItem = mustGet(tx.tables, 'salesOrderItem', input.salesOrderItemId, '수주 품목');
  if (soItem.salesOrderItemStatus === 'CANCELLED' || soItem.salesOrderItemStatus === 'SHIPPED') inputError('salesOrderItemId', '진행중인 수주 품목만 재생산할 수 있어요');
  const { reservedQty } = reserveUpToShortage(tx, actor, { salesOrderItemId: soItem.id, reasonTextOf: (qtyText) => `재생산 전에 같은 규격 여재 ${qtyText}를 미확보분에 예약` });
  const shortage = itemShortageOf(tx.tables, soItem);
  if (shortage.additionalPlanQty <= 0) {
    if (reservedQty > 0) return { reservedFromSurplusQty: reservedQty, plan: null };
    inputError('salesOrderItemId', '재생산할 매수가 없어요. 여재나 진행 중인 계획으로 채울 수 있어요');
  }
  const plan = createProductionPlan(tx, actor, {
    salesOrderItemId: soItem.id,
    itemId: soItem.itemId,
    shortageQty: shortage.additionalPlanQty,
    isReproduction: true,
    createdEmployeeId: actor.employeeId,
  });
  return { reservedFromSurplusQty: reservedQty, plan };
}

// ── 조회 ──────────────────────────────────────────────

function formationViewOf(tables: Tables, plan: ProductionPlanRow): ProductionPlanView['formation'] {
  try {
    const item = mustGet(tables, 'item', plan.itemId, '규격');
    const f = planHeatsFor(tables, item, plan.shortageQty);
    return {
      shortageQty: plan.shortageQty,
      targetWeightTon: f.targetWeightTon,
      cumulativeYieldRate: plan.cumulativeYieldRate,
      requiredSteelTon: plan.requiredSteelTon,
      heatCount: plan.heatCount,
      recalculatedHeatCount: f.heatCount,
      heatCapacityTon: f.heatCapacityTon,
      heatTon: decMul(f.heatCapacityTon, plan.heatCount),
      slabQtyPerHeat: f.slabQtyPerHeat,
      plannedSlabQty: f.slabQtyPerHeat * plan.heatCount,
      expectedSurplusSlabQty: Math.max(0, f.slabQtyPerHeat * plan.heatCount - plan.shortageQty),
    };
  } catch {
    return null;
  }
}

export function productionResultViewsOf(tables: Tables, planId: number): ProductionResultView[] {
  return tables.productionResult
    .filter((r) => r.productionPlanId === planId)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.id - b.id)
    .map((r) => ({
      id: r.id,
      processType: r.processType,
      blastFurnaceCode: r.blastFurnaceCode,
      converterCode: r.converterCode,
      startedAt: r.startedAt,
      completedAt: r.completedAt,
      inputTon: r.inputTon,
      outputTon: r.outputTon,
      outputQty: r.outputQty,
      lossQty: r.lossQty,
      sampleLossRate: r.sampleLossRate,
      randomSeed: r.randomSeed,
      isSimulated: r.isSimulated,
      operatorName: employeeNameOf(tables, r.operatorEmployeeId),
      outputLotNos: tables.lot.filter((l) => l.productionResultId === r.id).map((l) => l.lotNo),
    }));
}

export function productionPlanView(tables: Tables, planId: number): ProductionPlanView {
  const plan = mustGet(tables, 'productionPlan', planId, '생산계획');
  const item = mustGet(tables, 'item', plan.itemId, '규격');
  let slabSpec: ItemRow | null = null;
  try {
    slabSpec = castingSlabSpecOf(tables, plan);
  } catch {
    slabSpec = null;
  }
  const soItem = findById(tables, 'salesOrderItem', plan.salesOrderItemId);
  const so = soItem ? findById(tables, 'salesOrder', soItem.salesOrderId) : undefined;
  const heats = tables.lot.filter((l) => l.productionPlanId === plan.id && l.lotType === 'HEAT').sort((a, b) => a.id - b.id);
  const heatViews: PlanHeatView[] = [];
  for (let seq = 1; seq <= Math.max(plan.heatCount, heats.length); seq += 1) {
    const heat = heats[seq - 1];
    const slabQty = heat ? tables.lot.filter((l) => l.heatLotId === heat.id && l.lotType === 'SLAB').length : 0;
    heatViews.push({
      seq,
      heatLotId: heat?.id ?? null,
      heatNo: heat?.lotNo ?? null,
      converterCode: heat?.converterCode ?? null,
      producedDate: heat?.producedDate ?? null,
      heatTon: heat?.initialTon ?? null,
      inspectionResult: heat ? (heat.isPassed === true ? 'PASS' : heat.isPassed === false ? 'FAIL' : 'PENDING') : null,
      castDone: slabQty > 0,
      slabQty,
    });
  }
  return {
    id: plan.id,
    productionPlanNo: plan.productionPlanNo,
    productionPlanStatus: plan.productionPlanStatus,
    isReproduction: plan.isReproduction,
    isSurplusOnCompletion: plan.isSurplusOnCompletion,
    createdAt: plan.createdAt,
    createdEmployeeName: employeeNameOf(tables, plan.createdEmployeeId),
    cancelledAt: plan.cancelledAt,
    updatedAt: plan.updatedAt,
    item: {
      id: item.id,
      itemCode: item.itemCode,
      itemName: item.itemName,
      itemType: productItemTypeOf(item),
      steelGradeCode: steelGradeCodeOf(tables, item.steelGradeId),
      theoreticalWeightTon: item.theoreticalWeightTon ?? '0.000',
    },
    slabSpec: slabSpec ? { id: slabSpec.id, itemCode: slabSpec.itemCode, itemName: slabSpec.itemName, theoreticalWeightTon: slabSpec.theoreticalWeightTon ?? '0.000' } : null,
    salesOrder:
      soItem && so
        ? {
            salesOrderId: so.id,
            salesOrderNo: so.salesOrderNo,
            salesOrderItemId: soItem.id,
            lineNo: soItem.lineNo,
            customerName: findById(tables, 'customer', so.customerId)?.customerName ?? null,
            dueDate: soItem.dueDate,
            orderedQty: soItem.orderedQty,
          }
        : null,
    formation: formationViewOf(tables, plan),
    progress: planProgressOf(tables, plan),
    heats: heatViews,
    results: productionResultViewsOf(tables, plan.id),
    canCancel: plan.productionPlanStatus === 'PLANNED',
  };
}

export interface ProductionPlanSummary {
  id: number;
  productionPlanNo: string;
  productionPlanStatus: ProductionPlanRow['productionPlanStatus'];
  isReproduction: boolean;
  isSurplusOnCompletion: boolean;
  itemId: number;
  itemCode: string;
  itemName: string;
  itemType: ProductItemType;
  steelGradeCode: string | null;
  salesOrderId: number | null;
  salesOrderNo: string | null;
  dueDate: string | null;
  shortageQty: number;
  heatCount: number;
  requiredSteelTon: string;
  heatsMadeQty: number;
  heatsCastQty: number;
  passedQty: number;
  remainingTargetQty: number;
  createdAt: string;
}

/** 생산계획 목록 (최근 것 먼저) */
export function listProductionPlans(tables: Tables): ProductionPlanSummary[] {
  return [...tables.productionPlan]
    .sort((a, b) => b.id - a.id)
    .map((plan) => {
      const item = findById(tables, 'item', plan.itemId);
      const soItem = findById(tables, 'salesOrderItem', plan.salesOrderItemId);
      const so = soItem ? findById(tables, 'salesOrder', soItem.salesOrderId) : undefined;
      const progress = planProgressOf(tables, plan);
      return {
        id: plan.id,
        productionPlanNo: plan.productionPlanNo,
        productionPlanStatus: plan.productionPlanStatus,
        isReproduction: plan.isReproduction,
        isSurplusOnCompletion: plan.isSurplusOnCompletion,
        itemId: plan.itemId,
        itemCode: item?.itemCode ?? '',
        itemName: item?.itemName ?? '',
        itemType: item?.itemType === 'COIL' ? 'COIL' : 'SLAB',
        steelGradeCode: steelGradeCodeOf(tables, item?.steelGradeId ?? null),
        salesOrderId: so?.id ?? null,
        salesOrderNo: so?.salesOrderNo ?? null,
        dueDate: soItem?.dueDate ?? null,
        shortageQty: plan.shortageQty,
        heatCount: plan.heatCount,
        requiredSteelTon: plan.requiredSteelTon,
        heatsMadeQty: progress.heatsMadeQty,
        heatsCastQty: progress.heatsCastQty,
        passedQty: progress.passedQty,
        remainingTargetQty: progress.remainingTargetQty,
        createdAt: plan.createdAt,
      };
    });
}
