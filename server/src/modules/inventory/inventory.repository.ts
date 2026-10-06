import { Injectable } from '@nestjs/common';
import { ALLOCATION_PURPOSE, ALLOCATION_STATUS, ITEM_TYPE, RESERVATION_STATUS, type AllocationPurpose, type AllocationStatus, type ReservationStatus } from '@fantasteel/shared';
import {
  findAllocatableLots,
  findEligibilityTargets,
  findLotEligibility,
  lockInventoryByItemId,
  lockShipmentRequest,
  releaseInventoryReservedQty,
  reserveInventoryQty,
} from '../../generated/prisma/sql';
import type { Tx } from '../../prisma/prisma.service';

const allocationInclude = {
  lot: {
    select: {
      id: true,
      lotNo: true,
      itemId: true,
      yardId: true,
      producedDate: true,
      lotStatus: true,
      // 상위 히트 번호 표시용: 슬래브 → 히트, 코일 → 슬래브 → 히트
      lotRelationsAsChildLot: {
        select: { parentLot: { select: { lotType: true, lotNo: true, lotRelationsAsChildLot: { select: { parentLot: { select: { lotType: true, lotNo: true } } } } } } },
      },
    },
  },
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

  /** 시드는 재고 행을 만들지 않으므로 제품이 처음 적격이 될 때 만든다 (2026-10-06 결정, inventory.md 6장) */
  ensureInventory(tx: Tx, itemId: number) {
    return tx.inventory.upsert({ where: { itemId }, create: { itemId }, update: {} });
  }

  /** 적격이 됨·적격에서 빠짐. 줄일 때는 예약·열연 배정을 먼저 맞춰 두고, 가용 ≥ 0 CHECK가 최종 방어다 */
  changeOnHandQty(tx: Tx, itemId: number, delta: number) {
    return tx.inventory.update({ where: { itemId }, data: { onHandQty: { increment: delta } } });
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

  createReservation(tx: Tx, data: { salesOrderItemId: number; itemId: number; reservedQty: number }, reservationStatus: ReservationStatus = RESERVATION_STATUS.ACTIVE) {
    return tx.reservation.create({ data: { ...data, reservationStatus } });
  }

  updateReservationQty(tx: Tx, id: number, reservedQty: number) {
    return tx.reservation.update({ where: { id }, data: { reservedQty } });
  }

  /** 규격의 ACTIVE 예약, 최근 것부터 (불합격으로 예약을 줄일 때 쓴다) */
  findActiveReservationsOfInventoryItem(tx: Tx, itemId: number) {
    return tx.reservation.findMany({
      where: { itemId, reservationStatus: RESERVATION_STATUS.ACTIVE },
      include: { salesOrderItem: { select: { salesOrderId: true } } },
      orderBy: { id: 'desc' },
    });
  }

  /** 수주 품목의 예약 상태별 합계 (미확보 매수 = max(0, 주문 − CONVERTED − ACTIVE), 업무 프로세스 4.5) */
  sumReservedQtyByStatus(tx: Tx, salesOrderItemId: number) {
    return tx.reservation.groupBy({ by: ['reservationStatus'], where: { salesOrderItemId }, _sum: { reservedQty: true } });
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

  /** 검사한 LOT의 판정으로 적격이 달라질 수 있는 제품 LOT과 자기·상위 히트 합격 여부 */
  findEligibilityTargets(tx: Tx, lotId: number) {
    return tx.$queryRawTyped(findEligibilityTargets(lotId));
  }

  /** 자동 예약 대상: LOT → 실적 → 계획 → 원래 수주 품목 ([ERD] lot Note) */
  findLotOrigin(tx: Tx, lotId: number) {
    return tx.lot.findUnique({
      where: { id: lotId },
      select: {
        productionResult: {
          select: {
            productionPlan: {
              select: { salesOrderItem: { select: { id: true, salesOrderId: true, itemId: true, orderedQty: true, salesOrderItemStatus: true } } },
            },
          },
        },
      },
    });
  }

  findConfirmedAllocationOfLot(tx: Tx, lotId: number) {
    return tx.allocation.findFirst({ where: { lotId, allocationStatus: ALLOCATION_STATUS.CONFIRMED }, include: allocationInclude });
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

  /** 출하요청의 품목과 품목별 확정 배정 수 (줄 순서) */
  findShipmentRequestItemsOfRequest(tx: Tx, shipmentRequestId: number) {
    return tx.shipmentRequestItem.findMany({
      where: { shipmentRequestId },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        requestQty: true,
        salesOrderItem: { select: { id: true, itemId: true } },
        _count: { select: { allocations: { where: { allocationStatus: ALLOCATION_STATUS.CONFIRMED } } } },
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
