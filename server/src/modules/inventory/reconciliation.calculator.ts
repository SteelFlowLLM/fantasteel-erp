import { RECONCILIATION_STATUS, type ReconciliationStatus, type ReservationReconciliationRow } from '@fantasteel/shared';

export interface InventoryQtyRow {
  itemId: number;
  onHandQty: number;
  reservedQty: number;
  rollingAllocatedQty: number;
}

export interface ReconciliationItem {
  id: number;
  itemCode: string;
  itemName: string;
  itemType: string;
  steelGradeCode: string | null;
}

/**
 * 정합성 보정 판단 (REQ-INV-010, BP-INV-02 P2). 재고 행이 있거나 ACTIVE 예약이 있는 규격마다 비교한다.
 * - 같으면 일치. 다르면 예약 매수를 ACTIVE 합계로 맞춘다(불일치 → 보정함).
 * - 예약을 지워서 맞추지 않는다([04] BP-INV-02 구현 제안). 그래서 ACTIVE 합계가 재고 − 열연 배정을 넘거나(가용 CHECK) 재고 행이 없으면 보정 불가.
 */
export function reconciliationRows(inventories: readonly InventoryQtyRow[], activeSums: ReadonlyMap<number, number>, items: ReadonlyMap<number, ReconciliationItem>): ReservationReconciliationRow[] {
  const byItem = new Map(inventories.map((row) => [row.itemId, row]));
  const itemIds = [...new Set([...byItem.keys(), ...[...activeSums].filter(([, qty]) => qty > 0).map(([itemId]) => itemId)])];
  return itemIds
    .map((itemId) => {
      const inventory = byItem.get(itemId) ?? null;
      const active = activeSums.get(itemId) ?? 0;
      const item = items.get(itemId);
      const onHandQty = inventory?.onHandQty ?? 0;
      const rollingAllocatedQty = inventory?.rollingAllocatedQty ?? 0;
      const { status, reason } = judge(inventory, active);
      return {
        itemId,
        itemCode: item?.itemCode ?? `#${itemId}`,
        itemName: item?.itemName ?? '',
        itemType: item?.itemType ?? '',
        steelGradeCode: item?.steelGradeCode ?? null,
        inventoryReservedQty: inventory?.reservedQty ?? null,
        activeReservedQty: active,
        differenceQty: (inventory?.reservedQty ?? 0) - active,
        onHandQty,
        rollingAllocatedQty,
        status,
        reason,
      };
    })
    .sort((a, b) => a.itemCode.localeCompare(b.itemCode));
}

function judge(inventory: InventoryQtyRow | null, active: number): { status: ReconciliationStatus; reason: string | null } {
  if (!inventory) return { status: RECONCILIATION_STATUS.UNFIXABLE, reason: `ACTIVE 예약 ${active}매가 있는데 재고 행이 없어요. 재고 행이 생긴 뒤에 맞출 수 있어요` };
  if (inventory.reservedQty === active) return { status: RECONCILIATION_STATUS.MATCHED, reason: null };
  const room = inventory.onHandQty - inventory.rollingAllocatedQty;
  if (active > room) {
    return {
      status: RECONCILIATION_STATUS.UNFIXABLE,
      reason: `ACTIVE 예약 합계 ${active}매가 재고 ${inventory.onHandQty}매 − 열연 배정 ${inventory.rollingAllocatedQty}매(${room}매)를 넘어요. 예약은 지우지 않으니 수주·재고를 확인해 주세요`,
    };
  }
  return { status: RECONCILIATION_STATUS.MISMATCHED, reason: null };
}
