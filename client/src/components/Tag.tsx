// 작은 꼬리표 (옛 hl-tag · hl-role). brand = 역할 표시. 부서장 표시는 역할처럼 보이지 않게 outline을 쓴다.
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type TagTone = 'neutral' | 'brand' | 'outline' | 'run';

const TONE: Record<TagTone, string> = {
  neutral: 'bg-surface-3 text-ink-2 font-medium',
  brand: 'bg-brand-tint text-brand font-semibold',
  outline: 'bg-surface text-ink-2 font-medium shadow-[inset_0_0_0_1px_var(--color-line-strong)]',
  run: 'bg-run-bg text-run font-semibold',
};

export interface TagProps {
  tone?: TagTone;
  /** sm = 16px 높이 (이름 옆 작은 표시) */
  size?: 'sm' | 'md';
  title?: string;
  className?: string;
  children: ReactNode;
}

export function Tag({ tone = 'neutral', size = 'md', title, className, children }: TagProps) {
  return (
    <span
      title={title}
      className={cn('inline-flex items-center whitespace-nowrap rounded-xs', size === 'sm' ? 'h-4 px-1 text-[10px]' : 'h-5 px-1.5 text-cap', TONE[tone], className)}
    >
      {children}
    </span>
  );
}
