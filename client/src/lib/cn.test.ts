import { describe, expect, it } from 'vitest';
import { cn } from './cn';

describe('cn', () => {
  it('거짓 값은 빼고 공백으로 잇는다', () => {
    expect(cn('a', false, null, undefined, 'b c')).toBe('a b c');
  });

  it('hover 배경이 둘 이상이면 뒤에 쓴 것만 남긴다 (선택 항목의 hover가 회색에 덮이지 않게)', () => {
    expect(cn('px-4 hover:bg-surface-2', true && 'bg-brand-tint hover:bg-brand-tint-hover')).toBe('px-4 bg-brand-tint hover:bg-brand-tint-hover');
  });

  it('선택되지 않았으면 기본 hover를 그대로 둔다', () => {
    expect(cn('px-4 hover:bg-surface-2', false && 'hover:bg-brand-tint-hover')).toBe('px-4 hover:bg-surface-2');
  });

  it('hover 배경이 아닌 다른 hover·variant 클래스는 건드리지 않는다', () => {
    expect(cn('hover:text-ink hover:bg-surface-2 focus:bg-brand-tint', 'hover:bg-brand-tint-hover')).toBe('hover:text-ink focus:bg-brand-tint hover:bg-brand-tint-hover');
  });
});
