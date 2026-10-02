// 이름 첫 글자 동그라미 (옛 hl-avatar)
import { cn } from '@/lib/cn';

export type AvatarTone = 'brand' | 'ok' | 'wait' | 'neutral';

const TONE: Record<AvatarTone, string> = {
  brand: 'bg-brand-tint text-brand',
  ok: 'bg-ok-bg text-ok',
  wait: 'bg-wait-bg text-wait',
  neutral: 'bg-surface-3 text-ink-2',
};

const SIZE = {
  sm: 'size-[22px] text-[10px]',
  md: 'size-7 text-xs',
  lg: 'size-9 text-base',
} as const;

export function Avatar({ name, size = 'md', tone = 'brand', className }: { name: string; size?: keyof typeof SIZE; tone?: AvatarTone; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('inline-flex flex-none items-center justify-center rounded-full font-semibold', SIZE[size], TONE[tone], className)}
    >
      {name.slice(0, 1)}
    </span>
  );
}
