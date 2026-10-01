import { describe, expect, it } from 'vitest';
import { trimNum } from '@/lib/format';

describe('trimNum: 소수 끝의 0 지우기 (측정값·검사 기준 표시)', () => {
  it('시드 값("0.180", "10.000")과 입력한 값("0.18", "10")이 같은 글자가 된다', () => {
    expect(trimNum('0.180')).toBe('0.18');
    expect(trimNum('0.18')).toBe('0.18');
    expect(trimNum('10.000')).toBe('10');
    expect(trimNum('10')).toBe('10');
    expect(trimNum('0.000')).toBe('0');
    expect(trimNum('0')).toBe('0');
  });

  it('소수점 없는 값과 정수부의 0은 그대로 둔다', () => {
    expect(trimNum('100')).toBe('100');
    expect(trimNum('1200')).toBe('1200');
    expect(trimNum('400.0000')).toBe('400');
    expect(trimNum('-0.2500')).toBe('-0.25');
    expect(trimNum('-5.00')).toBe('-5');
    expect(trimNum('0.0450')).toBe('0.045');
  });

  it('값이 없으면 빈 글자', () => {
    expect(trimNum(null)).toBe('');
    expect(trimNum(undefined)).toBe('');
    expect(trimNum('')).toBe('');
  });
});
