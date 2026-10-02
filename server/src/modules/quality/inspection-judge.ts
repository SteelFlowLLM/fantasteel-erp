import type { Prisma } from '../../generated/prisma/client';

type Decimal = Prisma.Decimal;

export interface ThicknessRange {
  thicknessOverMm: Decimal | null;
  thicknessUptoMm: Decimal | null;
}

/**
 * 이 두께의 제품에 적용되는 항목인가 (quality.md 4장 "적용 항목", REQ-QC-002).
 * 구간은 "초과~이하"이고 빈 쪽은 열린 구간이다. 두께가 없는 히트에는 구간 없는 항목만 적용된다.
 */
export function isItemApplicable(range: ThicknessRange, thicknessMm: Decimal | null): boolean {
  const { thicknessOverMm: over, thicknessUptoMm: upto } = range;
  if (over === null && upto === null) return true;
  if (thicknessMm === null) return false;
  if (over !== null && !thicknessMm.gt(over)) return false;
  if (upto !== null && thicknessMm.gt(upto)) return false;
  return true;
}

/** 항목 판정: min 이상·max 이하면 합격 (경계 포함, REQ-QC-003). 측정값이 없으면 null(미입력) */
export function judgeMeasuredValue(
  limits: { minValue: Decimal | null; maxValue: Decimal | null },
  measuredValue: Decimal | null,
): boolean | null {
  if (measuredValue === null) return null;
  if (limits.minValue !== null && measuredValue.lt(limits.minValue)) return false;
  if (limits.maxValue !== null && measuredValue.gt(limits.maxValue)) return false;
  return true;
}
