import { describe, expect, it } from 'vitest';
import { appliesToThickness, judgeValue, typicalPassValue } from '@/lib/inspectionJudgment';

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
    expect(appliesToThickness(charpy, null)).toBe(false);
  });
  it('대표값', () => {
    expect(typicalPassValue(item(1, '490', '630'))).toBe('560.000');
    expect(typicalPassValue(item(1, null, '0.25'))).toBe('0.200');
    expect(typicalPassValue(item(1, '27', null))).toBe('29.700');
    expect(typicalPassValue(item(1, null, null))).toBeNull();
  });
});
