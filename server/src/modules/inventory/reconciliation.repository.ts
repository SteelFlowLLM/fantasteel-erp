import { Injectable } from '@nestjs/common';
import { ALLOCATION_PURPOSE, ALLOCATION_STATUS, ITEM_TYPE, RESERVATION_STATUS, ROLE, type NotificationType } from '@fantasteel/shared';
import { lockInventoriesForReconciliation, reconcileInventoryReservedQty, reconcileInventoryRollingQty } from '../../generated/prisma/sql';
import type { Tx } from '../../prisma/prisma.service';
import type { InventoryQtyRow, ReconciliationItem } from './reconciliation.calculator';

/** 정합성 보정 (REQ-INV-010). inventory는 이 모듈만 바꾼다 (docs/backend/inventory.md) */
@Injectable()
export class ReconciliationRepository {
  /** 점검만 할 때: 잠그지 않고 읽는다 */
  async findInventories(tx: Tx): Promise<InventoryQtyRow[]> {
    return tx.inventory.findMany({ select: { itemId: true, onHandQty: true, reservedQty: true, rollingAllocatedQty: true }, orderBy: { itemId: 'asc' } });
  }

  /** 보정할 때: 재고 행을 모두 item_id 순으로 잠근다 */
  async lockInventories(tx: Tx): Promise<InventoryQtyRow[]> {
    const rows = await tx.$queryRawTyped(lockInventoriesForReconciliation());
    return rows.map((r) => ({ itemId: r.item_id, onHandQty: r.on_hand_qty, reservedQty: r.reserved_qty, rollingAllocatedQty: r.rolling_allocated_qty }));
  }

  /** 규격별 ACTIVE 예약 매수 합계 */
  async sumActiveReservations(tx: Tx): Promise<Map<number, number>> {
    const rows = await tx.reservation.groupBy({ by: ['itemId'], where: { reservationStatus: RESERVATION_STATUS.ACTIVE }, _sum: { reservedQty: true } });
    return new Map(rows.map((r) => [r.itemId, r._sum.reservedQty ?? 0]));
  }

  async findProductItems(tx: Tx, itemIds: readonly number[]): Promise<Map<number, ReconciliationItem>> {
    const rows = await tx.item.findMany({
      where: { id: { in: [...itemIds] }, itemType: { in: [ITEM_TYPE.SLAB, ITEM_TYPE.COIL] } },
      select: { id: true, itemCode: true, itemName: true, itemType: true, steelGrade: { select: { steelGradeCode: true } } },
    });
    return new Map(rows.map((r) => [r.id, { id: r.id, itemCode: r.itemCode, itemName: r.itemName, itemType: r.itemType, steelGradeCode: r.steelGrade?.steelGradeCode ?? null }]));
  }

  /** 예약 매수를 ACTIVE 합계로 바꾼다. 읽은 뒤 바뀌었거나 가용이 0 미만이 되면 false */
  async setReservedQty(tx: Tx, itemId: number, beforeQty: number, activeQty: number): Promise<boolean> {
    return (await tx.$queryRawTyped(reconcileInventoryReservedQty(itemId, beforeQty, activeQty))).length > 0;
  }

  /** 규격별 확정(CONFIRMED) 열연 배정 수 (rolling_allocated_qty와 같아야 한다) */
  async countConfirmedRollingAllocations(tx: Tx): Promise<Map<number, number>> {
    const rows = await tx.allocation.findMany({
      where: { allocationPurpose: ALLOCATION_PURPOSE.HOT_ROLLING, allocationStatus: ALLOCATION_STATUS.CONFIRMED },
      select: { lot: { select: { itemId: true } } },
    });
    const counts = new Map<number, number>();
    for (const row of rows) if (row.lot.itemId !== null) counts.set(row.lot.itemId, (counts.get(row.lot.itemId) ?? 0) + 1);
    return counts;
  }

  /** 열연 배정 매수를 확정 열연 배정 수로 바꾼다. 읽은 뒤 바뀌었거나 가용이 0 미만이 되면 false */
  async setRollingAllocatedQty(tx: Tx, itemId: number, beforeQty: number, confirmedQty: number): Promise<boolean> {
    return (await tx.$queryRawTyped(reconcileInventoryRollingQty(itemId, beforeQty, confirmedQty))).length > 0;
  }

  /** 보정 알림을 받을 관리자 (재직 중) */
  async findActiveAdminIds(tx: Tx): Promise<number[]> {
    const rows = await tx.employee.findMany({ where: { isActive: true, role: { roleCode: ROLE.ADMIN } }, select: { id: true }, orderBy: { id: 'asc' } });
    return rows.map((r) => r.id);
  }

  /** 같은 내용의 알림을 아직 읽지 않은 사원 (매일 같은 보정 불가 알림이 쌓이지 않게) */
  async findUnreadRecipients(tx: Tx, recipientIds: readonly number[], notificationType: NotificationType, content: string): Promise<Set<number>> {
    const rows = await tx.notification.findMany({ where: { recipientId: { in: [...recipientIds] }, notificationType, notificationContent: content, readAt: null }, select: { recipientId: true } });
    return new Set(rows.map((r) => r.recipientId));
  }
}
