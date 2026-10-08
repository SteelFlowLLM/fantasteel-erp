import { describe, expect, it } from 'vitest';
import { pickCurrentStandard } from '@/lib/inspectionJudgment';
import {
  canChooseCommonStandard,
  canHaveCommonStandard,
  findChangedItemKeys,
  findCurrentStandard,
  findOverlappingItems,
  formatInspectionStandardCode,
  isInThicknessBand,
  countRemovedItems,
  getStandardValueSource,
  formatThicknessBand,
  doThicknessBandsOverlap,
  type ComparableItem,
} from '@/features/inspectionStandards/lib/standardItems';

const buildBand = (minThicknessMm: string | null, maxThicknessMm: string | null) => ({ minThicknessMm, maxThicknessMm });

describe('검사 기준 코드 (TRM-110 예: QS-SM355A-HR)', () => {
  it('강종·공정으로 만든다. 공통 기준은 COMMON', () => {
    expect(formatInspectionStandardCode('SM355A', 'HOT_ROLLING')).toBe('QS-SM355A-HR');
    expect(formatInspectionStandardCode('SS275', 'STEELMAKING')).toBe('QS-SS275-ST');
    expect(formatInspectionStandardCode(null, 'CONTINUOUS_CASTING')).toBe('QS-COMMON-CC');
  });
});

describe('적용 두께 구간 (초과 ~ 이하, REQ-QC-002)', () => {
  it('구간 글자', () => {
    expect(formatThicknessBand(buildBand(null, null))).toBe('전체');
    expect(formatThicknessBand(buildBand('6.00', null))).toBe('6 초과');
    expect(formatThicknessBand(buildBand(null, '16.00'))).toBe('16 이하');
    expect(formatThicknessBand(buildBand('16.00', '40.00'))).toBe('16 초과 40 이하');
  });

  it('경계값: 하한과 같으면 밖, 상한과 같으면 안', () => {
    expect(isInThicknessBand(buildBand('16', '40'), '16')).toBe(false);
    expect(isInThicknessBand(buildBand('16', '40'), '16.01')).toBe(true);
    expect(isInThicknessBand(buildBand('16', '40'), '40')).toBe(true);
    expect(isInThicknessBand(buildBand('16', '40'), '40.01')).toBe(false);
    expect(isInThicknessBand(buildBand('6', null), '6')).toBe(false);
    expect(isInThicknessBand(buildBand(null, null), '250')).toBe(true);
  });

  it('구간 겹침: 맞닿기만 하면 겹치지 않는다', () => {
    expect(doThicknessBandsOverlap(buildBand(null, '16'), buildBand('16', '40'))).toBe(false);
    expect(doThicknessBandsOverlap(buildBand(null, '16'), buildBand('10', '40'))).toBe(true);
    expect(doThicknessBandsOverlap(buildBand(null, null), buildBand('6', null))).toBe(true);
    expect(doThicknessBandsOverlap(buildBand('40', null), buildBand('16', '40'))).toBe(false);
  });

  it('같은 항목 코드끼리만 겹침을 찾는다 (대소문자 무시)', () => {
    const items = [
      { inspectionItemCode: 'YIELD_STRENGTH', ...buildBand(null, '16') },
      { inspectionItemCode: 'YIELD_STRENGTH', ...buildBand('16', '40') },
      { inspectionItemCode: 'yield_strength', ...buildBand('30', null) },
      { inspectionItemCode: 'ELONGATION', ...buildBand(null, null) },
    ];
    expect(findOverlappingItems(items)).toEqual([[1, 2]]);
  });
});

describe('값의 근거와 이전 버전 비교', () => {
  it('연주는 가정값, 제강·열연은 KS', () => {
    expect(getStandardValueSource('CONTINUOUS_CASTING')).toBe('ASSUMED');
    expect(getStandardValueSource('STEELMAKING')).toBe('KS');
    expect(getStandardValueSource('HOT_ROLLING')).toBe('KS');
  });

  it('새로 생기거나 값이 바뀐 항목만 고른다 (자리수 차이는 같은 값)', () => {
    const base: ComparableItem = { inspectionItemCode: 'C', inspectionItemName: '탄소', unit: '%', minValue: null, maxValue: '0.20', isRequired: true, ...buildBand(null, null) };
    const previous = [base, { ...base, inspectionItemCode: 'SI', maxValue: '0.55' }];
    const current = [{ ...base, maxValue: '0.2000' }, { ...base, inspectionItemCode: 'P', maxValue: '0.035' }];
    expect([...findChangedItemKeys(current, previous)]).toEqual(['P||']);
    expect(countRemovedItems(current, previous)).toBe(1);
    expect([...findChangedItemKeys([{ ...base, maxValue: '0.18' }], previous)]).toEqual(['C||']);
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

  it('제강(성분 규격)은 강종 전용 기준만 본다: 공통 제강 기준이 있어도 대신하지 않는다 (REQ-MST-002, TRM-020)', () => {
    const standards = [
      { id: 1, processType: 'STEELMAKING' as const, steelGradeId: null, isCurrent: true },
      { id: 2, processType: 'STEELMAKING' as const, steelGradeId: 7, isCurrent: true },
    ];
    expect(findCurrentStandard(standards, 'STEELMAKING', 7)?.id).toBe(2);
    expect(findCurrentStandard(standards, 'STEELMAKING', 8)).toBeUndefined();
    // 자동 판정(core)이 쓰는 함수도 같은 결과
    expect(pickCurrentStandard(standards, 'STEELMAKING', 8)).toBeUndefined();
    expect(canHaveCommonStandard('STEELMAKING')).toBe(false);
    expect(canHaveCommonStandard('CONTINUOUS_CASTING')).toBe(true);
    // 새 기준 창의 '공통 (모든 강종)' 선택지: 가짜 DB 모드는 제강 말고 보이고, 서버 모드(ERD steel_grade_id NOT NULL)는 늘 숨긴다
    expect(canChooseCommonStandard('', false)).toBe(true);
    expect(canChooseCommonStandard('HOT_ROLLING', false)).toBe(true);
    expect(canChooseCommonStandard('STEELMAKING', false)).toBe(false);
    expect(canChooseCommonStandard('', true)).toBe(false);
    expect(canChooseCommonStandard('HOT_ROLLING', true)).toBe(false);
    expect(canHaveCommonStandard('HOT_ROLLING')).toBe(true);
  });
});
