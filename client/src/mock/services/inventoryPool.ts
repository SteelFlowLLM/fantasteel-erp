// 규격별 재고 풀: 적격 판정과 예약 가용 (업무 프로세스 4.2·4.3, REQ-INV-003·007·008·009).
import type { AllocationRow, LotRow, MockTables } from '@/mock/schema';
import { productEligibility, type ProductEligibility } from '@/lib/eligibility';
import { reservationAvailableQty } from '@/lib/inventoryMath';

type Tables = Readonly<MockTables>;

export const heatOf = (tables: Tables, lot: LotRow): LotRow | undefined =>
  lot.heatLotId === null ? undefined : tables.lot.find((l) => l.id === lot.heatLotId);

/** 제품(슬래브·코일) LOT의 적격 여부. 히트·원료·용선 LOT은 NOT_AVAILABLE이 아니면 판정만 본다. */
export function lotEligibility(tables: Tables, lot: LotRow): ProductEligibility {
  if (lot.lotType !== 'SLAB' && lot.lotType !== 'COIL') {
    if (lot.lotStatus !== 'AVAILABLE') return 'NOT_AVAILABLE';
    return lot.isPassed === true ? 'ELIGIBLE' : lot.isPassed === false ? 'FAILED' : 'PENDING';
  }
  return productEligibility(lot, heatOf(tables, lot));
}

export const isEligibleLot = (tables: Tables, lot: LotRow): boolean => lotEligibility(tables, lot) === 'ELIGIBLE';

/** 이 규격의 적격(미소진 합격) LOT */
export const eligibleLotsOf = (tables: Tables, itemId: number): LotRow[] =>
  tables.lot.filter((l) => l.itemId === itemId && (l.lotType === 'SLAB' || l.lotType === 'COIL') && isEligibleLot(tables, l));

/** LOT의 CONFIRMED 배정 (LOT당 1건, BP-INV-02) */
export const confirmedAllocationOf = (tables: Tables, lotId: number): AllocationRow | undefined =>
  tables.allocation.find((a) => a.lotId === lotId && a.allocationStatus === 'CONFIRMED');

export const activeReservedQtyOfItem = (tables: Tables, salesOrderItemId: number): number =>
  tables.reservation.filter((r) => r.salesOrderItemId === salesOrderItemId && r.reservationStatus === 'ACTIVE').reduce((sum, r) => sum + r.reservedQty, 0);

export interface ReservationPool {
  itemId: number;
  /** 미소진 합격 제품 매수 */
  eligibleQty: number;
  /** ACTIVE 예약 매수 합계 (= inventory.reserved_qty) */
  activeReservedQty: number;
  /** 열연용 CONFIRMED 배정 매수 (적격 슬래브). 판매 예약과 겹치지 않으므로 모두 "예약으로 커버되지 않는" 배정이다 */
  hotRollingConfirmedQty: number;
  /** 출하용 CONFIRMED 배정 매수 (ACTIVE 예약의 일부라 다시 빼지 않는다) */
  shipmentConfirmedQty: number;
  /** 예약 가용 = 적격 − ACTIVE 예약 − 열연 배정 (4.2). 불변조건상 0 이상 */
  availableQty: number;
}

/**
 * 예약 가용 (4.2). 열연 배정은 생산계획에 연결되고, 열연 추천은 판매 예약 몫을 침범하지 않으므로(BP-INV-01)
 * ACTIVE 예약이 커버하는 열연 배정은 없다 → 열연용 CONFIRMED 배정은 모두 뺀다.
 */
export function reservationPoolOf(tables: Tables, itemId: number): ReservationPool {
  const eligible = eligibleLotsOf(tables, itemId);
  const eligibleIds = new Set(eligible.map((l) => l.id));
  const confirmed = tables.allocation.filter((a) => a.allocationStatus === 'CONFIRMED' && eligibleIds.has(a.lotId));
  const hotRollingConfirmedQty = confirmed.filter((a) => a.allocationPurpose === 'HOT_ROLLING').length;
  const shipmentConfirmedQty = confirmed.filter((a) => a.allocationPurpose === 'SHIPMENT').length;
  const activeReservedQty = tables.reservation.filter((r) => r.itemId === itemId && r.reservationStatus === 'ACTIVE').reduce((sum, r) => sum + r.reservedQty, 0);
  return {
    itemId,
    eligibleQty: eligible.length,
    activeReservedQty,
    hotRollingConfirmedQty,
    shipmentConfirmedQty,
    availableQty: reservationAvailableQty({ eligibleQty: eligible.length, activeReservedQty, uncoveredHotRollingQty: hotRollingConfirmedQty }),
  };
}

/** 배정할 수 있는 LOT (적격 + CONFIRMED 배정 없음) */
export const unallocatedEligibleLotsOf = (tables: Tables, itemId: number): LotRow[] =>
  eligibleLotsOf(tables, itemId).filter((l) => !confirmedAllocationOf(tables, l.id));
