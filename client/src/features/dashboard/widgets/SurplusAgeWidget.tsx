// 여재 보유 기간 (REQ-DSH-002): 수주에 묶이지 않은 합격 슬래브를 오래된 순으로.
import { Link } from 'react-router';
import type { SurplusAgeWidget as Data } from '@/api/dashboard';
import { EmptyNote } from '@/components/ui';
import { fmtDate, fmtInt, fmtNum, fmtTon } from '@/lib/format';
import { pctW } from '@/features/dashboard/parts';

export function SurplusAgeWidget({ data }: { data: Data }) {
  const s = data.summary;
  const maxAge = Math.max(1, s.maxAgeDays ?? 0, ...data.items.map((i) => i.ageDays));
  return (
    <div className="hl-card__body" style={{ padding: '12px 16px', gap: 10 }}>
      <div className="dsh-figures" title={data.definition}>
        <div className="hl-figure"><span>여재</span><b>{fmtInt(s.count)}<small>매</small></b></div>
        <div className="hl-figure"><span>중량</span><b>{fmtTon(s.totalTon)}</b></div>
        <div className="hl-figure"><span>최장 보유</span><b>{s.maxAgeDays === null ? '—' : <>{fmtInt(s.maxAgeDays)}<small>일</small></>}</b></div>
        <div className="hl-figure"><span>평균 보유</span><b>{s.avgAgeDays === null ? '—' : <>{fmtNum(s.avgAgeDays, 1)}<small>일</small></>}</b></div>
      </div>
      <div className="hl-col dsh-list">
        {data.items.map((it) => (
          <div key={it.lotId} className="hl-row dsh-list__row" title={`${it.specCode ?? '규격 없음'} · ${fmtTon(it.weightTon)} · 생산 ${fmtDate(it.producedAt)}`}>
            <Link className="hl-link-id dsh-clip" to={it.linkPath} style={{ flex: '0 1 auto' }} title={it.lotNo}>{it.lotNo}</Link>
            <span className="mono hl-muted dsh-clip" style={{ flex: '1 1 0', fontSize: 11.5 }}>{it.steelGradeCode ?? '—'}</span>
            <div className="hl-progress hl-progress--wait" style={{ width: 72, flex: 'none' }}><span style={{ width: pctW(it.ageDays, maxAge) }} /></div>
            <b className="tnum" style={{ flex: 'none', width: 40, textAlign: 'right', fontSize: 12 }}>{it.ageDays}일</b>
          </div>
        ))}
        {!data.items.length ? <EmptyNote>여재 슬래브가 없어요</EmptyNote> : null}
      </div>
    </div>
  );
}
