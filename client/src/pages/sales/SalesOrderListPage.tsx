// 수주 목록 (REQ-SO-004·005). 모양은 v1 B안 s10: 필터 레일 | 표 | 선택한 수주 미리보기.
// 모든 숫자·상태는 GET /sales-orders, GET /sales-orders/:id/fulfillment, GET /business-events 응답에서 온다.
import { useEffect, useState, type MouseEvent } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { ITEM_TYPE_LABEL, SALES_ORDER_STATUS_LABEL, type SalesOrderStatus } from '@fantasteel/shared';
import { salesOrderApi, type ListSalesOrdersQuery, type SalesOrderItemView, type SalesOrderView } from '@/api/salesOrders';
import { DateInput } from '@/components/DateInput';
import { Badge, EmptyNote, Icon, QueryBoundary, Spinner } from '@/components/ui';
import {
  DueCell, EventLine, FulfillLegend, FulfillStack, ItemTitle, LockHint, OrderNoLink, ProgressCell, RiskBadge, STATUS_KEYS, StatusBadge, SummaryCell,
  WorkRoomButton, dueLabel, eventsHref, lotHref, lotLabel, lotTone, planHref, planLabel, planTone, shipmentNewHref, sumOf, unitOf, useLookups, useOrderEvents,
} from '@/features/sales/salesUi';
import { fmtDate, fmtMD, fmtMDHM, fmtTon, todayStr } from '@/lib/format';
import { canUse, useMe } from '@/stores/auth';
import './SalesOrderListPage.css';

const PAGE_SIZE = 50;
const pad = (n: number) => String(n).padStart(2, '0');
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
function monthRange(today: string): [string, string] {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  return [`${y}-${pad(m)}-01`, `${y}-${pad(m)}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`];
}

interface Filters {
  status: SalesOrderStatus | '';
  customerId: number | '';
  itemType: 'SLAB' | 'COIL' | '';
  dueFrom: string;
  dueTo: string;
  riskOnly: boolean;
}
const EMPTY: Filters = { status: '', customerId: '', itemType: '', dueFrom: '', dueTo: '', riskOnly: false };
const SEG: (SalesOrderStatus | '')[] = ['', 'REGISTERED', 'IN_PROGRESS', 'PARTIALLY_SHIPPED', 'SHIPPED'];

export function SalesOrderListPage() {
  const me = useMe();
  const canCreate = canUse(me, 'ORDER_CREATE');
  const lookups = useLookups();
  const [f, setF] = useState<Filters>(EMPTY);
  const [keywordText, setKeywordText] = useState('');
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [sel, setSel] = useState<number | null>(null);

  // 검색어는 입력이 멈춘 뒤에 조회한다
  useEffect(() => {
    const t = setTimeout(() => { setKeyword(keywordText.trim()); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [keywordText]);

  const set = (patch: Partial<Filters>) => { setF((prev) => ({ ...prev, ...patch })); setPage(1); };
  const reset = () => { setF(EMPTY); setKeywordText(''); setKeyword(''); setPage(1); };

  const query: ListSalesOrdersQuery = {
    status: f.status || undefined,
    customerId: f.customerId || undefined,
    itemType: f.itemType || undefined,
    dueFrom: f.dueFrom || undefined,
    dueTo: f.dueTo || undefined,
    deliveryRiskOnly: f.riskOnly || undefined,
    keyword: keyword || undefined,
    page,
    size: PAGE_SIZE,
  };
  const list = useQuery({ queryKey: ['sales-orders', 'list', query], queryFn: () => salesOrderApi.list(query), placeholderData: keepPreviousData });

  const today = todayStr();
  const d7: [string, string] = [today, addDays(today, 7)];
  const month = monthRange(today);
  const isRange = (r: [string, string]) => f.dueFrom === r[0] && f.dueTo === r[1];
  const toggleRange = (r: [string, string]) => set(isRange(r) ? { dueFrom: '', dueTo: '' } : { dueFrom: r[0], dueTo: r[1] });
  const dueErr = !!f.dueFrom && !!f.dueTo && f.dueFrom > f.dueTo;
  const activeCount = [f.status, f.customerId, f.itemType, f.dueFrom || f.dueTo, f.riskOnly, keyword].filter(Boolean).length;

  const rows = list.data?.rows ?? [];
  const selRow = rows.find((r) => r.id === sel) ?? rows[0] ?? null;
  const total = list.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / (list.data?.size ?? PAGE_SIZE)));
  const pick = (e: MouseEvent, id: number) => {
    if ((e.target as HTMLElement).closest('a,button,input')) return;
    setSel(id);
  };

  return (
    <>
      <section className="hl-master so-list" aria-label="필터" style={{ width: 236 }}>
        <div className="hl-master__head" style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Icon name="filter" style={{ color: '#3F4A57' }} />
          <b style={{ fontSize: 14 }}>필터</b>
          <span className="hl-tag">적용 {activeCount}</span>
          <button className="hl-btn hl-btn--ghost hl-btn--sm" style={{ marginLeft: 'auto' }} type="button" onClick={reset}>초기화</button>
        </div>
        <div className="hl-master__list">
          <div className="fg">
            <b>상태</b>
            <label className="fc"><input type="radio" name="so-status" checked={!f.status} onChange={() => set({ status: '' })} />전체</label>
            {STATUS_KEYS.map((k) => (
              <label key={k} className="fc">
                <input type="radio" name="so-status" checked={f.status === k} onChange={() => set({ status: k })} />
                {SALES_ORDER_STATUS_LABEL[k]}
              </label>
            ))}
            <label className="fc" style={{ marginTop: 6, height: 30, padding: '0 8px', border: '1px solid #F2C3BE', borderRadius: 4, background: '#FCEAE8', color: '#C0322B', fontWeight: 600 }}>
              <input type="checkbox" checked={f.riskOnly} onChange={() => set({ riskOnly: !f.riskOnly })} />
              납기 위험만
            </label>
          </div>
          <div className="fg">
            <b>고객사</b>
            <label className="fc"><input type="radio" name="so-customer" checked={f.customerId === ''} onChange={() => set({ customerId: '' })} />전체</label>
            {(lookups.data?.customers ?? []).map((c) => (
              <label key={c.id} className="fc">
                <input type="radio" name="so-customer" checked={f.customerId === c.id} onChange={() => set({ customerId: c.id })} />
                {c.customerName}
              </label>
            ))}
            {lookups.isLoading ? <span className="hl-cap">불러오는 중…</span> : null}
            {lookups.error ? <span className="hl-cap hl-danger-text">고객사 목록을 불러오지 못했어요</span> : null}
          </div>
          <div className="fg">
            <b>품목 유형</b>
            <label className="fc"><input type="radio" name="so-type" checked={!f.itemType} onChange={() => set({ itemType: '' })} />전체</label>
            <label className="fc">
              <input type="radio" name="so-type" checked={f.itemType === 'COIL'} onChange={() => set({ itemType: 'COIL' })} />
              <Icon name="coil" size="sm" />
              {ITEM_TYPE_LABEL.COIL}
            </label>
            <label className="fc">
              <input type="radio" name="so-type" checked={f.itemType === 'SLAB'} onChange={() => set({ itemType: 'SLAB' })} />
              <Icon name="slab" size="sm" />
              {ITEM_TYPE_LABEL.SLAB}
            </label>
          </div>
          <div className="fg" style={{ borderBottom: 0, gap: 6 }}>
            <b>납기</b>
            <div className="hl-col" style={{ gap: 6 }}>
              <DateInput value={f.dueFrom} onChange={(v) => set({ dueFrom: v })} ariaLabel="납기 시작" placeholder="시작일" width={204} invalid={dueErr} />
              <DateInput value={f.dueTo} onChange={(v) => set({ dueTo: v })} ariaLabel="납기 끝" placeholder="종료일" width={204} invalid={dueErr} />
            </div>
            {dueErr ? <span className="hl-cap hl-danger-text">시작일이 종료일보다 늦어요</span> : null}
            <div className="hl-row" style={{ gap: 4 }}>
              <button className={`hl-chip${isRange(d7) ? ' is-on' : ''}`} style={{ height: 24 }} type="button" onClick={() => toggleRange(d7)}>D-7 이내</button>
              <button className={`hl-chip${isRange(month) ? ' is-on' : ''}`} style={{ height: 24 }} type="button" onClick={() => toggleRange(month)}>이번 달</button>
            </div>
          </div>
        </div>
      </section>
      <main className="hl-main so-list" style={{ padding: '16px 20px', gap: 12 }}>
        <div className="hl-row" style={{ gap: 10, flex: 'none', flexWrap: 'wrap' }}>
          <label className="hl-inputwrap" style={{ width: 260 }}>
            <Icon name="search" size="sm" />
            <input className="hl-input" type="search" placeholder="수주번호·고객사·규격 코드" aria-label="수주 검색" value={keywordText} onChange={(e) => setKeywordText(e.target.value)} />
          </label>
          <div className="hl-seg" role="tablist" aria-label="상태 탭">
            {SEG.map((k) => (
              <button key={k || 'ALL'} className={f.status === k ? 'is-on' : undefined} type="button" role="tab" aria-selected={f.status === k} onClick={() => set({ status: k })}>
                {k ? SALES_ORDER_STATUS_LABEL[k] : '전체'}
              </button>
            ))}
          </div>
          <span className="hl-cap">{list.data ? `${total.toLocaleString('en-US')}건` : ''}{list.isFetching && list.data ? ' · 새로 불러오는 중…' : ''}</span>
          <div className="hl-row" style={{ marginLeft: 'auto', gap: 8 }}>
            {selRow ? <Link className="hl-btn" to={eventsHref(selRow.id)} title={`${selRow.salesOrderNo} 작업 로그`}><Icon name="history" />작업 로그</Link> : <Link className="hl-btn" to="/business-events"><Icon name="history" />작업 로그</Link>}
            {canCreate ? (
              <Link className="hl-btn hl-btn--primary" to="/sales-orders/new"><Icon name="plus" />수주 등록</Link>
            ) : (
              <button className="hl-btn hl-btn--primary" type="button" disabled title="권한이 필요해요"><Icon name="plus" />수주 등록</button>
            )}
          </div>
        </div>
        {!canCreate ? <LockHint>수주 등록은 영업 권한(수주 등록)이 필요해요 · 조회는 할 수 있어요</LockHint> : null}
        <QueryBoundary query={list} loadingLabel="수주를 불러오는 중…">
          {() => (
            <>
              <section className="hl-card" style={{ flex: 'none', minWidth: 0, overflowX: 'auto' }}>
                <table className="hl-table tb">
                  <thead>
                    <tr>
                      <th>수주번호</th>
                      <th>고객사</th>
                      <th>품목 요약</th>
                      <th className="num">주문 수량</th>
                      <th className="num" title="매수 × 1매 이론중량 계산값">이론중량</th>
                      <th style={{ width: 140 }}>충족 진행률</th>
                      <th>상태</th>
                      <th>납기</th>
                      <th>담당</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => {
                      const bb = i === rows.length - 1 ? { borderBottom: 0 } : undefined;
                      const on = r.id === selRow?.id;
                      const muted = r.salesOrderStatus === 'SHIPPED' || r.salesOrderStatus === 'CANCELLED';
                      return (
                        <tr key={r.id} className={on ? 'is-selected' : r.isDeliveryRisk ? 'is-risk' : muted ? 'is-muted' : undefined} style={{ cursor: 'pointer' }} onClick={(e) => pick(e, r.id)} aria-selected={on}>
                          <td style={bb}><OrderNoLink o={r} style={on ? { fontWeight: 600 } : undefined} /></td>
                          <td style={bb}>{r.customer.customerName}</td>
                          <td style={bb}><SummaryCell items={r.items} /></td>
                          <td className="num" style={bb}><span className="hl-sheets">{r.orderedQty.toLocaleString('en-US')}<small>{unitOf(r.items)}</small></span></td>
                          <td className="num" style={bb}>{fmtTon(r.orderedTon)}</td>
                          <td style={bb}><ProgressCell rate={r.progressRate} risk={r.isDeliveryRisk} /></td>
                          <td style={bb}>
                            <span className="hl-row" style={{ gap: 4 }}>
                              <StatusBadge status={r.salesOrderStatus} />
                              {r.isDeliveryRisk ? <RiskBadge /> : null}
                            </span>
                          </td>
                          <td style={bb}><DueCell o={r} date={fmtMD(r.dueDate)} /></td>
                          <td style={bb}>{r.ownerEmployee.employeeName}</td>
                        </tr>
                      );
                    })}
                    {!rows.length ? (
                      <tr><td colSpan={9} style={{ borderBottom: 0 }}><EmptyNote>{activeCount ? '조건에 맞는 수주가 없어요 · 왼쪽 필터를 초기화해 보세요' : '등록된 수주가 없어요'}</EmptyNote></td></tr>
                    ) : null}
                  </tbody>
                </table>
                {pages > 1 ? (
                  <div className="hl-card__foot">
                    <span className="hl-cap">{total.toLocaleString('en-US')}건 중 {(page - 1) * PAGE_SIZE + 1}~{Math.min(total, page * PAGE_SIZE)}</span>
                    <div className="hl-row" style={{ marginLeft: 'auto', gap: 6 }}>
                      <button className="hl-btn hl-btn--sm" type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}><Icon name="chevron-left" />이전</button>
                      <span className="hl-cap tnum">{page} / {pages}</span>
                      <button className="hl-btn hl-btn--sm" type="button" disabled={page >= pages} onClick={() => setPage(page + 1)}>다음<Icon name="chevron-right" /></button>
                    </div>
                  </div>
                ) : null}
              </section>
              <section className="hl-card" style={{ flex: '1 0 auto', minWidth: 0 }} aria-label="선택한 수주 미리보기">
                {selRow ? <Preview key={selRow.id} row={selRow} /> : <EmptyNote style={{ padding: '32px 16px' }}>미리 볼 수주가 없어요</EmptyNote>}
              </section>
            </>
          )}
        </QueryBoundary>
      </main>
    </>
  );
}

const capOf = (l: SalesOrderItemView) =>
  `예약 ${l.reservedQty} · 생산중 ${l.inProductionQty} · 검사합격 ${l.passedQty} · 출하 ${l.shippedQty}` +
  (l.salesOrderItemStatus === 'CANCELLED' ? ` · 취소 ${l.cancelledQty}` : l.additionalPlanNeededQty ? ` · 남음 ${l.additionalPlanNeededQty}` : '');

/** 선택한 수주 미리보기: 품목별 충족 막대, 연결된 생산계획·LOT, 최근 작업 로그, 업무방. */
function Preview({ row }: { row: SalesOrderView }) {
  const ful = useQuery({ queryKey: ['sales-orders', 'fulfillment', row.id], queryFn: () => salesOrderApi.fulfillment(row.id) });
  const events = useOrderEvents(row.id, 8);
  const d = ful.data ?? null;
  const o = d ?? row;
  const items: SalesOrderItemView[] = d?.items ?? row.items;
  const plans = d ? d.items.flatMap((it) => it.productionPlans.map((p) => ({ ...p, lineNo: it.lineNo, unit: it.qtyUnit }))) : [];
  const lots = d ? d.items.flatMap((it) => it.lots.map((l) => ({ ...l, lineNo: it.lineNo }))) : [];
  const unit = unitOf(items);
  const live = items.filter((it) => it.salesOrderItemStatus !== 'CANCELLED');
  const base = live.length ? live : items;
  const secured = sumOf(base, (it) => it.reservedQty + it.passedQty + it.shippedQty);
  const LINKS = 6;
  return (
    <>
      <header className="hl-card__head" style={{ minHeight: 52, height: 'auto', flexWrap: 'wrap', rowGap: 6, paddingTop: 8, paddingBottom: 8 }}>
        <span className="hl-cap">미리보기</span>
        <OrderNoLink o={o} style={{ fontSize: 15, fontWeight: 600 }} />
        <b style={{ fontSize: 14 }}>{o.customer.customerName}</b>
        <StatusBadge status={o.salesOrderStatus} />
        {o.isDeliveryRisk ? <RiskBadge /> : null}
        <span className="hl-cap">등록 {fmtMDHM(o.createdAt)} · {o.ownerEmployee.employeeName} · 납기 {fmtDate(o.dueDate)} ({dueLabel(o.daysToDue)})</span>
        <div className="hl-card__actions">
          <WorkRoomButton salesOrderId={o.id}><Icon name="chat" />업무방</WorkRoomButton>
          <Link className="hl-btn hl-btn--sm" to={shipmentNewHref(o.id)}><Icon name="truck" />출하요청 만들기</Link>
          <Link className="hl-btn hl-btn--sm hl-btn--primary" to={`/sales-orders/${o.id}`}>상세 보기<Icon name="arrow-right" /></Link>
        </div>
      </header>
      <div className="so-list__preview">
        <div className="hl-col" style={{ padding: '14px 16px', gap: 14, borderRight: '1px solid #DDE2E7', minWidth: 0 }}>
          <div className="hl-row" style={{ flexWrap: 'wrap', rowGap: 4 }}>
            <b style={{ fontSize: 13 }}>품목별 충족 (수량)</b>
            <FulfillLegend style={{ marginLeft: 'auto' }} />
          </div>
          {items.map((l) => (
            <div key={l.id} className="hl-col" style={{ gap: 6 }}>
              <div className="hl-row" style={{ fontSize: 12.5, flexWrap: 'wrap' }}>
                <span><ItemTitle it={l} /></span>
                <span className="hl-muted">· {l.orderedQty}{l.qtyUnit} {fmtTon(l.orderedTon)}</span>
                {l.salesOrderItemStatus === 'CANCELLED' ? <Badge tone="danger">{SALES_ORDER_STATUS_LABEL.CANCELLED}</Badge> : null}
                <b style={{ marginLeft: 'auto' }}>{Math.floor(l.progressRate)}%</b>
              </div>
              <FulfillStack it={l} />
              <div className="hl-cap">{capOf(l)}</div>
            </div>
          ))}
          <div className="hl-col" style={{ gap: 6, paddingTop: 10, borderTop: '1px solid #DDE2E7' }}>
            <b style={{ fontSize: 13 }}>생산 연결</b>
            {ful.isLoading ? <Spinner /> : null}
            {ful.error ? <span className="hl-cap hl-danger-text">연결된 생산계획·LOT을 불러오지 못했어요</span> : null}
            {plans.map((p) => (
              <div key={`p${p.id}`} className="hl-row" style={{ fontSize: 12, gap: 8 }}>
                <Link className="hl-link-id" to={planHref(p.id)}>{p.productionPlanNo}</Link>
                <span className="hl-muted">품목 {p.lineNo} · 목표 {p.shortageQty}{p.unit} · 남은 목표 {p.remainingTargetQty}{p.unit}{p.isReproduction ? ' · 재생산' : ''}</span>
                <Badge tone={planTone(p.productionPlanStatus)}>{planLabel(p.productionPlanStatus)}</Badge>
              </div>
            ))}
            {lots.slice(0, LINKS).map((l) => (
              <div key={`l${l.id}`} className="hl-row" style={{ fontSize: 12, gap: 8 }}>
                <Link className="hl-link-id" to={lotHref(l.lotNo)}>{l.lotNo}</Link>
                <span className="hl-muted">품목 {l.lineNo} · 생산완료 {fmtMDHM(l.producedAt)}</span>
                <Badge tone={lotTone(l)}>{lotLabel(l)}</Badge>
              </div>
            ))}
            {lots.length > LINKS ? <Link className="hl-cap" to={`/sales-orders/${o.id}`} style={{ color: '#1F5FCC' }}>LOT 외 {lots.length - LINKS}건 · 상세에서 보기</Link> : null}
            {d && !plans.length && !lots.length ? <span className="hl-cap">연결된 생산계획·LOT이 없어요 · 예약 수량은 LOT을 정하지 않아요 (출하요청 때 배정해요)</span> : null}
          </div>
          <div className="hl-row" style={{ marginTop: 'auto', paddingTop: 10, borderTop: '1px dashed #C3CBD4' }}>
            <span className="hl-cap">전체 {sumOf(base, (it) => it.orderedQty)}{unit} 중 확보 {secured}{unit} · 진행률 = (예약 + 검사합격 + 출하) ÷ 주문 수량</span>
            <b style={{ marginLeft: 'auto', fontSize: 16 }}>{Math.floor(o.progressRate)}%</b>
          </div>
        </div>
        <div className="hl-col" style={{ padding: '14px 16px', gap: 10, minWidth: 0 }}>
          <div className="hl-row">
            <b style={{ fontSize: 13 }}>최근 작업 로그</b>
            <Link className="hl-cap" to={eventsHref(o.id)} style={{ marginLeft: 'auto', color: '#1F5FCC' }}>전체 보기</Link>
          </div>
          {events.isLoading ? <Spinner /> : null}
          {events.error ? <span className="hl-cap hl-danger-text">작업 로그를 불러오지 못했어요</span> : null}
          {(events.data?.items ?? []).map((e) => <EventLine key={e.id} e={e} />)}
          {events.data && !events.data.items.length ? <span className="hl-cap">기록된 작업이 없어요</span> : null}
          <div className="hl-row" style={{ marginTop: 'auto', gap: 8, paddingTop: 10, borderTop: '1px dashed #C3CBD4' }}>
            <Icon name="hash" size="sm" style={{ color: '#5E6977' }} />
            <WorkRoomButton salesOrderId={o.id} className="hl-btn hl-btn--ghost hl-btn--sm">업무방 #{o.salesOrderNo}</WorkRoomButton>
            <span className="hl-cap">{o.workRoomId ? '수주 담당자와 생산·품질·물류·구매 부서장이 함께 있어요' : '아직 업무방이 없어요 · 열면 만들어져요'}</span>
          </div>
        </div>
      </div>
    </>
  );
}
