import { describe, expect, it } from 'vitest';
import {
  changedItemKeys,
  findCurrentStandard,
  findOverlappingItems,
  formatInspectionStandardCode,
  isInThicknessBand,
  removedItemCount,
  standardValueSourceOf,
  thicknessBandText,
  thicknessBandsOverlap,
  type ComparableItem,
} from '@/features/inspectionStandards/lib/standardItems';

const band = (minThicknessMm: string | null, maxThicknessMm: string | null) => ({ minThicknessMm, maxThicknessMm });

describe('검사 기준 코드 (TRM-110 예: QS-SM355A-HR)', () => {
  it('강종·공정으로 만든다. 공통 기준은 COMMON', () => {
    expect(formatInspectionStandardCode('SM355A', 'HOT_ROLLING')).toBe('QS-SM355A-HR');
    expect(formatInspectionStandardCode('SS275', 'STEELMAKING')).toBe('QS-SS275-ST');
    expect(formatInspectionStandardCode(null, 'CONTINUOUS_CASTING')).toBe('QS-COMMON-CC');
  });
});

describe('적용 두께 구간 (초과 ~ 이하, REQ-QC-002)', () => {
  it('구간 글자', () => {
    expect(thicknessBandText(band(null, null))).toBe('전체');
    expect(thicknessBandText(band('6.00', null))).toBe('6 초과');
    expect(thicknessBandText(band(null, '16.00'))).toBe('16 이하');
    expect(thicknessBandText(band('16.00', '40.00'))).toBe('16 초과 40 이하');
  });

  it('경계값: 하한과 같으면 밖, 상한과 같으면 안', () => {
    expect(isInThicknessBand(band('16', '40'), '16')).toBe(false);
    expect(isInThicknessBand(band('16', '40'), '16.01')).toBe(true);
    expect(isInThicknessBand(band('16', '40'), '40')).toBe(true);
    expect(isInThicknessBand(band('16', '40'), '40.01')).toBe(false);
    expect(isInThicknessBand(band('6', null), '6')).toBe(false);
    expect(isInThicknessBand(band(null, null), '250')).toBe(true);
  });

  it('구간 겹침: 맞닿기만 하면 겹치지 않는다', () => {
    expect(thicknessBandsOverlap(band(null, '16'), band('16', '40'))).toBe(false);
    expect(thicknessBandsOverlap(band(null, '16'), band('10', '40'))).toBe(true);
    expect(thicknessBandsOverlap(band(null, null), band('6', null))).toBe(true);
    expect(thicknessBandsOverlap(band('40', null), band('16', '40'))).toBe(false);
  });

  it('같은 항목 코드끼리만 겹침을 찾는다 (대소문자 무시)', () => {
    const items = [
      { inspectionItemCode: 'YIELD_STRENGTH', ...band(null, '16') },
      { inspectionItemCode: 'YIELD_STRENGTH', ...band('16', '40') },
      { inspectionItemCode: 'yield_strength', ...band('30', null) },
      { inspectionItemCode: 'ELONGATION', ...band(null, null) },
    ];
    expect(findOverlappingItems(items)).toEqual([[1, 2]]);
  });
});

describe('값의 근거와 이전 버전 비교', () => {
  it('연주는 가정값, 제강·열연은 KS', () => {
    expect(standardValueSourceOf('CONTINUOUS_CASTING')).toBe('ASSUMED');
    expect(standardValueSourceOf('STEELMAKING')).toBe('KS');
    expect(standardValueSourceOf('HOT_ROLLING')).toBe('KS');
  });

  it('새로 생기거나 값이 바뀐 항목만 고른다 (자리수 차이는 같은 값)', () => {
    const base: ComparableItem = { inspectionItemCode: 'C', inspectionItemName: '탄소', unit: '%', minValue: null, maxValue: '0.20', isRequired: true, ...band(null, null) };
    const previous = [base, { ...base, inspectionItemCode: 'SI', maxValue: '0.55' }];
    const current = [{ ...base, maxValue: '0.2000' }, { ...base, inspectionItemCode: 'P', maxValue: '0.035' }];
    expect([...changedItemKeys(current, previous)]).toEqual(['P||']);
    expect(removedItemCount(current, previous)).toBe(1);
    expect([...changedItemKeys([{ ...base, maxValue: '0.18' }], previous)]).toEqual(['C||']);
  });
});

describe('지금 버전 찾기', () => {
  it('강종 전용 기준이 먼저, 없으면 공통 기준', () => {
    const standards = [
      { id: 1, processType: 'HOT_ROLLING' as const, steelGradeId: null, isCurrent: true },
      { id: 2, processType: 'HOT_ROLLING' as const, steelGradeId: 7, isCurrent: false },
      { id: 3, processType: 'HOT_ROLLING' as const, steelGradeId: 7, isCurrent: true },
    ];
    expect(findCurrentStandard(standards, 'HOT_ROLLING', 7)?.id).toBe(3);
    expect(findCurrentStandard(standards, 'HOT_ROLLING', 8)?.id).toBe(1);
    expect(findCurrentStandard(standards, 'STEELMAKING', 7)).toBeUndefined();
  });
});
