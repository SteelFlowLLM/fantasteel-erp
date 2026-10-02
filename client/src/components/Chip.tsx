// 필터 칩 (옛 hl-chip). 켜짐(on)이면 진하게 채운다.
import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  on?: boolean;
}

export function Chip({ on = false, className, type = 'button', children, ...rest }: ChipProps) {
  return (
    <button
      type={type}
      aria-pressed={on}
      className={cn(
        'inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-[14px] border px-2.5 text-xs font-medium [&_b]:font-semibold',
        on ? 'border-brand bg-brand text-white' : 'border-line-strong bg-surface text-ink-2 hover:bg-surface-2',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
