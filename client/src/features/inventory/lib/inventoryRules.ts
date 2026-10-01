// 재고 화면의 여재·배정 여부·검사 결과 규칙 (순수 함수).
// - 여재: 용어 사전 TRM-048 "수주에 쓰이지 않고 남은 미배정 합격 슬래브", REQ-INV-008, 업무 프로세스 4.3 구현 제안
//   ("이미 다른 수주에 ACTIVE 예약된 매수를 자유 재고로 노출하지 않는다").
// - 배정 여부: REQ-INV-006 ALLOCATION_STATUS (CONFIRMED / CONSUMED = 출고 확정·열연 투입 / RELEASED).
// - 검사 결과: 06 LOT_STATUS "품질은 INSPECTION_RESULT, 배정 여부는 allocation으로 따로 본다".
import type { AllocationPurpose, AllocationStatus } from '@/codes';
import { productEligibility, type EligibilityHeat } from '@/lib/eligibility';
import { compareFifo } from '@/lib/fifo';

/** 여재 후보: 그 규격의 미배정 합격 슬래브 (적격 + CONFIRMED 배정 없음) */
export interface SurplusCandidate {
  lotId: number;
  lotNo: string;
  producedDate: string;
  /** 여재 전환 시각 (core 가정값: 원래 수주에 쓰이지 않게 된 합격 슬래브에만 있다) */
  surplusAt: string | null;
}

const byFifo = (a: SurplusCandidate, b: SurplusCandidate) =>
  compareFifo({ id: a.lotId, lotNo: a.lotNo, producedDate: a.producedDate }, { id: b.lotId, lotNo: b.lotNo, producedDate: b.producedDate });

/**
 * 규격별 여재 슬래브 (선입선출 순).
 * - 여재 = 미배정 합격 슬래브 중 여재로 전환된(surplus_at) LOT. 원래 수주의 예약 몫·코일 계획의 열연 대기 슬래브는 여재가 아니다.
 * - 여재로 다른 수주를 예약하면 그만큼은 "수주에 쓰인" 것이라 여재에서 빠진다 → 여재 매수 = min(여재 전환 LOT 수, 가용재고).
 *   그래서 여재는 늘 가용재고 안에 있다(TRM-055 "여재 포함").
 * - 예약은 매수 단위라 어느 LOT이 예약 몫인지 정해지지 않는다. 배정은 선입선출(오래된 LOT부터)로 쓰이므로
 *   여재로 남는 LOT은 여재 전환 LOT 중 최근 것부터 여재 매수만큼으로 본다(가정값).
 */
export function pickSurplusLots<T extends SurplusCandidate>(candidates: readonly T[], availableQty: number): T[] {
  const converted = candidates.filter((l) => l.surplusAt !== null).sort(byFifo);
  const surplusQty = Math.min(converted.length, Math.max(0, availableQty));
  return surplusQty === 0 ? [] : converted.slice(converted.length - surplusQty);
}

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
