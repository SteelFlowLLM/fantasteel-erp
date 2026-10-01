// 단계 표시 (옛 hl-steps, 예: 제강 → 연주 → 열연)
import { Fragment } from 'react';
import { Icon } from '@/components/Icon';
import { cn } from '@/lib/cn';

export type StepState = 'done' | 'run' | 'todo';

export interface StepItem {
  key: string;
  label: string;
  state: StepState;
}

const STATE_LABEL: Record<StepState, string> = { done: '완료', run: '진행 중', todo: '대기' };

export function Steps({ items, className }: { items: readonly StepItem[]; className?: string }) {
  return (
    <ol className={cn('flex items-center', className)}>
      {items.map((step, index) => (
        <Fragment key={step.key}>
          <li
            aria-label={`${step.label} ${STATE_LABEL[step.state]}`}
            className={cn(
              'flex items-center gap-1.5 whitespace-nowrap text-xs font-medium',
              step.state === 'done' && 'text-ok',
              step.state === 'run' && 'font-semibold text-run',
              step.state === 'todo' && 'text-ink-3',
            )}
          >
            <span
              className={cn(
                'inline-flex size-[18px] flex-none items-center justify-center rounded-full border-2 [&_.ic]:size-2.5',
                step.state === 'done' && 'border-ok bg-ok text-white',
                step.state === 'run' && 'border-run bg-run shadow-[inset_0_0_0_3px_var(--color-surface)]',
                step.state === 'todo' && 'border-line-strong bg-surface',
              )}
            >
              {step.state === 'done' ? <Icon name="check" /> : null}
            </span>
            {step.label}
          </li>
          {index < items.length - 1 ? (
            <li aria-hidden="true" className={cn('mx-2 h-0.5 min-w-4 flex-1', step.state === 'done' ? 'bg-ok' : 'bg-line-strong')} />
          ) : null}
        </Fragment>
      ))}
    </ol>
  );
}
