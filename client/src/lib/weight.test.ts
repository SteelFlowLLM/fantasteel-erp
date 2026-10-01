import { describe, expect, it } from 'vitest';
import { calcHotRollingYieldRate, calcTheoreticalWeightTon, calcWeightTon, compareDecimal, formatDecimal, sumTon } from '@/lib/weight';

describe('calcTheoreticalWeightTon', () => {
  it('업무 프로세스 4.1 예시: 250 × 1,200 × 10,000mm → 23.550t', () => {
    expect(calcTheoreticalWeightTon('250', '1200', '10000')).toBe('23.550');
    expect(calcTheoreticalWeightTon(250, 1200, 10000)).toBe('23.550');
  });

  it('DB 소수 자리 그대로 받아도 같다 (decimal(8,2))', () => {
    expect(calcTheoreticalWeightTon('250.00', '1200.00', '10000.00')).toBe('23.550');
  });

  it('소수 4자리째에서 0.5 올림한다', () => {
    // 250 × 1500 × 10000 × 7.85 ÷ 10^9 = 29.4375
    expect(calcTheoreticalWeightTon('250', '1500', '10000')).toBe('29.438');
    // 220 × 1400 × 9500 × 7.85 ÷ 10^9 = 22.9691
    expect(calcTheoreticalWeightTon('220', '1400', '9500')).toBe('22.969');
  });

  it('소수 두께도 정확히 계산한다 (부동소수 오차 없음)', () => {
    // 2.3 × 1200 × 1065000 × 7.85 ÷ 10^9 = 23.07429
    expect(calcTheoreticalWeightTon('2.3', '1200', '1065000')).toBe('23.074');
    expect(calcTheoreticalWeightTon('9.0', '1400', '227500')).toBe('22.502');
  });

  it('0 이하나 숫자가 아닌 값은 거부한다', () => {
    expect(() => calcTheoreticalWeightTon('0', '1200', '10000')).toThrow(RangeError);
    expect(() => calcTheoreticalWeightTon('-1', '1200', '10000')).toThrow(RangeError);
    expect(() => calcTheoreticalWeightTon('abc', '1200', '10000')).toThrow(RangeError);
    expect(() => calcTheoreticalWeightTon('1e3', '1200', '10000')).toThrow(RangeError);
  });
});

describe('calcWeightTon', () => {
  it('업무 프로세스 4.1 예시: 10매 → 235.500t', () => {
    expect(calcWeightTon(10, '23.550')).toBe('235.500');
  });

  it('0매는 0.000t, 소수·음수 매수는 거부한다', () => {
    expect(calcWeightTon(0, '23.550')).toBe('0.000');
    expect(() => calcWeightTon(1.5, '23.550')).toThrow(RangeError);
    expect(() => calcWeightTon(-1, '23.550')).toThrow(RangeError);
  });
});

describe('sumTon', () => {
  it('소수 3자리로 더한다', () => {
    expect(sumTon(['235.500', '29.438', '0.1'])).toBe('265.038');
    expect(sumTon([])).toBe('0.000');
  });

  it('0.1 + 0.2 같은 부동소수 오차가 없다', () => {
    expect(sumTon(['0.1', '0.2'])).toBe('0.300');
  });
});

describe('calcHotRollingYieldRate', () => {
  it('코일 이론중량 ÷ 슬래브 이론중량, 소수 4자리', () => {
    expect(calcHotRollingYieldRate('23.074', '23.550')).toBe('0.9798');
    expect(calcHotRollingYieldRate('23.550', '23.550')).toBe('1.0000');
  });
});

describe('formatDecimal · compareDecimal', () => {
  it('자리수를 맞춘다', () => {
    expect(formatDecimal('250', 3)).toBe('250.000');
    expect(formatDecimal('0.98', 4)).toBe('0.9800');
    expect(formatDecimal('1.23456', 3)).toBe('1.235');
    expect(formatDecimal('-1.2345', 3)).toBe('-1.235');
  });

  it('크기를 비교한다', () => {
    expect(compareDecimal('23.074', '23.550')).toBe(-1);
    expect(compareDecimal('23.550', '23.55')).toBe(0);
    expect(compareDecimal('29.438', '29.4375')).toBe(1);
  });
});
