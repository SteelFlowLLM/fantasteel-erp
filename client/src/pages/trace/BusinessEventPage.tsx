// 작업 로그 · Decision Replay (REQ-LOG-001~003, BP-LOG-01). 조회 전용 — 이벤트는 수정·삭제할 수 없다.
// 주소: /business-events?salesOrderId=&so=&lot=<lotNo>|lotId=&includeLineage=true&eventType=&actorType=&targetType=&from=&to=&q=&order=
//  - 수주 또는 LOT을 고르면 시간순 타임라인(오래된 순), 아니면 최근 이벤트(최신순).
import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { BUSINESS_EVENT_TYPE_LABEL, EVENT_TARGET_TYPE, type ActorType, type BusinessEventType, type EventTargetType } from '@fantasteel/shared';
import { businessEventApi, type BusinessEventView } from '@/api/businessEvents';
import { lotApi } from '@/api/lots';
import { ApiError } from '@/api/client';
import { DateInput } from '@/components/DateInput';
import { EmptyNote, QueryBoundary, SoonButton, Spinner, StateView } from '@/components/ui';
import { fmtDate, fmtInt } from '@/lib/format';
import { useShellTitle } from '@/shell/shellTitle';
import { useBusinessEvents } from '@/features/trace/eventHooks';
import { EventRow, Legend, TARGET_TYPE_LABEL, dayLabel } from '@/features/trace/eventUi';
import { PickerInput } from '@/features/trace/PickerInput';
import { useDebounced, useLotByNo, useLotDetail } from '@/features/trace/traceHooks';
import { traceHref } from '@/features/trace/traceUi';
import './BusinessEventPage.css';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const asInt = (v: string | null) => (v && /^\d+$/.test(v) ? Number(v) : undefined);
const EVENT_TYPES = Object.entries(BUSINESS_EVENT_TYPE_LABEL) as [BusinessEventType, string][];
const TARGET_TYPES = Object.keys(EVENT_TARGET_TYPE) as EventTargetType[];

export function BusinessEventPage() {
  const [params, setParams] = useSearchParams();
  const get = (k: string) => params.get(k) ?? '';
  const patch = (p: Record<string, string | null>, push = false) =>
    setParams((prev) => {
      const n = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(p)) {
        if (v === null || v === '') n.delete(k);
        else n.set(k, v);
      }
      return n;
    }, { replace: !push });

  // ── 필터 (전부 주소에 남는다) ──
  const salesOrderId = asInt(params.get('salesOrderId'));
  const soLabelParam = get('so');
  const lotNoParam = get('lot').trim();
  const lotIdParam = asInt(params.get('lotId'));
  const includeLineage = get('includeLineage') === 'true';
  const eventType = EVENT_TYPES.some(([k]) => k === get('eventType')) ? (get('eventType') as BusinessEventType) : '';
  const actorType: ActorType | '' = get('actorType') === 'USER' || get('actorType') === 'SYSTEM' ? (get('actorType') as ActorType) : '';
  const targetType = TARGET_TYPES.includes(get('targetType') as EventTargetType) ? (get('targetType') as EventTargetType) : '';
  const from = DATE_RE.test(get('from')) ? get('from') : '';
  const to = DATE_RE.test(get('to')) ? get('to') : '';
  const order = get('order') === 'asc' || get('order') === 'desc' ? (get('order') as 'asc' | 'desc') : undefined;

  const [kw, setKw] = useState(get('q'));
  const dkw = useDebounced(kw, 350);
  useEffect(() => { if (dkw.trim() !== get('q')) patch({ q: dkw.trim() }); }, [dkw]); // eslint-disable-line react-hooks/exhaustive-deps
  // 주소가 바깥에서 바뀌었을 때(링크·초기화)만 입력창을 맞춘다. 타이핑 중에는 덮어쓰지 않는다
  useEffect(() => { if (get('q') !== kw.trim() && get('q') !== dkw.trim()) setKw(get('q')); }, [params]); // eslint-disable-line react-hooks/exhaustive-deps

  // LOT 번호(?lot=) 또는 id(?lotId=)를 서로 풀어 준다 — 번호가 안 풀리면 전체 로그를 보여 주지 않고 안내한다
  const byNo = useLotByNo(lotNoParam);
  const byId = useLotDetail(!lotNoParam && lotIdParam !== undefined ? lotIdParam : null);
  const lotId = lotNoParam ? byNo.data?.id : lotIdParam;
  const lotLabel = lotNoParam || byId.data?.lotNo || (lotIdParam !== undefined ? `LOT #${lotIdParam}` : '');
  const lotPending = !!lotNoParam && byNo.isLoading;
  const lotError = lotNoParam && byNo.error ? byNo.error : null;

  const isTimeline = salesOrderId !== undefined || lotId !== undefined;
  const q = useBusinessEvents(
    { salesOrderId, lotId, includeLineage: lotId !== undefined && includeLineage ? true : undefined, eventType: eventType || undefined, actorType: actorType || undefined, targetType: targetType || undefined, from: from || undefined, to: to || undefined, q: get('q') || undefined, order },
    !lotPending && !lotError,
  );
  const events = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);
  const appliedOrder = q.data?.pages[0]?.order ?? order ?? (isTimeline ? 'asc' : 'desc');
  const soLabel = soLabelParam || events.find((e) => e.salesOrderId === salesOrderId)?.salesOrderNo || (salesOrderId !== undefined ? `수주 #${salesOrderId}` : '');

  const [open, setOpen] = useState<Set<number>>(new Set());
  const toggle = (id: number) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const groups = useMemo(() => {
    const out: { day: string; label: string; items: BusinessEventView[] }[] = [];
    for (const e of events) {
      const day = fmtDate(e.occurredAt);
      const last = out[out.length - 1];
      if (last && last.day === day) last.items.push(e);
      else out.push({ day, label: dayLabel(e.occurredAt, day), items: [e] });
    }
    return out;
  }, [events]);

  const title = salesOrderId !== undefined && lotLabel ? `${soLabel} · ${lotLabel}` : salesOrderId !== undefined ? soLabel : lotLabel || '전체 작업 로그';
  useShellTitle('작업 로그', isTimeline ? title : 'Decision Replay');

  const anyFilter = !!(salesOrderId !== undefined || lotNoParam || lotIdParam !== undefined || eventType || actorType || targetType || from || to || get('q') || order);
  const reset = () => { setKw(''); setParams({}, { replace: false }); };

  return (
    <main className="hl-main be-main">
      <div className="hl-row be-head">
        <div className="hl-col" style={{ gap: 2, minWidth: 0 }}>
          <div className="hl-crumb">
            <Link to="/dashboard">대시보드</Link>
            <i className="ic ic-chevron-right ic--sm" />
            작업 로그
            <i className="ic ic-chevron-right ic--sm" />
            {isTimeline ? (salesOrderId !== undefined ? '수주 단위' : 'LOT 단위') : '전체'}
          </div>
          <div className="hl-row" style={{ gap: 10, flexWrap: 'wrap' }}>
            <h1 className={`hl-title${isTimeline ? ' mono' : ''}`} style={{ fontSize: 19 }}>{title}</h1>
            {isTimeline ? <span className="hl-tag">Decision Replay · 시간순</span> : null}
          </div>
          <span className="hl-cap">이벤트는 기록 전용이라 수정·삭제할 수 없어요{q.data ? ` · 불러온 이벤트 ${fmtInt(events.length)}건${q.data.pages[q.data.pages.length - 1].hasMore ? ' (더 있어요)' : ''}` : ''}</span>
        </div>
        <div className="hl-page-head__actions">
          {salesOrderId !== undefined ? <Link className="hl-btn" to={`/sales-orders/${salesOrderId}`}><i className="ic ic-order" />수주 상세</Link> : null}
          {lotLabel && lotId !== undefined ? <Link className="hl-btn" to={traceHref(lotLabel)}><i className="ic ic-trace" />LOT 추적</Link> : null}
          <SoonButton grade="EX">과거 사례 검색</SoonButton>
        </div>
      </div>

      <div className="hl-filterbar be-filters">
        <PickerInput
          kind="sales-orders" icon="order" ariaLabel="수주번호" placeholder="수주번호" width={190}
          selected={salesOrderId !== undefined ? soLabel : null}
          onClear={() => patch({ salesOrderId: null, so: null })}
          search={async (t) => (await businessEventApi.searchSalesOrders(t)).map((s) => ({ key: String(s.id), label: s.salesOrderNo }))}
          onPick={(it) => patch({ salesOrderId: it.key, so: it.label }, true)}
        />
        <PickerInput
          kind="lots" icon="trace" ariaLabel="LOT 번호" placeholder="LOT 번호" width={220}
          selected={lotNoParam || lotIdParam !== undefined ? lotLabel : null}
          onClear={() => patch({ lot: null, lotId: null, includeLineage: null })}
          search={async (t) => (await lotApi.search(t, 10)).map((l) => ({ key: l.lotNo, label: l.lotNo, sub: l.lotTypeLabel }))}
          onPick={(it) => patch({ lot: it.label, lotId: null }, true)}
        />
        <label className={`hl-chip${includeLineage && lotId !== undefined ? ' is-on' : ''}`} style={lotId === undefined ? { opacity: 0.55, cursor: 'not-allowed' } : undefined} title={lotId === undefined ? 'LOT 번호를 고르면 쓸 수 있어요' : '그 LOT의 조상·자손 LOT의 이벤트도 함께 봐요 (형제 LOT은 제외)'}>
          <input type="checkbox" checked={includeLineage && lotId !== undefined} disabled={lotId === undefined} onChange={(e) => patch({ includeLineage: e.target.checked ? 'true' : null })} style={{ accentColor: 'var(--on-brand, #fff)' }} />
          상·하위 LOT 포함
        </label>
        <span className="hl-sep" style={{ margin: '2px 4px' }} />
        <label className="hl-inputwrap" style={{ width: 200 }}>
          <i className="ic ic-search" />
          <input className="hl-input" type="search" placeholder="요약·대상 번호 검색" aria-label="키워드 검색" value={kw} onChange={(e) => setKw(e.target.value)} maxLength={100} />
        </label>
        <button type="button" className="hl-btn hl-btn--ghost hl-btn--sm" style={{ marginLeft: 'auto' }} disabled={!anyFilter} onClick={reset}><i className="ic ic-refresh" />조건 초기화</button>
      </div>
      <div className="hl-filterbar be-filters">
        <span className="hl-label">주체</span>
        {([['', '전체'], ['USER', '사용자'], ['SYSTEM', '시스템']] as const).map(([v, label]) => (
          <button key={v} type="button" className={`hl-chip${actorType === v ? ' is-on' : ''}`} aria-pressed={actorType === v} onClick={() => patch({ actorType: v || null })}>{label}</button>
        ))}
        <span className="hl-sep" style={{ margin: '2px 4px' }} />
        <label className="hl-selectwrap" style={{ width: 150 }}>
          <select className="hl-input" aria-label="이벤트 유형" value={eventType} onChange={(e) => patch({ eventType: e.target.value || null })}>
            <option value="">유형: 전체</option>
            {EVENT_TYPES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
          <i className="ic ic-chevron-down ic--sm" />
        </label>
        <label className="hl-selectwrap" style={{ width: 140 }}>
          <select className="hl-input" aria-label="대상 종류" value={targetType} onChange={(e) => patch({ targetType: e.target.value || null })}>
            <option value="">대상: 전체</option>
            {TARGET_TYPES.map((k) => <option key={k} value={k}>{TARGET_TYPE_LABEL[k]}</option>)}
          </select>
          <i className="ic ic-chevron-down ic--sm" />
        </label>
        <span className="hl-sep" style={{ margin: '2px 4px' }} />
        <span className="hl-label">기간</span>
        <DateInput value={from} onChange={(v) => patch({ from: v })} ariaLabel="시작일" placeholder="시작일" width={140} />
        <span className="hl-muted">~</span>
        <DateInput value={to} onChange={(v) => patch({ to: v })} ariaLabel="종료일" placeholder="종료일" width={140} min={from || undefined} />
        <button type="button" className="hl-btn hl-btn--ghost hl-btn--sm" style={{ marginLeft: 'auto' }} onClick={() => patch({ order: appliedOrder === 'asc' ? 'desc' : 'asc' })}>
          <i className="ic ic-sort" />
          {appliedOrder === 'asc' ? '오래된 순' : '최신순'}
        </button>
      </div>

      <section className="hl-card be-card" aria-label="이벤트 타임라인">
        <header className="hl-card__head">
          <h2>{isTimeline ? 'Decision Replay' : '최근 이벤트'}</h2>
          <span className="hl-card__meta">{isTimeline ? '예약 → 계획 → 실적 → 검사 → 배정 → 출고 → 밀시트 순서로 결정을 다시 볼 수 있어요' : '전체 이벤트를 최신순으로 보여줘요. 수주나 LOT을 고르면 시간순 타임라인이 돼요'}</span>
        </header>
        <div className="hl-card__body be-card__body">
          {lotPending ? <StateView kind="loading" /> : lotError ? (
            <StateView
              kind="error"
              title={lotError instanceof ApiError && lotError.status === 404 ? `'${lotNoParam}'에 맞는 LOT이 없어요` : undefined}
              text={lotError instanceof Error ? lotError.message : undefined}
              actions={<button type="button" className="hl-btn" onClick={() => patch({ lot: null })}>LOT 조건 지우기</button>}
            />
          ) : (
            <QueryBoundary query={q}>
              {() => (
                <div className="hl-timeline">
                  {groups.map((g, gi) => (
                    <Fragment key={g.day}>
                      <div className="hl-daysep" style={{ margin: gi ? '2px 0 6px' : '0 0 6px' }}>{g.label}</div>
                      {g.items.map((e) => <EventRow key={e.id} e={e} open={open.has(e.id)} onToggle={() => toggle(e.id)} />)}
                    </Fragment>
                  ))}
                  {!events.length ? <EmptyNote>{isTimeline ? '이 조건에 기록된 이벤트가 없어요' : '조건에 맞는 이벤트가 없어요'}</EmptyNote> : null}
                  {q.hasNextPage ? (
                    <button type="button" className="hl-btn hl-btn--sm" style={{ alignSelf: 'center', margin: '4px 0 8px' }} disabled={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>
                      {q.isFetchingNextPage ? <Spinner label="불러오는 중…" /> : '더 보기'}
                    </button>
                  ) : null}
                </div>
              )}
            </QueryBoundary>
          )}
        </div>
        <div className="hl-card__foot" style={{ fontSize: 12, gap: 12, flexWrap: 'wrap' }}>
          <Legend />
          <span style={{ marginLeft: 'auto' }}><SoonButton grade="EX" className="hl-btn hl-btn--sm">비슷한 과거 사례</SoonButton></span>
        </div>
      </section>
    </main>
  );
}
