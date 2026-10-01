// 검사 자동 판정 (REQ-QC-003, BP-QC-01, 업무 프로세스 10장).
// - min/max는 경계값을 포함한다(이상·이하).
// - 적용 두께 구간은 "초과~이하"로 판정한다 (min_thickness_mm 초과, max_thickness_mm 이하). 구간이 없으면 모든 두께에 적용.
// - 필수 항목 측정값이 비었거나 검사 기준이 없으면 합격으로 처리하지 않고 PENDING(판정 대기).
// - 측정한 항목 하나라도 기준을 벗어나면 FAIL (필수 항목이 비어 있어도 불합격은 불합격이다 — 가정값).
import type { InspectionResult } from '@/codes';
import { decAdd, decCmp, decDiv, decMul } from '@/lib/decimal';

export interface JudgmentStandardItem {
  id: number;
  minValue: string | null;
  maxValue: string | null;
  minThicknessMm: string | null;
  maxThicknessMm: string | null;
  isRequired: boolean;
}

/** 두께 구간(초과~이하)에 드는지. 구간이 있는데 두께를 모르면 적용하지 않는다. */
export function appliesToThickness(item: Pick<JudgmentStandardItem, 'minThicknessMm' | 'maxThicknessMm'>, thicknessMm: string | null): boolean {
  if (item.minThicknessMm === null && item.maxThicknessMm === null) return true;
  if (thicknessMm === null) return false;
  if (item.minThicknessMm !== null && decCmp(thicknessMm, item.minThicknessMm) <= 0) return false;
  if (item.maxThicknessMm !== null && decCmp(thicknessMm, item.maxThicknessMm) > 0) return false;
  return true;
}

/** 이 두께의 제품에 적용할 항목만 */
export const applicableItems = <T extends JudgmentStandardItem>(items: readonly T[], thicknessMm: string | null): T[] =>
  items.filter((item) => appliesToThickness(item, thicknessMm));

/** 항목 판정: 측정값이 없으면 null, min 이상·max 이하면 true */
export function judgeValue(item: Pick<JudgmentStandardItem, 'minValue' | 'maxValue'>, measuredValue: string | null | undefined): boolean | null {
  if (measuredValue === null || measuredValue === undefined || measuredValue.trim() === '') return null;
  if (item.minValue !== null && decCmp(measuredValue, item.minValue) < 0) return false;
  if (item.maxValue !== null && decCmp(measuredValue, item.maxValue) > 0) return false;
  return true;
}

export interface ItemJudgment {
  inspectionStandardItemId: number;
  measuredValue: string | null;
  isPassed: boolean | null;
}

export interface InspectionJudgment {
  result: InspectionResult;
  items: ItemJudgment[];
  /** 비어 있는 필수 항목 id */
  missingRequiredItemIds: number[];
  /** 기준을 벗어난 항목 id */
  failedItemIds: number[];
}

/**
 * 측정값으로 판정한다. items는 이미 두께로 거른 적용 항목이다(없으면 applicableItems로 거른다).
 * items가 null이면 검사 기준이 없는 것 → PENDING.
 */
export function judgeInspection(items: readonly JudgmentStandardItem[] | null, measuredValues: ReadonlyMap<number, string | null>): InspectionJudgment {
  if (items === null || items.length === 0) return { result: 'PENDING', items: [], missingRequiredItemIds: [], failedItemIds: [] };
  const judged = items.map((item) => {
    const measuredValue = measuredValues.get(item.id) ?? null;
    return { item, measuredValue, isPassed: judgeValue(item, measuredValue) };
  });
  const failedItemIds = judged.filter((j) => j.isPassed === false).map((j) => j.item.id);
  const missingRequiredItemIds = judged.filter((j) => j.item.isRequired && j.isPassed === null).map((j) => j.item.id);
  const result: InspectionResult = failedItemIds.length > 0 ? 'FAIL' : missingRequiredItemIds.length > 0 ? 'PENDING' : 'PASS';
  return {
    result,
    items: judged.map((j) => ({ inspectionStandardItemId: j.item.id, measuredValue: j.measuredValue, isPassed: j.isPassed })),
    missingRequiredItemIds,
    failedItemIds,
  };
}

/** 탄소당량 = C + Mn/6 + (Cr+Mo+V)/5 + (Ni+Cu)/15 (ks-values.md 2-2). 모르는 원소는 0으로 본다. 소수 4자리. */
export function calcCarbonEquivalent(elements: { C: string; Mn: string; Cr?: string; Mo?: string; V?: string; Ni?: string; Cu?: string }): string {
  const z = (v: string | undefined) => v ?? '0';
  const crMoV = decAdd(decAdd(z(elements.Cr), z(elements.Mo), 6), z(elements.V), 6);
  const niCu = decAdd(z(elements.Ni), z(elements.Cu), 6);
  const total = decAdd(decAdd(decAdd(elements.C, decDiv(elements.Mn, 6, 8), 8), decDiv(crMoV, 5, 8), 8), decDiv(niCu, 15, 8), 8);
  return decMul(total, '1', 4);
}

/**
 * 기준 안의 대표값 ('기준 안 값으로 채우기' 시연 편의·시드용, 가정값):
 * min·max 모두 있으면 가운데, max만 있으면 max × 0.8, min만 있으면 min × 1.1 (소수 3자리), 둘 다 없으면 null.
 */
export function typicalPassValue(item: Pick<JudgmentStandardItem, 'minValue' | 'maxValue'>): string | null {
  if (item.minValue !== null && item.maxValue !== null) return decDiv(decAdd(item.minValue, item.maxValue, 6), 2, 3);
  if (item.maxValue !== null) return decMul(item.maxValue, '0.8', 3);
  if (item.minValue !== null) return decMul(item.minValue, '1.1', 3);
  return null;
}
