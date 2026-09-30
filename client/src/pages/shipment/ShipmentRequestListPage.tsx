// 출하요청 목록 (REQ-SHP-001). 상태·고객사·출하 요청일로 걸러 보고, 배정·출고 확정·밀시트로 이어진다.
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { SHIPMENT_REQUEST_STATUS_LABEL, type ShipmentRequestStatus } from '@fantasteel/shared';
import { shipmentRequestApi, type ShipmentRequestView } from '@/api/shipments';
import { DateInput } from '@/components/DateInput';
import { EmptyNote, Icon, QueryBoundary } from '@/components/ui';
import { OrderLinks, ShipmentStatusBadge, itemsSummary, requestOrders, shipDateLabel, unitOf } from '@/features/shipment/shipmentUi';
import { fmtInt, fmtMDHM, fmtTon } from '@/lib/format';
import { canUse, useMe } from '@/stores/auth';

/** 화면에서 거르는 상태 (PARTIALLY_ISSUED는 서버가 쓰지 않는다) */
const STATUSES: ShipmentRequestStatus[] = ['REQUESTED', 'ALLOCATED', 'ISSUED', 'CANCELLED'];
const isStatus = (v: string | null): v is ShipmentRequestStatus => !!v && (STATUSES as string[]).includes(v);

export function ShipmentRequestListPage() {
  const me = useMe();
  const canRequest = canUse(me, 'SHIPMENT_REQUEST');
  const [params, setParams] = useSearchParams();
  const statusParam = params.get('status');
  const status = isStatus(statusParam) ? statusParam : '';
  const [customerId, setCustomerId] = useState<number | ''>('');
  const [shipFrom, setShipFrom] = useState('');
  const [shipTo, setShipTo] = useState('');
  const [q, setQ] = useState('');

  const list = useQuery({ queryKey: ['shipment-requests', 'list', {}], queryFn: () => shipmentRequestApi.list() });

  const setStatus = (s: ShipmentRequestStatus | '') =>
    setParams((p) => { const n = new URLSearchParams(p); if (s) n.set('status', s); else n.delete('status'); return n; }, { replace: true });

  return (
    <main className="hl-main">
      <div className="hl-page-head">
        <div>
          <div className="hl-crumb">출하</div>
          <div className="hl-row" style={{ gap: 10 }}>
            <h1 className="hl-title">출하요청</h1>
            <span className="hl-cap">여러 수주 품목을 묶어 요청하고, 합격 LOT을 FIFO로 배정해요</span>
          </div>
        </div>
        <div className="hl-page-head__actions">
          {canRequest ? (
            <Link className="hl-btn hl-btn--primary" to="/shipment-requests/new"><Icon name="plus" />출하요청 등록</Link>
          ) : (
            <button type="button" className="hl-btn hl-btn--primary" disabled title="권한이 필요해요"><Icon name="lock" />출하요청 등록</button>
          )}
        </div>
      </div>

      <QueryBoundary query={list}>
        {(all) => {
          const customers = [...new Map(all.map((r) => [r.customer.id, r.customer])).values()].sort((a, b) => a.customerName.localeCompare(b.customerName, 'ko'));
          const text = q.trim().toLowerCase();
          const hit = (r: ShipmentRequestView) =>
            (customerId === '' || r.customer.id === customerId)
            && (!shipFrom || r.requestedShipDate >= shipFrom)
            && (!shipTo || r.requestedShipDate <= shipTo)
            && (!text || [r.shipmentRequestNo, r.customer.customerName, ...requestOrders(r).map((o) => o.no), ...r.items.map((it) => it.specCode)].some((s) => s.toLowerCase().includes(text)));
          const base = all.filter(hit);
          const rows = base.filter((r) => !status || r.shipmentRequestStatus === status);
          const count = (s: ShipmentRequestStatus) => base.filter((r) => r.shipmentRequestStatus === s).length;
          return (
            <>
              <div className="hl-row" style={{ gap: 8, flexWrap: 'wrap', flex: 'none' }}>
                <button type="button" className={`hl-chip${status === '' ? ' is-on' : ''}`} onClick={() => setStatus('')}>전체 <b>{base.length}</b></button>
                {STATUSES.map((s) => (
                  <button key={s} type="button" className={`hl-chip${status === s ? ' is-on' : ''}`} onClick={() => setStatus(s)}>{SHIPMENT_REQUEST_STATUS_LABEL[s]} <b>{count(s)}</b></button>
                ))}
                <span className="hl-row" style={{ marginLeft: 'auto', gap: 8, flexWrap: 'wrap' }}>
                  <span className="hl-selectwrap" style={{ width: 160 }}>
                    <select className="hl-input" aria-label="고객사" value={customerId} onChange={(e) => setCustomerId(e.target.value ? Number(e.target.value) : '')}>
                      <option value="">고객사 전체</option>
                      {customers.map((c) => <option key={c.id} value={c.id}>{c.customerName}</option>)}
                    </select>
                    <Icon name="chevron-down" size="sm" />
                  </span>
                  <span className="hl-row" style={{ gap: 4 }}>
                    <span className="hl-cap">출하 요청일</span>
                    <DateInput value={shipFrom} onChange={setShipFrom} ariaLabel="출하 요청일 시작" width={140} />
                    <span className="hl-muted">~</span>
                    <DateInput value={shipTo} onChange={setShipTo} ariaLabel="출하 요청일 끝" width={140} />
                  </span>
                  <label className="hl-inputwrap" style={{ width: 220 }}>
                    <Icon name="search" size="sm" />
                    <input className="hl-input" type="search" placeholder="출하번호·고객사·수주·규격 검색" aria-label="출하요청 검색" value={q} onChange={(e) => setQ(e.target.value)} />
                  </label>
                </span>
              </div>

              <section className="hl-card" style={{ flex: 1 }}>
                <header className="hl-card__head">
                  <h2>출하요청</h2>
                  <span className="hl-card__meta">{rows.length === all.length ? `${all.length}건` : `${rows.length} / ${all.length}건`} · 최신순</span>
                </header>
                <div className="hl-card__body hl-card__body--flush" style={{ overflow: 'auto' }}>
                  <table className="hl-table">
                    <thead>
                      <tr>
                        <th>출하번호</th>
                        <th>상태</th>
                        <th>고객사</th>
                        <th>출하 요청일</th>
                        <th>품목</th>
                        <th>수주</th>
                        <th className="num">요청 매수</th>
                        <th className="num">이론중량</th>
                        <th className="num">배정</th>
                        <th>요청</th>
                        <th>다음</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => {
                        const unit = unitOf(r.items);
                        return (
                          <tr key={r.id} className={r.shipmentRequestStatus === 'CANCELLED' ? 'is-muted' : undefined}>
                            <td><Link className="hl-link-id" to={`/shipment-requests/${r.id}`}>{r.shipmentRequestNo}</Link></td>
                            <td><ShipmentStatusBadge status={r.shipmentRequestStatus} /></td>
                            <td>{r.customer.customerName}</td>
                            <td className="tnum">{shipDateLabel(r.requestedShipDate)}</td>
                            <td><span className="mono" title={r.items.map((it) => `${it.specCode} ${it.requestQty}${it.qtyUnit}`).join('\n')}>{itemsSummary(r.items)}</span></td>
                            <td><OrderLinks request={r} /></td>
                            <td className="num"><span className="hl-sheets">{fmtInt(r.requestQty)}<small>{unit}</small></span></td>
                            <td className="num">{fmtTon(r.requestTon)}</td>
                            <td className="num tnum">{r.shipmentRequestStatus === 'CANCELLED' ? '-' : `${fmtInt(r.allocatedQty)} / ${fmtInt(r.requestQty)}`}</td>
                            <td><span className="hl-muted">{r.requester?.employeeName ?? '-'} · {fmtMDHM(r.createdAt)}</span></td>
                            <td><NextLink r={r} /></td>
                          </tr>
                        );
                      })}
                      {!rows.length ? (
                        <tr><td colSpan={11}><EmptyNote>{all.length ? '조건에 맞는 출하요청이 없어요' : '아직 등록된 출하요청이 없어요'}</EmptyNote></td></tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          );
        }}
      </QueryBoundary>
    </main>
  );
}

/** 상태에 따라 다음에 할 일로 가는 링크 */
function NextLink({ r }: { r: ShipmentRequestView }) {
  if (r.shipmentRequestStatus === 'REQUESTED') return <Link to={`/shipment-requests/${r.id}`} style={{ fontSize: 12 }}>LOT 배정</Link>;
  if (r.shipmentRequestStatus === 'ALLOCATED') return <Link to={`/goods-issues?request=${r.id}`} style={{ fontSize: 12 }}>출고 확정</Link>;
  if (r.shipmentRequestStatus === 'ISSUED') {
    return (
      <span className="hl-row" style={{ gap: 6 }}>
        {r.millSheets.map((m) => <Link key={m.id} className="hl-link-id" to={`/mill-sheets?id=${m.id}`}>{m.millSheetNo}</Link>)}
        {!r.millSheets.length ? <span className="hl-muted">-</span> : null}
      </span>
    );
  }
  return <span className="hl-muted">-</span>;
}
