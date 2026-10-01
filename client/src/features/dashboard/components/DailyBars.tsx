// 하루 단위 누적 세로 막대 (옛 parts.tsx DailyBars). 출하 실적·생산량 위젯이 쓴다.
import type { DailyProductPoint } from '@/api/dashboard';
import { LegendItem } from '@/features/dashboard/components/WidgetFrame';
import { fmtTon } from '@/lib/format';

const SERIES = [
  { key: 'slabQty', label: '슬래브(매)', colorClass: 'bg-chart-1' },
  { key: 'coilQty', label: '코일(개)', colorClass: 'bg-chart-2' },
] as const;

const pct = (part: number, whole: number): string => `${whole > 0 ? Math.max(0, Math.min(100, (part / whole) * 100)) : 0}%`;

export function DailyBars({ points }: { points: readonly DailyProductPoint[] }) {
  const max = Math.max(1, ...points.map((p) => p.slabQty + p.coilQty));
  // 날짜 글자는 너무 촘촘하지 않게 몇 칸마다 하나씩
  const step = Math.max(1, Math.ceil(points.length / 6));
  return (
    <div className="flex min-h-24 flex-1 flex-col gap-1">
      <div
        role="img"
        aria-label={`하루 단위 막대 그래프, 하루 최대 ${max}`}
        className="relative flex min-h-14 flex-1 items-end gap-[3px] border-t border-b border-dashed border-t-line border-b-line-strong pt-0.5"
      >
        <span className="absolute top-0.5 left-0 bg-surface pr-1 text-cap text-ink-3 tabular-nums">{max}</span>
        {points.map((p) => (
          <div key={p.date} className="flex h-full min-w-0 flex-1 items-end hover:bg-surface-2" title={`${p.date} · 슬래브 ${p.slabQty}매 · 코일 ${p.coilQty}개 · ${fmtTon(p.ton)}`}>
            {/* 높이는 실행 중에 정해지는 값이라 style로 준다 */}
            <div className="flex w-full flex-col-reverse overflow-hidden rounded-t-xs" style={{ height: pct(p.slabQty + p.coilQty, max) }}>
              {SERIES.map((s) => (p[s.key] > 0 ? <span key={s.key} className={s.colorClass} style={{ flex: p[s.key], minHeight: 1 }} /> : null))}
            </div>
          </div>
        ))}
      </div>
      <div className="flex gap-[3px] text-cap text-ink-3 tabular-nums" aria-hidden="true">
        {points.map((p, i) => (
          <span key={p.date} className="min-w-0 flex-1 overflow-visible whitespace-nowrap">
            {i % step === 0 ? p.date.slice(5) : ''}
          </span>
        ))}
      </div>
      <div className="flex flex-wrap gap-3">
        {SERIES.map((s) => (
          <LegendItem key={s.key} colorClass={s.colorClass} label={s.label} />
        ))}
      </div>
    </div>
  );
}
