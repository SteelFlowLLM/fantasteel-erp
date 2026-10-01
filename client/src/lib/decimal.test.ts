import { describe, expect, it } from 'vitest';
import { decAdd, decCeilDiv, decCmp, decDiv, decFloorDiv, decMul, decRound, decSub, decSum, floorMulInt, fromUnits, toUnits } from '@/lib/decimal';

describe('십진수 계산', () => {
  it('더하기·빼기·합계는 소수 3자리 정확값', () => {
    expect(decAdd('0.1', '0.2')).toBe('0.300');
    expect(decSub('633.330', '444.445')).toBe('188.885');
    expect(decSum(['1.000', '1.000', '0.500'])).toBe('2.500');
  });
  it('곱하기·나누기는 0.5에서 올림', () => {
    expect(decMul('277.778', '1.6')).toBe('444.445');
    expect(decDiv('250', '0.9')).toBe('277.778');
    expect(decDiv('94.2', '0.98')).toBe('96.122');
    expect(decDiv('-1', '3', 2)).toBe('-0.33');
    expect(() => decDiv('1', '0')).toThrow(RangeError);
  });
  it('비교·올림 나눗셈·내림', () => {
    expect(decCmp('0.050', '0.05')).toBe(0);
    expect(decCmp('-0.28', '0')).toBe(-1);
    expect(decCeilDiv('96.122', '250')).toBe(1);
    expect(decCeilDiv('500', '250')).toBe(2);
    expect(decCeilDiv('500.001', '250')).toBe(3);
    expect(decFloorDiv('245', '23.550')).toBe(10);
    expect(floorMulInt(10, '0.0499')).toBe(0);
    expect(floorMulInt(40, '0.05')).toBe(2);
  });
  it('단위 변환', () => {
    expect(toUnits('23.55', 3)).toBe(23550n);
    expect(fromUnits(-5n, 3)).toBe('-0.005');
    expect(decRound('2.5')).toBe('2.500');
  });
});
