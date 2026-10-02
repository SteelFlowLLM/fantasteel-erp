// 측정값을 기준 구간 위에 놓아 보여 주는 게이지 (옛 B안 hl-gauge). 위치(%)는 값마다 달라 style로 준다.
import { gaugeGeometry, limitText, trimNum, type LimitLike } from '@/features/quality/lib/qualityDisplay';
import { cn } from '@/lib/cn';

export function LimitGauge({ item, value, bad }: { item: LimitLike; value: string | null; bad?: boolean }) {
  const g = gaugeGeometry(item, value);
  if (!g) return <span className="text-cap text-ink-3">기준이 없어 게이지를 그릴 수 없어요</span>;
  const shown = value?.trim() ?? '';
  return (
    <div className="px-5.5 pt-1 pb-4">
      <div className="relative h-2" role="img" aria-label={`기준 ${limitText(item)}${shown ? `, 측정값 ${shown}` : ''}`}>
        <div className="absolute inset-0 rounded-sm bg-surface-3" />
        <div className="absolute top-0 bottom-0 rounded-sm bg-[#bfe3ce]" style={{ left: `${g.from}%`, width: `${Math.max(0, g.to - g.from)}%` }} />
        {item.minValue !== null ? (
          <span className="absolute top-2.5 -translate-x-1/2 text-2xs text-ink-3 tabular-nums" style={{ left: `${g.from}%` }}>
            {trimNum(item.minValue)}
          </span>
        ) : null}
        {item.maxValue !== null ? (
          <span className="absolute top-2.5 -translate-x-1/2 text-2xs text-ink-3 tabular-nums" style={{ left: `${g.to}%` }}>
            {trimNum(item.maxValue)}
          </span>
        ) : null}
        {g.mark !== null ? (
          <span className={cn('absolute -top-1 h-4 -translate-x-1/2 rounded-xs', bad ? 'w-[3px] bg-danger' : 'w-0.5 bg-ok')} style={{ left: `${g.mark}%` }} />
        ) : null}
      </div>
    </div>
  );
}

/** 표 안에 넣는 작은 게이지 */
export function MiniGauge({ item, value, bad }: { item: LimitLike; value: string | null; bad?: boolean }) {
  const g = gaugeGeometry(item, value);
  if (!g) return <span className="text-cap text-ink-3">—</span>;
  return (
    <div className="relative h-2 w-[132px] rounded-sm bg-surface-3" aria-hidden="true">
      <div className="absolute top-0 bottom-0 rounded-sm bg-[#bfe3ce]" style={{ left: `${g.from}%`, width: `${Math.max(0, g.to - g.from)}%` }} />
      {g.mark !== null ? <div className={cn('absolute -top-[3px] -ml-0.5 h-3.5 w-1 rounded-xs', bad ? 'bg-danger' : 'bg-ink')} style={{ left: `${g.mark}%` }} /> : null}
    </div>
  );
}
