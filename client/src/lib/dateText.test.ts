import { describe, expect, it } from 'vitest';
import { parseDateText } from '@/lib/dateText';

describe('parseDateText', () => {
  it('숫자 8자리를 날짜로 바꾼다', () => {
    expect(parseDateText('20261020')).toBe('2026-10-20');
  });

  it('구분자가 있는 입력도 받는다', () => {
    expect(parseDateText('2026.10.12')).toBe('2026-10-12');
    expect(parseDateText('26-10-12')).toBe('2026-10-12');
    expect(parseDateText('10/12', 2026)).toBe('2026-10-12');
  });

  it('6자리·4자리 입력', () => {
    expect(parseDateText('261012')).toBe('2026-10-12');
    expect(parseDateText('1012', 2027)).toBe('2027-10-12');
  });

  it('없는 날짜와 해석할 수 없는 입력은 null', () => {
    expect(parseDateText('20260230')).toBeNull();
    expect(parseDateText('20261301')).toBeNull();
    expect(parseDateText('abc')).toBeNull();
    expect(parseDateText('')).toBeNull();
    expect(parseDateText('123')).toBeNull();
  });

  it('윤년 2월 29일', () => {
    expect(parseDateText('20280229')).toBe('2028-02-29');
    expect(parseDateText('20270229')).toBeNull();
  });
});
