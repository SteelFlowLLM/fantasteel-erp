// 공정 실적 (REQ-PRD-003, BP-PRD-02). 디자인: v1 B안 19번(작업 지시 목록 | 실적 입력). 데이터는 docs/api/production.md.
import { useState } from 'react';
import { Link } from 'react-router';
import { ITEM_TYPE_LABEL, PROCESS_CODE_LABEL, type ProcessCode } from '@fantasteel/shared';
import { productionApi, type PlanDetail, type PlanSummary, type ResultView } from '@/api/production';
import { EmptyNote, Icon, QueryBoundary, StateView } from '@/components/ui';
import { CompleteResultModal } from '@/features/production/CompleteResultModal';
import { PLAN_TOPICS, usePlanDetail, usePlanParam, usePlanResults, usePlans } from '@/features/production/productionHooks';
import {
  GROUP_STYLE, LockHint, LotJudgeBadge, LotLink, PlanListItem, PlanProcessSteps, PlanStatusBadge, ResultStatusBadge, ServerErrorBanner, planProcesses, qtyUnit, specText,
} from '@/features/production/prodUi';
import { useAction } from '@/hooks/useApi';
import { fmtMDHM, fmtTon } from '@/lib/format';
import { useShellTitle } from '@/shell/shellTitle';
import { canUse, useMe } from '@/stores/auth';

type Chip = 'OPEN' | 'DONE';
const isOpen = (p: PlanSummary) => p.productionPlanStatus === 'CONFIRMED' || p.productionPlanStatus === 'IN_PROGRESS';

export function ProductionResultPage() {
  const [planId, setPlanId] = usePlanParam();
  const [chip, setChip] = useState<Chip>('OPEN');
  const [q, setQ] = useState('');
  const list = usePlans();

  const needle = q.trim().toLowerCase();
  const match = (p: PlanSummary) => !needle || `${p.productionPlanNo} ${p.salesOrder?.salesOrderNo ?? ''} ${p.salesOrder?.customerName ?? ''}`.toLowerCase().includes(needle);
  const all = list.data ?? [];
  const open = all.filter(isOpen);
  const done = all.filter((p) => p.productionPlanStatus === 'COMPLETED');
  const running = open.filter((p) => p.productionPlanStatus === 'IN_PROGRESS' && match(p));
  const waiting = open.filter((p) => p.productionPlanStatus === 'CONFIRMED' && match(p));
  const doneShown = done.filter(match);
  const selectedId = planId ?? (chip === 'OPEN' ? running[0]?.id ?? waiting[0]?.id : doneShown[0]?.id) ?? null;
  const item = (p: PlanSummary) => <PlanListItem key={p.id} plan={p} active={p.id === selectedId} onPick={setPlanId} />;

  return (
    <>
      <section className="hl-master" aria-label="작업 지시 목록">
        <div className="hl-master__head">
          <div className="hl-row">
            <b style={{ fontSize: '14px' }}>작업 지시</b>
            <span className="hl-tag">{list.data ? open.length : '…'}</span>
          </div>
          <label className="hl-inputwrap">
            <Icon name="search" size="sm" />
            <input className="hl-input" type="search" placeholder="계획·수주번호·고객사 검색" aria-label="작업 지시 검색" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <div className="hl-row" style={{ gap: '6px' }}>
            <button className={`hl-chip${chip === 'OPEN' ? ' is-on' : ''}`} type="button" aria-pressed={chip === 'OPEN'} onClick={() => setChip('OPEN')}>입력 필요 <b>{open.length}</b></button>
            <button className={`hl-chip${chip === 'DONE' ? ' is-on' : ''}`} type="button" aria-pressed={chip === 'DONE'} onClick={() => setChip('DONE')}>완료 <b>{done.length}</b></button>
          </div>
        </div>
        <div className="hl-master__list">
          <QueryBoundary query={list}>
            {() => (chip === 'OPEN' ? (
              <>
                <div style={GROUP_STYLE}>생산 중</div>
                {running.map(item)}
                {!running.length ? <EmptyNote style={{ padding: '8px 16px' }}>생산 중인 계획이 없어요</EmptyNote> : null}
                <div style={GROUP_STYLE}>편성 확정 · 시작 전</div>
                {waiting.map(item)}
                {!waiting.length ? <EmptyNote style={{ padding: '8px 16px' }}>시작을 기다리는 계획이 없어요</EmptyNote> : null}
              </>
            ) : (
              <>
                <div style={GROUP_STYLE}>완료</div>
                {doneShown.map(item)}
                {!doneShown.length ? <EmptyNote style={{ padding: '8px 16px' }}>완료된 계획이 없어요</EmptyNote> : null}
              </>
            ))}
          </QueryBoundary>
        </div>
        <div style={{ padding: '10px 16px', borderTop: '1px solid var(--line)', background: 'var(--surface-2)' }}>
          <span className="hl-cap">
            <Link to="/production/plans">생산계획</Link>에서 히트 편성을 확정한 계획만 표시돼요. 열연 투입 슬래브는 <Link to="/production/rolling">열연 투입 배정</Link>에서 확정한 LOT만 압연해요.
          </span>
        </div>
      </section>
      <main className="hl-main">
        {selectedId === null ? (
          list.isLoading ? <StateView kind="loading" /> : <StateView kind="empty" title="작업할 계획이 없어요" text="생산계획에서 히트 편성을 확정하면 여기에 실적 행이 생겨요." actions={<Link className="hl-btn" to="/production/plans">생산계획으로</Link>} />
        ) : (
          <ResultDetail key={selectedId} planId={selectedId} />
        )}
      </main>
    </>
  );
}

function ResultDetail({ planId }: { planId: number }) {
  const detail = usePlanDetail(planId);
  const plan = detail.data;
  useShellTitle(plan ? `공정 실적 · ${plan.productionPlanNo}` : '공정 실적', plan?.salesOrder ? `${plan.salesOrder.salesOrderNo} · ${plan.salesOrder.customerName}` : undefined);
  return <QueryBoundary query={detail}>{(d) => <ResultBody plan={d} />}</QueryBoundary>;
}

function ioText(r: ResultView): { input: string; output: string } {
  const dash = '-';
  switch (r.processCode) {
    case 'IRONMAKING':
      return { input: r.inputTon ? `원료 ${fmtTon(r.inputTon)}` : dash, output: r.outputTon ? `용선 ${fmtTon(r.outputTon)}` : r.defaultHotMetalTon ? `필요 ${fmtTon(r.defaultHotMetalTon)}` : dash };
    case 'STEELMAKING':
      return { input: r.inputTon ? `용선 ${fmtTon(r.inputTon)}` : dash, output: r.outputTon ? `히트 ${fmtTon(r.outputTon)}` : dash };
    case 'CASTING':
      return {
        input: r.inputTon ? `히트 ${fmtTon(r.inputTon)}` : `계획 ${r.plannedQty ?? dash}매`,
        output: r.outputQty !== null ? `슬래브 ${r.outputQty}매${r.outputTon ? ` · ${fmtTon(r.outputTon)}` : ''}${r.lossQty ? ` (손실 ${r.lossQty}매)` : ''}` : dash,
      };
    default:
      return {
        input: r.inputTon ? `슬래브 ${fmtTon(r.inputTon)}` : `남은 압연 ${r.plannedQty ?? dash}매`,
        output: r.outputQty !== null ? `코일 ${r.outputQty}개${r.outputTon ? ` · ${fmtTon(r.outputTon)}` : ''}` : dash,
      };
  }
}

function ResultBody({ plan }: { plan: PlanDetail }) {
  const me = useMe();
  const canResult = canUse(me, 'RESULT_CONFIRM');
  const results = usePlanResults(plan.id);
  const [completing, setCompleting] = useState<ResultView | null>(null);
  const [startError, setStartError] = useState<unknown>(null);
  const start = useAction(productionApi.startResult, {
    success: (r) => `${PROCESS_CODE_LABEL[r.processCode]}${r.heatSeq !== null ? ` 히트 ${r.heatSeq}` : ''} 작업을 시작했어요`,
    invalidate: PLAN_TOPICS,
    onSuccess: () => setStartError(null),
    onError: (e) => setStartError(e),
  });
  const so = plan.salesOrder;
  const unit = qtyUnit(plan.itemType);
  const active = plan.productionPlanStatus === 'CONFIRMED' || plan.productionPlanStatus === 'IN_PROGRESS';
  const confirmedAllocQty = plan.rolling?.confirmedAllocationQty ?? 0;

  return (
    <>
      <div className="hl-page-head">
        <div>
          <div className="hl-crumb">
            <Link to="/production/results">작업 지시</Link>
            <Icon name="chevron-right" size="sm" />
            {so ? <Link to={`/sales-orders/${so.salesOrderId}`}>{so.salesOrderNo}</Link> : '수주 연결 없음'}
            <Icon name="chevron-right" size="sm" />
            실적 입력
          </div>
          <h1 className="hl-title" style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <span className="mono" style={{ fontSize: '18px' }}>{plan.productionPlanNo}</span>
            <PlanStatusBadge status={plan.productionPlanStatus} />
            <span className="hl-tag">{ITEM_TYPE_LABEL[plan.itemType]}</span>
          </h1>
        </div>
        <div className="hl-page-head__actions" style={{ flexWrap: 'wrap' }}>
          <Link className="hl-btn" to={`/production/plans?plan=${plan.id}`}><Icon name="calendar" />생산계획</Link>
          {plan.itemType === 'COIL' ? <Link className="hl-btn" to={`/production/rolling?plan=${plan.id}`}><Icon name="coil" />열연 투입 배정</Link> : null}
          <Link className="hl-btn" to="/quality/inspections"><Icon name="quality" />검사 입력</Link>
          <Link className="hl-btn" to="/business-events"><Icon name="history" />작업 로그</Link>
        </div>
      </div>

      <section className="hl-card" style={{ flex: 'none' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', padding: '12px 16px', gap: '12px' }}>
          <div className="hl-figure"><span>목표 규격</span><b className="mono" style={{ fontSize: '13px', lineHeight: '20px' }}>{specText(plan.productSpec)}</b></div>
          <div className="hl-figure"><span>목표</span><b style={{ fontSize: '15px' }}>{plan.shortageQty}{unit} · {fmtTon(plan.shortageTon)}</b></div>
          <div className="hl-figure"><span>편성</span><b style={{ fontSize: '15px' }}>{plan.heatCount}히트 · 슬래브 {plan.plannedSlabQty}매</b></div>
          <div className="hl-figure"><span>여재 사용</span><b style={{ fontSize: '15px' }}>{plan.surplusUseQty}매</b></div>
          <div className="hl-figure"><span>수주 · 고객사</span><b style={{ fontSize: '13px', lineHeight: '20px', fontWeight: 500 }}>{so ? <><Link to={`/sales-orders/${so.salesOrderId}`}>{so.salesOrderNo}</Link> {so.customerName}</> : '-'}</b></div>
        </div>
        <div style={{ padding: '10px 16px 12px', borderTop: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <PlanProcessSteps plan={plan} />
        </div>
      </section>

      <div className="hl-banner" style={{ fontSize: '12.5px' }}>
        <Icon name="info" size="sm" />
        <span>
          작업 시작 → 작업 완료 순서로 등록해요. 검사는 품질 담당이 <Link to="/quality/inspections">검사 입력</Link>에서 등록해요.
          히트의 성분 검사 결과가 나오기 전에도 연주는 진행할 수 있지만, 미합격(검사 전·불합격) LOT은 예약·열연·출고에 쓸 수 없어요.
        </span>
      </div>
      {startError ? <ServerErrorBanner error={startError} /> : null}
      {!active && plan.productionPlanStatus !== 'COMPLETED' ? (
        <div className="hl-banner hl-banner--wait"><Icon name="alert" /><span>{plan.productionPlanStatus === 'PLANNED' ? <>히트 편성 전이에요. <Link to={`/production/plans?plan=${plan.id}`}>생산계획</Link>에서 편성을 먼저 확정해 주세요.</> : '취소된 계획이에요.'}</span></div>
      ) : null}

      <QueryBoundary query={results}>
        {(rows) => (
          <>
            {planProcesses(plan.itemType).map((code) => (
              <ProcessSection
                key={code}
                code={code}
                rows={rows.filter((r) => r.processCode === code)}
                canResult={canResult}
                pendingId={start.isPending ? start.variables ?? null : null}
                confirmedAllocQty={confirmedAllocQty}
                planId={plan.id}
                onStart={(r) => start.mutate(r.id)}
                onComplete={setCompleting}
              />
            ))}
            {!rows.length ? <EmptyNote>이 계획의 실적 행이 없어요</EmptyNote> : null}
          </>
        )}
      </QueryBoundary>

      {completing ? <CompleteResultModal result={completing} plan={plan} onClose={() => setCompleting(null)} /> : null}
    </>
  );
}

const PROCESS_NOTE: Record<ProcessCode, string> = {
  IRONMAKING: '원료 → 용선 · 고로 번호와 용선량을 등록해요',
  STEELMAKING: '용선 + 합금철 → 히트 · 전로 번호를 등록해요',
  CASTING: '히트 → 슬래브 · 슬래브 생산 매수를 등록해요',
  HOT_ROLLING: '슬래브 → 코일 · 배정 확정된 슬래브를 압연해요',
};

function ProcessSection({
  code, rows, canResult, pendingId, confirmedAllocQty, planId, onStart, onComplete,
}: {
  code: ProcessCode;
  rows: ResultView[];
  canResult: boolean;
  pendingId: number | null;
  confirmedAllocQty: number;
  planId: number;
  onStart: (r: ResultView) => void;
  onComplete: (r: ResultView) => void;
}) {
  const done = rows.filter((r) => r.productionResultStatus === 'COMPLETED').length;
  return (
    <section className="hl-card" style={{ flex: 'none' }}>
      <div className="hl-card__head">
        <h2>{PROCESS_CODE_LABEL[code]}</h2>
        <span className="hl-card__meta">{PROCESS_NOTE[code]}</span>
        <div className="hl-card__actions">
          {code === 'HOT_ROLLING' ? <span className="hl-cap">배정 확정 {confirmedAllocQty}매 투입 대기</span> : null}
          <span className="hl-tag">완료 {done}/{rows.length}</span>
        </div>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="hl-table">
          <thead>
            <tr>
              <th style={{ width: 90 }}>{code === 'STEELMAKING' || code === 'CASTING' ? '히트' : '차수'}</th>
              <th style={{ width: 90 }}>상태</th>
              <th>시작</th>
              <th>완료</th>
              <th>투입</th>
              <th>산출</th>
              <th>LOT</th>
              <th className="ctr" style={{ width: 130 }}>작업</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const io = ioText(r);
              const equip = r.blastFurnaceNo ? `고로 ${r.blastFurnaceNo}` : r.converterNo ? `전로 ${r.converterNo}` : null;
              return (
                <tr key={r.id}>
                  <td>
                    <b>{r.heatSeq !== null ? `히트 ${r.heatSeq}` : `${i + 1}차`}</b>
                    {equip ? <div className="hl-cap">{equip}</div> : null}
                  </td>
                  <td>
                    <ResultStatusBadge status={r.productionResultStatus} />
                    {r.isSimulated ? <div><span className="hl-actor hl-actor--system" title="실적 시뮬레이션으로 등록">SYSTEM</span></div> : null}
                  </td>
                  <td className="tnum">{fmtMDHM(r.startedAt)}</td>
                  <td className="tnum">{fmtMDHM(r.completedAt)}</td>
                  <td>{io.input}</td>
                  <td>{io.output}{r.sampledLossRate !== null ? <div className="hl-cap">시뮬레이션 손실률 {(Number(r.sampledLossRate) * 100).toFixed(2)}%</div> : null}</td>
                  <td>
                    {r.lots.length ? (
                      <div className="hl-col" style={{ gap: 2 }}>
                        {r.lots.slice(0, 3).map((l) => (
                          <span key={l.id} className="hl-row" style={{ gap: 6 }}>
                            <LotLink lotNo={l.lotNo} />
                            <LotJudgeBadge isPassed={l.isPassed} lotType={l.lotType} />
                          </span>
                        ))}
                        {r.lots.length > 3 ? <span className="hl-cap">외 {r.lots.length - 3}개 · <Link to={`/production/plans?plan=${planId}`}>생산계획에서 전체 보기</Link></span> : null}
                      </div>
                    ) : <span className="hl-muted">-</span>}
                  </td>
                  <td className="ctr">
                    {r.productionResultStatus === 'READY' ? (
                      <button type="button" className="hl-btn hl-btn--sm" disabled={!canResult || pendingId !== null} title={canResult ? undefined : '권한이 필요해요'} onClick={() => onStart(r)}>
                        <Icon name="clock" />작업 시작
                      </button>
                    ) : r.productionResultStatus === 'STARTED' ? (
                      <button type="button" className="hl-btn hl-btn--sm hl-btn--primary" disabled={!canResult} title={canResult ? undefined : '권한이 필요해요'} onClick={() => onComplete(r)}>
                        <Icon name="check" />작업 완료
                      </button>
                    ) : (
                      <span className="hl-muted">-</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {!rows.length ? <tr><td colSpan={8}><EmptyNote style={{ padding: 6 }}>{PROCESS_CODE_LABEL[code]} 실적 행이 없어요</EmptyNote></td></tr> : null}
          </tbody>
        </table>
      </div>
      {!canResult && rows.some((r) => r.productionResultStatus !== 'COMPLETED') ? (
        <div className="hl-card__foot"><LockHint>공정 실적 권한이 필요해요</LockHint></div>
      ) : null}
    </section>
  );
}
