import { describe, expect, it } from 'vitest';
import { hasBatchim, withEulReul, withEunNeun, withGwaWa, withIGa } from '@/lib/josa';

describe('조사 붙이기', () => {
  it('받침에 따라 고른다', () => {
    expect(withEulReul('이름')).toBe('이름을');
    expect(withEulReul('사원번호')).toBe('사원번호를');
    expect(withEunNeun('부서')).toBe('부서는');
    expect(withEunNeun('직급')).toBe('직급은');
    expect(withIGa('강종')).toBe('강종이');
    expect(withIGa('야드')).toBe('야드가');
    expect(withGwaWa('부서')).toBe('부서와');
  });

  it('숫자·영문 약어·괄호 끝', () => {
    expect(hasBatchim('SM355')).toBe(false); // 오
    expect(hasBatchim('250')).toBe(true); // 영
    expect(withEunNeun('MRP')).toBe('MRP는');
    expect(withIGa('탄소당량(Ceq)')).toBe('탄소당량(Ceq)가');
  });
});
