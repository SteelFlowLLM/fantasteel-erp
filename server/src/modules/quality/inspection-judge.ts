import { Prisma } from '../../generated/prisma/client';

/** 검사 항목 1개의 기준. 성분은 강종 성분 규격, 그 밖은 공정별 검사 항목에서 온다. */
export interface InspectionSpecItem {
  inspectionItemCode: string;
  inspectionItemName: string;
  unit: string | null;
  minValue: Prisma.Decimal | null;
  maxValue: Prisma.Decimal | null;
  isRequired: boolean;
  sortOrder: number;
}

export interface MeasuredInput { inspectionItemCode: string; measuredValue: string | number }

export interface JudgedValue extends InspectionSpecItem {
  measuredValue: Prisma.Decimal | null;
  /** null = 측정하지 않은 선택 항목 */
  isPassed: boolean | null;
}

export type JudgeOutcome =
  | { ok: true; result: 'PASS' | 'FAIL'; values: JudgedValue[] }
  | { ok: false; reason: 'UNKNOWN_ITEM' | 'DUPLICATE_ITEM' | 'MISSING_REQUIRED' | 'NO_LIMIT' | 'NO_SPEC'; itemCodes: string[] };

/** 값 하나의 판정. min/max 경계를 포함한다 (min ≤ 값 ≤ max). */
export function isWithinLimits(value: Prisma.Decimal, minValue: Prisma.Decimal | null, maxValue: Prisma.Decimal | null): boolean {
  return (minValue === null || value.gte(minValue)) && (maxValue === null || value.lte(maxValue));
}

/**
 * 자동 판정 (REQ-QC-003). 모든 필수 항목이 측정돼 있어야 하고, 하나라도 기준을 벗어나면 FAIL.
 * 필수 측정값·기준이 빠져 있으면 판정하지 않는다 (ok = false → 합격으로 저장하지 않음).
 */
export function judgeInspection(spec: InspectionSpecItem[], inputs: MeasuredInput[]): JudgeOutcome {
  if (!spec.length) return { ok: false, reason: 'NO_SPEC', itemCodes: [] };
  const byCode = new Map(spec.map((s) => [s.inspectionItemCode, s]));
  const unknown = inputs.filter((i) => !byCode.has(i.inspectionItemCode)).map((i) => i.inspectionItemCode);
  if (unknown.length) return { ok: false, reason: 'UNKNOWN_ITEM', itemCodes: unknown };
  const seen = new Set<string>();
  const duplicated = inputs.filter((i) => (seen.has(i.inspectionItemCode) ? true : (seen.add(i.inspectionItemCode), false))).map((i) => i.inspectionItemCode);
  if (duplicated.length) return { ok: false, reason: 'DUPLICATE_ITEM', itemCodes: duplicated };
  const missing = spec.filter((s) => s.isRequired && !seen.has(s.inspectionItemCode)).map((s) => s.inspectionItemCode);
  if (missing.length) return { ok: false, reason: 'MISSING_REQUIRED', itemCodes: missing };
  const noLimit = spec.filter((s) => s.isRequired && s.minValue === null && s.maxValue === null).map((s) => s.inspectionItemCode);
  if (noLimit.length) return { ok: false, reason: 'NO_LIMIT', itemCodes: noLimit };

  const measured = new Map(inputs.map((i) => [i.inspectionItemCode, new Prisma.Decimal(i.measuredValue)]));
  const values: JudgedValue[] = [...spec]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.inspectionItemCode.localeCompare(b.inspectionItemCode))
    .map((s) => {
      const v = measured.get(s.inspectionItemCode) ?? null;
      return { ...s, measuredValue: v, isPassed: v === null ? null : isWithinLimits(v, s.minValue, s.maxValue) };
    });
  return { ok: true, result: values.every((v) => v.isPassed !== false) ? 'PASS' : 'FAIL', values };
}

/** 기준 안쪽의 값 (실적 시뮬레이션의 자동 합격값). 양쪽 기준이면 가운데, 한쪽이면 그 기준에서 여유를 둔 값. */
export function passingValue(minValue: Prisma.Decimal | null, maxValue: Prisma.Decimal | null): Prisma.Decimal {
  if (minValue !== null && maxValue !== null) return minValue.add(maxValue).div(2).toDecimalPlaces(4);
  if (maxValue !== null) return (maxValue.gt(0) ? maxValue.mul('0.6') : maxValue.sub(1)).toDecimalPlaces(4);
  if (minValue !== null) return (minValue.gt(0) ? minValue.mul('1.1') : minValue.add(1)).toDecimalPlaces(4);
  return new Prisma.Decimal(0);
}
