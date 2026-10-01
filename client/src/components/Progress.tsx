// 진행 막대 (옛 hl-progress). 진행률은 분모를 화면에 함께 밝힌다 (업무 프로세스 4.5).
import { cn } from '@/lib/cn';

export type ProgressTone = 'run' | 'ok' | 'wait' | 'danger';

const FILL: Record<ProgressTone, string> = {
  run: 'bg-run',
  ok: 'bg-ok',
  wait: 'bg-[#c9731a]',
  danger: 'bg-danger',
};

export interface ProgressProps {
  /** 0~100 */
  value: number;
  tone?: ProgressTone;
  showLabel?: boolean;
  label?: string;
  className?: string;
}

export function Progress({ value, tone = 'run', showLabel = true, label, className }: ProgressProps) {
  const percent = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="relative h-1.5 min-w-[60px] flex-1 overflow-hidden rounded-[3px] bg-surface-3"
      >
        {/* 너비는 실행 중에 정해지는 값이라 style로 준다 */}
        <span className={cn('absolute inset-y-0 left-0 rounded-[3px]', FILL[tone])} style={{ width: `${percent}%` }} />
      </div>
      {showLabel ? <b className="min-w-[34px] text-right text-xs font-semibold tabular-nums">{percent}%</b> : null}
    </div>
  );
}
