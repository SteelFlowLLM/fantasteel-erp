// 불변조건 점검 (BP-INV-02, ERD CHECK·unique 메모). 테스트와 (P2) 정합성 보정 화면이 쓴다. 위반 문장 목록을 돌려준다(없으면 []).
import { decCmp, decSub } from '@/lib/decimal';
import type { MockTables } from '@/mock/schema';
import { lotEligibility, reservationPoolOf } from '@/mock/services/inventoryPool';

export function checkInvariants(tables: Readonly<MockTables>): string[] {
  const problems: string[] = [];
  for (const item of tables.item.filter((i) => i.itemType !== 'RAW_MATERIAL')) {
    const active = tables.reservation.filter((r) => r.itemId === item.id && r.reservationStatus === 'ACTIVE').reduce((s, r) => s + r.reservedQty, 0);
    const onHand = tables.lot.filter((l) => l.itemId === item.id && l.lotStatus === 'AVAILABLE').length;
    const row = tables.inventory.find((r) => r.itemId === item.id);
    if ((row?.reservedQty ?? 0) !== active) problems.push(`${item.itemCode}: reserved_qty ${row?.reservedQty ?? 0} ≠ ACTIVE 예약 ${active}`);
    if ((row?.onHandQty ?? 0) !== onHand) problems.push(`${item.itemCode}: on_hand_qty ${row?.onHandQty ?? 0} ≠ 미소진 LOT ${onHand}`);
    if ((row?.reservedQty ?? 0) > (row?.onHandQty ?? 0)) problems.push(`${item.itemCode}: reserved_qty > on_hand_qty`);
    const pool = reservationPoolOf(tables, item.id);
    if (pool.availableQty < 0) problems.push(`${item.itemCode}: 예약 가용 ${pool.availableQty} < 0`);
  }
  const confirmedByLot = new Map<number, number>();
  for (const a of tables.allocation.filter((x) => x.allocationStatus === 'CONFIRMED')) {
    confirmedByLot.set(a.lotId, (confirmedByLot.get(a.lotId) ?? 0) + 1);
    const lot = tables.lot.find((l) => l.id === a.lotId);
    if (!lot || lot.lotStatus !== 'AVAILABLE') problems.push(`배정 ${a.id}: 미소진 LOT이 아님`);
    else if (lotEligibility(tables, lot) !== 'ELIGIBLE') problems.push(`배정 ${a.id}: 적격 LOT이 아님 (${lot.lotNo})`);
  }
  for (const [lotId, count] of confirmedByLot) if (count > 1) problems.push(`LOT ${lotId}: CONFIRMED 배정 ${count}건`);
  for (const soItem of tables.salesOrderItem) {
    const active = tables.reservation.filter((r) => r.salesOrderItemId === soItem.id && r.reservationStatus === 'ACTIVE').reduce((s, r) => s + r.reservedQty, 0);
    const converted = tables.reservation.filter((r) => r.salesOrderItemId === soItem.id && r.reservationStatus === 'CONVERTED').reduce((s, r) => s + r.reservedQty, 0);
    const shipmentAllocated = tables.allocation.filter((a) => a.salesOrderItemId === soItem.id && a.allocationPurpose === 'SHIPMENT' && a.allocationStatus === 'CONFIRMED').length;
    if (converted !== soItem.shippedQty) problems.push(`수주 품목 ${soItem.id}: CONVERTED ${converted} ≠ shipped_qty ${soItem.shippedQty}`);
    if (active + soItem.shippedQty > soItem.orderedQty) problems.push(`수주 품목 ${soItem.id}: 예약+출고 > 수주 매수`);
    if (shipmentAllocated > active) problems.push(`수주 품목 ${soItem.id}: 출하 배정 ${shipmentAllocated} > ACTIVE 예약 ${active}`);
  }
  for (const lot of tables.lot) {
    if (lot.remainingTon !== null && decCmp(lot.remainingTon, 0) < 0) problems.push(`${lot.lotNo}: 잔량 음수`);
  }
  for (const line of tables.purchaseOrderItem) {
    if (decCmp(line.scheduledReceiptTon, decSub(line.orderedTon, line.receivedTon)) !== 0) problems.push(`발주 품목 ${line.id}: 입고예정 ≠ 발주 − 입고`);
  }
  const millSheetKeys = tables.millSheet.map((m) => `${m.shipmentRequestId}:${m.salesOrderId}`);
  if (new Set(millSheetKeys).size !== millSheetKeys.length) problems.push('밀시트: 출하요청 × 수주 중복');
  const lotNos = tables.lot.map((l) => l.lotNo);
  if (new Set(lotNos).size !== lotNos.length) problems.push('LOT 번호 중복');
  const relationKeys = tables.lotRelation.map((r) => `${r.parentLotId}:${r.childLotId}`);
  if (new Set(relationKeys).size !== relationKeys.length) problems.push('LOT 관계 중복');
  return problems;
}
