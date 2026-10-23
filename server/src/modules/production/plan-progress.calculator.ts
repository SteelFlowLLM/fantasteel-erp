import { INSPECTION_RESULT, PRODUCTION_PLAN_STATUS, RESERVATION_STATUS, SALES_ORDER_ITEM_STATUS, type InspectionResult, type LotJudgement, type ProductionPlanStatus, type ReproductionCheck, type SalesOrderItemStatus } from '@fantasteel/shared';

// 생산계획 진행·재생산 판단 (업무 프로세스 4.3·4.5, 14.1-6). DB를 읽지 않는 순수 함수.

/** 제품 판정: 자기 불합격이나 상위 히트 불합격이면 FAIL, 둘 다 합격이면 PASS, 나머지는 판정 대기 (REQ-INV-003·007) */
export function productJudgement(own: InspectionResult | null, heat: InspectionResult | null): LotJudgement {
  if (own === INSPECTION_RESULT.FAIL || heat === INSPECTION_RESULT.FAIL) return 'FAIL';
  if (own === INSPECTION_RESULT.PASS && heat === INSPECTION_RESULT.PASS) return 'PASS';
  return 'PENDING';
}

export interface PlanRemainingInput {
  productionPlanStatus: ProductionPlanStatus;
  shortageQty: number;
  passedQty: number;
  /** 계획 규격 제품 중 판정 대기 매수 */
  pendingQty: number;
}

/**
 * 진행 계획 잔여 목표 매수.
 *  - 시작 전·진행중: max(0, 부족 매수 − 합격 매수) (sales-order fulfillment.calculator와 같다)
 *  - 완료: 생산은 끝났지만 판정 대기 제품이 남아 있으면 그 안에서만 남긴다 (검사 중인 제품을 재생산으로 다시 만들지 않게)
 *  - 취소: 0
 */
export function planOpenRemainingQty(plan: PlanRemainingInput): number {
  const open = Math.max(0, plan.shortageQty - plan.passedQty);
  if (plan.productionPlanStatus === PRODUCTION_PLAN_STATUS.PLANNED || plan.productionPlanStatus === PRODUCTION_PLAN_STATUS.IN_PROGRESS) return open;
  if (plan.productionPlanStatus === PRODUCTION_PLAN_STATUS.COMPLETED) return Math.min(open, plan.pendingQty);
  return 0;
}

export interface ReproductionInput {
  salesOrderItemId: number;
  orderedQty: number;
  salesOrderItemStatus: SalesOrderItemStatus;
  reservations: readonly { reservationStatus: string; reservedQty: number }[];
  plans: readonly PlanRemainingInput[];
  /** 같은 규격 재고의 예약 가용 (on_hand − reserved − rolling) */
  reservationAvailableQty: number;
}

/** 4.5 계산값 (수주 번호·계획 목록 같은 표시값은 서비스가 붙인다) */
export type ReproductionNumbers = Pick<ReproductionCheck, 'salesOrderItemId' | 'orderedQty' | 'shippedQty' | 'activeReservedQty' | 'unsecuredQty' | 'openPlanRemainingQty' | 'additionalPlanQty' | 'reservationAvailableQty' | 'reproductionNeedQty'>;

/** 4.5: 미출하 → 현재 미확보 → 추가 계획 필요, 14.1-6: 여재(예약 가용)로도 모자란 만큼만 재생산 */
export function reproductionCheckOf(input: ReproductionInput): ReproductionNumbers {
  const sumOf = (status: string) => input.reservations.filter((r) => r.reservationStatus === status).reduce((sum, r) => sum + r.reservedQty, 0);
  const closed = input.salesOrderItemStatus === SALES_ORDER_ITEM_STATUS.CANCELLED || input.salesOrderItemStatus === SALES_ORDER_ITEM_STATUS.SHIPPED;
  const shippedQty = sumOf(RESERVATION_STATUS.CONVERTED);
  const activeReservedQty = closed ? 0 : sumOf(RESERVATION_STATUS.ACTIVE);
  const unshippedQty = closed ? 0 : Math.max(0, input.orderedQty - shippedQty);
  const unsecuredQty = Math.max(0, unshippedQty - activeReservedQty);
  const openPlanRemainingQty = closed ? 0 : input.plans.reduce((sum, p) => sum + planOpenRemainingQty(p), 0);
  const additionalPlanQty = Math.max(0, unsecuredQty - openPlanRemainingQty);
  const reservationAvailableQty = Math.max(0, input.reservationAvailableQty);
  return {
    salesOrderItemId: input.salesOrderItemId,
    orderedQty: input.orderedQty,
    shippedQty,
    activeReservedQty,
    unsecuredQty,
    openPlanRemainingQty,
    additionalPlanQty,
    reservationAvailableQty,
    reproductionNeedQty: Math.max(0, additionalPlanQty - reservationAvailableQty),
  };
}
