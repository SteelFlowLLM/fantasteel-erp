// 구매 진행 (REQ-DSH-002): 구매요청 상태별 건수 + 미입고 발주.
import { Link } from 'react-router';
import type { PurchaseProgressWidget as Data } from '@/api/dashboard';
import { EmptyNote } from '@/components/ui';
import { fmtMD, fmtTon } from '@/lib/format';
import { pctW } from '@/features/dashboard/parts';

const STATUS_COLOR: Record<Data['requisitionsByStatus'][number]['status'], string> = {
  DRAFT: '#9AA5B1', WAITING_APPROVAL: '#C9731A', APPROVED: '#1F5FCC', REJECTED: '#C0322B', ORDERED: '#17794A',
};

export function PurchaseProgressWidget({ data }: { data: Data }) {
  const total = data.requisitionsByStatus.reduce((a, s) => a + s.count, 0);
  const open = data.openPurchaseOrders;
  return (
    <div className="hl-card__body" style={{ padding: '12px 16px', gap: 10 }}>
      <div className="dsh-figures">
        {data.requisitionsByStatus.map((s) => (
          <div key={s.status} className="hl-figure">
            <span className="dsh-clip" title={`구매요청 ${s.label}`}><i className="dsh-dot" style={{ background: STATUS_COLOR[s.status] }} />{s.label}</span>
            <b className={s.count ? undefined : 'hl-muted'}>{s.count}<small>건</small></b>
          </div>
        ))}
      </div>
      <div className="hl-stack" style={{ flex: 'none' }} aria-hidden="true">
        {data.requisitionsByStatus.map((s) => (s.count ? <span key={s.status} style={{ width: pctW(s.count, total), background: STATUS_COLOR[s.status] }} title={`${s.label} ${s.count}건`} /> : null))}
      </div>
      <div className="hl-row" style={{ flex: 'none' }}>
        <span className="hl-label">미입고 발주</span>
        <span className="tnum" style={{ marginLeft: 'auto', fontSize: 12 }}><b>{open.count}</b>건 · 남은 입고 <b>{fmtTon(open.outstandingTon)}</b></span>
      </div>
      <div className="hl-col dsh-list">
        {open.purchaseOrders.map((po) => (
          <div key={po.purchaseOrderId} className="hl-row dsh-list__row">
            <Link className="hl-link-id" to="/purchase-orders" style={{ flex: 'none' }}>{po.purchaseOrderNo}</Link>
            <span className="dsh-clip hl-ink2" style={{ fontSize: 12 }} title={`${po.supplierName} · ${po.lineCount}개 품목`}>{po.supplierName}</span>
            <span className="tnum" style={{ marginLeft: 'auto', flex: 'none', fontSize: 12 }}>{fmtTon(po.outstandingTon)}</span>
            <span className="hl-cap tnum" style={{ flex: 'none', width: 62, textAlign: 'right' }}>{po.dueDate ? `납기 ${fmtMD(po.dueDate)}` : '납기 없음'}</span>
          </div>
        ))}
        {!open.purchaseOrders.length ? <EmptyNote>미입고 발주가 없어요</EmptyNote> : null}
      </div>
    </div>
  );
}
