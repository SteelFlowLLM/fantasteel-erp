'use client';

// 작업 실적 화면 (/production/results): 계획 목록 | 공정별 작업 실적 (제선 → 제강 → 연주 → 열연).
// REQ-PRD-003·007, BP-PRD-02, 8장. 작업 상태값 없이 작업 시작·완료 일시만 기록한다. 실적 시뮬레이션도 이 화면에서 실행한다.
// 열연 실적은 열연 투입 배정 화면 한 곳에서 등록한다.
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { PERMISSION, PROCESS_TYPE_LABEL, PRODUCT_QTY_UNIT, type ProcessType } from '@/codes';
import type { ProductionPlanSummary, ProductionResultView } from '@/api/production';
import type { WorkContext } from '@/api/productionResults';
import { Banner } from '@/components/Banner';
import { Button, ButtonLink } from '@/components/Button';
import { Card, CardBody, CardHead } from '@/components/Card';
import { Chip } from '@/components/Chip';
import { Icon } from '@/components/Icon';
import { Input } from '@/components/Input';
import { Kpi, StatBar } from '@/components/Kpi';
import { MasterPane, PageHead, PageMain } from '@/components/Page';
import { QueryBoundary } from '@/components/QueryBoundary';
import { ReadOnlyHint } from '@/components/ReadOnlyHint';
import { EmptyNote, StateView } from '@/components/StateView';
import { Steps } from '@/components/Steps';
import { MasterListGroup, MasterListItem, Row } from '@/features/production/components/MasterList';
import { PlanFlags, PlanStatusBadge, ProductTypeTag } from '@/features/production/components/PlanBadges';
import { ResultFormModal, type ResultFormMode, type WorkProcess } from '@/features/production/components/ResultFormModal';
import { ResultsTable } from '@/features/production/components/ResultsTable';
import { SimulationModal } from '@/features/production/components/SimulationModal';
import { countResultsByProcess, planProcesses, processStepItems } from '@/features/production/lib/productionDisplay';
import { useShellTitle } from '@/features/shell/useShellTitle';
import { useCanUse } from '@/hooks/usePermission';
import { useProductionPlanParam } from '@/hooks/useProductionPlanParam';
import { useWorkContext, useWorkPlanList } from '@/hooks/useProductionResults';
import { fmtTon } from '@/lib/format';
import { permissionNeedText } from '@/lib/permissions';

const PROCESS_NOTE: Record<ProcessType, string> = {
  IRONMAKING: '원료(철광석·석탄·석회석) = 용선량 × 원단위(t/t), 입고일 순 FIFO 차감 → 용선 (HM-고로-YYMMDD-NN)',
  STEELMAKING: '용선 LOT 생산 순 FIFO 투입 · 합금철 = 히트 톤 × 원단위(kg/t) ÷ 1,000, 입고일 순 FIFO → 히트 (성분 검사 대상)',
  CONTINUOUS_CASTING: '히트 1개 → 슬래브 여러 매 (히트번호-SS) · 표면·치수 검사 대상',
  HOT_ROLLING: '배정 확정 슬래브 1매 → 코일 1개 (C + 슬래브번호, HT- 제외)',
};

function WorkPlanRow({ plan, active, onPick }: { plan: ProductionPlanSummary; active: boolean; onPick: () => void }) {
  return (
    <MasterListItem active={active} onPick={onPick}>
      <Row>
        <span className="font-mono text-mono font-semibold">{plan.productionPlanNo}</span>
        <ProductTypeTag itemType={plan.itemType} />
        <PlanFlags isReproduction={plan.isReproduction} isSurplusOnCompletion={plan.isSurplusOnCompletion} />
        <span className="ml-auto">
          <PlanStatusBadge status={plan.productionPlanStatus} />
        </span>
      </Row>
      <Row className="text-xs">
        {plan.salesOrderNo ? <span className="font-mono">{plan.salesOrderNo}</span> : <span className="text-ink-3">수주 연결 없음</span>}
        <span className="ml-auto whitespace-nowrap tabular-nums text-ink-2">
          제강 {plan.heatsMadeQty}/{plan.heatCount} · 연주 {plan.heatsCastQty}/{plan.heatCount}
        </span>
      </Row>
      <Row className="text-cap text-ink-3">
        <span className="truncate font-mono">{plan.itemCode}</span>
      </Row>
    </MasterListItem>
  );
}

function WorkPlanList({ plans, selectedId, onPick }: { plans: readonly ProductionPlanSummary[]; selectedId: number | null; onPick: (id: number) => void }) {
  const [keyword, setKeyword] = useState('');
  const [showDone, setShowDone] = useState(false);
  const filtered = useMemo(() => {
    const k = keyword.trim().toLowerCase();
    return plans.filter((p) => !k || [p.productionPlanNo, p.salesOrderNo ?? '', p.itemCode].some((t) => t.toLowerCase().includes(k)));
  }, [plans, keyword]);
  const groups = [
    { title: '진행중', rows: filtered.filter((p) => p.productionPlanStatus === 'IN_PROGRESS'), empty: '진행 중인 계획이 없어요' },
    { title: '계획 · 시작 전', rows: filtered.filter((p) => p.productionPlanStatus === 'PLANNED'), empty: '시작 전 계획이 없어요' },
    ...(showDone ? [{ title: '완료', rows: filtered.filter((p) => p.productionPlanStatus === 'COMPLETED'), empty: '완료된 계획이 없어요' }] : []),
  ];
  const openCount = plans.filter((p) => p.productionPlanStatus !== 'COMPLETED').length;
  return (
    <MasterPane
      head={
        <>
          <div className="flex items-baseline gap-2">
            <h2 className="text-lg font-semibold">생산계획</h2>
            <span className="text-xs text-ink-3">실적 입력 {openCount}건</span>
          </div>
          <Input leadingIcon="search" placeholder="계획·수주번호·규격 검색" value={keyword} onChange={(e) => setKeyword(e.target.value)} aria-label="계획 검색" />
          <div className="flex gap-1.5">
            <Chip on={!showDone} onClick={() => setShowDone(false)}>
              입력할 계획 <b>{openCount}</b>
            </Chip>
            <Chip on={showDone} onClick={() => setShowDone(true)}>
              완료 포함 <b>{plans.length}</b>
            </Chip>
          </div>
        </>
      }
    >
      {groups.map((g) => (
        <div key={g.title}>
          <MasterListGroup title={g.title} count={g.rows.length} />
          {g.rows.length === 0 ? <EmptyNote>{g.empty}</EmptyNote> : g.rows.map((p) => <WorkPlanRow key={p.id} plan={p} active={p.id === selectedId} onPick={() => onPick(p.id)} />)}
        </div>
      ))}
    </MasterPane>
  );
}

interface FormState {
  process: WorkProcess;
  mode: ResultFormMode;
  openResult: ProductionResultView | null;
}

function ProcessSection({
  ctx,
  process,
  canWork,
  onOpen,
}: {
  ctx: WorkContext;
  process: ProcessType;
  canWork: boolean;
  onOpen: (form: FormState) => void;
}) {
  const plan = ctx.plan;
  const results = plan.results.filter((r) => r.processType === process);
  const open = results.find((r) => r.completedAt === null) ?? null;
  const needText = permissionNeedText([PERMISSION.PRODUCTION_RESULT_CONFIRM]);
  const isRolling = process === 'HOT_ROLLING';
  const blockedReason = !ctx.isOpen
    ? '계획·진행중인 계획만 실적을 등록해요'
    : process === 'STEELMAKING' && ctx.heatsToMakeQty === 0
      ? `편성한 히트 ${plan.progress.heatCount}개를 모두 만들었어요`
      : process === 'CONTINUOUS_CASTING' && ctx.uncastHeats.length === 0
        ? '연주할 히트가 없어요 (제강 먼저)'
        : null;
  const meta =
    process === 'STEELMAKING'
      ? `히트 ${plan.progress.heatsMadeQty}/${plan.progress.heatCount}`
      : process === 'CONTINUOUS_CASTING'
        ? `연주 ${plan.progress.heatsCastQty}/${plan.progress.heatCount} · 슬래브 ${plan.progress.slabQty}매`
        : process === 'HOT_ROLLING'
          ? `코일 ${plan.progress.coilQty}/${plan.formation?.shortageQty ?? 0}개 · 배정 확정 ${plan.progress.hotRollingAllocatedQty}매 투입 대기`
          : `${results.length}건 · 용선 ${fmtTon(plan.progress.hotMetalTon)}`;
  const workProcess = process as WorkProcess;
  return (
    <Card>
      <CardHead
        title={PROCESS_TYPE_LABEL[process]}
        meta={meta}
        actions={
          isRolling ? (
            <ButtonLink href={`/production/rolling?plan=${plan.id}`} size="sm" icon="coil">
              열연 투입 배정 · 열연 실적
            </ButtonLink>
          ) : (
            <>
              <Button
                size="sm"
                icon="clock"
                disabled={!canWork || blockedReason !== null || open !== null}
                title={!canWork ? needText : (blockedReason ?? (open ? '진행 중인 작업을 먼저 완료해 주세요' : '작업 시작만 기록해요'))}
                onClick={() => onOpen({ process: workProcess, mode: 'start', openResult: null })}
              >
                작업 시작
              </Button>
              <Button
                size="sm"
                variant="primary"
                icon="plus"
                disabled={!canWork || blockedReason !== null}
                title={!canWork ? needText : (blockedReason ?? undefined)}
                onClick={() => onOpen({ process: workProcess, mode: 'register', openResult: null })}
              >
                실적 등록
              </Button>
            </>
          )
        }
      />
      <div className="border-b border-line bg-surface-2 px-4 py-1.5 text-cap text-ink-3">
        {PROCESS_NOTE[process]}
        {blockedReason && ctx.isOpen && !isRolling ? ` · ${blockedReason}` : ''}
      </div>
      <CardBody flush>
        <ResultsTable
          results={results}
          emptyText={isRolling ? '열연 실적은 열연 투입 배정 화면에서 등록해요' : '아직 등록된 실적이 없어요'}
          action={
            isRolling
              ? undefined
              : (r) =>
                  r.completedAt === null ? (
                    <Button size="sm" disabled={!canWork || !ctx.isOpen} title={canWork ? undefined : needText} onClick={() => onOpen({ process: workProcess, mode: 'complete', openResult: r })}>
                      작업 완료
                    </Button>
                  ) : null
          }
        />
      </CardBody>
    </Card>
  );
}

export function WorkBody({ ctx }: { ctx: WorkContext }) {
  const canWork = useCanUse(PERMISSION.PRODUCTION_RESULT_CONFIRM);
  const [form, setForm] = useState<FormState | null>(null);
  const [simulating, setSimulating] = useState(false);
  const plan = ctx.plan;
  const unit = PRODUCT_QTY_UNIT[plan.item.itemType];
  const so = plan.salesOrder;
  const needText = permissionNeedText([PERMISSION.PRODUCTION_RESULT_CONFIRM]);
  const steps = processStepItems({
    itemType: plan.item.itemType,
    productionPlanStatus: plan.productionPlanStatus,
    heatCount: plan.progress.heatCount,
    heatsMadeQty: plan.progress.heatsMadeQty,
    heatsCastQty: plan.progress.heatsCastQty,
    coilQty: plan.progress.coilQty,
    shortageQty: plan.formation?.shortageQty ?? 0,
    ...countResultsByProcess(plan.results),
  });
  return (
    <>
      <PageHead
        crumb={
          <>
            <Link href="/production/results">작업 실적</Link>
            <Icon name="chevron-right" size="sm" />
            {so ? <Link href={`/sales-orders/${so.salesOrderId}`}>{so.salesOrderNo}</Link> : '수주 연결 없음'}
            <Icon name="chevron-right" size="sm" />
            실적 입력
          </>
        }
        title={
          <span className="flex flex-wrap items-center gap-2.5">
            <span className="font-mono text-xl">{plan.productionPlanNo}</span>
            <PlanStatusBadge status={plan.productionPlanStatus} />
            <PlanFlags isReproduction={plan.isReproduction} isSurplusOnCompletion={plan.isSurplusOnCompletion} />
            <ProductTypeTag itemType={plan.item.itemType} />
          </span>
        }
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            {canWork ? null : <ReadOnlyHint permissions={[PERMISSION.PRODUCTION_RESULT_CONFIRM]} />}
            <ButtonLink href={`/production/plans?plan=${plan.id}`} icon="calendar">
              생산계획
            </ButtonLink>
            <ButtonLink href="/quality/inspections" icon="quality">
              검사 입력
            </ButtonLink>
            <ButtonLink href="/business-events" icon="history">
              작업 로그
            </ButtonLink>
            <Button variant="primary" icon="flow" disabled={!canWork || !ctx.isOpen} title={!canWork ? needText : ctx.isOpen ? undefined : '계획·진행중인 계획만 시뮬레이션해요'} onClick={() => setSimulating(true)}>
              실적 시뮬레이션
            </Button>
          </div>
        }
      />

      {plan.productionPlanStatus === 'COMPLETED' ? <Banner tone="ok">산출이 끝난 계획이에요. 실적은 조회만 할 수 있어요.</Banner> : null}
      {plan.productionPlanStatus === 'CANCELLED' ? <Banner>취소된 계획이에요.</Banner> : null}
      {plan.isSurplusOnCompletion ? <Banner tone="wait">수주 취소로 연결이 끊긴 계획이에요. 이 계획에서 나오는 합격 슬래브는 여재로 남아요.</Banner> : null}

      <StatBar>
        <Kpi flat label="생산 규격" value={<span className="font-mono text-base">{plan.item.itemCode}</span>} sub={plan.slabSpec && plan.item.itemType === 'COIL' ? `연주 ${plan.slabSpec.itemCode}` : undefined} />
        <Kpi flat label="부족 매수" value={plan.formation?.shortageQty ?? '-'} unit={unit} sub={so ? `${so.salesOrderNo} · ${so.customerName ?? ''}` : '수주 연결 없음'} />
        <Kpi flat label="히트 (제강/편성)" value={`${plan.progress.heatsMadeQty}/${plan.progress.heatCount}`} sub={plan.formation ? `히트 톤 ${fmtTon(plan.formation.heatTon)}` : undefined} />
        <Kpi flat label="슬래브" value={plan.progress.slabQty} unit="매" sub={`연주 ${plan.progress.heatsCastQty}/${plan.progress.heatCount}히트`} />
        <Kpi flat label="합격 / 판정 대기" value={`${plan.progress.passedQty} / ${plan.progress.pendingQty}`} unit={unit} sub={`불합격 ${plan.progress.failedQty}${unit}`} />
      </StatBar>
      <Steps items={steps} className="overflow-x-auto px-1" />

      {planProcesses(plan.item.itemType).map((process) => (
        <ProcessSection key={process} ctx={ctx} process={process} canWork={canWork} onOpen={setForm} />
      ))}

      {form ? <ResultFormModal ctx={ctx} process={form.process} mode={form.mode} openResult={form.openResult} onClose={() => setForm(null)} /> : null}
      {simulating ? <SimulationModal planId={plan.id} planNo={plan.productionPlanNo} onClose={() => setSimulating(false)} /> : null}
    </>
  );
}

function WorkDetail({ planId }: { planId: number }) {
  const work = useWorkContext(planId);
  const plan = work.data?.plan;
  useShellTitle(plan ? `작업 실적 · ${plan.productionPlanNo}` : '작업 실적', plan?.salesOrder ? `${plan.salesOrder.salesOrderNo} · ${plan.salesOrder.customerName ?? ''}` : undefined);
  return <QueryBoundary query={work}>{(ctx) => <WorkBody ctx={ctx} />}</QueryBoundary>;
}

export function ProductionResultScreen() {
  const list = useWorkPlanList();
  const [planParam, setPlan] = useProductionPlanParam();
  const plans = list.data ?? [];
  const firstOpen = plans.find((p) => p.productionPlanStatus === 'IN_PROGRESS') ?? plans.find((p) => p.productionPlanStatus === 'PLANNED') ?? plans[0];
  const selectedId = planParam ?? firstOpen?.id ?? null;
  return (
    <>
      {list.data ? (
        <WorkPlanList plans={plans} selectedId={selectedId} onPick={setPlan} />
      ) : (
        <MasterPane>
          <QueryBoundary query={list}>{() => null}</QueryBoundary>
        </MasterPane>
      )}
      <PageMain>
        {selectedId === null ? (
          list.isPending ? (
            <StateView kind="loading" />
          ) : (
            <StateView
              kind="empty"
              title="작업할 계획이 없어요"
              text="수주를 등록하면 부족분만큼 생산계획이 만들어지고, 여기서 작업 실적을 등록해요."
              actions={<ButtonLink href="/production/plans">생산계획으로</ButtonLink>}
            />
          )
        ) : (
          <WorkDetail key={selectedId} planId={selectedId} />
        )}
      </PageMain>
    </>
  );
}
