// 제품 재고 (REQ-DSH-001): 슬래브·코일 합계 막대 + 규격별 재고·예약·가용.
import type { ProductStockWidget as Data } from '@/api/dashboard';
import { EmptyNote } from '@/components/ui';
import { fmtInt, fmtTon } from '@/lib/format';
import { pctW } from '@/features/dashboard/parts';

const COLOR = { reserved: '#23507F', available: '#D2DCE7' } as const;
const UNIT: Record<'SLAB' | 'COIL', string> = { SLAB: '매', COIL: '개' };

export function ProductStockWidget({ data }: { data: Data }) {
  const maxOnHand = Math.max(1, ...data.totals.map((t) => t.onHandQty));
  return (
    <>
      <div className="hl-card__body" style={{ padding: '12px 16px', gap: 10 }}>
        {data.totals.map((t) => (
          <div key={t.itemType} className="hl-row" style={{ gap: 10, flex: 'none' }} title={`재고 ${fmtTon(t.onHandTon)} · 예약 ${fmtTon(t.reservedTon)} · 가용 ${fmtTon(t.availableTon)}`}>
            <span className="hl-label" style={{ width: 44, flex: 'none' }}>{t.itemTypeLabel}</span>
            <div className="hl-grow">
              <div className="hl-stack" style={{ height: 14, width: pctW(t.onHandQty, maxOnHand), minWidth: t.onHandQty ? 6 : 0 }}>
                <span style={{ width: pctW(t.reservedQty, t.onHandQty), background: COLOR.reserved }} />
                <span style={{ width: pctW(Math.max(0, t.availableQty), t.onHandQty), background: COLOR.available }} />
              </div>
            </div>
            <span className="tnum" style={{ flex: 'none', fontSize: 12 }}>
              가용 <b>{fmtInt(t.availableQty)}</b> / 재고 <b>{fmtInt(t.onHandQty)}</b>{UNIT[t.itemType]}
            </span>
          </div>
        ))}
        <div className="hl-legend" style={{ flex: 'none' }}>
          <span><i style={{ background: COLOR.reserved }} />예약</span>
          <span><i style={{ background: COLOR.available }} />가용</span>
        </div>
        {data.items.length ? (
          <table className="hl-table hl-table--compact dsh-table--inset">
            <thead>
              <tr>
                <th>규격</th>
                <th className="num">재고</th>
                <th className="num">예약</th>
                <th className="num">가용</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((it) => (
                <tr key={it.productSpecId} title={`${it.itemTypeLabel} · ${it.steelGradeCode} · 1${it.unit} ${fmtTon(it.theoreticalWeightTon)}`}>
                  <td><span className="mono dsh-clip" style={{ maxWidth: 220 }} title={it.specCode}>{it.specCode}</span></td>
                  <td className="num" title={fmtTon(it.onHandTon)}><span className="hl-sheets">{fmtInt(it.onHandQty)}<small>{it.unit}</small></span></td>
                  <td className="num" title={fmtTon(it.reservedTon)}>{fmtInt(it.reservedQty)}</td>
                  <td className="num" title={fmtTon(it.availableTon)}><b className={it.availableQty > 0 ? undefined : 'hl-muted'}>{fmtInt(it.availableQty)}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyNote>재고가 있는 규격이 없어요</EmptyNote>
        )}
      </div>
      <div className="hl-card__foot dsh-foot"><span className="hl-cap dsh-clip" title={data.note}>{data.note}</span></div>
    </>
  );
}
