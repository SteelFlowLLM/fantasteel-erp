// 재고 화면의 배정 여부·검사 결과 규칙 (순수 함수).
// - 여재(TRM-048) 고르기는 core 재고 조회가 하도록 `@/lib/surplus`로 옮겼다(재고 화면·대시보드가 같은 숫자를 쓴다).
// - 배정 여부: REQ-INV-006 ALLOCATION_STATUS (CONFIRMED / CONSUMED = 출고 확정·열연 투입 / RELEASED).
// - 검사 결과: 06 LOT_STATUS "품질은 INSPECTION_RESULT, 배정 여부는 allocation으로 따로 본다".
import type { AllocationPurpose, AllocationStatus } from '@/codes';
import { productEligibility, type EligibilityHeat } from '@/lib/eligibility';

export interface AllocationLike {
  id: number;
  allocationPurpose: AllocationPurpose;
  allocationStatus: AllocationStatus;
}

/** LOT의 배정 여부: 해제(RELEASED)되지 않은 마지막 배정 — 배정 확정(CONFIRMED) 또는 소진(CONSUMED). 없으면 null */
export function currentAllocationOf<T extends AllocationLike>(allocations: readonly T[]): T | null {
  return allocations.filter((a) => a.allocationStatus !== 'RELEASED').reduce<T | null>((last, a) => (last === null || a.id > last.id ? a : last), null);
}

/** LOT 목록의 검사 결과: INSPECTION_RESULT + 상위 히트 불합격(HEAT_FAILED, INV-007 제외 이유) */
export type LotInspectionResult = 'PASS' | 'PENDING' | 'FAIL' | 'HEAT_FAILED';

/**
 * 제품(슬래브·코일) LOT의 검사 결과 — 소진·출고 여부와 관계없이 본다.
 * 4.3 적격 판정(제품 검사 + 상위 히트 성분)을 LOT 상태만 빼고 그대로 쓴다. 적격(예약·배정 가능) 여부는 따로 둔다.
 */
export function productInspectionResult(lot: { isPassed: boolean | null }, heat: EligibilityHeat | null | undefined): LotInspectionResult {
  switch (productEligibility({ lotStatus: 'AVAILABLE', isPassed: lot.isPassed }, heat)) {
    case 'ELIGIBLE':
      return 'PASS';
    case 'FAILED':
      return 'FAIL';
    case 'HEAT_FAILED':
      return 'HEAT_FAILED';
    default:
      return 'PENDING';
  }
}

/** 히트 LOT의 검사 결과 (성분 판정) */
export function heatInspectionResult(isPassed: boolean | null): LotInspectionResult {
  return isPassed === true ? 'PASS' : isPassed === false ? 'FAIL' : 'PENDING';
}
