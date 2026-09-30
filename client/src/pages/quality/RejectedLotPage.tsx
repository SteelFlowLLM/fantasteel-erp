// 불합격 관리 (REQ-QC-004): 불합격 LOT 목록 | 검사값(불합격 항목 강조) · 처리 상태 지정 · 영향 범위.
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { LOT_TYPE_LABEL, PRODUCTION_PLAN_STATUS_LABEL, PROCESS_CODE_LABEL, SALES_ORDER_ITEM_STATUS_LABEL, type DispositionStatus } from '@fantasteel/shared';
import type { RejectedLot } from '@/api/quality';
import { Badge, EmptyNote, Icon, QueryBoundary, SoonButton, StateView } from '@/components/ui';
import { DispositionForm } from '@/features/quality/DispositionForm';
import { useInspectionDetail, useLotEvents, useRejectedLots } from '@/features/quality/qualityHooks';
import { DispositionBadge, EventTimeline, InspectionValuesTable, LotHeader, ResultBadge, traceHref } from '@/features/quality/qualityUi';
import { limitText, lotIcon, trimNum } from '@/features/quality/qualityUtil';
import { dLabel, fmtDate, fmtMDHM } from '@/lib/format';
import { useShellTitle } from '@/shell/shellTitle';
import './RejectedLotPage.css';

type StatusFilter = 'ALL' | 'NONE' | DispositionStatus;
type OriginFilter = 'ALL' | 'OWN' | 'HEAT';

const label = (map: object, key: string) => (map as Record<string, string>)[key] ?? key;
const statusOf = (r: RejectedLot): StatusFilter => r.dispositionStatus ?? 'NONE';
const failedNames = (r: RejectedLot) => r.failedInspection?.failedItems.map((f) => f.inspectionItemName).join(' · ') ?? '';

export function RejectedLotPage() {
  const q = useRejectedLots();
  return <QueryBoundary query={q} loadingLabel="불합격 LOT을 불러오는 중…">{(rows) => <Workspace rows={rows} />}</QueryBoundary>;
}

function Workspace({ rows }: { rows: RejectedLot[] }) {
  const [sp, setSp] = useSearchParams();
  const [status, setStatus] = useState<StatusFilter>('ALL');
  const [origin, setOrigin] = useState<OriginFilter>('ALL');
  const [q, setQ] = useState('');

  const count = (s: StatusFilter) => (s === 'ALL' ? rows.length : rows.filter((r) => statusOf(r) === s).length);
  const needle = q.trim().toUpperCase();
  const list = rows.filter(
    (r) => (status === 'ALL' || statusOf(r) === status) && (origin === 'ALL' || r.rejectedBy === origin) && (!needle || r.lotNo.toUpperCase().includes(needle) || (r.heatLotNo ?? '').toUpperCase().includes(needle)),
  );
  const paramId = Number(sp.get('lot')) || null;
  const activeId = paramId ?? list[0]?.id ?? null;
  const sel = rows.find((r) => r.id === activeId) ?? null;
  useShellTitle(sel?.lotNo, sel ? '불합격 관리' : undefined);

  const tile = (s: DispositionStatus | 'NONE', text: string, bg: string, fg: string, ring?: boolean) => (
    <button
      type="button"
      className="qr-tile"
      aria-pressed={status === s}
      style={{ background: bg, color: fg, boxShadow: status === s ? `inset 0 0 0 2px ${fg}` : ring ? 'inset 0 0 0 1px #C3CBD4' : undefined }}
      onClick={() => setStatus(status === s ? 'ALL' : s)}
    >
      <span className="hl-cap" style={{ color: fg }}>{text}</span>
      <b>{count(s)}</b>
    </button>
  );

  return (
    <>
      <section className="hl-master qc-master" aria-label="불합격 LOT 목록">
        <div className="hl-master__head">
          <div className="hl-row">
            <b style={{ fontSize: 14 }}>불합격 LOT</b>
            <span className="hl-cap">{rows.length}건</span>
          </div>
          <div className="qr-tiles">
            {tile('NONE', '미지정', '#EEF1F4', '#3F4A57')}
            {tile('HOLD', '보류', '#FDF0DF', '#9E4F00')}
            {tile('DOWNGRADED', '격하', '#FFFFFF', '#3F4A57', true)}
            {tile('SCRAPPED', '폐기', '#FCEAE8', '#C0322B')}
          </div>
          <div className="hl-seg qr-seg" role="tablist" aria-label="처리 상태">
            {([['ALL', '전체'], ['NONE', '미지정'], ['HOLD', '보류'], ['DOWNGRADED', '격하'], ['SCRAPPED', '폐기']] as [StatusFilter, string][]).map(([k, t]) => (
              <button key={k} type="button" role="tab" aria-selected={status === k} className={status === k ? 'is-on' : undefined} onClick={() => setStatus(k)}>{t} {count(k)}</button>
            ))}
          </div>
          <div className="hl-row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {([['ALL', '모든 원인'], ['OWN', '자체 불합격'], ['HEAT', '히트 불합격']] as [OriginFilter, string][]).map(([k, t]) => (
              <button key={k} type="button" className={`hl-chip${origin === k ? ' is-on' : ''}`} aria-pressed={origin === k} onClick={() => setOrigin(k)}>{t}</button>
            ))}
          </div>
          <span className="hl-inputwrap">
            <Icon name="search" size="sm" />
            <input className="hl-input" type="search" placeholder="LOT번호 검색" aria-label="LOT 검색" value={q} onChange={(e) => setQ(e.target.value)} />
          </span>
        </div>
        <div className="hl-master__list">
          {list.map((r) => {
            const on = r.id === activeId;
            return (
              <Link key={r.id} className={`hl-mitem${on ? ' is-active' : ''}`} to={`/quality/rejected?lot=${r.id}`}>
                <div className="hl-row">
                  <Icon name={lotIcon(r.lotType)} size="sm" style={on ? { color: '#173A5E' } : { color: 'var(--ink-3)' }} />
                  <span className="mono" style={on ? { fontWeight: 600 } : undefined}>{r.lotNo}</span>
                  <span style={{ marginLeft: 'auto' }}><DispositionBadge status={r.dispositionStatus} /></span>
                </div>
                <span className="hl-cap">{LOT_TYPE_LABEL[r.lotType]} · {r.steelGradeCode ?? '—'}{r.specCode ? ` ${r.specCode}` : ''}</span>
                <div className="hl-row" style={{ fontSize: 12, gap: 6 }}>
                  {r.rejectedBy === 'HEAT' ? <span className="hl-badge hl-badge--outline">히트 불합격</span> : <span className="hl-badge hl-badge--outline">자체 불합격</span>}
                  <span className="hl-danger-text" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={failedNames(r)}>
                    {r.rejectedBy === 'HEAT' ? `${r.heatLotNo ?? '히트'} ${failedNames(r) || '성분'}` : failedNames(r) || '기준 밖'}
                  </span>
                </div>
                <div className="hl-row hl-cap" style={{ gap: 6 }}>
                  <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.affectedSalesOrderItem ? `${r.affectedSalesOrderItem.salesOrderNo} 품목${r.affectedSalesOrderItem.lineNo}` : '연결 수주 없음'}
                  </span>
                  <span style={{ marginLeft: 'auto', whiteSpace: 'nowrap' }}>{r.hasReproductionPlan ? <Badge tone="run">재생산 계획 있음</Badge> : '재생산 계획 없음'}</span>
                </div>
              </Link>
            );
          })}
          {!list.length ? <EmptyNote>{rows.length ? '조건에 맞는 불합격 LOT이 없어요' : '불합격 LOT이 없어요'}</EmptyNote> : null}
          <div className="hl-banner" style={{ margin: '14px 16px', fontSize: 12, lineHeight: '17px' }}>
            <Icon name="info" size="sm" />
            <span>자체 검사에 불합격했거나 상위 히트가 성분 불합격이라 쓸 수 없는 슬래브·코일이에요. v2는 처리 상태만 관리해요.</span>
          </div>
        </div>
      </section>

      <main className="hl-main qc-main">
        {!activeId ? (
          <section className="hl-card qr-empty"><span className="hl-cap">불합격 LOT이 없어요</span></section>
        ) : !sel ? (
          <StateView
            kind="empty"
            title="이 LOT은 불합격 목록에 없어요"
            text="불합격이 아니거나 아직 검사 전인 LOT이에요."
            actions={<Link className="hl-btn" to={`/quality/inspections?lot=${activeId}`}>검사 입력에서 보기</Link>}
          />
        ) : (
          <Detail key={sel.id} lot={sel} />
        )}
      </main>
    </>
  );
}

function Detail({ lot }: { lot: RejectedLot }) {
  const fi = lot.failedInspection;
  const inspectionQ = useInspectionDetail(fi?.id ?? null);
  const eventsQ = useLotEvents(lot.id);
  const history = (eventsQ.data?.items ?? []).slice(-8);
  const so = lot.affectedSalesOrderItem;
  const total = inspectionQ.data?.values.length;
  const failN = inspectionQ.data?.values.filter((v) => v.isPassed === false).length ?? fi?.failedItems.length ?? 0;
  const own = lot.rejectedBy === 'OWN';

  return (
    <>
      <LotHeader
        area="불합격 관리"
        lotNo={lot.lotNo}
        typeName={LOT_TYPE_LABEL[lot.lotType]}
        badges={(
          <>
            <DispositionBadge status={lot.dispositionStatus} />
            <span className="hl-badge hl-badge--outline">{own ? '자체 검사 불합격' : '상위 히트 불합격'}</span>
          </>
        )}
        actions={(
          <>
            {own ? <Link className="hl-btn" to={`/quality/inspections?lot=${lot.id}`}><Icon name="quality" />검사 결과</Link> : null}
            <Link className="hl-btn" to={traceHref(lot.lotNo, 'forward')} title="정추적으로 이 LOT이 어디까지 퍼졌는지 봐요"><Icon name="trace" />LOT 추적 (영향 범위)</Link>
            <Link className="hl-btn" to="/business-events"><Icon name="history" />작업 로그</Link>
            <SoonButton grade="EX">사례로 등록</SoonButton>
            <SoonButton grade="EX">비슷한 사례 찾기</SoonButton>
          </>
        )}
      />

      <section className="hl-card">
        <div className="hl-card__body" style={{ padding: '12px 16px' }}>
          <dl className="qc-kv">
            <div className="qc-kv__item"><dt>강종 · 규격</dt><dd>{lot.steelGradeCode ? <span className="mono">{lot.steelGradeCode}</span> : '—'} {lot.specCode ? <span className="mono">{lot.specCode}</span> : null}</dd></div>
            <div className="qc-kv__item">
              <dt>불합격 원인</dt>
              <dd>
                {own ? '자체 검사 불합격' : (
                  <>상위 히트 {lot.heatLotNo ? <Link className="hl-link-id mono" to={traceHref(lot.heatLotNo)}>{lot.heatLotNo}</Link> : ''} 성분 불합격</>
                )}
              </dd>
            </div>
            <div className="qc-kv__item">
              <dt>근거 검사</dt>
              <dd>{fi ? <><span className="mono">{fi.qualityInspectionNo}</span> <span className="hl-cap">{PROCESS_CODE_LABEL[fi.processCode]} · {fmtMDHM(fi.inspectedAt)}</span></> : <span className="hl-muted">기록 없음</span>}</dd>
            </div>
            {lot.lotType !== 'HEAT' ? (
              <div className="qc-kv__item"><dt>상위 히트</dt><dd>{lot.heatLotNo ? <Link className="hl-link-id mono" to={traceHref(lot.heatLotNo)}>{lot.heatLotNo}</Link> : '—'}</dd></div>
            ) : null}
            <div className="qc-kv__item"><dt>생산계획</dt><dd>{lot.productionPlanId ? <Link className="hl-link-id mono" to={`/production/plans?plan=${lot.productionPlanId}`}>{lot.productionPlanNo}</Link> : <span className="hl-muted">없음</span>}</dd></div>
            <div className="qc-kv__item">
              <dt>영향받는 수주 품목</dt>
              <dd>
                {so ? (
                  <>
                    <Link className="hl-link-id mono" to={`/sales-orders/${so.salesOrderId}`}>{so.salesOrderNo}</Link> 품목{so.lineNo}{' '}
                    <span className="hl-cap">{so.customerName} · 납기 {fmtDate(so.dueDate)} {dLabel(so.dueDate)} · 주문 {so.orderedQty} · {label(SALES_ORDER_ITEM_STATUS_LABEL, so.salesOrderItemStatus)}</span>
                  </>
                ) : <span className="hl-muted">없음 · 연결된 수주 품목이 없어요</span>}
              </dd>
            </div>
            <div className="qc-kv__item"><dt>생산 시각</dt><dd className="qc-num">{fmtMDHM(lot.producedAt)}</dd></div>
          </dl>
        </div>
      </section>

      <div className="qr-two">
        <div className="hl-col" style={{ gap: 14, minWidth: 0 }}>
          <section className="hl-card" style={{ flex: 'none' }}>
            <header className="hl-card__head">
              <h2>검사값</h2>
              <span className="hl-card__meta">{fi ? <><span className="mono">{fi.qualityInspectionNo}</span> · 불합격 {failN}{total ? `/${total}` : ''}개</> : '검사 기록 없음'}</span>
              {inspectionQ.data ? <div className="hl-card__actions"><ResultBadge result={inspectionQ.data.inspectionResult} /></div> : null}
            </header>
            {!own && fi ? <div className="hl-banner hl-banner--wait" style={{ margin: '12px 16px 0', fontSize: 12 }}><Icon name="info" size="sm" /><span>이 LOT 자신이 아니라 상위 히트 {lot.heatLotNo}의 성분 검사 결과예요.</span></div> : null}
            <div className="hl-card__body hl-card__body--flush">
              {!fi ? (
                <EmptyNote>연결된 검사 기록이 없어요</EmptyNote>
              ) : (
                <QueryBoundary query={inspectionQ} loadingLabel="검사값을 불러오는 중…">
                  {(ins) => <InspectionValuesTable values={ins.values} />}
                </QueryBoundary>
              )}
            </div>
            {fi && !inspectionQ.data ? (
              <div className="hl-card__foot" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
                <span className="hl-cap">불합격 항목</span>
                {fi.failedItems.map((f) => <span key={f.inspectionItemCode} className="hl-danger-text" style={{ fontSize: 12 }}>{f.inspectionItemName} {trimNum(f.measuredValue)}{f.unit ? ` ${f.unit}` : ''} (기준 {limitText(f)})</span>)}
              </div>
            ) : null}
          </section>
          <DispositionForm lot={lot} />
        </div>

        <div className="hl-col" style={{ gap: 14, minWidth: 0 }}>
          <section className="hl-card" style={{ flex: 'none' }}>
            <header className="hl-card__head">
              <h2>영향과 자동 처리</h2>
              <span className="hl-card__meta">불합격 판정 때 시스템이 처리한 것</span>
            </header>
            <div className="hl-card__body" style={{ gap: 10 }}>
              <div className="hl-row" style={{ flexWrap: 'wrap', gap: 6 }}>
                <span className="hl-actor hl-actor--system">SYSTEM</span>
                <span className="hl-chip" style={{ height: 26, cursor: 'default' }}><Icon name="lock" size="sm" />예약·배정·출하 대상에서 제외</span>
                {lot.lotType === 'HEAT' ? <span className="hl-chip" style={{ height: 26, cursor: 'default' }}><Icon name="link" size="sm" />하위 슬래브·코일 사용 불가</span> : null}
              </div>
              {so ? (
                <div className="hl-col" style={{ gap: 6 }}>
                  <span className="hl-cap">재생산 계획 (수주 품목 {so.salesOrderNo} 품목{so.lineNo})</span>
                  {lot.reproductionPlan ? (
                    <Link className="hl-chip" style={{ height: 28, color: '#1F5FCC', alignSelf: 'flex-start' }} to={`/production/plans?plan=${lot.reproductionPlan.id}`}>
                      <Icon name="refresh" size="sm" />
                      <span className="mono">{lot.reproductionPlan.productionPlanNo}</span>
                      {label(PRODUCTION_PLAN_STATUS_LABEL, lot.reproductionPlan.productionPlanStatus)} · 부족 {lot.reproductionPlan.shortageQty}
                    </Link>
                  ) : (
                    <span style={{ fontSize: 13 }}>재생산 계획이 아직 없어요. 생산 담당이 <Link className="hl-link-id" to={lot.productionPlanId ? `/production/plans?plan=${lot.productionPlanId}` : '/production/plans'}>생산계획 화면</Link>에서 만들어요.</span>
                  )}
                </div>
              ) : <span className="hl-cap">연결된 수주 품목이 없어 재생산 계획 대상이 아니에요</span>}
              <div className="hl-row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <Link className="hl-btn hl-btn--sm" to={traceHref(lot.lotNo, 'forward')}><Icon name="trace" />정추적으로 영향 범위 보기</Link>
              </div>
            </div>
          </section>

          <section className="hl-card" style={{ flex: 'none' }}>
            <header className="hl-card__head">
              <h2>이력</h2>
              <span className="hl-card__meta">이 LOT</span>
              <div className="hl-card__actions"><Link className="hl-cap" to="/business-events" style={{ color: '#1F5FCC' }}>작업 로그</Link></div>
            </header>
            <div className="hl-card__body" style={{ padding: '14px 16px 4px' }}>
              {eventsQ.isLoading ? <span className="hl-cap">불러오는 중…</span> : history.length ? <EventTimeline events={history} /> : <span className="hl-cap" style={{ paddingBottom: 10 }}>기록된 이벤트가 없어요</span>}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
