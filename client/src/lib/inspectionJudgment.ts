// 검사 항목 판정 도우미 (REQ-QC-003, BP-QC-01, 업무 프로세스 10장). 검사 결과 판정(PASS·FAIL·PENDING)은 서버가 한다(server/src/modules/quality/inspection-judge.ts).
// - min/max는 경계값을 포함한다(이상·이하).
// - 적용 두께 구간은 "초과~이하"로 판정한다 (min_thickness_mm 초과, max_thickness_mm 이하). 구간이 없으면 모든 두께에 적용.
import type { ProcessType } from '@/codes';
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

/** 항목 판정: 측정값이 없으면 null, min 이상·max 이하면 true */
export function judgeValue(item: Pick<JudgmentStandardItem, 'minValue' | 'maxValue'>, measuredValue: string | null | undefined): boolean | null {
  if (measuredValue === null || measuredValue === undefined || measuredValue.trim() === '') return null;
  if (item.minValue !== null && decCmp(measuredValue, item.minValue) < 0) return false;
  if (item.maxValue !== null && decCmp(measuredValue, item.maxValue) > 0) return false;
  return true;
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

/**
 * 공정·강종에 쓰는 지금 버전의 검사 기준: 강종 전용 지금 버전 → 없으면 공통 기준(강종 없음).
 * 검사 기준 화면이 이 함수를 쓴다.
 */
export function pickCurrentStandard<T extends { processType: ProcessType; steelGradeId: number | null; isCurrent: boolean }>(
  standards: readonly T[],
  processType: ProcessType,
  steelGradeId: number | null,
): T | undefined {
  const current = standards.filter((s) => s.isCurrent && s.processType === processType);
  return current.find((s) => s.steelGradeId === steelGradeId) ?? (processType === 'STEELMAKING' ? undefined : current.find((s) => s.steelGradeId === null)); // 제강(성분 규격)은 강종별 기준만 (REQ-MST-002, TRM-020)
}
