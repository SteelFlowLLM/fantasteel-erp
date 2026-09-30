// LOT 추적 (REQ-LOT-005, BP-LOT-01): 코일 → 원료 역추적 / 원료·히트 → 출하 정추적. 조회 전용.
// 주소: /lots/trace?lot=<lotNo>&direction=backward|forward
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { LOT_TYPE_LABEL, type LotType } from '@fantasteel/shared';
import { ApiError } from '@/api/client';
import { lotApi, type LotTraceResponse, type LotView, type TraceDirection } from '@/api/lots';
import { EmptyNote, QueryBoundary, Spinner, StateView } from '@/components/ui';
import { fmtInt, relTime } from '@/lib/format';
import { useShellTitle } from '@/shell/shellTitle';
import { ImpactSummary } from '@/features/trace/ImpactSummary';
import { LotDetailPanel, ShipPanel } from '@/features/trace/LotDetailPanel';
import { TraceGraph } from '@/features/trace/TraceGraph';
import { buildShipGroups, lotKey } from '@/features/trace/traceLayout';
import { defaultDirection, useDebounced, useLotByNo, useLotSearch, useLotTrace, useRecentLots } from '@/features/trace/traceHooks';
import { InspectionBadge, LotStatusBadge, LotTypeIcon } from '@/features/trace/traceUi';
import './LotTracePage.css';

const TYPE_FILTERS: { value: LotType | ''; label: string }[] = [
  { value: '', label: '전체' },
  { value: 'COIL', label: '코일' },
  { value: 'SLAB', label: '슬래브' },
  { value: 'HEAT', label: '히트' },
  { value: 'HOT_METAL', label: '용선' },
  { value: 'RAW_MATERIAL', label: '원료' },
];

const isDirection = (v: string | null): v is TraceDirection => v === 'backward' || v === 'forward';

export function LotTracePage() {
  const [params, setParams] = useSearchParams();
  const lotNo = params.get('lot')?.trim() ?? '';
  const dirParam = params.get('direction');

  const root = useLotByNo(lotNo);
  const direction: TraceDirection = isDirection(dirParam) ? dirParam : root.data ? defaultDirection(root.data.lotType) : 'backward';
  const rootId = root.data?.id ?? null;
  const trace = useLotTrace(rootId, direction);

  const [sel, setSel] = useState<string | null>(null);
  useEffect(() => setSel(null), [rootId, direction]);

  useShellTitle(lotNo || 'LOT 추적', root.data ? `${root.data.lotTypeLabel} · ${direction === 'backward' ? '역추적' : '정추적'}` : undefined);

  const go = (nextNo: string, nextDir: TraceDirection | null = isDirection(dirParam) ? dirParam : null) => {
    const p: Record<string, string> = { lot: nextNo };
    if (nextDir) p.direction = nextDir;
    setParams(p);
  };
  const setDirection = (d: TraceDirection) => go(lotNo, d);

  return (
    <>
      <SearchPane lotNo={lotNo} direction={direction} onPick={(no) => go(no)} onDirection={setDirection} hasLot={!!lotNo} />
      <main className="hl-main lt-main">
        {!lotNo ? (
          <StateView kind="empty" title="추적할 LOT을 골라 주세요" text="왼쪽에서 LOT 번호를 검색하거나 최근 LOT을 눌러 보세요. 코일은 어디서 왔는지(역추적), 원료·히트는 어디로 갔는지(정추적)를 보여줘요." />
        ) : root.isLoading ? (
          <StateView kind="loading" />
        ) : root.error ? (
          <StateView
            kind="error"
            title={root.error instanceof ApiError && root.error.status === 404 ? `'${lotNo}'에 맞는 LOT이 없어요` : undefined}
            text={root.error instanceof Error ? root.error.message : undefined}
            code={root.error instanceof ApiError ? root.error.code : undefined}
            actions={<button type="button" className="hl-btn" onClick={() => void root.refetch()}>다시 시도</button>}
          />
        ) : root.data ? (
          <>
            <div className="hl-row lt-head">
              <div className="hl-col" style={{ gap: 2, minWidth: 0 }}>
                <div className="hl-crumb">
                  <Link to="/dashboard">대시보드</Link>
                  <i className="ic ic-chevron-right ic--sm" />
                  LOT 추적
                  <i className="ic ic-chevron-right ic--sm" />
                  {direction === 'backward' ? '역추적' : '정추적'}
                </div>
                <div className="hl-row" style={{ gap: 10, flexWrap: 'wrap' }}>
                  <span className="mono" style={{ fontSize: 18, fontWeight: 600, lineHeight: '26px' }}>{root.data.lotNo}</span>
                  <span className="hl-tag">{LOT_TYPE_LABEL[root.data.lotType]}</span>
                  <LotStatusBadge status={root.data.lotStatus} label={root.data.lotStatusLabel} />
                  <InspectionBadge result={root.data.inspectionResult} label={root.data.inspectionResultLabel} />
                  <span className="hl-cap">{root.data.title}</span>
                </div>
              </div>
              <div className="hl-row" style={{ marginLeft: 'auto', gap: 8 }}>
                <Link className="hl-btn" to={`/business-events?lot=${encodeURIComponent(root.data.lotNo)}`}><i className="ic ic-history" />작업 로그</Link>
              </div>
            </div>
            <QueryBoundary query={trace} loadingLabel="계보를 불러오는 중…">
              {(t) => <TraceBody trace={t} direction={direction} sel={sel} onSel={setSel} onReroot={(no) => go(no)} />}
            </QueryBoundary>
          </>
        ) : null}
      </main>
    </>
  );
}

function TraceBody({ trace, direction, sel, onSel, onReroot }: { trace: LotTraceResponse; direction: TraceDirection; sel: string | null; onSel: (k: string | null) => void; onReroot: (lotNo: string) => void }) {
  const { summary } = trace;
  const ships = useMemo(() => buildShipGroups(trace), [trace]);
  const nodeById = useMemo(() => new Map(trace.nodes.map((n) => [n.id, n])), [trace]);
  const activeKey = sel ?? lotKey(trace.rootId);
  const activeLotId = activeKey.startsWith('lot:') ? Number(activeKey.slice(4)) : null;
  const activeShip = activeKey.startsWith('ship:') ? ships.get(Number(activeKey.slice(5))) : undefined;
  const alloyCount = trace.nodes.filter((n) => n.rawMaterialType === 'FERROALLOY').length;
  const typeChips = trace.levels.map((lv) => {
    const c = lv.nodeIds.length;
    return `${lv.label} ${fmtInt(c)}`;
  });
  return (
    <>
      {summary.truncated || summary.hasCycle ? (
        <div className="lt-warns" role="status">
          {summary.truncated ? <div className="lt-warn"><i className="ic ic-alert ic--sm" /> LOT이 너무 많아 일부만 보여줘요 (최대 2,000개). 더 좁은 LOT에서 다시 추적해 보세요.</div> : null}
          {summary.hasCycle ? <div className="lt-warn"><i className="ic ic-alert ic--sm" /> 순환 연결이 있어요. 이미 지나온 LOT은 다시 펼치지 않았어요. 데이터를 확인해 주세요.</div> : null}
        </div>
      ) : null}
      <div className="lt-grid">
        <section className="hl-card lt-graphcard" aria-label="LOT 계보">
          <header className="hl-card__head">
            <h2>{direction === 'backward' ? '역추적 계보' : '정추적 계보'}</h2>
            <span className="hl-card__meta">{typeChips.join(' · ')} · 연결 {fmtInt(summary.edgeCount)}</span>
          </header>
          <div className="hl-card__body lt-graphcard__body">
            <TraceGraph trace={trace} selected={sel} onSelect={(k) => onSel(k === sel ? null : k)} />
          </div>
          <div className="hl-card__foot lt-legend">
            <span className="hl-cap">범례</span>
            <span className="hl-row" style={{ gap: 5 }}>
              <svg width="26" height="6" aria-hidden="true"><line x1="0" y1="3" x2="26" y2="3" className="lt-lg lt-lg--direct" /></svg>
              직접 투입{alloyCount ? ' (합금철 포함)' : ''}
            </span>
            <span className="hl-row" style={{ gap: 5 }}>
              <svg width="26" height="6" aria-hidden="true"><line x1="0" y1="3" x2="26" y2="3" className="lt-lg lt-lg--period" /></svg>
              기간 기반 (그 기간에 쓰였을 수 있는 원료 · 실제 투입량 아님)
            </span>
            <span className="hl-cap" style={{ marginLeft: 'auto' }}>왼쪽 → 오른쪽 = 생산 흐름 · 노드를 누르면 상세가 열려요</span>
          </div>
        </section>
        <div className="lt-side">
          {direction === 'forward' ? <ImpactSummary trace={trace} /> : null}
          {activeShip ? (
            <ShipPanel ship={activeShip} onSelectLot={(id) => onSel(lotKey(id))} />
          ) : activeLotId !== null ? (
            <LotDetailPanel key={activeLotId} lotId={activeLotId} node={nodeById.get(activeLotId) ?? null} direction={direction} onReroot={onReroot} />
          ) : null}
        </div>
      </div>
    </>
  );
}

// ───────────── 왼쪽: LOT 검색 · 최근 LOT ─────────────
function SearchPane({ lotNo, direction, onPick, onDirection, hasLot }: { lotNo: string; direction: TraceDirection; onPick: (lotNo: string) => void; onDirection: (d: TraceDirection) => void; hasLot: boolean }) {
  const [q, setQ] = useState('');
  const [type, setType] = useState<LotType | ''>('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dq = useDebounced(q, 250);
  const search = useLotSearch(dq);
  const recent = useRecentLots(type);
  const searching = q.trim().length > 0;

  const submit = async () => {
    const text = q.trim();
    if (!text) return;
    setBusy(true);
    setMsg(null);
    try {
      const lot = await lotApi.byNo(text);
      onPick(lot.lotNo);
      setQ('');
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setMsg(search.data?.length ? `'${text}'와 정확히 같은 번호는 없어요. 아래에서 골라 주세요` : `'${text}'에 맞는 LOT이 없어요`);
      else setMsg(e instanceof Error ? e.message : '찾지 못했어요');
    } finally {
      setBusy(false);
    }
  };

  const item = (l: { id: number; lotNo: string; lotType: LotType; lotStatus: LotView['lotStatus']; lotStatusLabel: string }, sub: string | null, badge: React.ReactNode) => {
    const on = l.lotNo === lotNo;
    return (
      <button key={l.id} type="button" className={`hl-mitem lt-mitem${on ? ' is-active' : ''}`} onClick={() => onPick(l.lotNo)} aria-current={on ? 'true' : undefined}>
        <div className="hl-row">
          <LotTypeIcon type={l.lotType} />
          <span className="mono" style={on ? { fontWeight: 600 } : undefined}>{l.lotNo}</span>
          <span style={{ marginLeft: 'auto' }}>{badge}</span>
        </div>
        <span className="hl-cap lt-ell">{LOT_TYPE_LABEL[l.lotType]}{sub ? ` · ${sub}` : ''}</span>
      </button>
    );
  };

  return (
    <section className="hl-master" aria-label="LOT 검색">
      <div className="hl-master__head">
        <b style={{ fontSize: 14 }}>LOT 검색</b>
        <div className="hl-seg" role="radiogroup" aria-label="추적 방향" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
          <button type="button" role="radio" aria-checked={direction === 'backward'} className={direction === 'backward' ? 'is-on' : undefined} disabled={!hasLot} onClick={() => onDirection('backward')} title="코일 → 원료">역추적 ←</button>
          <button type="button" role="radio" aria-checked={direction === 'forward'} className={direction === 'forward' ? 'is-on' : undefined} disabled={!hasLot} onClick={() => onDirection('forward')} title="원료·히트 → 출하">정추적 →</button>
        </div>
        <span className="hl-inputwrap">
          <i className="ic ic-search ic--sm" />
          <input
            className="hl-input mono"
            type="search"
            value={q}
            placeholder="LOT 번호 (일부만 입력해도 돼요)"
            aria-label="LOT 번호 검색"
            onChange={(e) => { setQ(e.target.value); setMsg(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void submit(); }}
            disabled={busy}
          />
        </span>
        {msg ? <div className="hl-cap hl-danger-text" role="alert"><i className="ic ic-alert ic--sm" /> {msg}</div> : <span className="hl-cap">Enter를 누르면 그 번호의 LOT을 추적해요</span>}
        {!searching ? (
          <div className="hl-row" style={{ gap: 4, flexWrap: 'wrap' }} role="group" aria-label="LOT 종류">
            {TYPE_FILTERS.map((f) => (
              <button key={f.value} type="button" className={`hl-chip${type === f.value ? ' is-on' : ''}`} style={{ height: 24, padding: '0 8px' }} aria-pressed={type === f.value} onClick={() => setType(f.value)}>{f.label}</button>
            ))}
          </div>
        ) : null}
      </div>
      <div className="hl-master__list">
        {searching ? (
          <>
            <div className="hl-cap" style={{ padding: '10px 16px 6px' }}>검색 결과 {search.data ? search.data.length : ''}</div>
            {search.isLoading ? <div style={{ padding: '8px 16px' }}><Spinner /></div> : null}
            {search.data?.map((l) => item(l, null, <LotStatusBadge status={l.lotStatus} label={l.lotStatusLabel} />))}
            {search.data && !search.data.length ? <EmptyNote>번호가 맞는 LOT이 없어요</EmptyNote> : null}
            {search.error ? <EmptyNote>{search.error instanceof Error ? search.error.message : '검색하지 못했어요'}</EmptyNote> : null}
          </>
        ) : (
          <QueryBoundary query={recent}>
            {(d) => (
              <>
                <div className="hl-cap" style={{ padding: '10px 16px 6px' }}>최근 LOT · 전체 {fmtInt(d.total)}개 중 {fmtInt(d.items.length)}개</div>
                {d.items.map((l) => item(l, `${l.title} · ${relTime(l.producedAt)}`, l.inspectionResult ? <InspectionBadge result={l.inspectionResult} label={l.inspectionResultLabel} /> : <LotStatusBadge status={l.lotStatus} label={l.lotStatusLabel} />))}
                {!d.items.length ? <EmptyNote>조건에 맞는 LOT이 없어요</EmptyNote> : null}
              </>
            )}
          </QueryBoundary>
        )}
      </div>
    </section>
  );
}
