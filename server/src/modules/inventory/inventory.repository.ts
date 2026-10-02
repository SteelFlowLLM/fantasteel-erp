import { Injectable } from '@nestjs/common';
import { ALLOCATION_PURPOSE, ALLOCATION_STATUS, ITEM_TYPE, RESERVATION_STATUS, type AllocationPurpose, type AllocationStatus, type ReservationStatus } from '@fantasteel/shared';
import {
  findAllocatableLots,
  findLotEligibility,
  lockInventoryByItemId,
  lockShipmentRequest,
  releaseInventoryReservedQty,
  reserveInventoryQty,
} from '../../generated/prisma/sql';
import type { Tx } from '../../prisma/prisma.service';

const allocationInclude = {
  lot: { select: { id: true, lotNo: true, itemId: true, producedDate: true, lotStatus: true } },
  shipmentRequestItem: { select: { shipmentRequestId: true, salesOrderItem: { select: { salesOrderId: true } } } },
  productionPlan: { select: { salesOrderItem: { select: { salesOrderId: true } } } },
} as const;

/**
 * inventory·reservation·allocation은 이 모듈만 바꾼다 (docs/backend/inventory.md).
 * 잠금 순서: inventory(item_id 오름차순) → reservation → allocation → lot(id 오름차순) (업무 프로세스 13.2)
 */
@Injectable()
export class InventoryRepository {
  // ── 재고 ──────────────────────────────────────────────

  async lockInventory(tx: Tx, itemId: number) {
    const rows = await tx.$queryRawTyped(lockInventoryByItemId(itemId));
    return rows[0] ?? null;
  }

  /** 가용 안에서만 예약 매수를 늘린다. 바뀐 행이 없으면 false */
  async reserveQty(tx: Tx, itemId: number, qty: number): Promise<boolean> {
    return (await tx.$queryRawTyped(reserveInventoryQty(itemId, qty))).length > 0;
  }

  async releaseReservedQty(tx: Tx, itemId: number, qty: number): Promise<boolean> {
    return (await tx.$queryRawTyped(releaseInventoryReservedQty(itemId, qty))).length > 0;
  }

  /** 열연 배정 해제: rolling만 줄인다 (가용이 늘어나는 방향이라 조건이 필요 없다) */
  decrementRollingAllocatedQty(tx: Tx, itemId: number, qty: number) {
    return tx.inventory.update({ where: { itemId }, data: { rollingAllocatedQty: { decrement: qty } } });
  }

  /** 제품 규격(슬래브·코일)과 재고 행 (재고 행이 없으면 0매) */
  findProductInventories(tx: Tx) {
    return tx.item.findMany({
      where: { itemType: { in: [ITEM_TYPE.SLAB, ITEM_TYPE.COIL] } },
      select: {
        id: true,
        itemCode: true,
        itemName: true,
        itemType: true,
        theoreticalWeightTon: true,
        steelGrade: { select: { steelGradeCode: true } },
        inventory: { select: { onHandQty: true, reservedQty: true, rollingAllocatedQty: true } },
      },
      orderBy: { id: 'asc' },
    });
  }

  // ── 예약 ──────────────────────────────────────────────

  createReservation(tx: Tx, data: { salesOrderItemId: number; itemId: number; reservedQty: number }) {
    return tx.reservation.create({ data: { ...data, reservationStatus: RESERVATION_STATUS.ACTIVE } });
  }

  findReservationsOfItem(tx: Tx, salesOrderItemId: number, status: ReservationStatus) {
    return tx.reservation.findMany({ where: { salesOrderItemId, reservationStatus: status }, orderBy: { id: 'asc' } });
  }

  updateReservationStatus(tx: Tx, id: number, reservationStatus: ReservationStatus) {
    return tx.reservation.update({ where: { id }, data: { reservationStatus } });
  }

  findReservations(tx: Tx, salesOrderItemIds: number[]) {
    return tx.reservation.findMany({
      where: { salesOrderItemId: { in: salesOrderItemIds } },
      include: { item: { select: { itemCode: true, itemName: true } } },
      orderBy: { id: 'asc' },
    });
  }

  // ── 배정 ──────────────────────────────────────────────

  findAllocatableLots(tx: Tx, itemId: number) {
    return tx.$queryRawTyped(findAllocatableLots(itemId));
  }

  async findLotEligibility(tx: Tx, lotId: number) {
    return (await tx.$queryRawTyped(findLotEligibility(lotId)))[0] ?? null;
  }

  async lockShipmentRequest(tx: Tx, shipmentRequestId: number) {
    return (await tx.$queryRawTyped(lockShipmentRequest(shipmentRequestId)))[0] ?? null;
  }

  findShipmentRequestItem(tx: Tx, id: number) {
    return tx.shipmentRequestItem.findUnique({
      where: { id },
      include: {
        shipmentRequest: { select: { id: true, shipmentRequestNo: true, shipmentRequestStatus: true } },
        salesOrderItem: { select: { id: true, salesOrderId: true, itemId: true } },
      },
    });
  }

  countConfirmedShipmentAllocations(tx: Tx, shipmentRequestItemId: number) {
    return tx.allocation.count({ where: { shipmentRequestItemId, allocationStatus: ALLOCATION_STATUS.CONFIRMED } });
  }

  createShipmentAllocation(tx: Tx, lotId: number, shipmentRequestItemId: number) {
    return tx.allocation.create({
      data: { lotId, shipmentRequestItemId, allocationPurpose: ALLOCATION_PURPOSE.SHIPMENT, allocationStatus: ALLOCATION_STATUS.CONFIRMED },
      include: allocationInclude,
    });
  }

  findAllocation(tx: Tx, id: number) {
    return tx.allocation.findUnique({ where: { id }, include: allocationInclude });
  }

  updateAllocationStatus(tx: Tx, id: number, allocationStatus: AllocationStatus) {
    return tx.allocation.update({ where: { id }, data: { allocationStatus }, include: allocationInclude });
  }

  findAllocations(tx: Tx, where: { allocationPurpose?: AllocationPurpose; shipmentRequestId?: number; shipmentRequestItemId?: number; productionPlanId?: number; allocationStatus?: AllocationStatus[] }) {
    return tx.allocation.findMany({
      where: {
        allocationPurpose: where.allocationPurpose,
        shipmentRequestItemId: where.shipmentRequestItemId,
        productionPlanId: where.productionPlanId,
        shipmentRequestItem: where.shipmentRequestId === undefined ? undefined : { shipmentRequestId: where.shipmentRequestId },
        allocationStatus: where.allocationStatus ? { in: where.allocationStatus } : undefined,
      },
      include: allocationInclude,
      orderBy: { id: 'asc' },
    });
  }
}
