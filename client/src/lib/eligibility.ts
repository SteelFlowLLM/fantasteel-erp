// 제품 적격 판정 (업무 프로세스 4.3, REQ-INV-003·007).
// 슬래브 = 히트 성분 합격 + 슬래브 검사 합격, 코일 = 상위 히트 성분 합격 + 코일 검사 합격. 미소진(AVAILABLE)이어야 한다.
// 불합격 LOT과 불합격 히트의 하위 LOT은 예약·배정·출고 대상에서 뺀다.
import type { LotStatus } from '@/codes';

/**
 * ELIGIBLE 적격 · PENDING 판정 대기(제품 또는 히트 미판정) · FAILED 제품 불합격 · HEAT_FAILED 상위 히트 불합격
 * · NOT_AVAILABLE 이미 투입 소진·출고됨
 */
export type ProductEligibility = 'ELIGIBLE' | 'PENDING' | 'FAILED' | 'HEAT_FAILED' | 'NOT_AVAILABLE';

export interface EligibilityLot {
  lotStatus: LotStatus;
  /** 검사 판정: null = 판정 대기, true = 합격, false = 불합격 */
  isPassed: boolean | null;
}

export interface EligibilityHeat {
  isPassed: boolean | null;
}

/** 제품(슬래브·코일) LOT의 적격 여부. heat는 lot.heat_lot_id의 히트 LOT (없으면 판정 대기로 본다). */
export function productEligibility(lot: EligibilityLot, heat: EligibilityHeat | null | undefined): ProductEligibility {
  if (lot.lotStatus !== 'AVAILABLE') return 'NOT_AVAILABLE';
  if (lot.isPassed === false) return 'FAILED';
  if (heat?.isPassed === false) return 'HEAT_FAILED';
  if (lot.isPassed === null || !heat || heat.isPassed === null) return 'PENDING';
  return 'ELIGIBLE';
}

/** 불합격 관리 대상인지 (제품 불합격 또는 상위 히트 불합격). 소진·출고 여부와 관계없이 품질만 본다. */
export function isQualityExcluded(lot: Pick<EligibilityLot, 'isPassed'>, heat: EligibilityHeat | null | undefined): boolean {
  return lot.isPassed === false || heat?.isPassed === false;
}
