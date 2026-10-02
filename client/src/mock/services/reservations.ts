// 예약 (REQ-INV-002·004·005·009, 업무 프로세스 4.2, BP-INV-02).
// 불변조건: inventory.reserved_qty = ACTIVE 예약 합계 (refreshInventory로 같은 트랜잭션에서 맞춤), 예약 가용 ≥ 0.
import { ALLOCATION_PURPOSE_LABEL, RESERVATION_STATUS_LABEL, type EventReasonCode } from '@/codes';
import { recordBusinessEvent, type BusinessEventActor } from '@/mock/businessEvents';
import type { AllocationRow, MockTables, ReservationRow, SalesOrderItemRow } from '@/mock/schema';
import { insertRow, updateRow, type MockTx } from '@/mock/store';
import { activeReservedQtyOfItem, confirmedAllocationOf, lotEligibility, reservationPoolOf } from '@/mock/services/inventoryPool';
import { ApiError, mustGet, qtyUnitOfItem, refreshInventory, SYSTEM_ACTOR } from '@/mock/services/context';
import { releaseAllocationRow } from '@/mock/services/allocations';

const reservationSnapshot = (r: ReservationRow) => ({ id: r.id, salesOrderItemId: r.salesOrderItemId, itemId: r.itemId, reservedQty: r.reservedQty, reservationStatus: r.reservationStatus });

export interface CreateReservationInput {
  salesOrderItemId: number;
  qty: number;
  reasonCode?: EventReasonCode | null;
  reasonText?: string | null;
  /** 예약의 계기가 된 LOT (자동 예약: 합격한 LOT) */
  lotIds?: readonly number[];
}

/** ACTIVE 예약을 만든다. 예약 가용을 넘으면 INV-001. */
export function createReservation(tx: MockTx, actor: BusinessEventActor, input: CreateReservationInput): ReservationRow {
  const soItem = mustGet(tx.tables, 'salesOrderItem', input.salesOrderItemId, '수주 품목');
  if (!Number.isInteger(input.qty) || input.qty < 1) throw new ApiError('SO-002');
  const pool = reservationPoolOf(tx.tables, soItem.itemId);
  if (input.qty > pool.availableQty) throw new ApiError('INV-001', `예약 가용 ${Math.max(0, pool.availableQty)}매`);
  const row = insertRow(tx, 'reservation', { salesOrderItemId: soItem.id, itemId: soItem.itemId, reservedQty: input.qty, reservationStatus: 'ACTIVE' });
  refreshInventory(tx, soItem.itemId);
  recordBusinessEvent(tx, {
    businessEventType: 'RESERVATION_CREATED',
    actor,
    targetType: 'reservation',
    targetId: row.id,
    targetNo: null,
    salesOrderId: soItem.salesOrderId,
    afterData: reservationSnapshot(row),
    reasonCode: input.reasonCode ?? null,
    reasonText: input.reasonText ?? null,
    lotIds: input.lotIds,
  });
  return row;
}

/** 수주 품목의 현재 미확보 매수 = max(0, 미출하 − ACTIVE 예약) (4.5) */
export function unsecuredQtyOf(tx: MockTx | { tables: MockTx['tables'] }, soItem: SalesOrderItemRow): number {
  if (soItem.salesOrderItemStatus === 'CANCELLED') return 0;
  const unshipped = Math.max(0, soItem.orderedQty - soItem.shippedQty);
  return Math.max(0, unshipped - activeReservedQtyOfItem(tx.tables, soItem.id));
}

/**
 * 수주 품목의 미확보 매수 안에서 예약 가용만큼 예약한다 (REQ-INV-004 자동 예약, 14.1-5 여재 먼저).
 * 예약 가용은 규격 풀(같은 히트의 합격 여재 포함) 전체라 여재가 있으면 그것으로 먼저 채운다.
 * 예약한 매수(0 가능)를 돌려준다. 사유 문구는 예약한 매수(단위 포함, 예: '3매')로 만든다.
 */
export function reserveUpToShortage(
  tx: MockTx,
  actor: BusinessEventActor,
  input: { salesOrderItemId: number; reasonTextOf?: (qtyText: string) => string; reasonCode?: EventReasonCode | null; lotIds?: readonly number[] },
): { reservedQty: number; reservation: ReservationRow | null } {
  const soItem = mustGet(tx.tables, 'salesOrderItem', input.salesOrderItemId, '수주 품목');
  if (soItem.salesOrderItemStatus === 'CANCELLED' || soItem.salesOrderItemStatus === 'SHIPPED') return { reservedQty: 0, reservation: null };
  const qty = Math.min(unsecuredQtyOf(tx, soItem), Math.max(0, reservationPoolOf(tx.tables, soItem.itemId).availableQty));
  if (qty <= 0) return { reservedQty: 0, reservation: null };
  const reservation = createReservation(tx, actor, {
    salesOrderItemId: soItem.id,
    qty,
    reasonCode: input.reasonCode ?? null,
    reasonText: input.reasonTextOf?.(`${qty}${qtyUnitOfItem(tx.tables, soItem.itemId)}`) ?? null,
    lotIds: input.lotIds,
  });
  return { reservedQty: qty, reservation };
}

/** 예약 행 하나를 cutQty만큼 RELEASED로 나눈다 (전부면 행 자체를 RELEASED로). 사유 = `${cause} 예약 n매 해제` */
function releasePart(tx: MockTx, actor: BusinessEventActor, row: ReservationRow, cutQty: number, reasonCode: EventReasonCode | null, cause: string, lotIds?: readonly number[]): void {
  const before = reservationSnapshot(row);
  const salesOrderId = tx.tables.salesOrderItem.find((i) => i.id === row.salesOrderItemId)?.salesOrderId ?? null;
  let released: ReservationRow;
  if (cutQty >= row.reservedQty) {
    released = updateRow(tx, 'reservation', row.id, { reservationStatus: 'RELEASED' }) ?? row;
  } else {
    updateRow(tx, 'reservation', row.id, { reservedQty: row.reservedQty - cutQty });
    released = insertRow(tx, 'reservation', { salesOrderItemId: row.salesOrderItemId, itemId: row.itemId, reservedQty: cutQty, reservationStatus: 'RELEASED' });
  }
  recordBusinessEvent(tx, {
    businessEventType: 'RESERVATION_RELEASED',
    actor,
    targetType: 'reservation',
    targetId: row.id,
    salesOrderId,
    beforeData: before,
    afterData: { ...reservationSnapshot(released), remainingActiveQty: cutQty >= row.reservedQty ? 0 : row.reservedQty - cutQty },
    reasonCode,
    reasonText: `${cause} 예약 ${Math.min(cutQty, row.reservedQty)}${qtyUnitOfItem(tx.tables, row.itemId)} 해제`,
    lotIds,
  });
}

/**
 * 수주 품목의 ACTIVE 예약을 모두 RELEASED로 (수주 취소, REQ-INV-005).
 * cause는 사유 문구 앞부분(예: '수주 SO-2610-001 취소로')이고 뒤에 '예약 n매 해제'를 붙인다.
 */
export function releaseReservationsOfItem(tx: MockTx, actor: BusinessEventActor, salesOrderItemId: number, reasonCode: EventReasonCode | null, cause: string): number {
  const active = tx.tables.reservation.filter((r) => r.salesOrderItemId === salesOrderItemId && r.reservationStatus === 'ACTIVE');
  let total = 0;
  for (const row of active) {
    total += row.reservedQty;
    releasePart(tx, actor, row, row.reservedQty, reasonCode, cause);
  }
  const itemId = active[0]?.itemId;
  if (itemId !== undefined) refreshInventory(tx, itemId);
  return total;
}

/**
 * 출고한 매수만큼 ACTIVE 예약을 CONVERTED로 바꾼다 (REQ-INV-005, 10장 "ACTIVE 10매에서 4매 출고 → ACTIVE 6 + CONVERTED 4").
 * 오래된 예약부터 쓴다. 부분이면 ACTIVE 행을 줄이고 CONVERTED 행을 새로 만든다. ACTIVE가 모자라면 SHP-002.
 */
export function convertReservations(tx: MockTx, actor: BusinessEventActor, salesOrderItemId: number, qty: number, lotIds: readonly number[]): ReservationRow[] {
  const soItem = mustGet(tx.tables, 'salesOrderItem', salesOrderItemId, '수주 품목');
  const active = tx.tables.reservation.filter((r) => r.salesOrderItemId === salesOrderItemId && r.reservationStatus === 'ACTIVE').sort((a, b) => a.id - b.id);
  if (active.reduce((sum, r) => sum + r.reservedQty, 0) < qty) throw new ApiError('SHP-002', '예약 매수보다 많이 출고할 수 없어요');
  let left = qty;
  const converted: ReservationRow[] = [];
  for (const row of active) {
    if (left <= 0) break;
    const take = Math.min(left, row.reservedQty);
    const before = reservationSnapshot(row);
    let convertedRow: ReservationRow;
    if (take === row.reservedQty) {
      convertedRow = updateRow(tx, 'reservation', row.id, { reservationStatus: 'CONVERTED' }) ?? row;
    } else {
      updateRow(tx, 'reservation', row.id, { reservedQty: row.reservedQty - take });
      convertedRow = insertRow(tx, 'reservation', { salesOrderItemId, itemId: row.itemId, reservedQty: take, reservationStatus: 'CONVERTED' });
    }
    converted.push(convertedRow);
    const unit = qtyUnitOfItem(tx.tables, row.itemId);
    const remainingQty = row.reservedQty - take;
    recordBusinessEvent(tx, {
      businessEventType: 'RESERVATION_CONVERTED',
      actor,
      targetType: 'reservation',
      targetId: convertedRow.id,
      salesOrderId: soItem.salesOrderId,
      beforeData: before,
      afterData: { ...reservationSnapshot(convertedRow), remainingActiveQty: remainingQty },
      reasonText: `출고 확정으로 예약 ${take}${unit}를 ${RESERVATION_STATUS_LABEL.CONVERTED}${remainingQty > 0 ? ` · ${RESERVATION_STATUS_LABEL.ACTIVE} ${remainingQty}${unit} 남음` : ''}`,
      lotIds,
    });
    left -= take;
  }
  refreshInventory(tx, soItem.itemId);
  return converted;
}

/**
 * 품질 변화(불합격·판정 취소) 뒤 규격 풀을 다시 맞춘다 (BP-QC-01 "영향을 받는 예약은 규격 풀을 다시 계산해 부족분만 조정").
 * 예약 가용이 음수일 때만 줄인다. 순서(가정값): (1) 불합격 LOT을 만든 계획의 수주 품목 예약(최근 것부터)
 * (2) 열연용 CONFIRMED 배정(최근 것부터, 판매 예약이 우선) (3) 그 밖의 예약(최근 것부터).
 * 출하 배정이 줄어든 예약보다 많으면 최근 배정부터 RELEASED. 사유 QUALITY_FAILURE, 주체 SYSTEM.
 */
export function rebalancePool(tx: MockTx, itemId: number, context: { affectedSalesOrderItemIds: readonly number[]; lotIds: readonly number[] }): void {
  // 사유 문구: "품질 불합격(HT-…-03)으로 예약 가용이 줄어 예약 1매 해제" / "… 열연 투입 배정 해제"
  const failedLotNos = context.lotIds.map((id) => tx.tables.lot.find((l) => l.id === id)?.lotNo).filter((no): no is string => Boolean(no));
  const cause = `품질 불합격(${failedLotNos.length === 1 ? failedLotNos[0] : `LOT ${failedLotNos.length}개`})으로 예약 가용이 줄어`;
  const allocationReason = (allocation: AllocationRow) => `${cause} ${ALLOCATION_PURPOSE_LABEL[allocation.allocationPurpose]} 배정 해제`;
  const deficit = () => -reservationPoolOf(tx.tables, itemId).availableQty;
  const affected = new Set(context.affectedSalesOrderItemIds);
  const activeRows = () => tx.tables.reservation.filter((r) => r.itemId === itemId && r.reservationStatus === 'ACTIVE').sort((a, b) => b.id - a.id);

  const cutFrom = (rows: ReservationRow[]) => {
    for (const row of rows) {
      const need = deficit();
      if (need <= 0) return;
      releasePart(tx, SYSTEM_ACTOR, row, Math.min(need, row.reservedQty), 'QUALITY_FAILURE', cause, context.lotIds);
    }
  };

  if (deficit() > 0) cutFrom(activeRows().filter((r) => affected.has(r.salesOrderItemId)));
  if (deficit() > 0) {
    const hotRolling = tx.tables.allocation
      .filter((a) => a.allocationStatus === 'CONFIRMED' && a.allocationPurpose === 'HOT_ROLLING' && tx.tables.lot.find((l) => l.id === a.lotId)?.itemId === itemId)
      .sort((a, b) => b.id - a.id);
    for (const allocation of hotRolling) {
      if (deficit() <= 0) break;
      releaseAllocationRow(tx, SYSTEM_ACTOR, allocation, { reasonCode: 'QUALITY_FAILURE', reasonText: allocationReason(allocation) });
    }
  }
  if (deficit() > 0) cutFrom(activeRows());
  refreshInventory(tx, itemId);

  // 예약보다 많은 출하 배정은 풀어 준다
  const soItemIds = new Set(tx.tables.reservation.filter((r) => r.itemId === itemId).map((r) => r.salesOrderItemId));
  for (const soItemId of soItemIds) {
    const reserved = activeReservedQtyOfItem(tx.tables, soItemId);
    const allocations = tx.tables.allocation
      .filter((a) => a.allocationStatus === 'CONFIRMED' && a.allocationPurpose === 'SHIPMENT' && a.salesOrderItemId === soItemId)
      .sort((a, b) => b.id - a.id);
    for (const allocation of allocations.slice(0, Math.max(0, allocations.length - reserved))) {
      releaseAllocationRow(tx, SYSTEM_ACTOR, allocation, { reasonCode: 'QUALITY_FAILURE', reasonText: allocationReason(allocation) });
    }
  }
}

/** 적격에서 빠진 까닭 (배정 해제 사유 문구 앞부분) */
function lostEligibilityCause(tables: Readonly<MockTables>, lotId: number): string {
  const lot = tables.lot.find((l) => l.id === lotId);
  const eligibility = lot ? lotEligibility(tables, lot) : null;
  if (eligibility === 'FAILED') return '제품 불합격으로';
  if (eligibility === 'HEAT_FAILED') return '상위 히트 불합격으로';
  if (eligibility === 'PENDING') return '판정 대기로 바뀌어';
  return '품질 적격에서 빠져';
}

/** 이 LOT의 CONFIRMED 배정이 있으면 품질 불합격으로 해제한다 */
export function releaseAllocationOfFailedLot(tx: MockTx, lotId: number): void {
  const allocation = confirmedAllocationOf(tx.tables, lotId);
  if (!allocation) return;
  releaseAllocationRow(tx, SYSTEM_ACTOR, allocation, {
    reasonCode: 'QUALITY_FAILURE',
    reasonText: `${lostEligibilityCause(tx.tables, lotId)} ${ALLOCATION_PURPOSE_LABEL[allocation.allocationPurpose]} 배정 해제`,
  });
}
