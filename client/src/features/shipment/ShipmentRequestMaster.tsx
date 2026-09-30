// 배정 화면 왼쪽의 출하요청 목록 (v1 B안 24번의 master). 목록 화면과 같은 조회를 쓴다.
import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { ShipmentRequestStatus } from '@fantasteel/shared';
import { shipmentRequestApi, type ShipmentRequestView } from '@/api/shipments';
import { EmptyNote, Icon, Spinner } from '@/components/ui';
import { fmtInt, fmtMD, fmtMDHM, fmtTon } from '@/lib/format';
import { ShipmentStatusBadge, itemsSummary, requestOrders, shipDateLabel, unitOf } from './shipmentUi';

type Chip = 'all' | Extract<ShipmentRequestStatus, 'REQUESTED' | 'ALLOCATED'>;

function caption(r: ShipmentRequestView): string {
  if (r.shipmentRequestStatus === 'REQUESTED') return `요청 ${fmtMDHM(r.createdAt)} · FIFO 추천 확인 필요 (${r.allocatedQty}/${r.requestQty})`;
  if (r.shipmentRequestStatus === 'ALLOCATED') return `요청 ${fmtMDHM(r.createdAt)} · 배정 확정 · 출고 대기`;
  if (r.shipmentRequestStatus === 'CANCELLED') return `취소됨${r.cancelledAt ? ` ${fmtMD(r.cancelledAt)}` : ''}`;
  return `출고 ${r.goodsIssue?.confirmedAt ? fmtMD(r.goodsIssue.confirmedAt) : ''}${r.millSheets.length ? ` · 밀시트 ${r.millSheets.map((m) => m.millSheetNo).join(', ')}` : ''}`;
}

export function ShipmentRequestMaster({ activeId, canRequest }: { activeId: number | null; canRequest: boolean }) {
  const list = useQuery({ queryKey: ['shipment-requests', 'list', {}], queryFn: () => shipmentRequestApi.list() });
  const [chip, setChip] = useState<Chip>('all');
  const [q, setQ] = useState('');
  const all = list.data ?? [];
  const text = q.trim().toLowerCase();
  const rows = all.filter((r) => (chip === 'all' || r.shipmentRequestStatus === chip)
    && (!text || [r.shipmentRequestNo, r.customer.customerName, ...requestOrders(r).map((o) => o.no)].some((s) => s.toLowerCase().includes(text))));
  const count = (s: ShipmentRequestStatus) => all.filter((r) => r.shipmentRequestStatus === s).length;
  const chipBtn = (key: Chip, label: string, n: number) => (
    <button type="button" className={`hl-chip${chip === key ? ' is-on' : ''}`} onClick={() => setChip(key)}>{label} <b>{n}</b></button>
  );
  return (
    <section className="hl-master" aria-label="출하요청 목록">
      <div className="hl-master__head">
        <div className="hl-row">
          <b style={{ fontSize: 14 }}>출하요청</b>
          <span className="hl-tag">{all.length}</span>
          {canRequest ? (
            <Link className="hl-btn hl-btn--sm" to="/shipment-requests/new" style={{ marginLeft: 'auto' }}><Icon name="plus" />새 출하요청</Link>
          ) : null}
        </div>
        <label className="hl-inputwrap">
          <Icon name="search" size="sm" />
          <input className="hl-input" type="search" placeholder="출하번호·수주·고객사 검색" aria-label="출하요청 검색" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <div className="hl-row" style={{ gap: 6 }}>
          {chipBtn('all', '전체', all.length)}
          {chipBtn('REQUESTED', '배정 대기', count('REQUESTED'))}
          {chipBtn('ALLOCATED', '출고 대기', count('ALLOCATED'))}
        </div>
      </div>
      <div className="hl-master__list">
        {list.isLoading ? <div style={{ padding: 16 }}><Spinner /></div> : null}
        {list.error && !list.data ? <EmptyNote>{list.error instanceof Error ? list.error.message : '목록을 불러오지 못했어요'}</EmptyNote> : null}
        {rows.map((r) => {
          const on = r.id === activeId;
          const orders = requestOrders(r);
          return (
            <Link key={r.id} className={`hl-mitem${on ? ' is-active' : ''}`} to={`/shipment-requests/${r.id}`}>
              <div className="hl-row">
                <span className="hl-link-id" style={on ? { fontWeight: 600 } : undefined}>{r.shipmentRequestNo}</span>
                <span style={{ marginLeft: 'auto' }}><ShipmentStatusBadge status={r.shipmentRequestStatus} /></span>
              </div>
              <div className="hl-row" style={{ fontSize: 12 }}>
                <span>{r.customer.customerName}</span>
                <span className="hl-muted" style={{ marginLeft: 'auto' }}>{orders.length > 1 ? `수주 ${orders.length}건` : orders[0]?.no ?? '-'}</span>
              </div>
              <div className="hl-row" style={{ fontSize: 12 }}>
                <span className="mono" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{itemsSummary(r.items)}</span>
                <span className="tnum" style={{ marginLeft: 'auto', fontWeight: 600, whiteSpace: 'nowrap' }}>{fmtInt(r.requestQty)}{unitOf(r.items)} · {fmtTon(r.requestTon)}</span>
              </div>
              <div className="hl-cap">출하 요청일 {shipDateLabel(r.requestedShipDate)} · {caption(r)}</div>
            </Link>
          );
        })}
        {list.data && !rows.length ? <EmptyNote>{all.length ? '조건에 맞는 출하요청이 없어요' : '아직 등록된 출하요청이 없어요'}</EmptyNote> : null}
      </div>
      <div style={{ borderTop: '1px solid #DDE2E7', padding: '12px 16px', background: '#F7F8FA', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span className="hl-label">배정 규칙</span>
        <span className="hl-cap" style={{ lineHeight: '17px' }}>강종·규격이 같은 합격 LOT · 생산완료일 오래된 순(같으면 LOT 번호 순) 추천 · 담당자 확정 · 출고 전까지 변경 가능</span>
      </div>
    </section>
  );
}
