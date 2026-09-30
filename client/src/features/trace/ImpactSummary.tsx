// 정추적 영향 요약: 영향받은 슬래브·코일 수, 출하·수주 (응답의 impact + summary 그대로).
import { Link } from 'react-router';
import { LOT_TYPE_LABEL } from '@fantasteel/shared';
import type { LotTraceResponse } from '@/api/lots';
import { Badge, EmptyNote } from '@/components/ui';
import { fmtDate, fmtDateTime, fmtInt } from '@/lib/format';

export function ImpactSummary({ trace }: { trace: LotTraceResponse }) {
  const impact = trace.impact;
  if (!impact) return null;
  const c = trace.summary.countByType;
  const stat = (label: string, value: number, tone?: 'danger') => (
    <div className="lt-stat">
      <span className="hl-cap">{label}</span>
      <b className={`tnum${tone === 'danger' && value > 0 ? ' hl-danger-text' : ''}`}>{fmtInt(value)}</b>
    </div>
  );
  return (
    <section className="hl-card lt-panel lt-impact" aria-label="정추적 영향 요약">
      <header className="hl-card__head">
        <h2>영향 요약</h2>
        <span className="hl-card__meta">이 LOT에서 이어진 하위 LOT·출하</span>
      </header>
      <div className="hl-card__body" style={{ padding: '12px 16px', gap: 12, overflow: 'auto' }}>
        <div className="lt-stats">
          {stat(`${LOT_TYPE_LABEL.SLAB}`, c.SLAB ?? 0)}
          {stat(`${LOT_TYPE_LABEL.COIL}`, c.COIL ?? 0)}
          {stat('출하된 제품', impact.shippedProductLotCount, 'danger')}
          {stat('미출하 제품', impact.unshippedProductLotCount)}
          {stat('수주', impact.salesOrders.length)}
        </div>
        <div className="lt-sec">
          <div className="lt-sec__head"><b>출하</b><span className="hl-cap" style={{ marginLeft: 'auto' }}>{impact.shipments.length}건</span></div>
          {impact.shipments.length ? (
            <ul className="lt-list lt-list--scroll">
              {impact.shipments.map((s) => (
                <li key={s.goodsIssueId} className="lt-imp">
                  <div className="hl-row" style={{ gap: 8 }}>
                    <span className="mono" style={{ fontWeight: 600 }}>{s.goodsIssueNo}</span>
                    <span className="hl-cap">{fmtDateTime(s.issuedAt)}</span>
                    <span className="hl-cap" style={{ marginLeft: 'auto' }}>LOT {s.lotIds.length}</span>
                  </div>
                  <div className="hl-row" style={{ gap: 8, flexWrap: 'wrap' }}>
                    <span>{s.customerName}</span>
                    <Link className="hl-link-id" to={`/sales-orders/${s.salesOrderId}`}>{s.salesOrderNo}</Link>
                    <span className="hl-cap">{s.shipmentRequestNo}</span>
                    {s.millSheetNos.length ? <span className="hl-cap">밀시트 {s.millSheetNos.join(', ')}</span> : <span className="hl-cap">밀시트 없음</span>}
                  </div>
                </li>
              ))}
            </ul>
          ) : <EmptyNote>영향받은 출하가 없어요</EmptyNote>}
        </div>
        <div className="lt-sec">
          <div className="lt-sec__head"><b>수주</b><span className="hl-cap" style={{ marginLeft: 'auto' }}>{impact.salesOrders.length}건</span></div>
          {impact.salesOrders.length ? (
            <ul className="lt-list lt-list--scroll">
              {impact.salesOrders.map((o) => (
                <li key={o.salesOrderId} className="lt-imp">
                  <div className="hl-row" style={{ gap: 8 }}>
                    <Link className="hl-link-id" to={`/sales-orders/${o.salesOrderId}`}>{o.salesOrderNo}</Link>
                    <span>{o.customerName}</span>
                    <span style={{ marginLeft: 'auto' }}>{o.hasShipped ? <Badge tone="danger">출하됨</Badge> : <Badge tone="neutral">출하 전</Badge>}</span>
                  </div>
                  <div className="hl-cap">납기 {fmtDate(o.dueDate)} · 영향 LOT {o.lotCount}개</div>
                </li>
              ))}
            </ul>
          ) : <EmptyNote>영향받은 수주가 없어요</EmptyNote>}
        </div>
      </div>
    </section>
  );
}
