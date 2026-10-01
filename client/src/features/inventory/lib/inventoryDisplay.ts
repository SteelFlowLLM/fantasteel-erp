// 재고 화면 표시 규칙 (순수 함수). 표시명은 공통 코드 정의서 값만 쓴다 (INSPECTION_RESULT·ALLOCATION_PURPOSE·DISPOSITION_STATUS·LOT_STATUS).
import {
  ALLOCATION_PURPOSE_LABEL,
  DISPOSITION_STATUS_LABEL,
  INSPECTION_RESULT_LABEL,
  type AllocationPurpose,
  type DispositionStatus,
  type LotStatus,
  type ProductItemType,
} from '@/codes';
import type { BadgeTone } from '@/components/Badge';
import type { ProductEligibility } from '@/lib/eligibility';

/** LOT 목록의 품질 값: 제품은 적격 판정(히트 포함), 히트는 성분 판정, 원료·용선은 null */
export type LotQuality = ProductEligibility | 'PASS' | 'FAIL' | 'PENDING' | null;

export interface QualityDisplay {
  label: string;
  tone: BadgeTone;
  /** 보조 설명 (툴팁) */
  note?: string;
}

/**
 * 품질 결과 표시 (4.3).
 * - 제품: 적격 = 합격, 판정 대기, 불합격, 상위 히트 불합격 = 불합격(히트) — 예약·배정 대상에서 빠진다(INV-007).
 * - 이미 투입 소진·출고된 제품은 판정 결과가 아니라 LOT 상태로 본다 → '—'.
 * - 원료·용선은 검사 대상이 아니다 → null.
 */
export function qualityDisplayOf(quality: LotQuality): QualityDisplay | null {
  switch (quality) {
    case 'ELIGIBLE':
    case 'PASS':
      return { label: INSPECTION_RESULT_LABEL.PASS, tone: 'ok' };
    case 'PENDING':
      return { label: INSPECTION_RESULT_LABEL.PENDING, tone: 'wait' };
    case 'FAILED':
    case 'FAIL':
      return { label: INSPECTION_RESULT_LABEL.FAIL, tone: 'danger' };
    case 'HEAT_FAILED':
      return { label: `${INSPECTION_RESULT_LABEL.FAIL}(히트)`, tone: 'danger', note: '상위 히트가 성분 불합격이라 예약·배정 대상에서 빠졌어요' };
    case 'NOT_AVAILABLE':
    case null:
      return null;
  }
}

/** 배정 여부: CONFIRMED 배정의 목적 (없으면 '미배정') */
export function allocationLabelOf(purpose: AllocationPurpose | null): string {
  return purpose ? `${ALLOCATION_PURPOSE_LABEL[purpose]} 배정` : '미배정';
}

export function lotStatusTone(status: LotStatus): BadgeTone {
  if (status === 'AVAILABLE') return 'run';
  return 'neutral';
}

export function dispositionLabelOf(status: DispositionStatus | null): string | null {
  return status ? DISPOSITION_STATUS_LABEL[status] : null;
}

/** 제품 재고 합계 (유형별 KPI) */
export interface ProductTotals {
  specCount: number;
  onHandQty: number;
  passedQty: number;
  reservedQty: number;
  hotRollingAllocatedQty: number;
  availableQty: number;
}

export interface ProductTotalsInput {
  itemType: ProductItemType;
  onHandQty: number;
  passedQty: number;
  reservedQty: number;
  hotRollingAllocatedQty: number;
  availableQty: number;
}

export function productTotalsOf(rows: readonly ProductTotalsInput[], itemType: ProductItemType): ProductTotals {
  const list = rows.filter((r) => r.itemType === itemType);
  const sum = (pick: (r: ProductTotalsInput) => number) => list.reduce((acc, r) => acc + pick(r), 0);
  return {
    specCount: list.length,
    onHandQty: sum((r) => r.onHandQty),
    passedQty: sum((r) => r.passedQty),
    reservedQty: sum((r) => r.reservedQty),
    hotRollingAllocatedQty: sum((r) => r.hotRollingAllocatedQty),
    availableQty: sum((r) => r.availableQty),
  };
}

/** 모든 값이 0인 규격 줄은 흐리게 보인다 */
export function isEmptyProductRow(row: { onHandQty: number; reservedQty: number; hotRollingAllocatedQty: number }): boolean {
  return row.onHandQty === 0 && row.reservedQty === 0 && row.hotRollingAllocatedQty === 0;
}

/** LOT 번호 검색: 공백을 지우고 대소문자 구분 없이 부분 일치 */
export function matchesLotNo(lotNo: string, query: string): boolean {
  const q = query.replace(/\s+/g, '').toUpperCase();
  if (!q) return true;
  return lotNo.toUpperCase().includes(q);
}
