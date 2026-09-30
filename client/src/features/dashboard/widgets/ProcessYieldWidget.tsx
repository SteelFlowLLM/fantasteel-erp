// 공정별 수율 (REQ-DSH-001): 실적 수율 막대 + 계획 수율 눈금.
import type { ProcessYieldWidget as Data } from '@/api/dashboard';
import { EmptyNote } from '@/components/ui';
import { fmtTon } from '@/lib/format';
import { rateNum, rateText } from '@/features/dashboard/parts';

export function ProcessYieldWidget({ data }: { data: Data }) {
  const d = data.definitions;
  if (!data.processes.length) return <div className="hl-card__body"><EmptyNote>공정 실적이 없어요</EmptyNote></div>;
  const hasResult = data.processes.some((p) => p.resultCount > 0);
  return (
    <div className="hl-card__body" style={{ padding: '12px 16px', gap: 10 }}>
      <div className="hl-bars">
        {data.processes.map((p) => {
          const actual = rateNum(p.actualYieldRate);
          const planned = rateNum(p.plannedYieldRate);
          const below = actual !== null && planned !== null && actual < planned;
          return (
            <div key={p.processCode} className="dsh-yield">
              <b className="dsh-clip" title={p.processLabel}>{p.processLabel}</b>
              <div className="dsh-yield__track" title={`실적 수율 ${rateText(p.actualYieldRate, 1)} · 계획 수율 ${rateText(p.plannedYieldRate, 1)}`}>
                <div className="hl-bar-track" style={{ height: 14 }}>
                  {actual !== null ? <span style={{ width: `${Math.min(100, actual * 100)}%`, background: below ? '#C9731A' : '#17794A' }} /> : null}
                </div>
                {planned !== null ? <i className="dsh-yield__mark" style={{ left: `${Math.min(100, planned * 100)}%` }} /> : null}
              </div>
              <span className="num" title={d.actualYieldRate}>
                <b className={below ? 'hl-wait-text' : undefined}>{rateText(p.actualYieldRate, 1)}</b>
              </span>
              <span className="hl-cap dsh-clip dsh-yield__sub" title={`${d.plannedYieldRate}\n${d.qtyAttainmentRate}`}>
                {p.resultCount
                  ? `실적 ${p.resultCount}건 · 투입 ${fmtTon(p.inputTon)} → 산출 ${fmtTon(p.outputTon)} · 계획 수율 ${rateText(p.plannedYieldRate, 1)} · 계획 대비 산출 ${rateText(p.qtyAttainmentRate)}`
                  : `완료 실적 없음 · 계획 수율 ${rateText(p.plannedYieldRate, 1)}`}
              </span>
            </div>
          );
        })}
      </div>
      <div className="hl-legend" style={{ flex: 'none' }}>
        <span><i style={{ background: '#17794A' }} />실적 수율</span>
        <span><i style={{ background: '#C9731A' }} />계획보다 낮음</span>
        <span><i style={{ background: 'var(--ink)', width: 2 }} />계획 수율</span>
      </div>
      {!hasResult ? <EmptyNote style={{ padding: '4px 0' }}>완료된 공정 실적이 아직 없어요</EmptyNote> : null}
    </div>
  );
}
