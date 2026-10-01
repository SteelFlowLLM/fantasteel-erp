// 탭 (옛 hl-tabs · hl-tab)과 작은 단추 묶음 (옛 hl-seg)
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface TabItem<K extends string> {
  key: K;
  label: ReactNode;
  /** 탭 옆 숫자 */
  count?: number;
}

export interface TabsProps<K extends string> {
  items: readonly TabItem<K>[];
  active: K;
  onChange: (key: K) => void;
  ariaLabel?: string;
  className?: string;
}

export function Tabs<K extends string>({ items, active, onChange, ariaLabel, className }: TabsProps<K>) {
  return (
    <div role="tablist" aria-label={ariaLabel} className={cn('flex flex-none gap-1 border-b border-line', className)}>
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          role="tab"
          aria-selected={item.key === active}
          onClick={() => onChange(item.key)}
          className="-mb-px inline-flex h-[38px] items-center gap-1.5 border-b-2 border-transparent px-3 text-sm font-medium text-ink-2 aria-selected:border-brand aria-selected:font-semibold aria-selected:text-brand"
        >
          {item.label}
          {item.count !== undefined ? (
            <span className="inline-flex h-[18px] items-center rounded-xs bg-surface-3 px-1.5 text-cap font-medium text-ink-2">{item.count}</span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

export interface SegmentedProps<K extends string> {
  items: readonly { key: K; label: ReactNode }[];
  active: K;
  onChange: (key: K) => void;
  ariaLabel?: string;
  className?: string;
}

export function Segmented<K extends string>({ items, active, onChange, ariaLabel, className }: SegmentedProps<K>) {
  return (
    <div role="group" aria-label={ariaLabel} className={cn('inline-flex gap-0.5 rounded-sm bg-surface-3 p-0.5', className)}>
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          aria-pressed={item.key === active}
          onClick={() => onChange(item.key)}
          className="h-[26px] rounded-[3px] px-2.5 text-xs font-medium text-ink-2 aria-pressed:bg-surface aria-pressed:text-ink aria-pressed:shadow-[0_1px_2px_rgba(18,24,32,0.12)]"
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
