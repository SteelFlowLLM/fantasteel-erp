// 시간순 기록 (옛 hl-timeline, 예: 수주 타임라인·이력 재현)
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type TimelineTone = 'neutral' | 'ok' | 'run' | 'danger' | 'wait' | 'ai';

const DOT: Record<TimelineTone, string> = {
  neutral: 'border-line-strong bg-surface',
  ok: 'border-ok bg-ok-bg',
  run: 'border-run bg-run-bg',
  danger: 'border-danger bg-danger-bg',
  wait: 'border-[#c9731a] bg-wait-bg',
  ai: 'border-ai bg-ai-bg',
};

export interface TimelineItem {
  key: string | number;
  tone?: TimelineTone;
  title: ReactNode;
  /** 표시용 시각 (예: 10-01 14:05) */
  time?: string;
  body?: ReactNode;
}

export function Timeline({ items, className }: { items: readonly TimelineItem[]; className?: string }) {
  return (
    <ol className={cn('relative flex flex-col', className)}>
      {items.map((item) => (
        <li
          key={item.key}
          className="relative grid grid-cols-[18px_minmax(0,1fr)] gap-x-2.5 pb-3.5 before:absolute before:top-3.5 before:bottom-0 before:left-2 before:w-0.5 before:bg-line before:content-[''] last:before:hidden"
        >
          <span className={cn('relative z-[1] size-[18px] rounded-full border-2', DOT[item.tone ?? 'neutral'])} />
          <div className="flex min-w-0 flex-col gap-0.5 text-sm">
            <div>{item.title}</div>
            {item.time ? <time className="text-cap text-ink-3 tabular-nums">{item.time}</time> : null}
            {item.body}
          </div>
        </li>
      ))}
    </ol>
  );
}
