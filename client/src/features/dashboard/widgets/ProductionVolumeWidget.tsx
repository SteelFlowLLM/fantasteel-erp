// 생산량 (REQ-DSH-002): 하루 단위로 만든 슬래브·코일 LOT 수.
import type { ProductionVolumeWidget as Data } from '@/api/dashboard';
import { EmptyNote } from '@/components/ui';
import { fmtInt } from '@/lib/format';
import { DailyBars } from '@/features/dashboard/parts';

const SERIES = [
  { key: 'slab', label: '슬래브(매)', color: '#23507F' },
  { key: 'coil', label: '코일(개)', color: '#5B86B5' },
];

export function ProductionVolumeWidget({ data }: { data: Data }) {
  if (!data.series.length) return <div className="hl-card__body"><EmptyNote>생산 기록이 없어요</EmptyNote></div>;
  return (
    <div className="hl-card__body" style={{ padding: '12px 16px', gap: 10 }} title={data.definition}>
      <div className="dsh-figures">
        <div className="hl-figure"><span>슬래브</span><b>{fmtInt(data.totalSlabQty)}<small>매</small></b></div>
        <div className="hl-figure"><span>코일</span><b>{fmtInt(data.totalCoilQty)}<small>개</small></b></div>
      </div>
      <DailyBars unit="개" series={SERIES} points={data.series.map((s) => ({ date: s.date, values: [s.slabQty, s.coilQty], title: `${s.date} · 슬래브 ${s.slabQty}매 · 코일 ${s.coilQty}개` }))} />
      {data.totalSlabQty + data.totalCoilQty === 0 ? <EmptyNote style={{ padding: '4px 0' }}>최근 {data.days}일 동안 생산이 없어요</EmptyNote> : null}
    </div>
  );
}
