// 왼쪽 목록 한 줄 (옛 hl-mitem)과 목록 구분 제목 (옛 GROUP 스타일)
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function MasterListItem({ active, onPick, children }: { active: boolean; onPick: () => void; children: ReactNode }) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-current={active ? 'true' : undefined}
      onClick={onPick}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onPick();
        }
      }}
      className={cn(
        'flex flex-col gap-1 border-b border-line px-4 py-2.5 text-sm outline-none hover:bg-surface-2 focus-visible:bg-surface-2',
        active && 'bg-brand-tint shadow-[inset_3px_0_0_var(--color-brand)] hover:bg-brand-tint-hover',
      )}
    >
      {children}
    </div>
  );
}

export function MasterListGroup({ title, count }: { title: string; count?: number }) {
  return (
    <div className="flex items-center gap-1.5 border-b border-line bg-surface-2 px-4 pt-2 pb-1 text-cap font-semibold text-ink-3">
      {title}
      {count !== undefined ? <span className="tabular-nums">{count}</span> : null}
    </div>
  );
}

/** 한 줄 안의 가로 묶음 */
export function Row({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('flex min-w-0 items-center gap-1.5', className)}>{children}</div>;
}
