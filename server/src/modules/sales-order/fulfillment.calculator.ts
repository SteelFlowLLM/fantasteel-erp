import {
  PRODUCTION_PLAN_STATUS,
  RESERVATION_STATUS,
  SALES_ORDER_ITEM_STATUS,
  type ProductionPlanStatus,
  type ProgressMeasure,
  type ReservationStatus,
  type SalesOrderItemStatus,
} from '@fantasteel/shared';

// 수주 충족 현황 계산 (업무 프로세스 4.5, REQ-SO-004·005). DB를 읽지 않는 순수 함수라 단위 테스트로 검증한다.

export interface PlanProgressInput {
  productionPlanStatus: ProductionPlanStatus;
  shortageQty: number;
  /** 이 계획에서 나온 합격(적격) 제품 매수 */
  passedQty: number;
}

/**
 * 진행 계획 잔여 목표 매수. 4.5에 계산법이 없어 정했다(docs/backend/sales-order.md 8장 🟡):
 * 시작 전·진행중 계획만 max(0, 부족 매수 − 합격 제품 매수), 완료·취소 계획은 0.
 * 합격 제품은 자동 예약으로 ACTIVE 예약에 들어가므로 여기서 빼야 미확보 매수와 겹치지 않는다.
 */
export function planRemainingTargetQty(plan: PlanProgressInput): number {
  if (plan.productionPlanStatus !== PRODUCTION_PLAN_STATUS.PLANNED && plan.productionPlanStatus !== PRODUCTION_PLAN_STATUS.IN_PROGRESS) return 0;
  return Math.max(0, plan.shortageQty - plan.passedQty);
}

export function progressOf(qty: number, denominatorQty: number): ProgressMeasure {
  return { qty, denominatorQty, ratio: denominatorQty > 0 ? Math.min(1, Math.max(0, qty / denominatorQty)) : null };
}

/** 'YYYY-MM-DD' 두 날짜의 차이(일): to − from */
export function daysBetween(from: string, to: string): number {
  const utc = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
  return Math.round((utc(to) - utc(from)) / 86_400_000);
}

/** 납기 위험 (TRM-107): 납기까지 남은 일수 ≤ 기준일이고 아직 출하할 매수가 있다. 취소·출하완료는 위험 아님 */
export function isDueRisk(input: { dueDate: string; today: string; deliveryRiskDays: number; unshippedQty: number; salesOrderItemStatus: SalesOrderItemStatus }): boolean {
  if (input.salesOrderItemStatus === SALES_ORDER_ITEM_STATUS.CANCELLED || input.salesOrderItemStatus === SALES_ORDER_ITEM_STATUS.SHIPPED) return false;
  if (input.unshippedQty <= 0) return false;
  return daysBetween(input.today, input.dueDate) <= input.deliveryRiskDays;
}

/** 수주 헤더 상태 (저장하지 않음): 전부 취소면 취소, 남은 품목이 전부 출하완료면 출하완료, 출하가 하나라도 있으면 부분출하 */
export function salesOrderStatusOf(itemStatuses: readonly SalesOrderItemStatus[]): SalesOrderItemStatus {
  const live = itemStatuses.filter((s) => s !== SALES_ORDER_ITEM_STATUS.CANCELLED);
  if (itemStatuses.length > 0 && live.length === 0) return SALES_ORDER_ITEM_STATUS.CANCELLED;
  if (live.length > 0 && live.every((s) => s === SALES_ORDER_ITEM_STATUS.SHIPPED)) return SALES_ORDER_ITEM_STATUS.SHIPPED;
  if (live.some((s) => s === SALES_ORDER_ITEM_STATUS.SHIPPED || s === SALES_ORDER_ITEM_STATUS.PARTIALLY_SHIPPED)) return SALES_ORDER_ITEM_STATUS.PARTIALLY_SHIPPED;
  return SALES_ORDER_ITEM_STATUS.OPEN;
}

export interface ItemFulfillmentInput {
  orderedQty: number;
  salesOrderItemStatus: SalesOrderItemStatus;
  dueDate: string;
  reservations: readonly { reservationStatus: ReservationStatus | string; reservedQty: number }[];
  plans: readonly PlanProgressInput[];
  today: string;
  deliveryRiskDays: number;
}

export interface ItemFulfillmentNumbers {
  shippedQty: number;
  unshippedQty: number;
  activeReservedQty: number;
  passedQty: number;
  inProductionQty: number;
  plannedQty: number;
  unsecuredQty: number;
  additionalPlanQty: number;
  isDueRisk: boolean;
  progress: ProgressMeasure;
}

/**
 * 품목 충족 현황. 화면 문구 "진행률 = 출하 ÷ 수주 매수, 검사합격 = 예약 + 출하"와 같은 식이다.
 *   미출하 = 주문 − 출하(CONVERTED 합계), 미확보 = max(0, 미출하 − ACTIVE 예약), 추가 계획 필요 = max(0, 미확보 − 진행 계획 잔여 목표)
 * 취소 품목은 출하 외 모든 값이 0이다 (예약은 해제됐고 계획은 취소·해제됐다).
 */
export function calcItemFulfillment(input: ItemFulfillmentInput): ItemFulfillmentNumbers {
  const sumOf = (status: ReservationStatus) => input.reservations.filter((r) => r.reservationStatus === status).reduce((sum, r) => sum + r.reservedQty, 0);
  const shippedQty = sumOf(RESERVATION_STATUS.CONVERTED);
  const cancelled = input.salesOrderItemStatus === SALES_ORDER_ITEM_STATUS.CANCELLED;
  const activeReservedQty = cancelled ? 0 : sumOf(RESERVATION_STATUS.ACTIVE);
  const unshippedQty = cancelled ? 0 : Math.max(0, input.orderedQty - shippedQty);
  const remainingOf = (status: ProductionPlanStatus) =>
    cancelled ? 0 : input.plans.filter((p) => p.productionPlanStatus === status).reduce((sum, p) => sum + planRemainingTargetQty(p), 0);
  const inProductionQty = remainingOf(PRODUCTION_PLAN_STATUS.IN_PROGRESS);
  const plannedQty = remainingOf(PRODUCTION_PLAN_STATUS.PLANNED);
  const unsecuredQty = Math.max(0, unshippedQty - activeReservedQty);
  return {
    shippedQty,
    unshippedQty,
    activeReservedQty,
    passedQty: activeReservedQty + shippedQty,
    inProductionQty,
    plannedQty,
    unsecuredQty,
    additionalPlanQty: Math.max(0, unsecuredQty - inProductionQty - plannedQty),
    isDueRisk: isDueRisk({ dueDate: input.dueDate, today: input.today, deliveryRiskDays: input.deliveryRiskDays, unshippedQty, salesOrderItemStatus: input.salesOrderItemStatus }),
    progress: progressOf(shippedQty, input.orderedQty),
  };
}
