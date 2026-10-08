import { Injectable } from '@nestjs/common';
import { ALLOCATION_PURPOSE, ALLOCATION_STATUS, ITEM_TYPE, LOT_TYPE, RESERVATION_STATUS, SALES_ORDER_ITEM_STATUS, type AllocationPurpose, type AllocationStatus, type ReservationStatus } from '@fantasteel/shared';
import {
  allocateRollingQty,
  countEligibleAvailableLots,
  countUnallocatedPassedLotsByItem,
  findAllocatableLots,
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

  /** 출고: 현재고와 예약 매수를 함께 줄인다. 어느 쪽이든 모자라면 바뀐 행이 없어 false */
  async consumeOnHandAndReserved(tx: Tx, itemId: number, qty: number): Promise<boolean> {
    const result = await tx.inventory.updateMany({
      where: { itemId, onHandQty: { gte: qty }, reservedQty: { gte: qty } },
      data: { onHandQty: { decrement: qty }, reservedQty: { decrement: qty } },
    });
    return result.count > 0;
  }

  /** 재고 행이 없으면 만든다 (시드에 재고 행이 없고, 처음 적격이 될 때 생긴다) */
  ensureInventory(tx: Tx, itemId: number) {
    return tx.inventory.upsert({ where: { itemId }, create: { itemId }, update: {} });
  }

  async countEligibleAvailableLots(tx: Tx, itemId: number): Promise<number> {
    return (await tx.$queryRawTyped(countEligibleAvailableLots(itemId)))[0]?.eligible_qty ?? 0;
  }

  setOnHandQty(tx: Tx, itemId: number, onHandQty: number) {
    return tx.inventory.update({ where: { itemId }, data: { onHandQty } });
  }

  /** 판정이 바뀐 LOT에서 재고에 영향을 받는 제품 LOT: 히트면 하위 슬래브와 그 코일, 슬래브면 자기와 코일, 코일이면 자기 */
  async findAffectedProductLotIds(tx: Tx, lotIds: number[]): Promise<number[]> {
    const lots = await tx.lot.findMany({
      where: { id: { in: lotIds } },
      select: {
        id: true,
        lotType: true,
        lotRelationsAsParentLot: { select: { childLot: { select: { id: true, lotType: true, lotRelationsAsParentLot: { select: { childLot: { select: { id: true, lotType: true } } } } } } } },
      },
    });
    const ids = new Set<number>();
    const isProduct = (lotType: string) => lotType === LOT_TYPE.SLAB || lotType === LOT_TYPE.COIL;
    for (const lot of lots) {
      if (isProduct(lot.lotType)) ids.add(lot.id);
      for (const { childLot } of lot.lotRelationsAsParentLot) {
        if (isProduct(childLot.lotType)) ids.add(childLot.id);
        for (const grand of childLot.lotRelationsAsParentLot) if (isProduct(grand.childLot.lotType)) ids.add(grand.childLot.id);
      }
    }
    return [...ids].sort((a, b) => a - b);
  }

  /** 제품 LOT과 그 LOT을 만든 생산계획(자동 예약 대상 수주 품목 찾기: LOT → 실적 → 계획 → 수주 품목) */
  findProductLots(tx: Tx, lotIds: number[]) {
    return tx.lot.findMany({
      where: { id: { in: lotIds } },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        lotNo: true,
        itemId: true,
        lotStatus: true,
        productionResult: { select: { productionPlan: { select: { id: true, itemId: true, salesOrderItemId: true } } } },
      },
    });
  }

  findConfirmedAllocationsOfLots(tx: Tx, lotIds: number[]) {
    return tx.allocation.findMany({ where: { lotId: { in: lotIds }, allocationStatus: ALLOCATION_STATUS.CONFIRMED }, include: allocationInclude, orderBy: { lotId: 'asc' } });
  }

  /** 규격의 ACTIVE 예약 (초과 예약 축소 대상) */
  findActiveReservationsOfItem(tx: Tx, itemId: number) {
    return tx.reservation.findMany({
      where: { itemId, reservationStatus: RESERVATION_STATUS.ACTIVE },
      include: { salesOrderItem: { select: { salesOrderId: true } } },
      orderBy: { id: 'desc' },
    });
  }

  updateReservationQty(tx: Tx, id: number, reservedQty: number) {
    return tx.reservation.update({ where: { id }, data: { reservedQty } });
  }

  createReleasedReservation(tx: Tx, data: { salesOrderItemId: number; itemId: number; reservedQty: number }) {
    return tx.reservation.create({ data: { ...data, reservationStatus: RESERVATION_STATUS.RELEASED } });
  }

  /** 자동 예약 판단: 수주 품목의 주문 매수·상태와 예약 상태별 합계 */
  async findSalesOrderItemSecured(tx: Tx, salesOrderItemId: number) {
    const item = await tx.salesOrderItem.findUnique({ where: { id: salesOrderItemId }, select: { id: true, salesOrderId: true, itemId: true, orderedQty: true, salesOrderItemStatus: true } });
    if (!item) return null;
    const sums = await tx.reservation.groupBy({ by: ['reservationStatus'], where: { salesOrderItemId }, _sum: { reservedQty: true } });
    const sumOf = (status: string) => sums.find((r) => r.reservationStatus === status)?._sum.reservedQty ?? 0;
    return { ...item, activeQty: sumOf(RESERVATION_STATUS.ACTIVE), convertedQty: sumOf(RESERVATION_STATUS.CONVERTED) };
  }

  /** 열연 배정 확정: 가용 안에서만 rolling을 1 늘린다. 바뀐 행이 없으면 false (INV-001) */
  async allocateRollingQty(tx: Tx, itemId: number): Promise<boolean> {
    return (await tx.$queryRawTyped(allocateRollingQty(itemId))).length > 0;
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

  /** 규격별 미배정 합격 제품 LOT 수 */
  countUnallocatedPassedLots(tx: Tx) {
    return tx.$queryRawTyped(countUnallocatedPassedLotsByItem());
  }

  /** 원료 규격과 잔량이 남은 원료 LOT의 잔량 합계·LOT 수 (원료 재고 = 원료 LOT 잔량 합계, TRM-054) */
  async findRawMaterialStock(tx: Tx) {
    const [items, sums] = await Promise.all([
      tx.item.findMany({ where: { itemType: ITEM_TYPE.RAW_MATERIAL }, select: { id: true, itemCode: true, itemName: true }, orderBy: { id: 'asc' } }),
      tx.lot.groupBy({ by: ['itemId'], where: { lotType: LOT_TYPE.RAW_MATERIAL, remainingTon: { gt: 0 } }, _sum: { remainingTon: true }, _count: { _all: true } }),
    ]);
    return { items, sums };
  }

  // ── 예약 ──────────────────────────────────────────────

  createReservation(tx: Tx, data: { salesOrderItemId: number; itemId: number; reservedQty: number }) {
    return tx.reservation.create({ data: { ...data, reservationStatus: RESERVATION_STATUS.ACTIVE } });
  }

  findReservationsOfItem(tx: Tx, salesOrderItemId: number, status: ReservationStatus) {
    return tx.reservation.findMany({ where: { salesOrderItemId, reservationStatus: status }, orderBy: { id: 'asc' } });
  }

  /** 부분 출고: ACTIVE 예약 매수를 줄이고, 줄인 만큼 CONVERTED 예약 행을 새로 만든다 (ACTIVE 10 → ACTIVE 6 + CONVERTED 4) */
  async splitReservation(tx: Tx, reservation: { id: number; salesOrderItemId: number; itemId: number; reservedQty: number }, convertedQty: number) {
    const remaining = await tx.reservation.update({ where: { id: reservation.id }, data: { reservedQty: reservation.reservedQty - convertedQty } });
    const converted = await tx.reservation.create({
      data: { salesOrderItemId: reservation.salesOrderItemId, itemId: reservation.itemId, reservedQty: convertedQty, reservationStatus: RESERVATION_STATUS.CONVERTED },
    });
    return { remaining, converted };
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

  // ── 여재 (inventory.md 8-1) ───────────────────────────

  /**
   * 진행 중인 코일 수주에 묶인 슬래브 LOT (열연에 쓰일 몫).
   * LOT → 작업 실적 → 생산계획 → 수주 품목(4장 자동 예약과 같은 경로). 수주가 취소되면 계획의 수주 품목이 null이 되어 빠진다.
   */
  async findLotIdsForOpenCoilOrders(tx: Tx, lotIds: number[]): Promise<Set<number>> {
    const rows = await tx.lot.findMany({
      where: {
        id: { in: lotIds },
        productionResult: {
          productionPlan: {
            salesOrderItem: { salesOrderItemStatus: { in: [SALES_ORDER_ITEM_STATUS.OPEN, SALES_ORDER_ITEM_STATUS.PARTIALLY_SHIPPED] }, item: { itemType: ITEM_TYPE.COIL } },
          },
        },
      },
      select: { id: true },
    });
    return new Set(rows.map((r) => r.id));
  }

  /** 여재 슬래브의 야드 이름과 만든 생산계획 (화면 표시용) */
  findSurplusLotDetails(tx: Tx, lotIds: number[]) {
    return tx.lot.findMany({
      where: { id: { in: lotIds } },
      select: { id: true, yard: { select: { yardName: true } }, productionResult: { select: { productionPlan: { select: { id: true, productionPlanNo: true } } } } },
    });
  }

  /** 규격의 1매 이론중량 (여재 톤 계산) */
  findItemWeights(tx: Tx, itemIds: number[]) {
    return tx.item.findMany({ where: { id: { in: itemIds } }, select: { id: true, theoreticalWeightTon: true } });
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

  createHotRollingAllocation(tx: Tx, lotId: number, productionPlanId: number) {
    return tx.allocation.create({
      data: { lotId, productionPlanId, allocationPurpose: ALLOCATION_PURPOSE.HOT_ROLLING, allocationStatus: ALLOCATION_STATUS.CONFIRMED },
      include: allocationInclude,
    });
  }

  findAllocation(tx: Tx, id: number) {
    return tx.allocation.findUnique({ where: { id }, include: allocationInclude });
  }

  updateAllocationStatus(tx: Tx, id: number, allocationStatus: AllocationStatus) {
    return tx.allocation.update({ where: { id }, data: { allocationStatus }, include: allocationInclude });
  }

  /** 출고 확정: 확정(CONFIRMED) 배정만 소진으로. 바뀐 수가 모자라면 false */
  async consumeConfirmedAllocations(tx: Tx, ids: number[]): Promise<boolean> {
    // id IN (…)인 updateMany는 Prisma 쿼리 인터프리터가 실패해서 배정마다 고친다 (shipment.repository markLotsShipped 참고)
    let changed = 0;
    for (const id of [...ids].sort((a, b) => a - b)) {
      changed += (await tx.allocation.updateMany({ where: { id, allocationStatus: ALLOCATION_STATUS.CONFIRMED }, data: { allocationStatus: ALLOCATION_STATUS.CONSUMED } })).count;
    }
    return changed === ids.length;
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
