import { PROCESS_TYPE } from '@fantasteel/shared';
import { Prisma } from '../../generated/prisma/client';

/** 검사 기준 코드의 공정 약어. 용어 사전 예(QS-SM355A-HR)와 시드 규칙(ST·CC는 가정값)을 따른다 */
const PROCESS_SUFFIX: Record<string, string> = {
  [PROCESS_TYPE.STEELMAKING]: 'ST',
  [PROCESS_TYPE.CONTINUOUS_CASTING]: 'CC',
  [PROCESS_TYPE.HOT_ROLLING]: 'HR',
};

/** QS-{강종 코드}-{공정 약어} (TRM-110 코드 예, 2026-10-04 결정: 서버가 만든다) */
export function inspectionStandardCodeOf(steelGradeCode: string, processType: string): string {
  return `QS-${steelGradeCode}-${PROCESS_SUFFIX[processType]}`;
}

export interface StandardItemLimits {
  inspectionItemCode: string;
  minValue: Prisma.Decimal | null;
  maxValue: Prisma.Decimal | null;
  thicknessOverMm: Prisma.Decimal | null;
  thicknessUptoMm: Prisma.Decimal | null;
}

/** 두 "초과~이하" 구간이 겹치는가. 빈 쪽은 열린 구간 (quality.md 4장 "적용 항목") */
function rangesOverlap(a: StandardItemLimits, b: StandardItemLimits): boolean {
  const lowerOf = (x: StandardItemLimits) => x.thicknessOverMm;
  const upperOf = (x: StandardItemLimits) => x.thicknessUptoMm;
  const lower = [lowerOf(a), lowerOf(b)].filter((v): v is Prisma.Decimal => v !== null);
  const upper = [upperOf(a), upperOf(b)].filter((v): v is Prisma.Decimal => v !== null);
  if (!lower.length || !upper.length) return true;
  const maxLower = Prisma.Decimal.max(...lower);
  const minUpper = Prisma.Decimal.min(...upper);
  return maxLower.lt(minUpper);
}

/**
 * 항목 검증 (2026-10-04 결정, 문서에 규칙 없음). 문제가 있으면 안내 문장, 없으면 null.
 * - min ≤ max, 두께 초과 < 이하
 * - 같은 항목 코드는 두께 구간이 겹치면 안 된다. 겹치면 한 제품에 기준 두 개가 같이 적용된다(시드는 항복강도 등을 구간별로 나눈다)
 */
export function findStandardItemProblem(items: StandardItemLimits[]): string | null {
  for (const [index, item] of items.entries()) {
    const label = `${index + 1}번째 항목(${item.inspectionItemCode})`;
    if (item.minValue && item.maxValue && item.minValue.gt(item.maxValue)) {
      return `${label}의 최솟값이 최댓값보다 커요`;
    }
    if (item.thicknessOverMm && item.thicknessUptoMm && !item.thicknessOverMm.lt(item.thicknessUptoMm)) {
      return `${label}의 적용 두께 초과 값은 이하 값보다 작아야 해요`;
    }
  }
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      if (items[i].inspectionItemCode === items[j].inspectionItemCode && rangesOverlap(items[i], items[j])) {
        return `${i + 1}번째와 ${j + 1}번째 항목(${items[i].inspectionItemCode})의 적용 두께 구간이 겹쳐요`;
      }
    }
  }
  return null;
}
