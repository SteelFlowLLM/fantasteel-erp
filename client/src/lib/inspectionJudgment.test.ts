import { describe, expect, it } from 'vitest';
import { applicableItems, appliesToThickness, calcCarbonEquivalent, judgeInspection, judgeValue, typicalPassValue } from '@/lib/inspectionJudgment';

const item = (id: number, min: string | null, max: string | null, band: [string | null, string | null] = [null, null], isRequired = true) => ({
  id,
  minValue: min,
  maxValue: max,
  minThicknessMm: band[0],
  maxThicknessMm: band[1],
  isRequired,
});

describe('자동 판정 (REQ-QC-003)', () => {
  it('min/max는 경계 포함(이상·이하)', () => {
    expect(judgeValue(item(1, '490', '630'), '490')).toBe(true);
    expect(judgeValue(item(1, '490', '630'), '630')).toBe(true);
    expect(judgeValue(item(1, '490', '630'), '489.9999')).toBe(false);
    expect(judgeValue(item(1, null, '0.035'), '0.0351')).toBe(false);
    expect(judgeValue(item(1, null, '0.035'), '')).toBeNull();
  });
  it('두께 구간은 초과~이하: 16은 16 이하 구간, 6은 샤르피(6 초과) 대상 아님', () => {
    const upTo16 = item(1, '355', null, [null, '16.00']);
    const over16 = item(2, '345', null, ['16.00', '40.00']);
    const charpy = item(3, '27', null, ['6.00', null]);
    expect(appliesToThickness(upTo16, '16')).toBe(true);
    expect(appliesToThickness(over16, '16')).toBe(false);
    expect(appliesToThickness(over16, '16.01')).toBe(true);
    expect(appliesToThickness(charpy, '6')).toBe(false);
    expect(appliesToThickness(charpy, '9.0')).toBe(true);
    expect(applicableItems([upTo16, over16, charpy], '4.5').map((i) => i.id)).toEqual([1]);
    expect(appliesToThickness(charpy, null)).toBe(false);
  });
  it('필수 누락 → PENDING, 기준 없음 → PENDING, 하나라도 벗어나면 FAIL', () => {
    const items = [item(1, null, '0.25'), item(2, null, '1.40'), item(3, null, '9', [null, null], false)];
    expect(judgeInspection(items, new Map([[1, '0.20']])).result).toBe('PENDING');
    expect(judgeInspection(items, new Map([[1, '0.20'], [2, '1.10']])).result).toBe('PASS');
    expect(judgeInspection(items, new Map([[1, '0.26']])).result).toBe('FAIL');
    expect(judgeInspection(null, new Map()).result).toBe('PENDING');
    expect(judgeInspection([], new Map()).result).toBe('PENDING');
  });
  it('탄소당량·대표값', () => {
    expect(calcCarbonEquivalent({ C: '0.16', Mn: '1.42' })).toBe('0.3967');
    expect(typicalPassValue(item(1, '490', '630'))).toBe('560.000');
    expect(typicalPassValue(item(1, null, '0.25'))).toBe('0.200');
    expect(typicalPassValue(item(1, '27', null))).toBe('29.700');
    expect(typicalPassValue(item(1, null, null))).toBeNull();
  });
});
