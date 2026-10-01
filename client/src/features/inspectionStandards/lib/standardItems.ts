// 검사 기준(버전)과 검사 항목을 다루는 순수 함수 (REQ-QC-002, TRM-110·075).
// - 검사 기준 코드: QS-강종-공정 (용어 사전 TRM-110 예: QS-SM355A-HR)
// - 적용 두께 구간: "초과 ~ 이하" (REQ-QC-002). 하한·상한이 비면 그쪽은 제한이 없다.
// - 값의 근거: 연주(슬래브 표면·치수)는 KS에 없어 사내 가정값, 제강·열연은 KS 값 (docs/rework/ks-values.md, PLAN 8-1)
import type { ProcessType } from '@/codes';
import { compareDecimal } from '@/lib/weight';

/** 검사를 하는 공정 (REQ-QC-001: 제강 히트 성분 / 연주 슬래브 표면·치수 / 열연 코일 치수·기계적 성질). 제선은 검사하지 않는다. */
export const INSPECTED_PROCESS_TYPES = ['STEELMAKING', 'CONTINUOUS_CASTING', 'HOT_ROLLING'] as const satisfies readonly ProcessType[];
export type InspectedProcessType = (typeof INSPECTED_PROCESS_TYPES)[number];

export const isInspectedProcess = (processType: ProcessType): processType is InspectedProcessType =>
  (INSPECTED_PROCESS_TYPES as readonly ProcessType[]).includes(processType);

/** 검사 기준 코드의 공정 부분. 열연 HR은 용어 사전 예(QS-SM355A-HR), 제강 SM·연주 CC는 같은 방식의 영문 약어(가정값). */
export const STANDARD_CODE_PROCESS_SUFFIX: Record<InspectedProcessType, string> = {
  STEELMAKING: 'SM',
  CONTINUOUS_CASTING: 'CC',
  HOT_ROLLING: 'HR',
};

/** 공통 기준(강종 없음)의 코드에 쓰는 글자 */
export const COMMON_STANDARD_CODE_PART = 'COMMON';

/** QS-SM355A-HR · QS-COMMON-CC */
export function formatInspectionStandardCode(steelGradeCode: string | null, processType: InspectedProcessType): string {
  return `QS-${steelGradeCode ?? COMMON_STANDARD_CODE_PART}-${STANDARD_CODE_PROCESS_SUFFIX[processType]}`;
}

export interface ThicknessBand {
  /** 하한 (초과). null = 제한 없음 */
  minThicknessMm: string | null;
  /** 상한 (이하). null = 제한 없음 */
  maxThicknessMm: string | null;
}

const trimZeros = (value: string) => (value.includes('.') ? value.replace(/\.?0+$/, '') : value);

/** 적용 두께 구간 표시: '전체' · '6 초과' · '16 이하' · '16 초과 40 이하' (mm) */
export function thicknessBandText(band: ThicknessBand): string {
  const min = band.minThicknessMm ? trimZeros(band.minThicknessMm) : null;
  const max = band.maxThicknessMm ? trimZeros(band.maxThicknessMm) : null;
  if (min && max) return `${min} 초과 ${max} 이하`;
  if (min) return `${min} 초과`;
  if (max) return `${max} 이하`;
  return '전체';
}

/** 두께가 구간 안인지 (초과 ~ 이하) */
export function isInThicknessBand(band: ThicknessBand, thicknessMm: string): boolean {
  if (band.minThicknessMm !== null && compareDecimal(thicknessMm, band.minThicknessMm) <= 0) return false;
  if (band.maxThicknessMm !== null && compareDecimal(thicknessMm, band.maxThicknessMm) > 0) return false;
  return true;
}

/** 두 구간 (a, b]가 겹치는지. 비어 있는 쪽은 끝이 없다. */
export function thicknessBandsOverlap(a: ThicknessBand, b: ThicknessBand): boolean {
  // 겹침 = max(하한) < min(상한). 하한이 없으면 −∞, 상한이 없으면 +∞
  const lower = a.minThicknessMm === null ? b.minThicknessMm : b.minThicknessMm === null ? a.minThicknessMm : compareDecimal(a.minThicknessMm, b.minThicknessMm) >= 0 ? a.minThicknessMm : b.minThicknessMm;
  const upper = a.maxThicknessMm === null ? b.maxThicknessMm : b.maxThicknessMm === null ? a.maxThicknessMm : compareDecimal(a.maxThicknessMm, b.maxThicknessMm) <= 0 ? a.maxThicknessMm : b.maxThicknessMm;
  if (lower === null || upper === null) return true;
  return compareDecimal(lower, upper) < 0;
}

export interface StandardItemLike extends ThicknessBand {
  inspectionItemCode: string;
}

/** 같은 항목 코드끼리 두께 구간이 겹치는 쌍 (앞 행 번호, 뒤 행 번호). 같은 두께에 기준이 두 개면 판정할 수 없다. */
export function findOverlappingItems(items: readonly StandardItemLike[]): [number, number][] {
  const pairs: [number, number][] = [];
  items.forEach((a, i) => {
    items.forEach((b, j) => {
      if (j <= i) return;
      if (a.inspectionItemCode.toUpperCase() !== b.inspectionItemCode.toUpperCase()) return;
      if (thicknessBandsOverlap(a, b)) pairs.push([i, j]);
    });
  });
  return pairs;
}

/** 값의 근거. KS = KS 규격 값(ks-values.md), ASSUMED = KS에 없어 정한 사내 가정값 */
export type StandardValueSource = 'KS' | 'ASSUMED';

/** 연주(슬래브 표면·치수)는 KS 전용 규격이 없어 사내 가정값이다 (ks-values.md 5-1, PLAN 8-1 #1). 제강 성분·열연 기계적 성질·치수는 KS 값. */
export function standardValueSourceOf(processType: ProcessType): StandardValueSource {
  return processType === 'CONTINUOUS_CASTING' ? 'ASSUMED' : 'KS';
}

export interface ComparableItem extends StandardItemLike {
  inspectionItemName: string;
  unit: string | null;
  minValue: string | null;
  maxValue: string | null;
  isRequired: boolean;
}

/** 항목을 구분하는 키: 항목 코드 + 두께 구간 */
export function standardItemKey(item: StandardItemLike): string {
  const part = (value: string | null) => (value === null ? '' : trimZeros(value));
  return `${item.inspectionItemCode.toUpperCase()}|${part(item.minThicknessMm)}|${part(item.maxThicknessMm)}`;
}

const sameDecimal = (a: string | null, b: string | null) => (a === null || b === null ? a === b : compareDecimal(a, b) === 0);

/** 이전 버전과 견주어 새로 생기거나 값이 바뀐 항목의 키 */
export function changedItemKeys(current: readonly ComparableItem[], previous: readonly ComparableItem[]): Set<string> {
  const before = new Map(previous.map((item) => [standardItemKey(item), item]));
  const changed = new Set<string>();
  for (const item of current) {
    const key = standardItemKey(item);
    const old = before.get(key);
    if (
      !old ||
      old.inspectionItemName !== item.inspectionItemName ||
      (old.unit ?? '') !== (item.unit ?? '') ||
      !sameDecimal(old.minValue, item.minValue) ||
      !sameDecimal(old.maxValue, item.maxValue) ||
      old.isRequired !== item.isRequired
    ) {
      changed.add(key);
    }
  }
  return changed;
}

/** 이전 버전에는 있었는데 새 버전에서 빠진 항목 수 */
export function removedItemCount(current: readonly StandardItemLike[], previous: readonly StandardItemLike[]): number {
  const now = new Set(current.map(standardItemKey));
  return previous.filter((item) => !now.has(standardItemKey(item))).length;
}

export interface StandardHeadLike {
  id: number;
  processType: ProcessType;
  steelGradeId: number | null;
  isCurrent: boolean;
}

/** 공정·강종에 쓰는 지금 버전: 강종 전용 기준이 먼저, 없으면 공통 기준(강종 없음) */
export function findCurrentStandard<T extends StandardHeadLike>(standards: readonly T[], processType: ProcessType, steelGradeId: number): T | undefined {
  const current = standards.filter((s) => s.isCurrent && s.processType === processType);
  return current.find((s) => s.steelGradeId === steelGradeId) ?? current.find((s) => s.steelGradeId === null);
}
