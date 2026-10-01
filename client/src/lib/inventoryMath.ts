// 예약 가용·재고 우선 예약·수주 부족 계산 (업무 프로세스 4.2·4.5, REQ-SO-003, REQ-INV-008·009).

export interface ReservationPoolInput {
  /** 미소진 합격(적격) 제품 매수 */
  eligibleQty: number;
  /** ACTIVE 예약 매수 합계 */
  activeReservedQty: number;
  /** ACTIVE 예약으로 커버되지 않는 열연용 CONFIRMED 배정 매수 */
  uncoveredHotRollingQty: number;
}

/**
 * 예약 가용 매수 = 미소진 합격 제품 매수 − ACTIVE 예약 매수 − ACTIVE 예약으로 커버되지 않는 열연용 CONFIRMED 배정 매수 (4.2).
 * 불변조건(BP-INV-02)상 0 이상이어야 한다. 음수면 그대로 돌려주어 호출한 쪽이 보정하게 한다.
 */
export function reservationAvailableQty(input: ReservationPoolInput): number {
  return input.eligibleQty - input.activeReservedQty - input.uncoveredHotRollingQty;
}

/** 재고 우선 예약 (REQ-SO-003): 예약 = min(수주 매수, 가용), 부족 = 나머지. 부분 예약 허용. */
export function stockFirstSplit(orderedQty: number, availableQty: number): { reserveQty: number; shortageQty: number } {
  if (!Number.isInteger(orderedQty) || orderedQty < 1) throw new RangeError(`수주 매수는 1 이상의 정수여야 해요: ${orderedQty}`);
  const reserveQty = Math.min(orderedQty, Math.max(0, Math.floor(availableQty)));
  return { reserveQty, shortageQty: orderedQty - reserveQty };
}

export interface ShortageInput {
  orderedQty: number;
  /** 누적 출고 확정 매수 (sales_order_item.shipped_qty) */
  shippedQty: number;
  activeReservedQty: number;
  /** 같은 수주 품목의 진행 계획(시작 전·진행중) 잔여 목표 매수 */
  openPlanRemainingQty: number;
}

export interface Shortage {
  /** 미출하 매수 = 수주 매수 − 누적 출고 확정 매수 */
  unshippedQty: number;
  /** 현재 미확보 매수 = max(0, 미출하 − ACTIVE 예약) */
  unsecuredQty: number;
  /** 추가 계획 필요 매수 = max(0, 현재 미확보 − 진행 계획 잔여 목표) */
  additionalPlanQty: number;
}

/** 수주 부족 (업무 프로세스 4.5). 단계를 더해 수주보다 큰 "충족 매수"를 만들지 않는다. */
export function shortageOf(input: ShortageInput): Shortage {
  const unshippedQty = Math.max(0, input.orderedQty - input.shippedQty);
  const unsecuredQty = Math.max(0, unshippedQty - input.activeReservedQty);
  const additionalPlanQty = Math.max(0, unsecuredQty - Math.max(0, input.openPlanRemainingQty));
  return { unshippedQty, unsecuredQty, additionalPlanQty };
}

/**
 * 재생산 필요 매수 (REQ-PRD-006, 14.1-6): 추가 계획 필요 매수에서 지금 예약할 수 있는 여재(예약 가용)를 먼저 뺀다.
 * 여재로도 부족하고 진행 계획도 없을 때만 0보다 크다.
 */
export function reproductionNeedQty(additionalPlanQty: number, reservationAvailable: number): number {
  return Math.max(0, additionalPlanQty - Math.max(0, reservationAvailable));
}

/** 진행률 하나. 분모를 함께 둔다 (4.5 "지표의 포함 관계와 진행률 분모를 명시") */
export interface ProgressMeasure {
  qty: number;
  denominatorQty: number;
  /** 0~1. 분모가 0이면 null */
  ratio: number | null;
}

export function progressOf(qty: number, denominatorQty: number): ProgressMeasure {
  return { qty, denominatorQty, ratio: denominatorQty > 0 ? Math.min(1, Math.max(0, qty / denominatorQty)) : null };
}
