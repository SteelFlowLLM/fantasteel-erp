// 열연 투입 배정·열연 실적 (REQ-PRD-004, REQ-INV-006·008, BP-INV-01, 14.2).
// - 코일 계획 → 대응 슬래브 규격, 필요 매수 = 부족 매수 − 만든 코일(불합격 제외) − 이미 열연 배정한 슬래브.
//   불합격 코일은 만든 코일로 세지 않는다 → 같은 계획에서 다시 열연해 채운다 (BP-QC-01 부족량 재계산 → 진행 계획 확인).
// - FIFO 추천(생산완료일 → LOT 번호): 적격·미소진·미배정 슬래브 중 '예약 가용'(판매 ACTIVE 예약 몫을 뺀 수) 안에서만 → 판매 예약을 침범하지 않는다.
// - 확정 = HOT_ROLLING 배정 CONFIRMED (production_plan_id). 추천은 저장하지 않고 확정 때 ALLOCATION_RECOMMENDED로 남긴다.
// - 열연 실적: 배정 슬래브를 소비(배정 CONSUMED, LOT CONSUMED) → 슬래브 1매 = 코일 1개 `C+슬래브번호`(HT- 제외), 슬래브→코일 1:1, 코일 검사 대상.
//   열연 실적으로 계획이 완료되는데 다른 공정에 작업 시작만 한 실적이 남아 있으면 거부한다(productionResults.ts 진행 중 작업).
// - 수주 연결이 없는 코일 계획은 열연하지 않는다. '귀속' 단계는 없다.
import { decSum } from '@/lib/decimal';
import { calcWeightTon } from '@/lib/weight';
import { recordBusinessEvent } from '@/mock/businessEvents';
import type { AllocationRow, LotRow, MockTables, ProductionPlanRow } from '@/mock/schema';
import { coilNoOf } from '@/mock/sequence';
import { insertRow, updateRow, type MockTx } from '@/mock/store';
import { assertAllocatableLot, insertConfirmedAllocation, recommendFifoLots, recordRecommendation } from '@/mock/services/allocations';
import {
  ApiError,
  checkDateTime,
  employeeNameOf,
  FieldErrors,
  findById,
  inputError,
  mustGet,
  refreshInventory,
  salesOrderIdOfPlan,
  seoulDateOf,
  slabSpecOfCoil,
  theoreticalWeightOf,
  type PersonActor,
} from '@/mock/services/context';
import { ensurePendingInspection } from '@/mock/services/inspections';
import { heatOf, reservationPoolOf, type ReservationPool } from '@/mock/services/inventoryPool';
import { assertNoOpenWorkOnCompletion, planForWork, upsertCompletedResult, type SimulationMark } from '@/mock/services/productionResults';
import { planProgressOf, refreshPlanStatus } from '@/mock/services/productionPlans';

type Tables = Readonly<MockTables>;

export interface RollingLotView {
  lotId: number;
  lotNo: string;
  producedDate: string;
  heatNo: string | null;
  sourcePlanNo: string | null;
  surplusAt: string | null;
}

export interface RollingAllocationView extends RollingLotView {
  allocationId: number;
  confirmedAt: string;
  confirmedEmployeeName: string | null;
}

export interface RollingPlanView {
  productionPlanId: number;
  productionPlanNo: string;
  productionPlanStatus: ProductionPlanRow['productionPlanStatus'];
  salesOrderNo: string | null;
  dueDate: string | null;
  coilItem: { id: number; itemCode: string; itemName: string; theoreticalWeightTon: string };
  slabItem: { id: number; itemCode: string; itemName: string; theoreticalWeightTon: string };
  shortageQty: number;
  /** 이미 만든 코일 = 합격 + 판정 대기 (불합격·히트 불합격 코일은 세지 않는다) */
  rolledQty: number;
  /** 불합격(히트 불합격 포함) 코일 — 필요 매수에서 빼지 않는다 */
  failedCoilQty: number;
  /** CONFIRMED 열연 배정 */
  allocatedQty: number;
  /** 더 배정해야 할 슬래브 = max(0, 부족 − 코일(불합격 제외) − 배정) */
  neededQty: number;
  /** 슬래브 규격 풀 (예약 가용 = 판매 예약 몫을 뺀 수) */
  slabPool: ReservationPool;
  /** 지금 추천할 수 있는 매수 = min(필요, 예약 가용) */
  recommendableQty: number;
  allocations: RollingAllocationView[];
  /** 수주 연결이 있어야 열연한다 */
  rollable: boolean;
  notRollableReason: string | null;
}

const lotViewOf = (tables: Tables, lot: LotRow): RollingLotView => ({
  lotId: lot.id,
  lotNo: lot.lotNo,
  producedDate: lot.producedDate,
  heatNo: heatOf(tables, lot)?.lotNo ?? null,
  sourcePlanNo: findById(tables, 'productionPlan', lot.productionPlanId)?.productionPlanNo ?? null,
  surplusAt: lot.surplusAt,
});

const hotRollingAllocationsOf = (tables: Tables, planId: number): AllocationRow[] =>
  tables.allocation.filter((a) => a.productionPlanId === planId && a.allocationPurpose === 'HOT_ROLLING' && a.allocationStatus === 'CONFIRMED');

export function rollingPlanView(tables: Tables, productionPlanId: number): RollingPlanView {
  const plan = mustGet(tables, 'productionPlan', productionPlanId, '생산계획');
  const coil = mustGet(tables, 'item', plan.itemId, '규격');
  if (coil.itemType !== 'COIL') inputError('productionPlanId', '코일 계획만 열연해요');
  const slab = slabSpecOfCoil(tables, coil);
  const progress = planProgressOf(tables, plan);
  const rolledQty = progress.usableCoilQty;
  const allocations = hotRollingAllocationsOf(tables, plan.id);
  const neededQty = Math.max(0, plan.shortageQty - rolledQty - allocations.length);
  const slabPool = reservationPoolOf(tables, slab.id);
  const soItem = findById(tables, 'salesOrderItem', plan.salesOrderItemId);
  const so = soItem ? findById(tables, 'salesOrder', soItem.salesOrderId) : undefined;
  const linked = plan.salesOrderItemId !== null;
  const open = plan.productionPlanStatus === 'PLANNED' || plan.productionPlanStatus === 'IN_PROGRESS';
  return {
    productionPlanId: plan.id,
    productionPlanNo: plan.productionPlanNo,
    productionPlanStatus: plan.productionPlanStatus,
    salesOrderNo: so?.salesOrderNo ?? null,
    dueDate: soItem?.dueDate ?? null,
    coilItem: { id: coil.id, itemCode: coil.itemCode, itemName: coil.itemName, theoreticalWeightTon: theoreticalWeightOf(coil) },
    slabItem: { id: slab.id, itemCode: slab.itemCode, itemName: slab.itemName, theoreticalWeightTon: theoreticalWeightOf(slab) },
    shortageQty: plan.shortageQty,
    rolledQty,
    failedCoilQty: progress.coilQty - progress.usableCoilQty,
    allocatedQty: allocations.length,
    neededQty,
    slabPool,
    recommendableQty: linked && open ? Math.min(neededQty, Math.max(0, slabPool.availableQty)) : 0,
    allocations: allocations.map((a) => {
      const lot = mustGet(tables, 'lot', a.lotId, 'LOT');
      return { ...lotViewOf(tables, lot), allocationId: a.id, confirmedAt: a.confirmedAt, confirmedEmployeeName: employeeNameOf(tables, a.confirmedEmployeeId) };
    }),
    rollable: linked && open,
    notRollableReason: !linked ? '수주 연결이 없는 계획은 열연하지 않아요' : !open ? '진행중인 계획이 아니에요' : null,
  };
}

/** 열연 화면의 코일 계획 목록 (계획·진행중, 최근 것 먼저) */
export function rollingPlans(tables: Tables): RollingPlanView[] {
  return tables.productionPlan
    .filter((p) => (p.productionPlanStatus === 'PLANNED' || p.productionPlanStatus === 'IN_PROGRESS') && tables.item.find((i) => i.id === p.itemId)?.itemType === 'COIL')
    .sort((a, b) => b.id - a.id)
    .map((p) => rollingPlanView(tables, p.id));
}

/** FIFO 추천 (저장 안 함): 판매 예약 몫을 침범하지 않는 매수만 */
export function rollingRecommendation(tables: Tables, productionPlanId: number): { neededQty: number; availableQty: number; lots: RollingLotView[] } {
  const view = rollingPlanView(tables, productionPlanId);
  const lots = view.recommendableQty > 0 ? recommendFifoLots(tables, view.slabItem.id, view.recommendableQty) : [];
  return { neededQty: view.neededQty, availableQty: Math.max(0, view.slabPool.availableQty), lots: lots.map((l) => lotViewOf(tables, l)) };
}

/** 열연 배정 확정 (HOT_ROLLING CONFIRMED). INV-001(필요·가용 초과) / INV-002·003·004 */
export function confirmRollingAllocations(tx: MockTx, actor: PersonActor, input: { productionPlanId: number; lotIds: readonly number[] }): AllocationRow[] {
  const view = rollingPlanView(tx.tables, input.productionPlanId);
  if (!view.rollable) inputError('productionPlanId', view.notRollableReason ?? '열연할 수 없는 계획이에요');
  const lotIds = [...new Set(input.lotIds)];
  if (lotIds.length === 0) inputError('lotIds', '배정할 슬래브를 골라 주세요');
  const lots = lotIds.map((id) => assertAllocatableLot(tx.tables, id, view.slabItem.id));
  if (lotIds.length > view.neededQty) throw new ApiError('INV-001', `열연에 더 필요한 슬래브는 ${view.neededQty}매예요`);
  if (lotIds.length > Math.max(0, view.slabPool.availableQty)) throw new ApiError('INV-001', `판매 예약을 빼고 배정할 수 있는 슬래브는 ${Math.max(0, view.slabPool.availableQty)}매예요`);
  const plan = mustGet(tx.tables, 'productionPlan', view.productionPlanId, '생산계획');
  recordRecommendation(tx, actor, {
    allocationPurpose: 'HOT_ROLLING',
    itemId: view.slabItem.id,
    recommendedLotIds: recommendFifoLots(tx.tables, view.slabItem.id, view.recommendableQty).map((l) => l.id),
    chosenLotIds: lotIds,
    targetType: 'production_plan',
    targetId: plan.id,
    targetNo: plan.productionPlanNo,
    salesOrderId: salesOrderIdOfPlan(tx.tables, plan),
  });
  return lots.map((lot) =>
    insertConfirmedAllocation(tx, actor, lot, { allocationPurpose: 'HOT_ROLLING', salesOrderItemId: null, shipmentRequestItemId: null, productionPlanId: plan.id }),
  );
}

export interface HotRollingInput {
  productionPlanId: number;
  /** 열연할 배정 (생략하면 이 계획의 CONFIRMED 열연 배정 전부) */
  allocationIds?: readonly number[] | null;
  startedAt: string;
  completedAt: string;
  productionResultId?: number | null;
  simulation?: SimulationMark | null;
}

/** 열연 실적: 배정 슬래브 소비 → 코일 LOT (1:1), 코일 검사 대상 */
export function registerHotRolling(tx: MockTx, actor: PersonActor, input: HotRollingInput): { coilLots: LotRow[]; resultId: number } {
  const plan = planForWork(tx, input.productionPlanId, 'HOT_ROLLING');
  if (plan.salesOrderItemId === null) inputError('productionPlanId', '수주 연결이 없는 계획은 열연하지 않아요');
  const coil = mustGet(tx.tables, 'item', plan.itemId, '규격');
  const slabSpec = slabSpecOfCoil(tx.tables, coil);
  const all = hotRollingAllocationsOf(tx.tables, plan.id);
  const allocations = input.allocationIds ? all.filter((a) => input.allocationIds?.includes(a.id)) : all;
  if (allocations.length === 0) inputError('allocationIds', '열연할 배정 슬래브가 없어요. 먼저 열연 투입 배정을 확정해 주세요');
  if (input.allocationIds && allocations.length !== new Set(input.allocationIds).size) inputError('allocationIds', '이 계획의 확정된 열연 배정만 고를 수 있어요');
  const slabs = allocations.map((a) => {
    const lot = mustGet(tx.tables, 'lot', a.lotId, 'LOT');
    if (lot.lotStatus !== 'AVAILABLE') throw new ApiError('INV-004', lot.lotNo);
    if (lot.isPassed !== true || heatOf(tx.tables, lot)?.isPassed !== true) throw new ApiError('INV-002', lot.lotNo);
    return { allocation: a, lot };
  });
  const errors = new FieldErrors();
  const startedAt = checkDateTime(errors, 'startedAt', input.startedAt, '작업 시작 일시');
  const completedAt = checkDateTime(errors, 'completedAt', input.completedAt, '작업 완료 일시');
  if (startedAt && completedAt && completedAt < startedAt) errors.add('completedAt', '작업 완료 일시는 시작 일시 뒤여야 해요');
  errors.throwIfAny();
  const times = { startedAt: startedAt ?? '', completedAt: completedAt ?? '' };
  const result = upsertCompletedResult(tx, actor, plan, { productionResultId: input.productionResultId, processType: 'HOT_ROLLING', times, simulation: input.simulation });
  const slabTheoreticalWeightTon = theoreticalWeightOf(slabSpec);
  const coilTheoreticalWeightTon = theoreticalWeightOf(coil);
  const completedDate = seoulDateOf(times.completedAt);
  const coilLots: LotRow[] = [];
  for (const { allocation, lot } of slabs) {
    updateRow(tx, 'allocation', allocation.id, { allocationStatus: 'CONSUMED', consumedAt: tx.nowIso });
    updateRow(tx, 'lot', lot.id, { lotStatus: 'CONSUMED', consumedAt: tx.nowIso });
    const coilLot = insertRow(tx, 'lot', {
      lotNo: coilNoOf(lot.lotNo),
      lotType: 'COIL',
      lotStatus: 'AVAILABLE',
      itemId: coil.id,
      steelGradeId: lot.steelGradeId,
      heatLotId: lot.heatLotId,
      initialTon: null,
      remainingTon: null,
      blastFurnaceCode: null,
      converterCode: null,
      yardId: coil.defaultYardId,
      goodsReceiptId: null,
      productionResultId: result.id,
      productionPlanId: plan.id,
      isPassed: null,
      dispositionStatus: null,
      dispositionReason: null,
      dispositionAt: null,
      surplusAt: null,
      producedDate: completedDate,
      consumedAt: null,
      shippedAt: null,
    });
    insertRow(tx, 'lotRelation', { parentLotId: lot.id, childLotId: coilLot.id, lotRelationEvidence: 'ACTUAL_INPUT', inputTon: slabTheoreticalWeightTon, periodStartedAt: null, periodEndedAt: null });
    ensurePendingInspection(tx, coilLot);
    coilLots.push(coilLot);
  }
  const completed =
    updateRow(tx, 'productionResult', result.id, {
      inputTon: decSum(slabs.map(() => slabTheoreticalWeightTon)),
      outputQty: coilLots.length,
      outputTon: calcWeightTon(coilLots.length, coilTheoreticalWeightTon),
    }) ?? result;
  refreshInventory(tx, slabSpec.id);
  refreshInventory(tx, coil.id);
  recordBusinessEvent(tx, {
    businessEventType: 'PRODUCTION_RESULT_REGISTERED',
    actor,
    targetType: 'production_result',
    targetId: completed.id,
    targetNo: plan.productionPlanNo,
    salesOrderId: salesOrderIdOfPlan(tx.tables, plan),
    afterData: {
      processType: 'HOT_ROLLING',
      productionPlanNo: plan.productionPlanNo,
      startedAt: times.startedAt,
      completedAt: times.completedAt,
      slabNos: slabs.map((s) => s.lot.lotNo),
      coilNos: coilLots.map((c) => c.lotNo),
      outputQty: coilLots.length,
      isSimulated: completed.isSimulated,
    },
    lotIds: [...slabs.map((s) => s.lot.id), ...coilLots.map((c) => c.id)],
  });
  refreshPlanStatus(tx, plan.id);
  assertNoOpenWorkOnCompletion(tx.tables, plan.id);
  return { coilLots, resultId: completed.id };
}
