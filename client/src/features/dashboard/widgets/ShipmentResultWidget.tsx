// 출하 실적 (REQ-DSH-002): 하루 단위 출고 LOT 수.
import type { ShipmentResultWidget as Data } from '@/api/dashboard';
import { EmptyNote } from '@/components/ui';
import { fmtInt, fmtTon } from '@/lib/format';
import { DailyBars } from '@/features/dashboard/parts';

const SERIES = [
  { key: 'slab', label: '슬래브(매)', color: '#23507F' },
  { key: 'coil', label: '코일(개)', color: '#5B86B5' },
];

export function ShipmentResultWidget({ data }: { data: Data }) {
  if (!data.series.length) return <div className="hl-card__body"><EmptyNote>출하 실적이 없어요</EmptyNote></div>;
  return (
    <div className="hl-card__body" style={{ padding: '12px 16px', gap: 10 }}>
      <div className="dsh-figures">
        <div className="hl-figure"><span>출고 LOT</span><b>{fmtInt(data.totalQty)}<small>개</small></b></div>
        <div className="hl-figure"><span>출고 중량</span><b>{fmtTon(data.totalTon)}</b></div>
      </div>
      <DailyBars
        unit="개"
        series={SERIES}
        points={data.series.map((s) => ({ date: s.date, values: [s.slabQty, s.coilQty], title: `${s.date} · 슬래브 ${s.slabQty}매 · 코일 ${s.coilQty}개 · ${fmtTon(s.issuedTon)}` }))}
      />
      {data.totalQty === 0 ? <EmptyNote style={{ padding: '4px 0' }}>최근 {data.days}일 동안 출고가 없어요</EmptyNote> : null}
    </div>
  );
}
