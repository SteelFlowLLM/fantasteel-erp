// 생산계획 (REQ-PRD-001·002·006·007). 디자인: v1 B안 18번(목록 | 상세). 데이터는 docs/api/production.md.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import {
  ALLOCATION_STATUS_LABEL, ITEM_TYPE_LABEL, LOT_TYPE_LABEL, PROCESS_CODE_LABEL, PRODUCTION_PLAN_STATUS, PRODUCTION_PLAN_STATUS_LABEL,
  SALES_ORDER_ITEM_STATUS_LABEL, type ProductionPlanStatus, type SalesOrderItemStatus,
} from '@fantasteel/shared';
import { productionApi, type PlanDetail, type PlanListQuery, type PlanLotView, type ProductItemType, type ResultView } from '@/api/production';
import { Badge, EmptyNote, Icon, QueryBoundary, SoonButton, StateView } from '@/components/ui';
import { HeatPlanningCard } from '@/features/production/HeatPlanningCard';
import { CancelPlanModal, ReproductionModal, SimulateModal } from '@/features/production/PlanModals';
import { usePlanDetail, usePlanParam, usePlans } from '@/features/production/productionHooks';
import {
  LockHint, LotJudgeBadge, LotLink, PlanListItem, PlanProcessSteps, PlanStatusBadge, ResultStatusBadge, fmtRate, lotStateText, planProcesses, qtyUnit, specText,
} from '@/features/production/prodUi';
import { dLabel, fmtDate, fmtMDHM, fmtTon } from '@/lib/format';
import { useShellTitle } from '@/shell/shellTitle';
import { canUse, useMe } from '@/stores/auth';

type TypeChip = 'ALL' | ProductItemType;
const STATUS_OPTIONS = Object.values(PRODUCTION_PLAN_STATUS) as ProductionPlanStatus[];
const LOT_ROWS = 40;

export function ProductionPlanPage() {
  const [planId, setPlanId] = usePlanParam();
  const [status, setStatus] = useState<ProductionPlanStatus | ''>('');
  const [typeChip, setTypeChip] = useState<TypeChip>('ALL');
  const [needsAction, setNeedsAction] = useState(false);
  const [q, setQ] = useState('');

  const filters: PlanListQuery = {};
  if (status) filters.status = status;
  if (typeChip !== 'ALL') filters.itemType = typeChip;
  if (needsAction) filters.needsAction = true;
  const list = usePlans(filters);

  const needle = q.trim().toLowerCase();
  const shown = (list.data ?? []).filter((p) => !needle || `${p.productionPlanNo} ${p.salesOrder?.salesOrderNo ?? ''} ${p.salesOrder?.customerName ?? ''} ${p.productSpec.specCode}`.toLowerCase().includes(needle));
  const selectedId = planId ?? shown[0]?.id ?? null;

  return (
    <>
      <section className="hl-master" aria-label="생산계획 목록">
        <div className="hl-master__head">
          <div className="hl-row">
            <b style={{ fontSize: '14px' }}>생산계획</b>
            <span className="hl-tag">{list.data ? `${shown.length}건` : '…'}</span>
          </div>
          <label className="hl-inputwrap">
            <Icon name="search" size="sm" />
            <input className="hl-input" type="search" placeholder="계획·수주번호·고객사 검색" aria-label="생산계획 검색" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <div className="hl-row" style={{ gap: '6px' }}>
            <span className="hl-selectwrap" style={{ flex: 1, minWidth: 0 }}>
              <select className="hl-input" style={{ height: '28px', padding: '0 26px 0 8px' }} aria-label="상태" value={status} onChange={(e) => setStatus(e.target.value as ProductionPlanStatus | '')}>
                <option value="">상태 전체</option>
                {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{PRODUCTION_PLAN_STATUS_LABEL[s]}</option>)}
              </select>
              <Icon name="chevron-down" size="sm" style={{ top: '7px' }} />
            </span>
            <button className={`hl-chip${needsAction ? ' is-on' : ''}`} type="button" aria-pressed={needsAction} onClick={() => setNeedsAction(!needsAction)}>조치 필요</button>
          </div>
          <div className="hl-row" style={{ gap: '6px' }}>
            {(['ALL', 'SLAB', 'COIL'] as TypeChip[]).map((c) => (
              <button key={c} className={`hl-chip${typeChip === c ? ' is-on' : ''}`} type="button" aria-pressed={typeChip === c} onClick={() => setTypeChip(c)}>
                {c === 'ALL' ? '전체' : ITEM_TYPE_LABEL[c]}
              </button>
            ))}
          </div>
        </div>
        <div className="hl-master__list">
          <QueryBoundary query={list}>
            {() => (
              <>
                {shown.map((p) => <PlanListItem key={p.id} plan={p} active={p.id === selectedId} onPick={setPlanId} />)}
                {!shown.length ? <EmptyNote>{needle || status || needsAction || typeChip !== 'ALL' ? '조건에 맞는 생산계획이 없어요' : '생산계획이 없어요'}</EmptyNote> : null}
              </>
            )}
          </QueryBoundary>
        </div>
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--line)', background: 'var(--surface-2)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span className="hl-cap">수주 등록 때 합격 재고를 매수 단위로 예약하고, 모자란 매수만 SYSTEM이 생산계획으로 넘겨요. 계획은 히트 편성을 확정해야 실적을 등록할 수 있어요.</span>
        </div>
      </section>
      <main className="hl-main">
        {selectedId === null ? (
          list.isLoading ? <StateView kind="loading" /> : <StateView kind="empty" title="생산계획을 골라 주세요" text="왼쪽 목록에서 계획을 고르면 편성과 진행 상황을 볼 수 있어요." />
        ) : (
          <PlanDetailView key={selectedId} planId={selectedId} onSelect={setPlanId} />
        )}
      </main>
    </>
  );
}

function PlanDetailView({ planId, onSelect }: { planId: number; onSelect: (id: number) => void }) {
  const detail = usePlanDetail(planId);
  const plan = detail.data;
  useShellTitle(plan ? `생산계획 · ${plan.productionPlanNo}` : '생산계획', plan?.salesOrder ? `${plan.salesOrder.salesOrderNo} · ${plan.salesOrder.customerName}` : undefined);
  return <QueryBoundary query={detail}>{(d) => <PlanDetailBody plan={d} onSelect={onSelect} />}</QueryBoundary>;
}

function PlanDetailBody({ plan, onSelect }: { plan: PlanDetail; onSelect: (id: number) => void }) {
  const me = useMe();
  const canPlan = canUse(me, 'PLAN_CONFIRM');
  const canSimulate = canUse(me, 'RESULT_CONFIRM');
  const [modal, setModal] = useState<'simulate' | 'reproduce' | 'cancel' | null>(null);

  const so = plan.salesOrder;
  const status = plan.productionPlanStatus;
  const unit = qtyUnit(plan.itemType);
  const isPlanned = status === 'PLANNED';
  const isRunning = status === 'CONFIRMED' || status === 'IN_PROGRESS';
  const notStarted = plan.results.every((r) => r.productionResultStatus === 'READY');
  const canCancel = isPlanned || (status === 'CONFIRMED' && notStarted);
  const itemCancelled = so?.salesOrderItemStatus === 'CANCELLED';

  // 재생산이 필요한지: 수주 품목 기준으로 서버가 계산한 값 (편성 전 계획은 자기 자신이 채울 계획이라 묻지 않는다)
  const repro = useQuery({
    queryKey: ['production-plans', 'reproduction-preview', so?.salesOrderItemId ?? null],
    queryFn: () => productionApi.reproductionPreview(so!.salesOrderItemId),
    enabled: !!so && !itemCancelled && !isPlanned,
  });
  const additionalQty = repro.data?.additionalQty ?? 0;

  return (
    <>
      <div className="hl-page-head">
        <div>
          <div className="hl-crumb">
            <Link to="/production/plans">생산계획</Link>
            <Icon name="chevron-right" size="sm" />
            {so ? <Link to={`/sales-orders/${so.salesOrderId}`}>{so.salesOrderNo}</Link> : '수주 연결 없음'}
            <Icon name="chevron-right" size="sm" />
            {isPlanned ? '히트 편성' : '진행 현황'}
          </div>
          <h1 className="hl-title" style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <span className="mono" style={{ fontSize: '18px' }}>{plan.productionPlanNo}</span>
            <PlanStatusBadge status={status} />
            {plan.isReproduction ? <Badge tone="wait">재생산</Badge> : null}
            <span className="hl-tag">{ITEM_TYPE_LABEL[plan.itemType]}</span>
          </h1>
        </div>
        <div className="hl-page-head__actions" style={{ flexWrap: 'wrap' }}>
          {so ? <Link className="hl-btn" to={`/sales-orders/${so.salesOrderId}`}><Icon name="order" />수주 상세</Link> : null}
          <Link className="hl-btn" to="/business-events"><Icon name="history" />작업 로그</Link>
          {!isPlanned && status !== 'CANCELLED' ? <Link className="hl-btn" to={`/production/results?plan=${plan.id}`}><Icon name="factory" />공정 실적</Link> : null}
          {plan.itemType === 'COIL' && isRunning ? <Link className="hl-btn" to={`/production/rolling?plan=${plan.id}`}><Icon name="coil" />열연 투입</Link> : null}
          {so && !itemCancelled && !isPlanned ? (
            <button type="button" className="hl-btn" disabled={!canPlan} title={canPlan ? undefined : '권한이 필요해요'} onClick={() => setModal('reproduce')}><Icon name="refresh" />재생산 계획</button>
          ) : null}
          {isRunning ? (
            <button type="button" className="hl-btn hl-btn--primary" disabled={!canSimulate} title={canSimulate ? undefined : '권한이 필요해요'} onClick={() => setModal('simulate')}>
              <Icon name="flow" />실적 시뮬레이션 실행
            </button>
          ) : null}
        </div>
      </div>

      {additionalQty > 0 ? (
        <div className="hl-banner hl-banner--danger" style={{ alignItems: 'center' }}>
          <Icon name="alert" />
          <div>
            <b>재생산 필요</b> — {so?.salesOrderNo} 품목 {so?.lineNo}에 아직 <b>{additionalQty}{unit}</b>가 모자라요 (미확보 {repro.data?.unsecuredQty}{unit} · 진행 계획 잔여 {repro.data?.openPlanRemainingQty}{unit}).
          </div>
          <div className="hl-banner__actions">
            <button type="button" className="hl-btn hl-btn--sm" disabled={!canPlan} title={canPlan ? undefined : '권한이 필요해요'} onClick={() => setModal('reproduce')}><Icon name="plus" />재생산 계획</button>
          </div>
        </div>
      ) : null}
      {status === 'CANCELLED' ? (
        <div className="hl-banner"><Icon name="info" /><span>{fmtMDHM(plan.cancelledAt)}에 취소된 계획이에요.</span></div>
      ) : null}

      <section className="hl-card" style={{ flex: 'none' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(128px, 1fr))', padding: '12px 16px', gap: '12px' }}>
          <div className="hl-figure">
            <span>목표 규격</span>
            <b className="mono" style={{ fontSize: '13px', lineHeight: '20px' }}>{specText(plan.productSpec)}</b>
          </div>
          <div className="hl-figure">
            <span>슬래브 규격 (연주)</span>
            <b className="mono" style={{ fontSize: '13px', lineHeight: '20px' }}>{plan.slabSpec ? specText(plan.slabSpec) : '규격 매핑 없음'}</b>
          </div>
          <div className="hl-figure"><span>목표 매수</span><b>{plan.shortageQty}<small>{unit}</small></b></div>
          <div className="hl-figure"><span>여재 사용</span><b>{plan.surplusUseQty}<small>매</small></b></div>
          <div className="hl-figure"><span>히트 수</span><b>{isPlanned ? '-' : plan.heatCount}<small>{isPlanned ? '' : '개'}</small></b></div>
          <div className="hl-figure"><span>계획 슬래브</span><b>{isPlanned ? '-' : plan.plannedSlabQty}<small>{isPlanned ? '' : '매'}</small></b></div>
          <div className="hl-figure"><span>예상 여재</span><b>{isPlanned ? '-' : plan.surplus.expectedQty}<small>{isPlanned ? '' : '매'}</small></b></div>
          <div className="hl-figure"><span>필요 투입량</span><b style={{ fontSize: '15px' }}>{isPlanned ? '-' : fmtTon(plan.requiredInputTon)}</b></div>
          <div className="hl-figure"><span>누적 계획수율</span><b style={{ fontSize: '15px' }}>{fmtRate(plan.cumulativeYieldRate)}</b></div>
        </div>
        <div style={{ padding: '10px 16px 12px', borderTop: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <PlanProcessSteps plan={plan} />
          <span className="hl-cap">
            목표중량 {fmtTon(plan.shortageTon)} (계산값 = 목표 매수 × 1매 이론중량 {fmtTon(plan.productSpec.theoreticalWeightTon)})
            {isPlanned ? ' · 히트 수·필요 투입량은 편성을 확정하면 정해져요' : ` · 편성 확정 ${fmtMDHM(plan.confirmedAt)}`}
            {plan.completedAt ? ` · 완료 ${fmtMDHM(plan.completedAt)}` : ''}
            {!isPlanned && status !== 'CANCELLED' ? ` · 실제 여재 ${plan.surplus.actualQty}매` : ''}
          </span>
        </div>
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(280px, 340px)', gap: '16px', flex: '1', minHeight: '0', alignItems: 'start' }}>
        <div className="hl-col" style={{ gap: '16px', minWidth: 0 }}>
          {isPlanned ? <HeatPlanningCard plan={plan} onCancel={() => setModal('cancel')} /> : null}
          {!isPlanned ? <ProcessBoard plan={plan} canCancel={canCancel} canPlan={canPlan} onCancel={() => setModal('cancel')} /> : null}
          {!isPlanned ? <LotsCard plan={plan} /> : null}
        </div>
        <div className="hl-col" style={{ gap: '16px', minWidth: 0 }}>
          <section className="hl-card">
            <div className="hl-card__head"><h3>연결된 수주 품목</h3></div>
            <div className="hl-card__body">
              {so ? (
                <dl className="hl-kv">
                  <dt>수주</dt>
                  <dd><Link className="hl-link-id" to={`/sales-orders/${so.salesOrderId}`}>{so.salesOrderNo}</Link> <span className="hl-muted">품목 {so.lineNo}</span></dd>
                  <dt>고객사</dt>
                  <dd>{so.customerName}</dd>
                  <dt>납기</dt>
                  <dd>{fmtDate(so.dueDate)} <span className={dLabel(so.dueDate).startsWith('D+') && status !== 'COMPLETED' && status !== 'CANCELLED' ? 'hl-risk' : 'hl-muted'}>{dLabel(so.dueDate)}</span></dd>
                  <dt>주문 매수</dt>
                  <dd>{so.orderedQty}{unit}</dd>
                  <dt>품목 상태</dt>
                  <dd>{SALES_ORDER_ITEM_STATUS_LABEL[so.salesOrderItemStatus as SalesOrderItemStatus] ?? so.salesOrderItemStatus}</dd>
                  <dt>수주 담당</dt>
                  <dd>{so.ownerEmployeeName}</dd>
                  <dt>이 계획 잔여</dt>
                  <dd title="이 계획이 수주 품목에 아직 채워 줄 수 있는 매수">{plan.remainingTargetQty}{unit}</dd>
                </dl>
              ) : (
                <span className="hl-cap">수주 취소로 연결이 끊긴 계획이에요. 만들어진 합격 슬래브는 여재(가용재고)로 남아요.</span>
              )}
            </div>
          </section>

          {plan.rolling ? <RollingCard plan={plan} /> : null}

          <div className="hl-draft">
            <div className="hl-draft__head">
              <span className="hl-aimark hl-aimark--sm">AI</span>
              <b>Agent 초안</b>
            </div>
            <div className="hl-draft__body">
              <span className="hl-cap">납기 위험이나 합격 매수 부족이 감지되면 AI Factory Agent가 재생산·일정 초안을 제안하고, 부서장 승인 후에만 반영돼요. 지금은 담당자가 직접 재생산 계획을 만들어요.</span>
            </div>
            <div className="hl-draft__actions">
              <SoonButton grade="P2" className="hl-btn hl-btn--ai-outline hl-btn--sm">자동 초안</SoonButton>
            </div>
          </div>
        </div>
      </div>

      {modal === 'simulate' ? <SimulateModal plan={plan} onClose={() => setModal(null)} /> : null}
      {modal === 'cancel' ? <CancelPlanModal plan={plan} onClose={() => setModal(null)} /> : null}
      {modal === 'reproduce' && so ? (
        <ReproductionModal
          salesOrderItemId={so.salesOrderItemId}
          onClose={() => setModal(null)}
          onCreated={(r) => {
            setModal(null);
            if (r.plan) onSelect(r.plan.id);
          }}
        />
      ) : null}
    </>
  );
}

function resultLine(r: ResultView): string {
  if (r.processCode === 'IRONMAKING') return r.outputTon ? `용선 ${fmtTon(r.outputTon)}${r.blastFurnaceNo ? ` · 고로 ${r.blastFurnaceNo}` : ''}` : r.defaultHotMetalTon ? `필요 용선 ${fmtTon(r.defaultHotMetalTon)}` : '용선';
  if (r.processCode === 'STEELMAKING') return r.outputTon ? `히트 ${fmtTon(r.outputTon)}${r.converterNo ? ` · 전로 ${r.converterNo}` : ''}` : '히트';
  if (r.processCode === 'CASTING') return r.outputQty !== null ? `슬래브 ${r.outputQty}/${r.plannedQty ?? '-'}매${r.lossQty ? ` · 손실 ${r.lossQty}` : ''}` : `슬래브 계획 ${r.plannedQty ?? '-'}매`;
  return r.outputQty !== null ? `코일 ${r.outputQty}개` : `남은 압연 ${r.plannedQty ?? '-'}개`;
}

/** 공정별 진행: 제선 → 제강 → 연주 → [열연] 레인에 실적 카드 */
function ProcessBoard({ plan, canCancel, canPlan, onCancel }: { plan: PlanDetail; canCancel: boolean; canPlan: boolean; onCancel: () => void }) {
  const processes = planProcesses(plan.itemType);
  return (
    <section className="hl-card">
      <div className="hl-card__head">
        <h2>공정 진행</h2>
        <span className="hl-card__meta">{processes.map((p) => PROCESS_CODE_LABEL[p]).join(' → ')}</span>
        <div className="hl-card__actions">
          {canCancel ? (
            <button type="button" className="hl-btn hl-btn--sm" disabled={!canPlan} title={canPlan ? '작업을 시작하기 전에만 취소할 수 있어요' : '권한이 필요해요'} onClick={onCancel}><Icon name="x" />계획 취소</button>
          ) : null}
          <Link className="hl-btn hl-btn--sm" to={`/production/results?plan=${plan.id}`}><Icon name="factory" />실적 등록</Link>
        </div>
      </div>
      <div className="hl-card__body">
        {plan.results.length ? (
          <div className="hl-kanban" style={{ gridTemplateColumns: `repeat(${processes.length}, minmax(150px, 1fr))`, overflowX: 'auto', alignItems: 'start' }}>
            {processes.map((code) => {
              const rows = plan.results.filter((r) => r.processCode === code);
              const done = rows.filter((r) => r.productionResultStatus === 'COMPLETED').length;
              return (
                <div key={code} className="hl-lane" style={{ maxHeight: 420, overflowY: 'auto' }}>
                  <div className="hl-lane__head">
                    {PROCESS_CODE_LABEL[code]}
                    <span className="hl-tag">{done}/{rows.length}</span>
                  </div>
                  {rows.map((r) => (
                    <div key={r.id} className="hl-heatcard">
                      <div className="hl-row">
                        <span className="hl-heatcard__id">{r.heatSeq !== null ? `히트 ${r.heatSeq}` : PROCESS_CODE_LABEL[code]}</span>
                        {r.isSimulated ? <span className="hl-actor hl-actor--system" title="실적 시뮬레이션으로 등록">SYSTEM</span> : null}
                        <span style={{ marginLeft: 'auto' }}><ResultStatusBadge status={r.productionResultStatus} /></span>
                      </div>
                      <span style={{ fontSize: '12px' }}>{resultLine(r)}</span>
                      {r.lots.length ? (
                        <div className="hl-row" style={{ fontSize: '12px', flexWrap: 'wrap', gap: 4 }}>
                          <LotLink lotNo={r.lots[0].lotNo} />
                          {r.lots.length > 1 ? <span className="hl-muted">외 {r.lots.length - 1}</span> : null}
                        </div>
                      ) : null}
                      <div className="hl-row hl-cap">
                        <span>{r.completedAt ? `${fmtMDHM(r.completedAt)} 완료` : r.startedAt ? `${fmtMDHM(r.startedAt)} 시작` : '시작 전'}</span>
                      </div>
                    </div>
                  ))}
                  {!rows.length ? <EmptyNote style={{ padding: '8px 4px' }}>실적 행이 없어요</EmptyNote> : null}
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyNote>{plan.productionPlanStatus === 'CANCELLED' ? '취소된 계획이라 실적이 없어요' : '등록된 실적 행이 없어요'}</EmptyNote>
        )}
      </div>
    </section>
  );
}

function LotsCard({ plan }: { plan: PlanDetail }) {
  const groups: { key: string; lots: PlanLotView[] }[] = [
    { key: 'HOT_METAL', lots: plan.lots.hotMetals },
    { key: 'HEAT', lots: plan.lots.heats },
    { key: 'SLAB', lots: plan.lots.slabs },
    { key: 'COIL', lots: plan.lots.coils },
  ];
  const [tab, setTab] = useState<string>(() => (plan.lots.coils.length ? 'COIL' : plan.lots.slabs.length ? 'SLAB' : plan.lots.heats.length ? 'HEAT' : 'HOT_METAL'));
  const [all, setAll] = useState(false);
  const lots = groups.find((g) => g.key === tab)?.lots ?? [];
  const shown = all ? lots : lots.slice(0, LOT_ROWS);
  const total = groups.reduce((s, g) => s + g.lots.length, 0);
  const isProduct = tab === 'SLAB' || tab === 'COIL';
  return (
    <section className="hl-card">
      <div className="hl-card__head">
        <h2>생산 LOT</h2>
        <span className="hl-card__meta">이 계획이 만든 LOT {total}개</span>
        <div className="hl-card__actions" style={{ gap: 6 }}>
          {groups.map((g) => (
            <button key={g.key} type="button" className={`hl-chip${tab === g.key ? ' is-on' : ''}`} aria-pressed={tab === g.key} onClick={() => { setTab(g.key); setAll(false); }}>
              {LOT_TYPE_LABEL[g.key as keyof typeof LOT_TYPE_LABEL]} <b>{g.lots.length}</b>
            </button>
          ))}
        </div>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="hl-table">
          <thead>
            <tr>
              <th>LOT</th>
              {isProduct ? <th>히트</th> : null}
              <th className="num">{isProduct ? '이론중량' : tab === 'HOT_METAL' ? '출선량 · 잔량' : '히트 톤'}</th>
              <th>검사</th>
              <th>상태</th>
              <th>생산완료</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((l) => (
              <tr key={l.id} className={l.isPassed === false || l.heatIsPassed === false ? 'is-risk' : undefined}>
                <td><LotLink lotNo={l.lotNo} /></td>
                {isProduct ? <td>{l.heatLotNo ? <LotLink lotNo={l.heatLotNo} /> : '-'}</td> : null}
                <td className="num tnum">
                  {isProduct ? fmtTon(l.weightTon) : tab === 'HOT_METAL' ? `${fmtTon(l.initialTon)} · ${fmtTon(l.remainingTon)}` : fmtTon(l.initialTon)}
                </td>
                <td>
                  {l.isPassed === null && l.lotType !== 'HOT_METAL'
                    ? <Link to={`/quality/inspections?lot=${l.id}`} title="검사 입력으로 이동"><LotJudgeBadge isPassed={l.isPassed} heatIsPassed={l.heatIsPassed} lotType={l.lotType} /></Link>
                    : <LotJudgeBadge isPassed={l.isPassed} heatIsPassed={l.heatIsPassed} lotType={l.lotType} />}
                </td>
                <td>{lotStateText(l)}</td>
                <td className="tnum">{fmtMDHM(l.producedAt)}</td>
              </tr>
            ))}
            {!lots.length ? <tr><td colSpan={isProduct ? 6 : 5}><EmptyNote style={{ padding: 6 }}>아직 만든 {LOT_TYPE_LABEL[tab as keyof typeof LOT_TYPE_LABEL]} LOT이 없어요</EmptyNote></td></tr> : null}
          </tbody>
        </table>
      </div>
      {lots.length > LOT_ROWS ? (
        <div className="hl-card__foot">
          <span className="hl-cap">{shown.length} / {lots.length}개 표시</span>
          <button type="button" className="hl-btn hl-btn--sm hl-btn--ghost" style={{ marginLeft: 'auto' }} onClick={() => setAll(!all)}>{all ? '접기' : '모두 보기'}</button>
        </div>
      ) : null}
    </section>
  );
}

/** 코일 계획: 열연 투입 필요·귀속 슬래브·배정 */
function RollingCard({ plan }: { plan: PlanDetail }) {
  const me = useMe();
  const rolling = plan.rolling;
  if (!rolling) return null;
  const live = plan.rollingAllocations.filter((a) => a.status !== 'RELEASED');
  const active = plan.productionPlanStatus === 'CONFIRMED' || plan.productionPlanStatus === 'IN_PROGRESS';
  return (
    <section className="hl-card">
      <div className="hl-card__head">
        <h3>열연 투입</h3>
        <span className="hl-card__meta">코일 {rolling.rolledQty}/{plan.shortageQty}개 압연</span>
      </div>
      <div className="hl-card__body" style={{ gap: 10 }}>
        <dl className="hl-kv">
          <dt>남은 압연</dt>
          <dd>{rolling.remainingQty}개</dd>
          <dt>슬래브 추가 확보 필요</dt>
          <dd className={rolling.rollingNeedQty > 0 ? 'hl-danger-text' : undefined}>{rolling.rollingNeedQty}매</dd>
          <dt>귀속된 적격 슬래브</dt>
          <dd>{rolling.earmarkedSlabQty}매</dd>
          <dt>배정 확정 (투입 대기)</dt>
          <dd>{rolling.confirmedAllocationQty}매</dd>
        </dl>
        {plan.earmarkedSlabs.length ? (
          <div className="hl-col" style={{ gap: 4 }}>
            <b className="hl-label">귀속 슬래브</b>
            <div className="hl-col" style={{ gap: 4, maxHeight: 150, overflowY: 'auto' }}>
              {plan.earmarkedSlabs.map((l) => (
                <div key={l.id} className="hl-row" style={{ fontSize: '12px' }}>
                  <LotLink lotNo={l.lotNo} />
                  <span className="hl-muted" style={{ marginLeft: 'auto' }}>{l.confirmedAllocationId !== null ? '배정 확정' : l.productionPlanId === plan.id ? '이 계획 생산분' : '여재에서 귀속'}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        {live.length ? (
          <div className="hl-col" style={{ gap: 4 }}>
            <b className="hl-label">열연 배정</b>
            <div className="hl-col" style={{ gap: 4, maxHeight: 150, overflowY: 'auto' }}>
              {live.map((a) => (
                <div key={a.id} className="hl-row" style={{ fontSize: '12px' }}>
                  <LotLink lotNo={a.lotNo} />
                  <span style={{ marginLeft: 'auto' }}><Badge tone={a.status === 'CONSUMED' ? 'ok' : 'run'}>{ALLOCATION_STATUS_LABEL[a.status]}</Badge></span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        <span className="hl-cap">필요한 매수의 슬래브만 열연에 투입하고, 남은 합격 슬래브는 여재(가용재고)로 남아요.</span>
      </div>
      {active ? (
        <div className="hl-card__foot">
          {!canUse(me, 'ROLLING_ALLOCATE') ? <LockHint>열연 투입 배정 권한 필요</LockHint> : null}
          <Link className="hl-btn hl-btn--sm" style={{ marginLeft: 'auto' }} to={`/production/rolling?plan=${plan.id}`}><Icon name="coil" />열연 투입 배정<Icon name="arrow-right" size="sm" /></Link>
        </div>
      ) : null}
    </section>
  );
}
