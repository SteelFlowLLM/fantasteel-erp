// 출고 확정 (REQ-SHP-002·003). v1 B안 25번: 왼쪽 출고 대기·최근 출고 | 오른쪽 배정 LOT 확인 → 출고 확정 → 결과(예약 전환·밀시트).
import { useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQueries, useQuery } from '@tanstack/react-query';
import { INSPECTION_RESULT_LABEL, LOT_STATUS_LABEL, SALES_ORDER_ITEM_STATUS_LABEL } from '@fantasteel/shared';
import { ApiError, newIdempotencyKey } from '@/api/client';
import { lotApi, type LotDetail } from '@/api/lots';
import { goodsIssueApi, shipmentRequestApi, type GoodsIssueView, type ShipmentRequestView } from '@/api/shipments';
import { Badge, EmptyNote, Icon, QueryBoundary, Spinner, StateView } from '@/components/ui';
import {
  AllocationStatusBadge, InfoStrip, LotLink, OrderLinks, PdfStatusBadge, SalesOrderLink, ShipmentStatusBadge, itemTypeLabel, itemsSummary, requestOrders, shipDateLabel, unitOf,
} from '@/features/shipment/shipmentUi';
import { useAction } from '@/hooks/useApi';
import { fmtInt, fmtMD, fmtMDHM, fmtTon } from '@/lib/format';
import { useShellTitle } from '@/shell/shellTitle';
import { canUse, useMe } from '@/stores/auth';

type Chip = 'wait' | 'done';
const RECENT_LIMIT = 30;

export function GoodsIssuePage() {
  const me = useMe();
  const canIssue = canUse(me, 'GOODS_ISSUE_CONFIRM');
  const [params, setParams] = useSearchParams();
  const [chip, setChip] = useState<Chip>('wait');
  const [q, setQ] = useState('');

  // 출고 대기 = 모든 품목의 배정이 끝난(ALLOCATED) 출하요청
  const waiting = useQuery({ queryKey: ['shipment-requests', 'list', { status: 'ALLOCATED' }], queryFn: () => shipmentRequestApi.list({ status: 'ALLOCATED' }) });
  const recent = useQuery({ queryKey: ['goods-issues', 'list', {}], queryFn: () => goodsIssueApi.list() });

  const waitRows = waiting.data ?? [];
  const doneRows = (recent.data ?? []).slice(0, RECENT_LIMIT);
  const text = q.trim().toLowerCase();
  const hitWait = (r: ShipmentRequestView) => !text || [r.shipmentRequestNo, r.customer.customerName, ...requestOrders(r).map((o) => o.no), ...r.items.flatMap((it) => it.allocations.map((a) => a.lotNo))].some((s) => s.toLowerCase().includes(text));
  const hitDone = (g: GoodsIssueView) => !text || [g.goodsIssueNo, g.shipmentRequestNo, g.customer.customerName, ...g.items.flatMap((it) => [it.salesOrderNo, ...it.lots.map((l) => l.lotNo)])].some((s) => s.toLowerCase().includes(text));

  const paramId = Number(params.get('request')) || null;
  // 주소에 요청이 없으면 출고 대기의 첫 요청을 보여준다
  const selId = paramId ?? waitRows[0]?.id ?? null;
  const select = (id: number) => setParams((p) => { const n = new URLSearchParams(p); n.set('request', String(id)); return n; });

  const chipBtn = (key: Chip, label: string, n: number) => (
    <button type="button" className={`hl-chip${chip === key ? ' is-on' : ''}`} onClick={() => setChip(key)}>{label} <b>{n}</b></button>
  );

  return (
    <>
      <section className="hl-master" aria-label="출고 대기 목록">
        <div className="hl-master__head">
          <div className="hl-row">
            <b style={{ fontSize: 14 }}>출고 대기</b>
            <span className="hl-tag">{waitRows.length}</span>
            <span className="hl-cap" style={{ marginLeft: 'auto' }}>배정 확정된 요청만 출고</span>
          </div>
          <label className="hl-inputwrap">
            <Icon name="search" size="sm" />
            <input className="hl-input" type="search" placeholder="출하번호·고객사·LOT 검색" aria-label="출고 대기 검색" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <div className="hl-row" style={{ gap: 6 }}>
            {chipBtn('wait', '출고 대기', waitRows.length)}
            {chipBtn('done', '최근 출고', doneRows.length)}
          </div>
        </div>
        <div className="hl-master__list">
          {chip === 'wait' ? (
            <>
              {waiting.isLoading ? <div style={{ padding: 16 }}><Spinner /></div> : null}
              {waiting.error && !waiting.data ? <EmptyNote>{waiting.error instanceof Error ? waiting.error.message : '목록을 불러오지 못했어요'}</EmptyNote> : null}
              {waitRows.filter(hitWait).map((r) => {
                const on = r.id === selId;
                return (
                  <div key={r.id} className={`hl-mitem${on ? ' is-active' : ''}`} role="button" tabIndex={0} aria-current={on} onClick={() => select(r.id)} onKeyDown={(e) => { if (e.key === 'Enter') select(r.id); }}>
                    <div className="hl-row">
                      <span className="hl-link-id" style={on ? { fontWeight: 600 } : undefined}>{r.shipmentRequestNo}</span>
                      <span className="hl-badge hl-badge--run" style={{ marginLeft: 'auto' }}>출고 대기</span>
                    </div>
                    <div className="hl-row" style={{ fontSize: 12 }}>
                      <span>{r.customer.customerName}</span>
                      <span className="tnum" style={{ marginLeft: 'auto', fontWeight: 600 }}>{fmtInt(r.requestQty)}{unitOf(r.items)} · {fmtTon(r.requestTon)}</span>
                    </div>
                    <div className="hl-row hl-cap">
                      <Icon name="check-circle" size="sm" style={{ color: 'var(--ok)' }} />
                      배정 확정 {r.allocatedQty}/{r.requestQty}
                      <span style={{ marginLeft: 'auto' }}>출하 요청일 {shipDateLabel(r.requestedShipDate)}</span>
                    </div>
                  </div>
                );
              })}
              {waiting.data && !waitRows.filter(hitWait).length ? <EmptyNote>{waitRows.length ? '조건에 맞는 요청이 없어요' : '출고 대기 중인 요청이 없어요. 영업이 배정을 확정하면 여기에 올라와요'}</EmptyNote> : null}
            </>
          ) : (
            <>
              {recent.isLoading ? <div style={{ padding: 16 }}><Spinner /></div> : null}
              {recent.error && !recent.data ? <EmptyNote>{recent.error instanceof Error ? recent.error.message : '목록을 불러오지 못했어요'}</EmptyNote> : null}
              {doneRows.filter(hitDone).map((g) => {
                const on = g.shipmentRequestId === selId;
                return (
                  <div key={g.id} className={`hl-mitem${on ? ' is-active' : ''}`} role="button" tabIndex={0} onClick={() => select(g.shipmentRequestId)} onKeyDown={(e) => { if (e.key === 'Enter') select(g.shipmentRequestId); }}>
                    <div className="hl-row">
                      <span className="hl-link-id" style={on ? { fontWeight: 600 } : undefined}>{g.goodsIssueNo}</span>
                      <span className="hl-badge hl-badge--ok" style={{ marginLeft: 'auto' }}>출고 완료</span>
                    </div>
                    <div className="hl-row" style={{ fontSize: 12 }}>
                      <span>{g.customer.customerName} · <span className="mono">{g.shipmentRequestNo}</span></span>
                      <span className="tnum" style={{ marginLeft: 'auto' }}>{fmtInt(g.issuedQty)}{unitOf(g.items)} · {fmtTon(g.issuedTon)}</span>
                    </div>
                    <div className="hl-row hl-cap">
                      출고 {fmtMDHM(g.confirmedAt)} · 밀시트
                      <span className="hl-row" style={{ marginLeft: 'auto', gap: 6 }}>
                        {g.millSheets.map((m) => <Link key={m.id} className="hl-link-id" to={`/mill-sheets?id=${m.id}`} onClick={(e) => e.stopPropagation()}>{m.millSheetNo}</Link>)}
                      </span>
                    </div>
                  </div>
                );
              })}
              {recent.data && !doneRows.filter(hitDone).length ? <EmptyNote>{doneRows.length ? '조건에 맞는 출고가 없어요' : '아직 확정된 출고가 없어요'}</EmptyNote> : null}
            </>
          )}
        </div>
        <div style={{ borderTop: '1px solid #DDE2E7', padding: '12px 16px', background: '#F7F8FA', display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12.5 }}>
          <span className="hl-label">오늘 ({fmtMD(new Date())})</span>
          <div className="hl-row">
            <span className="hl-muted">출고 대기</span>
            <span className="tnum" style={{ marginLeft: 'auto', fontWeight: 600 }}>{waitRows.length}건 · {fmtInt(waitRows.reduce((a, r) => a + r.requestQty, 0))}{unitOf(waitRows.flatMap((r) => r.items))}</span>
          </div>
          <span className="hl-cap" style={{ lineHeight: '17px' }}>출고 확정은 출하요청 단위예요. 부분 출하는 출하요청을 나눠서 해요.</span>
        </div>
      </section>
      <main className="hl-main">
        {selId ? <RequestPanel key={selId} id={selId} canIssue={canIssue} /> : (
          waiting.isLoading ? <StateView kind="loading" /> : <StateView kind="empty" title="출고할 출하요청이 없어요" text="영업이 배정을 확정하면 여기에 올라와요" />
        )}
      </main>
    </>
  );
}

function RequestPanel({ id, canIssue }: { id: number; canIssue: boolean }) {
  const detail = useQuery({ queryKey: ['shipment-requests', 'detail', id], queryFn: () => shipmentRequestApi.get(id) });
  useShellTitle(detail.data ? `출고 확정 · ${detail.data.shipmentRequestNo}` : '출고 확정', detail.data?.customer.customerName);
  return <QueryBoundary query={detail}>{(r) => <RequestDetail r={r} canIssue={canIssue} />}</QueryBoundary>;
}

/** LOT의 자격 상태를 한 줄로 */
function lotQualification(lot: LotDetail | undefined): { selfOk: boolean | null; heatOk: boolean | null; inStock: boolean | null } {
  if (!lot) return { selfOk: null, heatOk: null, inStock: null };
  return { selfOk: lot.isPassed, heatOk: lot.heat ? lot.heat.isPassed : null, inStock: lot.lotStatus === 'IN_STOCK' };
}

function RequestDetail({ r, canIssue }: { r: ShipmentRequestView; canIssue: boolean }) {
  const status = r.shipmentRequestStatus;
  const issued = status === 'ISSUED';
  const unit = unitOf(r.items);
  const allocations = r.items.flatMap((it) => it.allocations.map((a) => ({ item: it, a })));

  // 요청 하나를 연 동안 같은 키를 쓴다 → 두 번 눌러도(응답이 늦어 다시 눌러도) 한 번만 출고된다.
  const keyRef = useRef<string | null>(null);
  const [refusal, setRefusal] = useState<{ code: string | null; message: string } | null>(null);

  // 배정 LOT의 지금 자격 상태 (검사·상위 히트·재고). 출고 뒤에는 보지 않는다.
  const lotQueries = useQueries({
    queries: allocations.map(({ a }) => ({ queryKey: ['lots', 'detail', a.lotId], queryFn: () => lotApi.detail(a.lotId), enabled: !issued && status !== 'CANCELLED' })),
  });
  const lots = new Map<number, LotDetail>();
  lotQueries.forEach((lq, i) => { if (lq.data) lots.set(allocations[i].a.lotId, lq.data); });
  const lotsLoading = lotQueries.some((lq) => lq.isLoading);

  // 출고된 요청이면 출고 기록을 불러 결과를 보여준다
  const issues = useQuery({ queryKey: ['goods-issues', 'by-request', r.id], queryFn: () => goodsIssueApi.list({ shipmentRequestId: r.id }), enabled: issued });

  const confirm = useAction(shipmentRequestApi.confirmGoodsIssue, {
    success: (g) => `출고 ${g.goodsIssueNo}을(를) 확정했어요 · 밀시트 ${g.millSheets.length}장 발행`,
    invalidate: ['shipment-requests', 'goods-issues', 'mill-sheets', 'allocations', 'lots', 'inventories', 'sales-orders'],
    onSuccess: () => setRefusal(null),
    onError: (e) => {
      setRefusal({ code: e instanceof ApiError ? e.code : null, message: e instanceof Error ? e.message : '출고를 확정하지 못했어요' });
      // 서버가 받아서 거절한 요청(4xx)은 처리되지 않은 것이 확실하므로, 고친 뒤 다시 시도할 때는 새 키를 쓴다.
      // 연결 실패·서버 오류는 처리 여부를 알 수 없으니 같은 키를 그대로 둔다 (다시 눌러도 두 번 출고되지 않게).
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) keyRef.current = null;
    },
  });
  const result: GoodsIssueView | undefined = confirm.data ?? issues.data?.[0];

  const allAllocated = r.items.length > 0 && r.items.every((it) => it.allocatedQty >= it.requestQty);
  const confirmedCount = allocations.filter(({ a }) => a.status === 'CONFIRMED').length;
  const known = allocations.filter(({ a }) => lots.has(a.lotId));
  const passCount = known.filter(({ a }) => { const x = lotQualification(lots.get(a.lotId)); return x.selfOk === true && x.heatOk === true; }).length;
  const stockCount = known.filter(({ a }) => lots.get(a.lotId)?.lotStatus === 'IN_STOCK').length;
  const total = allocations.length;
  const checks = [
    { label: '배정 확정', ok: status === 'ALLOCATED' && allAllocated && confirmedCount === total, text: `${confirmedCount}/${total}` },
    { label: '검사 합격 (제품 + 상위 히트)', ok: total > 0 && passCount === total, text: lotsLoading ? '확인 중' : `${passCount}/${total}` },
    { label: '미소진 (재고)', ok: total > 0 && stockCount === total, text: lotsLoading ? '확인 중' : `${stockCount}/${total}` },
  ];
  const blockedLots = known.filter(({ a }) => lots.get(a.lotId)?.isEligible === false);

  const submit = () => {
    if (!keyRef.current) keyRef.current = newIdempotencyKey();
    confirm.mutate({ id: r.id, idempotencyKey: keyRef.current });
  };
  const lockText = status === 'REQUESTED' ? '배정 대기 — 출고 불가 · 영업의 배정 확정이 필요해요'
    : status === 'CANCELLED' ? '취소된 출하요청이에요'
    : !canIssue && status === 'ALLOCATED' ? '출고 확정은 물류 담당만 할 수 있어요' : '';

  return (
    <>
      <div className="hl-page-head">
        <div>
          <div className="hl-crumb">
            <Link to="/goods-issues">출고 확정</Link>
            <Icon name="chevron-right" size="sm" />
            {r.shipmentRequestNo}
          </div>
          <div className="hl-row" style={{ gap: 10 }}>
            <h1 className="hl-title mono" style={{ fontSize: 19 }}>{r.shipmentRequestNo}</h1>
            <ShipmentStatusBadge status={status} />
            <span className="hl-cap">{r.customer.customerName}</span>
          </div>
        </div>
        <div className="hl-page-head__actions">
          <Link className="hl-btn" to={`/shipment-requests/${r.id}`}><Icon name="order" />출하요청·배정</Link>
          {allocations[0] ? <Link className="hl-btn" to={`/lots/trace?lot=${encodeURIComponent(allocations[0].a.lotNo)}`}><Icon name="trace" />LOT 추적</Link> : null}
        </div>
      </div>

      <InfoStrip cells={[
        { label: '요청', value: `${r.requester?.employeeName ?? '-'} · ${fmtMDHM(r.createdAt)}` },
        { label: '출하 요청일', value: <span className="tnum">{shipDateLabel(r.requestedShipDate)}</span> },
        { label: '수주', value: <OrderLinks request={r} /> },
        { label: '품목', value: <span className="mono">{itemsSummary(r.items)}</span> },
        { label: '수량', value: <span className="tnum">{fmtInt(r.requestQty)}{unit} · 이론중량 {fmtTon(r.requestTon)}</span>, grow: true },
      ]} />

      {refusal ? (
        <div className="hl-banner hl-banner--danger" role="alert" style={{ flex: 'none' }}>
          <Icon name="alert" />
          <div style={{ flex: 1 }}>
            <b>출고를 확정하지 못했어요{refusal.code ? <> <span className="mono">({refusal.code})</span></> : null}</b>
            <div>{refusal.message}</div>
            <div className="hl-cap" style={{ color: 'inherit', marginTop: 2 }}>
              {refusal.code === 'INV-002' ? '미합격 LOT이 있으면 출고 전체가 막혀요. 영업이 그 LOT의 배정을 다른 합격 LOT으로 바꾼 뒤 다시 확정해 주세요.'
                : refusal.code === 'INV-004' ? '이미 투입·출고된 LOT이 배정돼 있어요. 배정을 바꾼 뒤 다시 확정해 주세요.'
                : '아무것도 출고되지 않았어요. 원인을 확인한 뒤 다시 시도해 주세요.'}
            </div>
          </div>
          <Link className="hl-btn hl-btn--sm" to={`/shipment-requests/${r.id}`}>배정 화면</Link>
        </div>
      ) : null}

      {result ? <IssueResult g={result} /> : issued && issues.isLoading ? <Spinner label="출고 기록을 불러오는 중…" /> : null}

      <section className="hl-card" style={{ flex: 'none' }}>
        <header className="hl-card__head">
          <h2>{issued ? '출고한 LOT' : '배정 LOT 출고 확인'}</h2>
          <span className="hl-card__meta">{issued ? '출고 확정 때 소진됐어요' : '품목별 배정 LOT과 지금 자격 상태'}</span>
          <div className="hl-card__actions">
            {!issued && total ? <Badge tone={blockedLots.length ? 'danger' : lotsLoading ? 'neutral' : 'ok'}>{blockedLots.length ? `출고 불가 LOT ${blockedLots.length}` : lotsLoading ? '확인 중' : `${total} LOT`}</Badge> : null}
          </div>
        </header>
        <div className="hl-card__body hl-card__body--flush" style={{ overflow: 'auto' }}>
          <table className="hl-table">
            <thead>
              <tr>
                <th>품목</th>
                <th>수주</th>
                <th>LOT</th>
                <th>히트</th>
                <th>생산완료일</th>
                <th>배정</th>
                {!issued ? <><th>제품 검사</th><th>상위 히트</th><th>재고</th></> : null}
              </tr>
            </thead>
            <tbody>
              {r.items.map((it) => (it.allocations.length ? it.allocations.map((a, i) => {
                const lot = lots.get(a.lotId);
                const x = lotQualification(lot);
                const bad = lot?.isEligible === false;
                return (
                  <tr key={a.id} className={bad ? 'is-risk' : undefined}>
                    {i === 0 ? (
                      <td rowSpan={it.allocations.length} style={{ verticalAlign: 'top', paddingTop: 9 }}>
                        <span className="hl-tag">{itemTypeLabel(it.itemType)}</span> <span className="mono">{it.specCode}</span>
                        <div className="hl-cap">품목 {it.lineNo} · {it.allocatedQty}/{it.requestQty}{it.qtyUnit} · {fmtTon(it.requestTon)}</div>
                      </td>
                    ) : null}
                    {i === 0 ? <td rowSpan={it.allocations.length} style={{ verticalAlign: 'top', paddingTop: 9 }}><SalesOrderLink id={it.salesOrderId} no={it.salesOrderNo} lineNo={it.salesOrderLineNo} /></td> : null}
                    <td><LotLink lotNo={a.lotNo} /></td>
                    <td className="mono">{a.heatNo ?? '—'}</td>
                    <td className="tnum">{fmtMD(a.producedAt)}</td>
                    <td><AllocationStatusBadge status={a.status} /></td>
                    {!issued ? (
                      <>
                        <td>{!lot ? <span className="hl-muted">{lotsLoading ? '확인 중' : '—'}</span> : <Badge tone={x.selfOk === true ? 'ok' : x.selfOk === false ? 'danger' : 'wait'}>{lot.inspectionResult ? INSPECTION_RESULT_LABEL[lot.inspectionResult] : '검사 전'}</Badge>}</td>
                        <td>{!lot ? <span className="hl-muted">—</span> : <Badge tone={x.heatOk === true ? 'ok' : x.heatOk === false ? 'danger' : 'wait'}>{x.heatOk === true ? '합격' : x.heatOk === false ? '불합격' : '판정 전'}</Badge>}</td>
                        <td>{!lot ? <span className="hl-muted">—</span> : <Badge tone={x.inStock ? 'ok' : 'danger'}>{LOT_STATUS_LABEL[lot.lotStatus] ?? lot.lotStatusLabel}</Badge>}</td>
                      </>
                    ) : null}
                  </tr>
                );
              }) : (
                <tr key={`empty-${it.id}`}>
                  <td><span className="hl-tag">{itemTypeLabel(it.itemType)}</span> <span className="mono">{it.specCode}</span></td>
                  <td><SalesOrderLink id={it.salesOrderId} no={it.salesOrderNo} lineNo={it.salesOrderLineNo} /></td>
                  <td colSpan={issued ? 4 : 7}><span className="hl-muted">{status === 'CANCELLED' ? '취소된 요청이라 배정된 LOT이 없어요' : '배정 대기 — 아직 배정된 LOT이 없어요 (영업 확정 필요)'}</span></td>
                </tr>
              )))}
            </tbody>
            {total ? (
              <tfoot>
                <tr>
                  <td colSpan={2}>{total} LOT · {fmtInt(r.requestQty)}{unit}</td>
                  <td colSpan={issued ? 4 : 7}>이론중량 {fmtTon(r.requestTon)}</td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      </section>

      {!issued && status !== 'CANCELLED' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, flex: 'none' }}>
          <section className="hl-card">
            <header className="hl-card__head"><h2>출고 전 확인</h2><span className="hl-card__meta">서버가 확정할 때 다시 확인해요</span></header>
            <div className="hl-card__body" style={{ gap: 8, fontSize: 12.5 }}>
              {checks.map((c) => (
                <div key={c.label} className="hl-row">
                  <Icon name={c.ok ? 'check-circle' : 'clock'} size="sm" style={{ color: c.ok ? 'var(--ok)' : 'var(--ink-3)' }} />
                  {c.label}
                  <span className="tnum" style={{ marginLeft: 'auto', fontWeight: 600 }}>{c.text}</span>
                </div>
              ))}
              <span className="hl-cap" style={{ lineHeight: '17px', paddingTop: 8, borderTop: '1px solid #DDE2E7' }}>
                화면의 값은 지금 조회한 상태예요. 출고 확정을 누르면 서버가 배정 LOT을 잠그고 검사 합격(제품 + 상위 히트)·미소진·배정 확정을 다시 확인해요. 미합격 LOT이 하나라도 있으면 출고 전체를 막아요.
              </span>
            </div>
          </section>
          <section className="hl-card">
            <header className="hl-card__head"><h2>확정하면 바뀌는 것</h2></header>
            <div className="hl-card__body" style={{ gap: 8, fontSize: 12.5 }}>
              <div className="hl-row"><Icon name="box" size="sm" style={{ color: 'var(--ink-3)' }} />배정 · LOT<span style={{ marginLeft: 'auto' }}>{total} LOT → <b>소진 · 출고</b></span></div>
              <div className="hl-row"><Icon name="stock" size="sm" style={{ color: 'var(--ink-3)' }} />예약<span style={{ marginLeft: 'auto' }}>{fmtInt(r.requestQty)}{unit} → <b>출고 전환 (CONVERTED)</b></span></div>
              <div className="hl-row"><Icon name="order" size="sm" style={{ color: 'var(--ink-3)' }} />수주 품목 출고 매수<span style={{ marginLeft: 'auto' }}>{r.items.map((it, i) => <span key={it.id}>{i ? ' · ' : ''}{it.salesOrderNo} #{it.salesOrderLineNo} <b>+{it.requestQty}{it.qtyUnit}</b></span>)}</span></div>
              <div className="hl-row"><Icon name="file" size="sm" style={{ color: 'var(--ink-3)' }} />밀시트<span style={{ marginLeft: 'auto' }}>수주 품목마다 1장 · <b>{r.items.length}장</b> 자동 발행 (히트 성분 + 검사값 스냅샷)</span></div>
              <div className="hl-row"><Icon name="history" size="sm" style={{ color: 'var(--ink-3)' }} />작업 로그<span style={{ marginLeft: 'auto' }}>예약 전환 · 밀시트 발행 · 출고 확정 · 수주 담당에게 알림</span></div>
            </div>
          </section>
        </div>
      ) : null}

      <div className="hl-row" style={{ gap: 12, marginTop: 'auto', padding: '10px 16px', background: '#FFFFFF', border: '1px solid #DDE2E7', borderRadius: 6, flex: 'none', flexWrap: 'wrap' }}>
        <Icon name={issued ? 'check-circle' : 'clock'} style={{ color: issued ? 'var(--ok)' : 'var(--ink-3)' }} />
        <span style={{ fontSize: 13 }}><b>{issued ? '출고 완료' : `${total} LOT 출고 대기`}</b> · {fmtInt(r.requestQty)}{unit} · {fmtTon(r.requestTon)}</span>
        {lockText ? <span className="hl-lockhint"><Icon name="lock" size="sm" />{lockText}</span>
          : issued ? <span className="hl-cap">출고 {fmtMDHM(r.goodsIssue?.confirmedAt)} · 담당 {r.goodsIssue?.confirmedEmployee?.employeeName ?? '-'}</span>
          : <span className="hl-cap">두 번 눌러도 한 번만 출고돼요</span>}
        {issued ? (
          r.millSheets[0] ? <Link className="hl-btn hl-btn--primary" to={`/mill-sheets?id=${r.millSheets[0].id}`} style={{ marginLeft: 'auto' }}><Icon name="file" />밀시트 보기</Link> : null
        ) : (
          <button type="button" className="hl-btn hl-btn--primary" style={{ marginLeft: 'auto' }} disabled={!canIssue || status !== 'ALLOCATED' || confirm.isPending} title={canIssue ? undefined : '권한이 필요해요'} onClick={submit}>
            <Icon name={canIssue ? 'check' : 'lock'} />{confirm.isPending ? '출고 확정 중…' : '출고 확정'}
          </button>
        )}
      </div>
    </>
  );
}

/** 출고 확정 결과: 출고번호 · 예약 전환 매수 · 수주 품목 상태 · 밀시트 */
function IssueResult({ g }: { g: GoodsIssueView }) {
  return (
    <section className="hl-card" style={{ flex: 'none', borderColor: '#B9DEC8' }}>
      <header className="hl-card__head" style={{ background: 'var(--ok-bg)' }}>
        <Icon name="check-circle" style={{ color: 'var(--ok)' }} />
        <h2>출고 <span className="mono">{g.goodsIssueNo}</span> 확정</h2>
        <span className="hl-card__meta">{g.confirmedEmployee?.employeeName ?? '-'} · {fmtMDHM(g.confirmedAt)}</span>
        <div className="hl-card__actions">
          <span className="tnum" style={{ fontSize: 12.5, fontWeight: 600 }}>예약 전환(CONVERTED) {fmtInt(g.issuedQty)}{unitOf(g.items)} · {fmtTon(g.issuedTon)}</span>
        </div>
      </header>
      <div className="hl-card__body hl-card__body--flush" style={{ overflow: 'auto' }}>
        <table className="hl-table">
          <thead>
            <tr>
              <th>수주 품목</th>
              <th>규격</th>
              <th className="num">예약 전환 (CONVERTED)</th>
              <th className="num">이론중량</th>
              <th className="num">누적 출고 / 주문</th>
              <th>수주 품목 상태</th>
              <th>출고 LOT</th>
            </tr>
          </thead>
          <tbody>
            {g.items.map((it) => (
              <tr key={it.shipmentRequestItemId}>
                <td><SalesOrderLink id={it.salesOrderId} no={it.salesOrderNo} lineNo={it.salesOrderLineNo} /></td>
                <td><span className="hl-tag">{itemTypeLabel(it.itemType)}</span> <span className="mono">{it.specCode}</span></td>
                <td className="num"><span className="hl-sheets">{fmtInt(it.issuedQty)}<small>{it.qtyUnit}</small></span></td>
                <td className="num">{fmtTon(it.issuedTon)}</td>
                <td className="num tnum">{fmtInt(it.shippedQty)} / {fmtInt(it.orderedQty)}{it.qtyUnit}</td>
                <td><Badge tone={it.salesOrderItemStatus === 'SHIPPED' ? 'ok' : it.salesOrderItemStatus === 'PARTIALLY_SHIPPED' ? 'run' : 'neutral'}>{SALES_ORDER_ITEM_STATUS_LABEL[it.salesOrderItemStatus] ?? it.salesOrderItemStatus}</Badge></td>
                <td><span className="hl-row" style={{ gap: 8, flexWrap: 'wrap' }}>{it.lots.map((l) => <LotLink key={l.lotId} lotNo={l.lotNo} />)}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="hl-card__foot" style={{ flexWrap: 'wrap' }}>
        <Icon name="file" size="sm" />
        <span style={{ fontSize: 12.5 }}>발행된 밀시트</span>
        {g.millSheets.map((m) => (
          <span key={m.id} className="hl-row" style={{ gap: 4 }}>
            <Link className="hl-link-id" to={`/mill-sheets?id=${m.id}`}>{m.millSheetNo}</Link>
            <PdfStatusBadge status={m.pdfStatus} />
          </span>
        ))}
        {!g.millSheets.length ? <span className="hl-muted" style={{ fontSize: 12 }}>없음</span> : null}
        <span className="hl-cap" style={{ marginLeft: 'auto' }}>밀시트는 발행 시점 값을 스냅샷으로 저장해요</span>
      </div>
    </section>
  );
}
