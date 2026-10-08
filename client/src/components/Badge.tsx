// 상태 배지 (옛 hl-badge). 앞에 점이 붙는다. outline은 점 없이 테두리만.
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type BadgeTone = 'neutral' | 'ok' | 'run' | 'wait' | 'danger' | 'ai' | 'outline' | 'solid-danger';

const TONE: Record<BadgeTone, string> = {
  neutral: 'bg-surface-3 text-ink-2',
  ok: 'bg-ok-bg text-ok',
  run: 'bg-run-bg text-run',
  wait: 'bg-wait-bg text-wait',
  danger: 'bg-danger-bg text-danger',
  ai: 'bg-ai-bg text-ai-strong',
  outline: 'bg-surface text-ink-2 shadow-[inset_0_0_0_1px_var(--color-line-strong)]',
  'solid-danger': 'bg-danger text-white',
};

const DOT = "before:size-1.5 before:flex-none before:rounded-full before:bg-current before:content-['']";

export interface BadgeProps {
  tone?: BadgeTone;
  /** 앞의 점을 뺀다 */
  plain?: boolean;
  title?: string;
  className?: string;
  children: ReactNode;
}

export function Badge({ tone = 'neutral', plain, title, className, children }: BadgeProps) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex min-h-5 items-center gap-[5px] whitespace-nowrap rounded-xs px-[7px] text-xs font-semibold',
        TONE[tone],
        !plain && tone !== 'outline' && DOT,
        className,
      )}
    >
      {children}
    </span>
  );
}

/** 숫자 배지 (옛 hl-count): 아이콘 오른쪽 위의 빨간 숫자. 99를 넘으면 99+. 0이면 그리지 않는다. */
export type CountBadgePlacement = 'icon' | 'rail' | 'inline';

const PLACEMENT: Record<CountBadgePlacement, string> = {
  icon: 'absolute top-[3px] right-0.5',
  rail: 'absolute top-0.5 right-2',
  inline: 'inline-block',
};

/** muted = 회색 (알림을 끈 채팅방처럼 세지만 재촉하지 않을 때) */
export function CountBadge({ count, placement = 'icon', tone = 'danger', className }: { count: number; placement?: CountBadgePlacement; tone?: 'danger' | 'muted'; className?: string }) {
  if (count <= 0) return null;
  return (
    <span
      className={cn(
        tone === 'muted' ? 'bg-ink-disabled' : 'bg-danger',
        'min-w-4 rounded-lg px-1 text-center text-[10px] leading-4 font-semibold text-white tabular-nums',
        PLACEMENT[placement],
        className,
      )}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}
