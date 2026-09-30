// 강종별 불합격률 (REQ-DSH-002)
import type { RejectRateWidget as Data } from '@/api/dashboard';
import { EmptyNote } from '@/components/ui';
import { pctW, rateNum, rateText } from '@/features/dashboard/parts';

export function RejectRateWidget({ data }: { data: Data }) {
  if (!data.grades.length) return <div className="hl-card__body"><EmptyNote>등록된 강종이 없어요</EmptyNote></div>;
  // 불합격률은 보통 작은 값이라, 가장 큰 값(최소 10%)을 막대 끝으로 잡는다
  const scale = Math.max(0.1, ...data.grades.map((g) => rateNum(g.rejectRate) ?? 0));
  const anyInspected = data.grades.some((g) => g.inspectedCount > 0);
  return (
    <div className="hl-card__body" style={{ padding: '12px 16px', gap: 10 }} title={`${data.definitions.rejectRate}\n${data.definitions.note}`}>
      <div className="hl-bars">
        {data.grades.map((g) => {
          const rate = rateNum(g.rejectRate);
          return (
            <div key={g.steelGradeId} className="dsh-reject">
              <b className="mono">{g.steelGradeCode}</b>
              <div className="hl-bar-track" style={{ height: 14 }}>
                {rate ? <span style={{ width: pctW(rate, scale), background: '#C0322B' }} /> : null}
              </div>
              <span className="num tnum">
                <b className={rate ? 'hl-danger-text' : undefined}>{rateText(g.rejectRate, 1)}</b>{' '}
                <span className="hl-cap">{g.failedCount}/{g.inspectedCount}건</span>
              </span>
              <span className="hl-cap dsh-clip dsh-reject__sub" title={g.byProcess.map((p) => `${p.processLabel} ${rateText(p.rejectRate, 1)} (${p.failedCount}/${p.inspectedCount})`).join(' · ')}>
                {g.byProcess.length ? g.byProcess.map((p) => `${p.processLabel} ${p.failedCount}/${p.inspectedCount}`).join(' · ') : '검사 기록 없음'}
              </span>
            </div>
          );
        })}
      </div>
      <span className="hl-cap" style={{ flex: 'none' }}>막대 끝 = {(scale * 100).toFixed(0)}% · 불합격 / 판정된 검사 수</span>
      {!anyInspected ? <EmptyNote style={{ padding: '4px 0' }}>최근 {data.days}일 동안 판정된 검사가 없어요</EmptyNote> : null}
    </div>
  );
}
