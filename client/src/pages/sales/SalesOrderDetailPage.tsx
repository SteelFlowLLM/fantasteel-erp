// 수주 상세 · 충족 현황 (REQ-SO-004~006). 모양은 v1 B안 s12: 수주 목록 | 상세(탭) | 옆 칸.
// 충족 현황 숫자는 GET /sales-orders/:id/fulfillment 가 준 값 그대로다 (화면에서 다시 계산하지 않는다).
import { useEffect, useState, type ReactNode } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { ALLOCATION_PURPOSE_LABEL, ALLOCATION_STATUS_LABEL, ITEM_QTY_UNIT, ITEM_TYPE_LABEL, RESERVATION_STATUS_LABEL, SALES_ORDER_ITEM_STATUS_LABEL, type ReservationStatus } from '@fantasteel/shared';
import { salesOrderApi, type FulfillmentView, type ListSalesOrdersQuery } from '@/api/salesOrders';
import { Badge, EmptyNote, Icon, QueryBoundary, Spinner, type Tone } from '@/components/ui';
import { CancelOrderModal } from '@/features/sales/CancelOrderModal';
import {
  ActorChip, FulfillLegend, FulfillStack, ItemTitle, LockHint, ProgressCell, Qty, RiskBadge, STATUS_TONE, StatusBadge, WorkRoomButton,
  dueLabel, eventsHref, lotHref, lotLabel, lotTone, planHref, planLabel, planTone, shipmentNewHref, sumOf, unitOf, useOrderEvents,
} from '@/features/sales/salesUi';
import { fmtDate, fmtDateTime, fmtMD, fmtMDHM, fmtTon } from '@/lib/format';
import { useShellTitle } from '@/shell/shellTitle';
import { canUse, useMe } from '@/stores/auth';
import './SalesOrderDetailPage.css';

type Tab = 'fill' | 'links' | 'reservations' | 'log';
type Chip = 'all' | 'progress' | 'risk';
const RESERVATION_TONE: Record<ReservationStatus, Tone> = { ACTIVE: 'run', CONVERTED: 'ok', RELEASED: 'neutral' };
const EVENT_LIMIT = 50;

export function SalesOrderDetailPage() {
  const { id: idText } = useParams();
  const id = Number(idText);
  const valid = Number.isInteger(id) && id > 0;
  const ful = useQuery({ queryKey: ['sales-orders', 'fulfillment', id], queryFn: () => salesOrderApi.fulfillment(id), enabled: valid });
  useShellTitle(ful.data?.salesOrderNo, ful.data?.customer.customerName);

  return (
    <>
      <OrderMaster activeId={valid ? id : null} />
      <main className="hl-main so-detail" style={{ padding: '16px 20px', gap: 12 }}>
        {!valid ? (
          <NotFound text={idText ?? ''} />
        ) : (
          <QueryBoundary query={ful} loadingLabel="수주를 불러오는 중…">
            {(d) => <Detail key={d.id} d={d} />}
          </QueryBoundary>
        )}
      </main>
    </>
  );
}

function NotFound({ text }: { text: string }) {
  return (
    <section className="hl-card" style={{ flex: 'none', alignItems: 'center', padding: '28px 16px', gap: 12 }}>
      <Icon name="search" size="lg" style={{ color: '#5E6977' }} />
      <b style={{ fontSize: 15 }}>수주 {text}를 찾을 수 없어요</b>
      <span className="hl-cap">주소를 다시 확인하거나 수주 목록에서 골라 주세요</span>
      <Link className="hl-btn hl-btn--primary" to="/sales-orders"><Icon name="chevron-left" />수주 목록으로</Link>
    </section>
  );
}

/** 왼쪽 수주 목록 (최신 등록순 — 서버 정렬 그대로). */
function OrderMaster({ activeId }: { activeId: number | null }) {
  const me = useMe();
  const [chip, setChip] = useState<Chip>('all');
  const [text, setText] = useState('');
  const [keyword, setKeyword] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setKeyword(text.trim()), 300);
    return () => clearTimeout(t);
  }, [text]);
  const query: ListSalesOrdersQuery = { keyword: keyword || undefined, status: chip === 'progress' ? 'IN_PROGRESS' : undefined, deliveryRiskOnly: chip === 'risk' || undefined, size: 50 };
  const list = useQuery({ queryKey: ['sales-orders', 'list', query], queryFn: () => salesOrderApi.list(query), placeholderData: keepPreviousData });
  const rows = list.data?.rows ?? [];
  return (
    <section className="hl-master so-detail" aria-label="수주 목록">
      <div className="hl-master__head">
        <div className="hl-row">
          <b style={{ fontSize: 14 }}>수주</b>
          <span className="hl-tag">{list.data ? list.data.total : '…'}</span>
          <Link className="hl-btn hl-btn--ghost hl-btn--sm" to="/sales-orders" style={{ marginLeft: 'auto' }}><Icon name="chevron-left" />목록</Link>
          {canUse(me, 'ORDER_CREATE') ? <Link className="hl-btn hl-btn--sm" to="/sales-orders/new"><Icon name="plus" />등록</Link> : null}
        </div>
        <label className="hl-inputwrap">
          <Icon name="search" size="sm" />
          <input className="hl-input" type="search" placeholder="수주번호·고객사 검색" aria-label="수주 검색" value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        <div className="hl-row" style={{ gap: 6 }}>
          <button className={`hl-chip${chip === 'all' ? ' is-on' : ''}`} type="button" onClick={() => setChip('all')}>전체</button>
          <button className={`hl-chip${chip === 'progress' ? ' is-on' : ''}`} type="button" onClick={() => setChip('progress')}>{SALES_ORDER_ITEM_STATUS_LABEL.IN_PROGRESS}</button>
          <button className={`hl-chip${chip === 'risk' ? ' is-on' : ''}`} style={chip === 'risk' ? undefined : { color: '#C0322B', borderColor: '#E3A7A2' }} type="button" onClick={() => setChip('risk')}>납기 위험</button>
        </div>
      </div>
      <div className="hl-master__list">
        {list.isLoading ? <div style={{ padding: 16 }}><Spinner /></div> : null}
        {list.error && !list.data ? <EmptyNote>수주 목록을 불러오지 못했어요</EmptyNote> : null}
        {rows.map((r) => {
          const on = r.id === activeId;
          return (
            <Link key={r.id} className={`hl-mitem${on ? ' is-active' : ''}`} to={`/sales-orders/${r.id}`} aria-current={on ? 'page' : undefined}>
              <div className="hl-row">
                <span className="hl-link-id" style={on ? { fontWeight: 600 } : undefined}>{r.salesOrderNo}</span>
                <span style={{ marginLeft: 'auto' }}>{r.isDeliveryRisk ? <RiskBadge /> : <StatusBadge status={r.salesOrderStatus} />}</span>
              </div>
              <div className="hl-row" style={{ fontSize: 12 }}>
                <span>{r.customer.customerName}</span>
                <span className="hl-muted">· {r.orderedQty}{unitOf(r.items)} · {fmtTon(r.orderedTon)}</span>
                <span className={r.isDeliveryRisk ? 'hl-risk tnum' : 'tnum'} style={{ marginLeft: 'auto', fontSize: 12 }}>{fmtMD(r.dueDate)}</span>
              </div>
              <ProgressCell rate={r.progressRate} risk={r.isDeliveryRisk} />
            </Link>
          );
        })}
        {list.data && !rows.length ? <EmptyNote>{keyword ? '검색 결과가 없어요' : chip === 'risk' ? '납기 위험 수주가 없어요' : chip === 'progress' ? '진행 중인 수주가 없어요' : '등록된 수주가 없어요'}</EmptyNote> : null}
      </div>
      <div className="hl-row hl-cap" style={{ padding: '10px 16px', borderTop: '1px solid #DDE2E7', background: '#F7F8FA' }}>
        <span>최신 등록순{list.data && list.data.total > rows.length ? ` · ${rows.length}건까지 표시` : ''} · 진행률 = (예약+검사합격+출하) ÷ 주문</span>
      </div>
    </section>
  );
}

function Detail({ d }: { d: FulfillmentView }) {
  const me = useMe();
  const [tab, setTab] = useState<Tab>('fill');
  const [cancelOpen, setCancelOpen] = useState(false);
  const reservations = useQuery({ queryKey: ['sales-orders', 'reservations', d.id], queryFn: () => salesOrderApi.reservations(d.id) });
  const events = useOrderEvents(d.id, EVENT_LIMIT);

  const hasCancelPerm = canUse(me, 'ORDER_CANCEL');
  const lockText = d.isCancelled ? '이미 취소된 수주예요' : d.salesOrderStatus === 'SHIPPED' ? '전량 출하된 수주는 취소할 수 없어요' : !hasCancelPerm ? '수주 취소 권한 필요' : '';
  const canShip = canUse(me, 'SHIPMENT_REQUEST') && !d.isCancelled && d.salesOrderStatus !== 'SHIPPED';

  const unit = unitOf(d.items);
  const live = d.items.filter((it) => it.salesOrderItemStatus !== 'CANCELLED');
  const base = live.length ? live : d.items;   // 진행률 분모와 같은 기준 (취소 품목 제외, 전부 취소면 전체)
  const tot = {
    ordered: sumOf(base, (it) => it.orderedQty), reserved: sumOf(base, (it) => it.reservedQty), passed: sumOf(base, (it) => it.passedQty),
    inProd: sumOf(base, (it) => it.inProductionQty), shipped: sumOf(base, (it) => it.shippedQty), unsecured: sumOf(base, (it) => it.unsecuredQty),
    need: sumOf(base, (it) => it.additionalPlanNeededQty),
  };
  const plans = d.items.flatMap((it) => it.productionPlans.map((p) => ({ ...p, lineNo: it.lineNo, unit: it.qtyUnit })));
  const lots = d.items.flatMap((it) => it.lots.map((l) => ({ ...l, lineNo: it.lineNo })));
  const evs = events.data?.items ?? [];

  return (
    <>
      <div className="hl-col" style={{ gap: 8, flex: 'none' }}>
        <div className="hl-row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <span className="mono" style={{ fontSize: 18, fontWeight: 600, letterSpacing: 0 }}>{d.salesOrderNo}</span>
          <b style={{ fontSize: 16 }}>{d.customer.customerName}</b>
          <StatusBadge status={d.salesOrderStatus} />
          {d.isDeliveryRisk ? <RiskBadge /> : null}
          <span className="hl-tag tnum">납기 {fmtDate(d.dueDate)}{d.isCancelled || d.salesOrderStatus === 'SHIPPED' ? '' : ` · ${dueLabel(d.daysToDue)}`}</span>
          <span className="hl-cap" style={{ marginLeft: 'auto' }}>등록 {fmtDateTime(d.createdAt)} · 담당 {d.ownerEmployee.employeeName} ({d.ownerEmployee.employeeNo})</span>
        </div>
        {d.note ? <div className="hl-row hl-ink2" style={{ fontSize: 12.5, gap: 6 }}><Icon name="note" size="sm" />비고: {d.note}</div> : null}
        <div className="hl-row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button className="hl-btn hl-btn--sm hl-btn--danger-outline" type="button" onClick={() => setCancelOpen(true)} disabled={!!lockText} title={lockText || undefined}>
            <Icon name="x-circle" />수주 취소
          </button>
          {lockText ? <LockHint>{lockText}</LockHint> : null}
          <div className="hl-row" style={{ marginLeft: 'auto', gap: 8 }}>
            <WorkRoomButton salesOrderId={d.id} />
            <Link className="hl-btn hl-btn--sm" to={eventsHref(d.id)}><Icon name="history" />작업 로그</Link>
            {canShip ? (
              <Link className="hl-btn hl-btn--sm hl-btn--primary" to={shipmentNewHref(d.id)}><Icon name="truck" />출하요청 만들기</Link>
            ) : (
              <button className="hl-btn hl-btn--sm hl-btn--primary" type="button" disabled title={d.isCancelled ? '취소된 수주예요' : d.salesOrderStatus === 'SHIPPED' ? '전량 출하됐어요' : '권한이 필요해요'}><Icon name="truck" />출하요청 만들기</button>
            )}
          </div>
        </div>
      </div>
      {d.isCancelled ? (
        <div className="hl-banner hl-banner--danger" style={{ flex: 'none', padding: '8px 12px' }}>
          <Icon name="x-circle" />
          <span>취소된 수주예요 · {fmtDateTime(d.cancelledAt)}{d.cancelReason ? ` · 사유: ${d.cancelReason}` : ''} · 예약은 해제됐고, 생산 중이던 물량은 완료 후 여재가 돼요. 출하된 수량은 그대로예요.</span>
        </div>
      ) : null}
      <div className="hl-tabs" role="tablist">
        <button className={`hl-tab${tab === 'fill' ? ' is-active' : ''}`} type="button" role="tab" aria-selected={tab === 'fill'} onClick={() => setTab('fill')}>충족 현황</button>
        <button className={`hl-tab${tab === 'links' ? ' is-active' : ''}`} type="button" role="tab" aria-selected={tab === 'links'} onClick={() => setTab('links')}>생산 연결 <span className="hl-tag">{plans.length + lots.length}</span></button>
        <button className={`hl-tab${tab === 'reservations' ? ' is-active' : ''}`} type="button" role="tab" aria-selected={tab === 'reservations'} onClick={() => setTab('reservations')}>예약 이력 <span className="hl-tag">{reservations.data ? reservations.data.length : '…'}</span></button>
        <button className={`hl-tab${tab === 'log' ? ' is-active' : ''}`} type="button" role="tab" aria-selected={tab === 'log'} onClick={() => setTab('log')}>작업 로그 <span className="hl-tag">{events.data ? `${evs.length}${events.data.hasMore ? '+' : ''}` : '…'}</span></button>
        <span className="hl-cap" style={{ marginLeft: 'auto', alignSelf: 'center' }}>수량 기준 (슬래브 매 · 코일 개) · 톤은 계산값</span>
      </div>
      <div className="so-detail__grid">
        {tab === 'fill' ? (
          <div className="hl-col" style={{ gap: 12, minWidth: 0 }}>
            <section className="hl-card" style={{ flex: 'none', minWidth: 0, overflowX: 'auto' }}>
              <table className="hl-table ft">
                <thead>
                  <tr>
                    <th>품목</th>
                    <th className="num">주문</th>
                    <th className="num" title="재고에서 잡은 예약 (ACTIVE)">예약(재고)</th>
                    <th className="num" title="부족분 생산분이 검사에 합격해 자동 예약된 수량">검사합격</th>
                    <th className="num" title="진행 중 생산계획의 남은 목표 (미확보 안에서만 센다)">생산중</th>
                    <th className="num">출하</th>
                    <th className="num" title="주문 − 출하 − 예약 − 검사합격">미확보</th>
                    <th className="num" title="미확보 − 진행 계획 잔여 목표">추가 계획 필요</th>
                    <th style={{ width: 130 }}>진행률</th>
                  </tr>
                </thead>
                <tbody>
                  {d.items.map((l) => {
                    const cancelled = l.salesOrderItemStatus === 'CANCELLED';
                    return (
                      <tr key={l.id} className={cancelled ? 'is-muted' : undefined}>
                        <td>
                          <ItemTitle it={l} />{' '}
                          <Badge tone={STATUS_TONE[l.salesOrderItemStatus]}>{SALES_ORDER_ITEM_STATUS_LABEL[l.salesOrderItemStatus]}</Badge>
                          <div className="hl-cap mono" style={{ marginTop: 1 }}>{l.specCode} · <span style={{ fontFamily: 'inherit' }}>{fmtTon(l.orderedTon)}</span>{cancelled ? ` · 취소 잔량 ${l.cancelledQty}${l.qtyUnit}` : ''}</div>
                        </td>
                        <td className="num"><Qty n={l.orderedQty} unit={l.qtyUnit} /></td>
                        <td className="num"><Qty n={l.reservedQty} unit={l.qtyUnit} muted /></td>
                        <td className="num"><Qty n={l.passedQty} unit={l.qtyUnit} muted ok /></td>
                        <td className="num"><Qty n={l.inProductionQty} unit={l.qtyUnit} muted /></td>
                        <td className="num"><Qty n={l.shippedQty} unit={l.qtyUnit} muted /></td>
                        <td className="num"><Qty n={l.unsecuredQty} unit={l.qtyUnit} muted /></td>
                        <td className="num">{l.additionalPlanNeededQty ? <span className="hl-sheets hl-danger-text">{l.additionalPlanNeededQty}<small>{l.qtyUnit}</small></span> : <span className="hl-muted">0{l.qtyUnit}</span>}</td>
                        <td><ProgressCell rate={l.progressRate} /></td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td>합계 <span className="hl-cap" style={{ fontWeight: 500 }}>{fmtTon(d.orderedTon)}{live.length !== d.items.length && live.length ? ' · 취소 품목 제외' : ''}</span></td>
                    <td className="num">{tot.ordered}{unit}</td>
                    <td className="num">{tot.reserved}{unit}</td>
                    <td className="num">{tot.passed}{unit}</td>
                    <td className="num">{tot.inProd}{unit}</td>
                    <td className="num">{tot.shipped}{unit}</td>
                    <td className="num">{tot.unsecured}{unit}</td>
                    <td className="num">{tot.need}{unit}</td>
                    <td><ProgressCell rate={d.progressRate} risk={d.isDeliveryRisk} /></td>
                  </tr>
                </tfoot>
              </table>
              <div className="hl-card__foot" style={{ flexWrap: 'wrap' }}>
                <Icon name="info" size="sm" />
                <span className="hl-cap" style={{ whiteSpace: 'normal' }}>
                  진행률 = (예약 + 검사합격 + 출하) ÷ 주문 · 생산중은 진행률에 넣지 않아요 · 예약 + 검사합격 + 출하 + 미확보 = 주문, 생산중 + 추가 계획 필요 = 미확보 (합이 주문을 넘지 않아요)
                </span>
              </div>
            </section>
            {d.items.filter((l) => l.additionalPlanNeededQty > 0).map((l) => (
              <div key={l.id} className="hl-banner hl-banner--wait" style={{ flex: 'none', alignItems: 'center', padding: '8px 12px' }}>
                <Icon name="alert" style={{ marginTop: 0 }} />
                <span style={{ fontSize: 12.5 }}>품목 {l.lineNo} · 추가 계획 필요 {l.additionalPlanNeededQty}{l.qtyUnit} — 미확보 {l.unsecuredQty}{l.qtyUnit} 가운데 진행 중인 생산계획으로 채워지지 않는 수량이에요</span>
                <Link to="/production/plans" className="hl-banner__actions" style={{ fontSize: 12 }}>생산계획</Link>
              </div>
            ))}
            <div className="hl-row" style={{ flex: 'none', flexWrap: 'wrap', rowGap: 4 }}>
              <b style={{ fontSize: 13 }}>수량 구성</b>
              <span className="hl-cap">막대 전체 = 주문 수량</span>
              <FulfillLegend style={{ marginLeft: 'auto' }} />
            </div>
            {d.items.map((l) => {
              const open = l.productionPlans.filter((p) => p.productionPlanStatus !== 'COMPLETED' && p.productionPlanStatus !== 'CANCELLED');
              return (
                <div key={l.id} className="ib">
                  <div className="hl-row" style={{ fontSize: 12.5, flexWrap: 'wrap' }}>
                    <span><ItemTitle it={l} /> · {l.orderedQty}{l.qtyUnit}</span>
                    <span className="hl-cap" style={{ marginLeft: 'auto' }}>
                      {l.salesOrderItemStatus === 'CANCELLED' ? `취소 · 잔량 ${l.cancelledQty}${l.qtyUnit}`
                        : open.length ? <>생산중 {l.inProductionQty}{l.qtyUnit} = {open.map((p, i) => <span key={p.id}>{i ? ' · ' : ''}<Link className="mono" to={planHref(p.id)}>{p.productionPlanNo}</Link> {planLabel(p.productionPlanStatus)}</span>)}</>
                          : l.progressRate >= 100 ? '확보 완료' : '진행 중인 생산계획 없음'}
                    </span>
                  </div>
                  <FulfillStack it={l} height={18} />
                  <div className="hl-cap">
                    예약 {l.reservedQty} · 생산중 {l.inProductionQty} · 검사합격 {l.passedQty} · 출하 {l.shippedQty}
                    {l.salesOrderItemStatus !== 'CANCELLED' && l.additionalPlanNeededQty ? ` · 남음(추가 계획 필요) ${l.additionalPlanNeededQty}` : ''} / 주문 {l.orderedQty}{l.qtyUnit}
                  </div>
                </div>
              );
            })}
            <div className="so-detail__two">
              <section className="hl-card">
                <header className="hl-card__head" style={{ height: 40 }}>
                  <Icon name="truck" style={{ color: '#3F4A57' }} />
                  <h3>출하 준비</h3>
                </header>
                <div className="hl-card__body" style={{ padding: '12px 14px', gap: 8 }}>
                  <dl className="hl-kv" style={{ rowGap: 6, fontSize: 12.5 }}>
                    {d.items.map((l) => (
                      <FragmentRow key={l.id} label={`품목 ${l.lineNo} ${ITEM_TYPE_LABEL[l.itemType]}`}>
                        {[l.reservedQty ? `예약 ${l.reservedQty}${l.qtyUnit}` : '', l.passedQty ? `검사합격 ${l.passedQty}${l.qtyUnit}` : ''].filter(Boolean).join(' + ') || '확보된 수량 없음'}
                        {l.shippedQty ? <span className="hl-cap"> · 출하 {l.shippedQty}{l.qtyUnit}</span> : null}
                      </FragmentRow>
                    ))}
                  </dl>
                  <span className="hl-cap">LOT은 출하요청 때 선입선출(생산완료일 오래된 순)로 추천받아 확정해요</span>
                  {canShip ? <Link className="hl-btn hl-btn--sm hl-btn--primary" to={shipmentNewHref(d.id)} style={{ marginTop: 'auto', alignSelf: 'flex-start' }}><Icon name="truck" />출하요청 만들기</Link> : null}
                </div>
              </section>
              <section className="hl-card">
                <header className="hl-card__head" style={{ height: 40 }}>
                  <Icon name="hash" style={{ color: '#3F4A57' }} />
                  <h3>업무방</h3>
                  <span className="hl-card__meta">#{d.salesOrderNo}</span>
                </header>
                <div className="hl-card__body" style={{ padding: '12px 14px', gap: 10 }}>
                  <span className="hl-cap">{d.workRoomId ? '수주 담당자와 생산·품질·물류·구매 부서장이 함께 있는 방이에요. 열면 멤버로 들어가요.' : '아직 업무방이 없어요 · 열면 만들어져요'}</span>
                  <WorkRoomButton salesOrderId={d.id} className="hl-btn hl-btn--sm"><Icon name="chat" />업무방 열기</WorkRoomButton>
                </div>
              </section>
            </div>
          </div>
        ) : tab === 'links' ? (
          <div className="hl-col" style={{ gap: 12, minWidth: 0 }}>
            <section className="hl-card" style={{ flex: 'none', minWidth: 0, overflowX: 'auto' }}>
              <header className="hl-card__head"><h3>생산계획</h3><span className="hl-card__meta">{plans.length}건</span></header>
              <table className="hl-table hl-table--compact">
                <thead><tr><th>계획번호</th><th>품목</th><th>상태</th><th className="num">목표</th><th className="num">남은 목표</th><th className="num">히트</th><th className="num">계획 슬래브</th><th className="num">여재 사용</th></tr></thead>
                <tbody>
                  {plans.map((p) => (
                    <tr key={p.id}>
                      <td><Link className="hl-link-id" to={planHref(p.id)}>{p.productionPlanNo}</Link>{p.isReproduction ? <> <Badge tone="wait">재생산</Badge></> : null}</td>
                      <td>품목 {p.lineNo}</td>
                      <td><Badge tone={planTone(p.productionPlanStatus)}>{planLabel(p.productionPlanStatus)}</Badge></td>
                      <td className="num">{p.shortageQty}{p.unit}</td>
                      <td className="num">{p.remainingTargetQty}{p.unit}</td>
                      <td className="num">{p.heatCount}</td>
                      <td className="num">{p.plannedSlabQty}매</td>
                      <td className="num">{p.surplusUseQty}매</td>
                    </tr>
                  ))}
                  {!plans.length ? <tr><td colSpan={8} style={{ borderBottom: 0 }}><EmptyNote>연결된 생산계획이 없어요 · 재고로 전량 예약됐거나 부족분이 없어요</EmptyNote></td></tr> : null}
                </tbody>
              </table>
            </section>
            <section className="hl-card" style={{ flex: 'none', minWidth: 0, overflowX: 'auto' }}>
              <header className="hl-card__head"><h3>LOT</h3><span className="hl-card__meta">{lots.length}건 · 이 수주를 위해 생산·귀속됐거나 배정된 LOT</span></header>
              <table className="hl-table hl-table--compact">
                <thead><tr><th>LOT</th><th>품목</th><th>히트</th><th>상태</th><th>배정</th><th className="num">생산완료</th></tr></thead>
                <tbody>
                  {lots.map((l) => (
                    <tr key={l.id}>
                      <td><Link className="hl-link-id" to={lotHref(l.lotNo)}>{l.lotNo}</Link></td>
                      <td>품목 {l.lineNo}</td>
                      <td>{l.heatNo ? <Link className="mono" to={lotHref(l.heatNo)}>{l.heatNo}</Link> : '—'}</td>
                      <td><Badge tone={lotTone(l)}>{lotLabel(l)}</Badge></td>
                      <td className="hl-ink2">{l.allocationPurpose && l.allocationStatus ? `${ALLOCATION_PURPOSE_LABEL[l.allocationPurpose]} · ${ALLOCATION_STATUS_LABEL[l.allocationStatus]}` : <span className="hl-muted">배정 전</span>}</td>
                      <td className="num hl-cap">{fmtMDHM(l.producedAt)}</td>
                    </tr>
                  ))}
                  {!lots.length ? <tr><td colSpan={6} style={{ borderBottom: 0 }}><EmptyNote>연결된 LOT이 없어요 · 예약은 LOT을 정하지 않아요 (출하요청 때 배정해요)</EmptyNote></td></tr> : null}
                </tbody>
              </table>
            </section>
          </div>
        ) : tab === 'reservations' ? (
          <section className="hl-card" style={{ alignSelf: 'start', minWidth: 0, overflowX: 'auto' }}>
            <QueryBoundary query={reservations}>
              {(rs) => (
                <>
                  <table className="hl-table hl-table--compact">
                    <thead><tr><th>품목</th><th>규격 코드</th><th>상태</th><th className="num">예약 수량</th><th className="num">톤 (계산값)</th><th>구분</th><th className="num">생성</th><th className="num">변경</th></tr></thead>
                    <tbody>
                      {rs.map((r) => (
                        <tr key={r.id} className={r.status === 'RELEASED' ? 'is-muted' : undefined}>
                          <td><span className="hl-tag">{r.lineNo}</span> {ITEM_TYPE_LABEL[r.itemType]}</td>
                          <td className="mono">{r.specCode}</td>
                          <td><Badge tone={RESERVATION_TONE[r.status]} title={r.status}>{RESERVATION_STATUS_LABEL[r.status]}</Badge></td>
                          <td className="num">{r.reservedQty}{ITEM_QTY_UNIT[r.itemType]}</td>
                          <td className="num">{fmtTon(r.reservedTon)}</td>
                          <td>{r.isAutoReserved ? <span className="hl-row" style={{ gap: 4 }}><span className="hl-actor hl-actor--system">시스템</span>자동 예약</span> : '수주 등록 시 재고 예약'}</td>
                          <td className="num hl-cap">{fmtMDHM(r.createdAt)}</td>
                          <td className="num hl-cap">{r.updatedAt !== r.createdAt ? fmtMDHM(r.updatedAt) : '—'}</td>
                        </tr>
                      ))}
                      {!rs.length ? <tr><td colSpan={8} style={{ borderBottom: 0 }}><EmptyNote>예약 이력이 없어요</EmptyNote></td></tr> : null}
                    </tbody>
                  </table>
                  <div className="hl-card__foot">
                    <span className="hl-cap" style={{ whiteSpace: 'normal' }}>예약은 수량만 잡고 LOT은 정하지 않아요 · 출고가 확정되면 "{RESERVATION_STATUS_LABEL.CONVERTED}", 수주를 취소하면 "{RESERVATION_STATUS_LABEL.RELEASED}"가 돼요 · 부분 출고는 예약을 둘로 나눠요 · 자동 예약 = 부족분 생산분이 검사에 합격했을 때</span>
                  </div>
                </>
              )}
            </QueryBoundary>
          </section>
        ) : (
          <section className="hl-card" style={{ alignSelf: 'start', minWidth: 0, overflowX: 'auto' }}>
            <QueryBoundary query={events}>
              {(ev) => (
                <>
                  <table className="hl-table hl-table--compact">
                    <tbody>
                      {ev.items.map((e) => (
                        <tr key={e.id}>
                          <td className="tnum hl-cap" style={{ width: 84 }}>{fmtMDHM(e.occurredAt)}</td>
                          <td style={{ width: 76 }}><ActorChip e={e} /></td>
                          <td style={{ width: 84 }}><span className="hl-evt">{e.eventTypeLabel}</span></td>
                          <td style={{ whiteSpace: 'normal' }}>{e.summary}{e.reason ? <span className="hl-cap"> — {e.reason}</span> : null}</td>
                        </tr>
                      ))}
                      {!ev.items.length ? <tr><td style={{ borderBottom: 0 }}><EmptyNote>기록된 작업이 없어요</EmptyNote></td></tr> : null}
                    </tbody>
                  </table>
                  <div className="hl-card__foot">
                    <span className="hl-cap">최근순 {ev.items.length}건{ev.hasMore ? ' · 더 있어요' : ''}</span>
                    <Link className="hl-btn hl-btn--sm" to={eventsHref(d.id)} style={{ marginLeft: 'auto' }}><Icon name="history" />시간순으로 전체 보기</Link>
                  </div>
                </>
              )}
            </QueryBoundary>
          </section>
        )}
        <aside className="side">
          <div className="sbox">
            <b>진행률</b>
            <div className="hl-row" style={{ gap: 10 }}>
              <span style={{ fontSize: 28, lineHeight: '32px', fontWeight: 600 }} className="tnum">
                {d.progressRate}
                <small style={{ fontSize: 14, color: '#5E6977' }}>%</small>
              </span>
              <span className="hl-cap">{tot.ordered}{unit} 중 확보 {tot.reserved + tot.passed + tot.shipped}{unit}<br />출하 {d.shippedQty}{unit} · {fmtTon(d.shippedTon)}</span>
            </div>
            <ProgressCell rate={d.progressRate} risk={d.isDeliveryRisk} barStyle={{ height: 8 }} />
            <span className="hl-cap">(예약 + 검사합격 + 출하) ÷ 주문</span>
          </div>
          <div className="sbox">
            <b>생산 연결</b>
            {plans.slice(0, 3).map((p) => (
              <div key={`p${p.id}`} className="hl-row" style={{ fontSize: 12 }}>
                <Link className="hl-link-id" to={planHref(p.id)} style={{ fontSize: 11.5 }}>{p.productionPlanNo}</Link>
                <span style={{ marginLeft: 'auto' }}><Badge tone={planTone(p.productionPlanStatus)}>{planLabel(p.productionPlanStatus)}</Badge></span>
              </div>
            ))}
            {lots.slice(0, 4).map((l) => (
              <div key={`l${l.id}`} className="hl-row" style={{ fontSize: 12 }}>
                <Link className="hl-link-id" to={lotHref(l.lotNo)} style={{ fontSize: 11.5 }}>{l.lotNo}</Link>
                <span style={{ marginLeft: 'auto' }}><Badge tone={lotTone(l)}>{lotLabel(l)}</Badge></span>
              </div>
            ))}
            {!plans.length && !lots.length ? <span className="hl-cap">연결된 생산계획·LOT 없음</span> : null}
            {plans.length + lots.length > 0 ? <button type="button" className="hl-btn hl-btn--ghost hl-btn--sm" style={{ alignSelf: 'flex-start' }} onClick={() => setTab('links')}>생산계획 {plans.length}건 · LOT {lots.length}건 모두 보기</button> : null}
          </div>
          <div className="sbox" style={{ flex: 1 }}>
            <div className="hl-row">
              <b style={{ fontSize: 12.5 }}>최근 작업 로그</b>
              <Link className="hl-cap" to={eventsHref(d.id)} style={{ marginLeft: 'auto', color: '#1F5FCC' }}>전체 보기</Link>
            </div>
            {events.isLoading ? <Spinner /> : null}
            {events.error ? <span className="hl-cap hl-danger-text">작업 로그를 불러오지 못했어요</span> : null}
            {evs.slice(0, 6).map((e) => (
              <div key={e.id} className="hl-col" style={{ gap: 2, fontSize: 12 }}>
                <div className="hl-row" style={{ gap: 6 }}>
                  <ActorChip e={e} />
                  <span className="hl-evt">{e.eventTypeLabel}</span>
                  <time className="hl-cap tnum" style={{ marginLeft: 'auto' }}>{fmtMDHM(e.occurredAt)}</time>
                </div>
                <span className="hl-ink2">{e.summary}</span>
              </div>
            ))}
            {events.data && !evs.length ? <span className="hl-cap">기록된 작업이 없어요</span> : null}
          </div>
        </aside>
      </div>
      {cancelOpen ? <CancelOrderModal order={d} onClose={() => setCancelOpen(false)} /> : null}
    </>
  );
}

function FragmentRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  );
}
