// 표 (옛 hl-table). 행 상태는 <tr data-selected / data-risk / data-muted>로 표시한다.
import type { ReactNode, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

type Align = 'left' | 'right' | 'center';
const ALIGN: Record<Align, string> = { left: 'text-left', right: 'text-right', center: 'text-center' };

export interface TableProps {
  /** 행 높이 32px */
  compact?: boolean;
  className?: string;
  children: ReactNode;
}

export function Table({ compact, className, children }: TableProps) {
  return (
    <table
      className={cn(
        'w-full border-collapse text-sm tabular-nums',
        '[&_tbody_tr:hover_td]:bg-surface-2 [&_tr[data-selected=true]_td]:bg-brand-tint [&_tbody_tr[data-selected=true]:hover_td]:bg-brand-tint-hover [&_tr[data-risk=true]_td]:bg-[#fff7f6] [&_tr[data-muted=true]_td]:text-ink-3',
        '[&_tfoot_td]:border-b-0 [&_tfoot_td]:bg-surface-2 [&_tfoot_td]:font-semibold',
        compact && '[&_td]:h-8',
        className,
      )}
    >
      {children}
    </table>
  );
}

export interface ThProps extends ThHTMLAttributes<HTMLTableCellElement> {
  align?: Align;
}

export function Th({ align = 'left', className, scope = 'col', ...rest }: ThProps) {
  return (
    <th
      scope={scope}
      className={cn('h-8 whitespace-nowrap border-b border-line bg-surface-2 px-3 text-xs font-medium text-ink-2', ALIGN[align], className)}
      {...rest}
    />
  );
}

export interface TdProps extends TdHTMLAttributes<HTMLTableCellElement> {
  align?: Align;
  /** 숫자 뒤 단위 칸 (옛 td.unit) */
  unit?: boolean;
}

export function Td({ align = 'left', unit, className, ...rest }: TdProps) {
  return (
    <td
      className={cn('h-9 whitespace-nowrap border-b border-line', unit ? 'w-[1%] pr-3 pl-0 text-ink-3' : 'px-3', ALIGN[align], className)}
      {...rest}
    />
  );
}
