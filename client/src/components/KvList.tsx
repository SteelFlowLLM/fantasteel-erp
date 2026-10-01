// 이름-값 목록 (옛 hl-kv). columns=3이면 한 줄에 세 쌍.
import { Fragment, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface KvItem {
  label: ReactNode;
  value: ReactNode;
}

export function KvList({ items, columns = 1, className }: { items: readonly KvItem[]; columns?: 1 | 3; className?: string }) {
  return (
    <dl
      className={cn(
        'grid gap-x-4 gap-y-2 text-sm',
        columns === 3 ? 'grid-cols-[repeat(3,max-content_minmax(0,1fr))]' : 'grid-cols-[max-content_minmax(0,1fr)]',
        className,
      )}
    >
      {items.map((item, index) => (
        <Fragment key={index}>
          <dt className="text-xs leading-[18px] text-ink-3">{item.label}</dt>
          <dd className="m-0 font-medium text-ink">{item.value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}
