import { badInput } from '../../common/errors/app.exception';

/** 검사 항목 기준값 규칙: min·max 중 하나는 있어야 하고, 둘 다 있으면 min ≤ max (경계 포함). REQ-QC-002 */
export function validateInspectionRange(minValue: number | null | undefined, maxValue: number | null | undefined): void {
  const min = minValue ?? null;
  const max = maxValue ?? null;
  if (min === null && max === null) throw badInput('최소값·최대값 중 하나는 입력해 주세요');
  if (min !== null && max !== null && min > max) throw badInput('최소값이 최대값보다 클 수 없습니다');
}
