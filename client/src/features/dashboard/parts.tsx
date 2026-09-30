// 위젯들이 같이 쓰는 작은 부품 (말줄임 글자, 비율 표시, 하루 단위 막대).
import type { CSSProperties, ReactNode } from 'react';

/** 서버의 비율 문자열("0.4000") → 숫자. null이면 null. */
export function rateNum(v: string | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}
/** "40%" / "6.3%" / 없으면 "—" */
export function rateText(v: string | null | undefined, digits = 0): string {
  const n = rateNum(v);
  return n === null ? '—' : `${(n * 100).toFixed(digits)}%`;
}
/** 막대 너비용 퍼센트 (0~100) */
export const pctW = (part: number, whole: number): string => (whole > 0 ? `${Math.max(0, Math.min(100, (part / whole) * 100))}%` : '0%');

/** 길면 말줄임 + title (SPEC 7: 작은 위젯 임시 처리) */
export function Clip({ children, title, className, style }: { children: ReactNode; title?: string; className?: string; style?: CSSProperties }) {
  return (
    <span className={`dsh-clip${className ? ` ${className}` : ''}`} style={style} title={title ?? (typeof children === 'string' ? children : undefined)}>
      {children}
    </span>
  );
}

/** 남은 일수 → D-3 / D-day / D+2 (서버가 준 daysToDue 기준) */
export const dueLabel = (daysToDue: number): string => (daysToDue === 0 ? 'D-day' : daysToDue > 0 ? `D-${daysToDue}` : `D+${-daysToDue}`);

export interface DailyBarSeries { key: string; label: string; color: string }
export interface DailyBarPoint { date: string; values: number[]; title?: string }

/** 하루 단위 누적 세로 막대 (CSS만 사용). values는 series 순서와 같다. */
export function DailyBars({ series, points, unit }: { series: DailyBarSeries[]; points: DailyBarPoint[]; unit: string }) {
  const max = Math.max(1, ...points.map((p) => p.values.reduce((a, b) => a + b, 0)));
  // 날짜 라벨은 너무 촘촘하지 않게 몇 칸마다 하나씩
  const step = Math.max(1, Math.ceil(points.length / 7));
  return (
    <div className="dsh-daily">
      <div className="dsh-daily__plot" role="img" aria-label={`하루 단위 막대 그래프, 최대 ${max}${unit}`}>
        <span className="dsh-daily__max hl-cap tnum">{max}{unit}</span>
        {points.map((p) => {
          const total = p.values.reduce((a, b) => a + b, 0);
          const tip = p.title ?? `${p.date} · ${series.map((s, i) => `${s.label} ${p.values[i] ?? 0}`).join(' · ')}`;
          return (
            <div key={p.date} className="dsh-daily__col" title={tip}>
              <div className="dsh-daily__bar" style={{ height: pctW(total, max) }}>
                {series.map((s, i) => (p.values[i] ? <span key={s.key} style={{ flex: p.values[i], background: s.color }} /> : null))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="dsh-daily__axis hl-cap tnum" aria-hidden="true">
        {points.map((p, i) => (
          <span key={p.date}>{i % step === 0 ? p.date.slice(5) : ''}</span>
        ))}
      </div>
      <div className="hl-legend">
        {series.map((s) => <span key={s.key}><i style={{ background: s.color }} />{s.label}</span>)}
      </div>
    </div>
  );
}
