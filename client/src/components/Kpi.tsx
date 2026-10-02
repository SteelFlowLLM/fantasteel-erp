// 핵심 숫자 (옛 hl-kpi)와 숫자 묶음 띠 (옛 hl-statbar)
import type { ReactNode } from 'react';
import { Icon, type IconName } from '@/components/Icon';
import { cn } from '@/lib/cn';

export interface KpiProps {
  label: ReactNode;
  value: ReactNode;
  /** 숫자 뒤 작은 단위 (예: t, 매) */
  unit?: string;
  sub?: ReactNode;
  icon?: IconName;
  /** StatBar 안에서처럼 테두리 없이 */
  flat?: boolean;
  className?: string;
}

export function Kpi({ label, value, unit, sub, icon, flat, className }: KpiProps) {
  return (
    <div
      className={cn(
        'flex min-w-0 flex-col gap-1.5 px-4 py-3.5',
        flat ? 'rounded-none border-0 bg-transparent' : 'rounded-md border border-line bg-surface shadow-1',
        className,
      )}
    >
      <span className="flex items-center gap-1.5 text-xs font-medium text-ink-2">
        {icon ? <Icon name={icon} size="sm" /> : null}
        {label}
      </span>
      <span className="text-4xl font-semibold tracking-[-0.01em] tabular-nums">
        {value}
        {unit ? <small className="ml-[3px] text-base font-medium text-ink-3">{unit}</small> : null}
      </span>
      {sub ? <span className="text-xs text-ink-3">{sub}</span> : null}
    </div>
  );
}

/** Kpi를 한 줄로 묶는다. 안의 Kpi에는 flat을 준다. */
export function StatBar({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn('flex rounded-md border border-line bg-surface shadow-1 [&>*]:flex-1 [&>*+*]:border-l [&>*+*]:border-line', className)}>
      {children}
    </div>
  );
}
