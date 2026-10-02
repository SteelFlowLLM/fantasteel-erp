import { INSPECTION_RESULT, type InspectionResult } from '@fantasteel/shared';
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

export interface JudgedItem {
  id: number;
  minValue: Decimal | null;
  maxValue: Decimal | null;
  isRequired: boolean;
}

export interface InspectionJudgement {
  inspectionResult: InspectionResult;
  /** 기준을 벗어난 항목 */
  failedItemIds: number[];
  /** 측정값이 없는 필수 항목 */
  missingRequiredItemIds: number[];
}

/**
 * 검사 판정 (REQ-QC-003, quality.md 4장). 적용 항목만 넘긴다.
 * 벗어난 측정값이 하나라도 있으면 FAIL. 값을 더 넣어도 합격이 될 수 없기 때문이다(quality.md 8장 판정 우선순위, 2026-10-02 결정).
 * 그다음 필수 항목에 값이 없으면 PENDING (누락은 합격으로 처리하지 않음, BP-QC-01). 나머지는 PASS.
 * 적용 항목이 하나도 없으면 기준 누락이므로 PENDING이다.
 */
export function judgeInspection(items: JudgedItem[], measuredByItemId: Map<number, Decimal>): InspectionJudgement {
  if (!items.length) return { inspectionResult: INSPECTION_RESULT.PENDING, failedItemIds: [], missingRequiredItemIds: [] };
  const failedItemIds: number[] = [];
  const missingRequiredItemIds: number[] = [];
  for (const item of items) {
    const isPassed = judgeMeasuredValue(item, measuredByItemId.get(item.id) ?? null);
    if (isPassed === false) failedItemIds.push(item.id);
    if (isPassed === null && item.isRequired) missingRequiredItemIds.push(item.id);
  }
  const inspectionResult = failedItemIds.length
    ? INSPECTION_RESULT.FAIL
    : missingRequiredItemIds.length
      ? INSPECTION_RESULT.PENDING
      : INSPECTION_RESULT.PASS;
  return { inspectionResult, failedItemIds, missingRequiredItemIds };
}
