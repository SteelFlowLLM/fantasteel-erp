// 배정 공통 (REQ-INV-006·007·009, 업무 프로세스 4.2, BP-INV-01, BP-SHP-01, 13.2 confirmAllocation).
// - 배정은 확정할 때 만든다(CONFIRMED). 추천은 저장하지 않고 확정 때 작업 로그(ALLOCATION_RECOMMENDED)로만 남긴다.
// - LOT당 CONFIRMED 배정은 1건 (INV-003). 소진·출고된 LOT은 INV-004. 미합격(제품·상위 히트)은 INV-002.
// - 변경 = 기존 배정 RELEASED + 새 배정 CONFIRMED를 한 트랜잭션에서 (사유 필수, ALLOCATION_CHANGED).
import type { AllocationPurpose, EventReasonCode } from '@/codes';
import { pickFifo } from '@/lib/fifo';
import { recordBusinessEvent, type BusinessEventActor } from '@/mock/businessEvents';
import type { AllocationRow, LotRow, MockTables } from '@/mock/schema';
import { insertRow, updateRow, type MockTx } from '@/mock/store';
import { ApiError, findById, inputError, mustGet, salesOrderIdOfItem, salesOrderIdOfPlan, type PersonActor } from '@/mock/services/context';
import { confirmedAllocationOf, lotEligibility, unallocatedEligibleLotsOf } from '@/mock/services/inventoryPool';

type Tables = Readonly<MockTables>;

const allocationSnapshot = (tables: Tables, a: AllocationRow) => ({
  id: a.id,
  lotId: a.lotId,
  lotNo: tables.lot.find((l) => l.id === a.lotId)?.lotNo ?? null,
  allocationPurpose: a.allocationPurpose,
  salesOrderItemId: a.salesOrderItemId,
  shipmentRequestItemId: a.shipmentRequestItemId,
  productionPlanId: a.productionPlanId,
  allocationStatus: a.allocationStatus,
});

export function salesOrderIdOfAllocation(tables: Tables, a: AllocationRow): number | null {
  if (a.allocationPurpose === 'SHIPMENT') return salesOrderIdOfItem(tables, a.salesOrderItemId);
  return salesOrderIdOfPlan(tables, findById(tables, 'productionPlan', a.productionPlanId));
}

/**
 * 배정할 수 있는 LOT인지 다시 확인한다 (13.2 recheck…).
 * 규격이 다르면 입력 오류, 소진·출고 INV-004, 이미 배정 INV-003, 미합격 INV-002.
 */
export function assertAllocatableLot(tables: Tables, lotId: number, expectedItemId: number, ignoreAllocationId?: number): LotRow {
  const lot = mustGet(tables, 'lot', lotId, 'LOT');
  if (lot.lotType !== 'SLAB' && lot.lotType !== 'COIL') inputError('lotIds', `${lot.lotNo}은 제품(슬래브·코일) LOT이 아니에요`);
  if (lot.itemId !== expectedItemId) inputError('lotIds', `${lot.lotNo}은 규격이 달라요`);
  if (lot.lotStatus !== 'AVAILABLE') throw new ApiError('INV-004', lot.lotNo);
  const existing = confirmedAllocationOf(tables, lot.id);
  if (existing && existing.id !== ignoreAllocationId) throw new ApiError('INV-003', lot.lotNo);
  if (lotEligibility(tables, lot) !== 'ELIGIBLE') throw new ApiError('INV-002', lot.lotNo);
  return lot;
}

/** FIFO 추천 (생산완료일 → LOT 번호): 적격·미소진·미배정 LOT 앞에서 count개. 저장하지 않는다. */
export const recommendFifoLots = (tables: Tables, itemId: number, count: number): LotRow[] => pickFifo(unallocatedEligibleLotsOf(tables, itemId), count);

export interface AllocationLinks {
  allocationPurpose: AllocationPurpose;
  salesOrderItemId: number | null;
  shipmentRequestItemId: number | null;
  productionPlanId: number | null;
}

/** CONFIRMED 배정 행을 만들고 ALLOCATION_CONFIRMED를 남긴다 (검증은 부르는 쪽에서 assertAllocatableLot으로) */
export function insertConfirmedAllocation(tx: MockTx, actor: PersonActor, lot: LotRow, links: AllocationLinks): AllocationRow {
  const row = insertRow(tx, 'allocation', {
    lotId: lot.id,
    ...links,
    allocationStatus: 'CONFIRMED',
    confirmedEmployeeId: actor.employeeId,
    confirmedAt: tx.nowIso,
    consumedAt: null,
    releasedAt: null,
  });
  recordBusinessEvent(tx, {
    businessEventType: 'ALLOCATION_CONFIRMED',
    actor,
    targetType: 'allocation',
    targetId: row.id,
    targetNo: lot.lotNo,
    salesOrderId: salesOrderIdOfAllocation(tx.tables, row),
    afterData: allocationSnapshot(tx.tables, row),
    lotIds: [lot.id],
  });
  return row;
}

/** 확정 직전에 보여 준 FIFO 추천을 작업 로그로 남긴다 (추천은 저장하지 않음, 13.2) */
export function recordRecommendation(
  tx: MockTx,
  actor: BusinessEventActor,
  input: {
    allocationPurpose: AllocationPurpose;
    itemId: number;
    recommendedLotIds: readonly number[];
    chosenLotIds: readonly number[];
    targetType: 'shipment_request_item' | 'production_plan';
    targetId: number;
    targetNo: string | null;
    salesOrderId: number | null;
  },
): void {
  const lotNoOf = (id: number) => tx.tables.lot.find((l) => l.id === id)?.lotNo ?? String(id);
  const sameAsRecommended =
    input.recommendedLotIds.length === input.chosenLotIds.length && input.recommendedLotIds.every((id) => input.chosenLotIds.includes(id));
  recordBusinessEvent(tx, {
    businessEventType: 'ALLOCATION_RECOMMENDED',
    actor,
    targetType: input.targetType,
    targetId: input.targetId,
    targetNo: input.targetNo,
    salesOrderId: input.salesOrderId,
    afterData: {
      allocationPurpose: input.allocationPurpose,
      itemId: input.itemId,
      recommendedLotNos: input.recommendedLotIds.map(lotNoOf),
      chosenLotNos: input.chosenLotIds.map(lotNoOf),
      sameAsRecommended,
    },
    reasonCode: 'FIFO_RECOMMENDATION',
    reasonText: '생산완료일 → LOT 번호 순 FIFO 추천',
    lotIds: input.recommendedLotIds,
  });
}

/** CONFIRMED 배정 하나를 RELEASED로 (검증 없이). 출하요청 상태도 다시 맞춘다. */
export function releaseAllocationRow(tx: MockTx, actor: BusinessEventActor, allocation: AllocationRow, reason: { reasonCode?: EventReasonCode | null; reasonText?: string | null }): AllocationRow {
  const before = allocationSnapshot(tx.tables, allocation);
  const row = updateRow(tx, 'allocation', allocation.id, { allocationStatus: 'RELEASED', releasedAt: tx.nowIso }) ?? allocation;
  recordBusinessEvent(tx, {
    businessEventType: 'ALLOCATION_RELEASED',
    actor,
    targetType: 'allocation',
    targetId: row.id,
    targetNo: before.lotNo,
    salesOrderId: salesOrderIdOfAllocation(tx.tables, row),
    beforeData: before,
    afterData: allocationSnapshot(tx.tables, row),
    reasonCode: reason.reasonCode ?? null,
    reasonText: reason.reasonText ?? null,
    lotIds: [row.lotId],
  });
  refreshShipmentRequestStatusOfAllocation(tx, row);
  return row;
}

function confirmedAllocationForChange(tables: Tables, allocationId: number): AllocationRow {
  const allocation = mustGet(tables, 'allocation', allocationId, '배정');
  if (allocation.allocationStatus === 'CONSUMED') throw new ApiError('INV-004', '소진된 배정은 바꿀 수 없어요');
  if (allocation.allocationStatus !== 'CONFIRMED') inputError('allocationId', '이미 해제된 배정이에요');
  return allocation;
}

/** 배정 해제 (사람). 소진된 배정은 INV-004. */
export function releaseAllocation(tx: MockTx, actor: PersonActor, input: { allocationId: number; reasonText?: string | null }): AllocationRow {
  const allocation = confirmedAllocationForChange(tx.tables, input.allocationId);
  return releaseAllocationRow(tx, actor, allocation, { reasonCode: null, reasonText: input.reasonText?.trim() || null });
}

/**
 * 배정 변경: 기존 배정 RELEASED + 새 LOT CONFIRMED를 한 트랜잭션에서 (BP-INV-01). 사유 필수.
 * 작업 로그는 ALLOCATION_CHANGED(사유 ALLOCATION_CHANGE) 한 건에 전후 LOT을 남긴다.
 */
export function changeAllocation(tx: MockTx, actor: PersonActor, input: { allocationId: number; newLotId: number; reasonText: string }): AllocationRow {
  const reasonText = (input.reasonText ?? '').trim();
  if (!reasonText) inputError('reasonText', '배정을 바꾸는 사유를 입력해 주세요');
  const old = confirmedAllocationForChange(tx.tables, input.allocationId);
  const oldLot = mustGet(tx.tables, 'lot', old.lotId, 'LOT');
  if (input.newLotId === old.lotId) inputError('newLotId', '지금 배정된 LOT과 같아요');
  const newLot = assertAllocatableLot(tx.tables, input.newLotId, oldLot.itemId ?? -1);
  const before = allocationSnapshot(tx.tables, old);
  updateRow(tx, 'allocation', old.id, { allocationStatus: 'RELEASED', releasedAt: tx.nowIso });
  const row = insertRow(tx, 'allocation', {
    lotId: newLot.id,
    allocationPurpose: old.allocationPurpose,
    salesOrderItemId: old.salesOrderItemId,
    shipmentRequestItemId: old.shipmentRequestItemId,
    productionPlanId: old.productionPlanId,
    allocationStatus: 'CONFIRMED',
    confirmedEmployeeId: actor.employeeId,
    confirmedAt: tx.nowIso,
    consumedAt: null,
    releasedAt: null,
  });
  recordBusinessEvent(tx, {
    businessEventType: 'ALLOCATION_CHANGED',
    actor,
    targetType: 'allocation',
    targetId: row.id,
    targetNo: newLot.lotNo,
    salesOrderId: salesOrderIdOfAllocation(tx.tables, row),
    beforeData: before,
    afterData: { ...allocationSnapshot(tx.tables, row), releasedAllocationId: old.id },
    reasonCode: 'ALLOCATION_CHANGE',
    reasonText,
    lotIds: [oldLot.id, newLot.id],
  });
  refreshShipmentRequestStatusOfAllocation(tx, row);
  return row;
}

/** 출하요청 상태: 모든 품목이 요청 매수만큼 CONFIRMED 배정되면 ALLOCATED, 아니면 REQUESTED (출고·취소된 요청은 그대로) */
export function refreshShipmentRequestStatus(tx: MockTx, shipmentRequestId: number): void {
  const request = tx.tables.shipmentRequest.find((r) => r.id === shipmentRequestId);
  if (!request || request.shipmentRequestStatus === 'ISSUED' || request.shipmentRequestStatus === 'CANCELLED') return;
  const lines = tx.tables.shipmentRequestItem.filter((i) => i.shipmentRequestId === request.id);
  const allocated = lines.every(
    (line) => tx.tables.allocation.filter((a) => a.shipmentRequestItemId === line.id && a.allocationStatus === 'CONFIRMED').length >= line.requestQty,
  );
  const status = lines.length > 0 && allocated ? 'ALLOCATED' : 'REQUESTED';
  if (status !== request.shipmentRequestStatus) updateRow(tx, 'shipmentRequest', request.id, { shipmentRequestStatus: status });
}

function refreshShipmentRequestStatusOfAllocation(tx: MockTx, allocation: AllocationRow): void {
  if (allocation.shipmentRequestItemId === null) return;
  const line = tx.tables.shipmentRequestItem.find((i) => i.id === allocation.shipmentRequestItemId);
  if (line) refreshShipmentRequestStatus(tx, line.shipmentRequestId);
}
