'use client';

// 생산계획 화면 (/production/plans): 목록 | 상세(편성표·히트·작업 실적·LOT·연결 수주 품목).
// REQ-PRD-001·002·006, BP-PRD-01, 10장. 계획은 수주 등록 때 만들어진다(편성까지 계산). CONFIRMED 상태와 '조치 필요' 필터는 없다(PLAN 6-3·7).
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { INSPECTION_RESULT_LABEL, ITEM_TYPE_LABEL, PERMISSION, PRODUCT_QTY_UNIT, PRODUCTION_PLAN_STATUS, PRODUCTION_PLAN_STATUS_LABEL, SALES_ORDER_ITEM_STATUS_LABEL, type ProductItemType, type ProductionPlanStatus } from '@/codes';
import type { ProductionPlanDetail, ProductionPlanListRow } from '@/api/production';
import { Badge } from '@/components/Badge';
import { Banner } from '@/components/Banner';
import { Button, ButtonLink } from '@/components/Button';
import { Card, CardBody, CardHead } from '@/components/Card';
import { Chip } from '@/components/Chip';
import { Icon } from '@/components/Icon';
import { Input, Select } from '@/components/Input';
import { KvList } from '@/components/KvList';
import { MasterPane, PageHead, PageMain } from '@/components/Page';
import { QueryBoundary } from '@/components/QueryBoundary';
import { ReadOnlyHint } from '@/components/ReadOnlyHint';
import { EmptyNote, StateView } from '@/components/StateView';
import { Table, Td, Th } from '@/components/Table';
import { FormationCard } from '@/features/production/components/FormationCard';
import { MasterListItem, Row } from '@/features/production/components/MasterList';
import { PlanFlags, PlanStatusBadge, ProductTypeTag } from '@/features/production/components/PlanBadges';
import { PlanLotsCard } from '@/features/production/components/PlanLotsCard';
import { CancelPlanModal, ReproductionModal } from '@/features/production/components/PlanModals';
import { ResultsTable } from '@/features/production/components/ResultsTable';
import { countResultsByProcess, isOverdue, processStepItems } from '@/features/production/lib/productionDisplay';
import { useShellTitle } from '@/features/shell/useShellTitle';
import { useCanUse } from '@/hooks/usePermission';
import { useProductionPlanDetail, useProductionPlanList } from '@/hooks/useProductionPlans';
import { useProductionPlanParam } from '@/hooks/useProductionPlanParam';
import { dLabel, fmtDate, fmtDateTime, fmtMD, fmtTon } from '@/lib/format';
import { permissionNeedText } from '@/lib/permissions';
import { INSPECTION_RESULT_TONE } from '@/lib/statusTone';

type TypeFilter = 'ALL' | ProductItemType;

function PlanListRow({ plan, active, onPick }: { plan: ProductionPlanListRow; active: boolean; onPick: () => void }) {
  const unit = PRODUCT_QTY_UNIT[plan.itemType];
  const d = plan.dueDate ? dLabel(plan.dueDate) : '';
  const open = plan.productionPlanStatus === 'PLANNED' || plan.productionPlanStatus === 'IN_PROGRESS';
  return (
    <MasterListItem active={active} onPick={onPick}>
      <Row>
        <span className="font-mono text-mono font-semibold text-ink">{plan.productionPlanNo}</span>
        <ProductTypeTag itemType={plan.itemType} />
        <PlanFlags isReproduction={plan.isReproduction} isSurplusOnCompletion={plan.isSurplusOnCompletion} />
        <span className="ml-auto">
          <PlanStatusBadge status={plan.productionPlanStatus} />
        </span>
      </Row>
      <Row className="text-xs">
        {plan.salesOrderNo ? (
          <span className="min-w-0 truncate">
            <span className="font-mono">{plan.salesOrderNo}</span>
            {plan.customerName ? <span className="text-ink-2"> · {plan.customerName}</span> : null}
          </span>
        ) : (
          <span className="text-ink-3">수주 연결 없음</span>
        )}
        <b className="ml-auto whitespace-nowrap tabular-nums">
          부족 {plan.shortageQty}
          {unit}
        </b>
      </Row>
      <Row className="text-cap text-ink-3">
        <span className="truncate font-mono">{plan.itemCode}</span>
        <span className="ml-auto whitespace-nowrap">
          히트 {plan.heatsCastQty}/{plan.heatCount} 연주
        </span>
      </Row>
      {plan.dueDate ? (
        <Row className="text-cap text-ink-3">
          <span className={isOverdue(d, plan.productionPlanStatus) ? 'font-semibold text-danger' : undefined}>
            납기 {fmtMD(plan.dueDate)}
            {open ? ` · ${d}` : ''}
          </span>
          <span className="ml-auto">합격 {plan.passedQty}{unit}</span>
        </Row>
      ) : null}
    </MasterListItem>
  );
}

function PlanList({ plans, selectedId, onPick }: { plans: readonly ProductionPlanListRow[]; selectedId: number | null; onPick: (id: number) => void }) {
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState<ProductionPlanStatus | ''>('');
  const [type, setType] = useState<TypeFilter>('ALL');
  const filtered = useMemo(() => {
    const k = keyword.trim().toLowerCase();
    return plans.filter(
      (p) =>
        (!status || p.productionPlanStatus === status) &&
        (type === 'ALL' || p.itemType === type) &&
        (!k || [p.productionPlanNo, p.salesOrderNo ?? '', p.customerName ?? '', p.itemCode].some((text) => text.toLowerCase().includes(k))),
    );
  }, [plans, keyword, status, type]);
  return (
    <MasterPane
      head={
        <>
          <div className="flex items-baseline gap-2">
            <h2 className="text-lg font-semibold">생산계획</h2>
            <span className="text-xs text-ink-3">{filtered.length}건</span>
          </div>
          <Input leadingIcon="search" placeholder="계획·수주번호·고객사 검색" value={keyword} onChange={(e) => setKeyword(e.target.value)} aria-label="생산계획 검색" />
          <div className="flex items-center gap-1.5">
            <Select value={status} onChange={(e) => setStatus(e.target.value as ProductionPlanStatus | '')} aria-label="상태" className="w-28">
              <option value="">상태 전체</option>
              {Object.values(PRODUCTION_PLAN_STATUS).map((s) => (
                <option key={s} value={s}>
                  {PRODUCTION_PLAN_STATUS_LABEL[s]}
                </option>
              ))}
            </Select>
            {(['ALL', 'SLAB', 'COIL'] as const).map((t) => (
              <Chip key={t} on={type === t} onClick={() => setType(t)}>
                {t === 'ALL' ? '전체' : ITEM_TYPE_LABEL[t]}
              </Chip>
            ))}
          </div>
        </>
      }
    >
      {filtered.length === 0 ? (
        <EmptyNote>{plans.length === 0 ? '생산계획이 없어요. 수주를 등록하면 부족분만큼 생산계획이 생겨요.' : '조건에 맞는 생산계획이 없어요'}</EmptyNote>
      ) : (
        filtered.map((p) => <PlanListRow key={p.id} plan={p} active={p.id === selectedId} onPick={() => onPick(p.id)} />)
      )}
      <div className="px-4 py-3 text-cap text-ink-3">생산계획은 수주를 등록할 때 부족 매수만큼 자동으로 만들어져요. 재생산 계획은 생산 담당이 만들어요.</div>
    </MasterPane>
  );
}

export function PlanDetailBody({ plan }: { plan: ProductionPlanDetail }) {
  const canPlan = useCanUse(PERMISSION.PRODUCTION_PLAN_CONFIRM);
  const [modal, setModal] = useState<'cancel' | 'reproduce' | null>(null);
  const unit = PRODUCT_QTY_UNIT[plan.item.itemType];
  const so = plan.salesOrder;
  const status = plan.productionPlanStatus;
  const open = status === 'PLANNED' || status === 'IN_PROGRESS';
  const repro = plan.reproduction;
  const showRepro = repro !== null && repro.canReproduce && repro.additionalPlanQty > 0;
  const steps = processStepItems({
    itemType: plan.item.itemType,
    productionPlanStatus: status,
    heatCount: plan.progress.heatCount,
    heatsMadeQty: plan.progress.heatsMadeQty,
    heatsCastQty: plan.progress.heatsCastQty,
    usableCoilQty: plan.progress.usableCoilQty,
    shortageQty: plan.formation?.shortageQty ?? 0,
    ...countResultsByProcess(plan.results),
  });
  const needText = permissionNeedText([PERMISSION.PRODUCTION_PLAN_CONFIRM]);
  return (
    <>
      <PageHead
        crumb={
          <>
            <Link href="/production/plans">생산계획</Link>
            <Icon name="chevron-right" size="sm" />
            {so ? <Link href={`/sales-orders/${so.salesOrderId}`}>{so.salesOrderNo}</Link> : '수주 연결 없음'}
            <Icon name="chevron-right" size="sm" />
            {status === 'PLANNED' ? '히트 편성' : '진행 현황'}
          </>
        }
        title={
          <span className="flex flex-wrap items-center gap-2.5">
            <span className="font-mono text-xl">{plan.productionPlanNo}</span>
            <PlanStatusBadge status={status} />
            <PlanFlags isReproduction={plan.isReproduction} isSurplusOnCompletion={plan.isSurplusOnCompletion} />
            <ProductTypeTag itemType={plan.item.itemType} />
          </span>
        }
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            {canPlan ? null : <ReadOnlyHint permissions={[PERMISSION.PRODUCTION_PLAN_CONFIRM]} />}
            {so ? (
              <ButtonLink href={`/sales-orders/${so.salesOrderId}`} icon="clipboard">
                수주 상세
              </ButtonLink>
            ) : null}
            <ButtonLink href="/business-events" icon="history">
              작업 로그
            </ButtonLink>
            {status !== 'CANCELLED' ? (
              <ButtonLink href={`/production/results?plan=${plan.id}`} icon="factory">
                작업 실적
              </ButtonLink>
            ) : null}
            {plan.item.itemType === 'COIL' && open ? (
              <ButtonLink href={`/production/rolling?plan=${plan.id}`} icon="coil">
                열연 투입 배정
              </ButtonLink>
            ) : null}
            {plan.canCancel ? (
              <Button variant="danger-outline" icon="x" disabled={!canPlan} title={canPlan ? '작업을 시작하기 전(계획 상태)에만 취소할 수 있어요' : needText} onClick={() => setModal('cancel')}>
                계획 취소
              </Button>
            ) : null}
          </div>
        }
      />

      {showRepro && repro ? (
        <Banner
          tone={repro.reproductionNeedQty > 0 ? 'danger' : 'wait'}
          actions={
            <Button size="sm" icon="plus" disabled={!canPlan} title={canPlan ? undefined : needText} onClick={() => setModal('reproduce')}>
              {repro.reproductionNeedQty > 0 ? '재생산 계획' : '여재로 채우기'}
            </Button>
          }
        >
          {repro.reproductionNeedQty > 0 ? (
            <>
              <b>
                재생산 필요 {repro.reproductionNeedQty}
                {unit}
              </b>{' '}
              — {repro.salesOrderNo} 품목 {repro.lineNo}에 여재와 진행 중인 계획으로도 채우지 못하는 매수가 있어요 (현재 미확보 {repro.unsecuredQty}
              {unit} · 진행 계획 잔여 {repro.openPlanRemainingQty}
              {unit} · 예약 가용 {repro.reservationAvailableQty}
              {unit}).
            </>
          ) : (
            <>
              <b>
                추가 계획 필요 {repro.additionalPlanQty}
                {unit}
              </b>{' '}
              — 같은 규격 여재 {repro.reservationAvailableQty}
              {unit}로 채울 수 있어요. 재생산 계획은 만들지 않아요.
            </>
          )}
        </Banner>
      ) : null}
      {status === 'CANCELLED' ? <Banner>{fmtDateTime(plan.cancelledAt)}에 취소된 계획이에요.</Banner> : null}
      {plan.isSurplusOnCompletion ? (
        <Banner tone="wait">
          수주 취소로 연결이 끊긴 계획이에요. 이미 시작한 공정은 끝까지 할 수 있고, 이 계획에서 나온 합격 슬래브는 <b>여재</b>(가용재고)로 남아요.
          {plan.item.itemType === 'COIL' ? ' 수주 연결이 없으므로 열연하지 않아요.' : ''}
        </Banner>
      ) : null}

      <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_minmax(280px,340px)] items-start gap-4">
        <div className="flex min-w-0 flex-col gap-4">
          <FormationCard plan={plan} steps={steps} />

          <Card>
            <CardHead title="히트" meta={`편성 ${plan.progress.heatCount}개 · 제강 ${plan.progress.heatsMadeQty}개 · 연주 ${plan.progress.heatsCastQty}개`} />
            <CardBody flush>
              <Table compact>
                <thead>
                  <tr>
                    <Th>순번</Th>
                    <Th>히트</Th>
                    <Th>전로</Th>
                    <Th align="right">히트 톤</Th>
                    <Th>성분 판정</Th>
                    <Th>연주</Th>
                    <Th align="right">슬래브</Th>
                  </tr>
                </thead>
                <tbody>
                  {plan.heats.map((h) => (
                    <tr key={h.seq} data-muted={h.heatLotId === null ? true : undefined}>
                      <Td>{h.seq}</Td>
                      <Td className="font-mono text-mono">{h.heatNo ?? '제강 전'}</Td>
                      <Td className="font-mono text-mono">{h.converterCode ?? '-'}</Td>
                      <Td align="right">{fmtTon(h.heatTon)}</Td>
                      <Td>
                        {h.inspectionResult === null ? (
                          '-'
                        ) : (
                          <Badge tone={INSPECTION_RESULT_TONE[h.inspectionResult]}>{INSPECTION_RESULT_LABEL[h.inspectionResult]}</Badge>
                        )}
                      </Td>
                      <Td>{h.heatLotId === null ? '-' : h.castDone ? '완료' : '연주 전'}</Td>
                      <Td align="right">{h.slabQty > 0 ? `${h.slabQty}매` : '-'}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </CardBody>
          </Card>

          <Card>
            <CardHead
              title="작업 실적"
              meta="제선 → 제강 → 연주 → 열연"
              actions={
                status !== 'CANCELLED' ? (
                  <ButtonLink href={`/production/results?plan=${plan.id}`} size="sm" icon="factory">
                    실적 등록
                  </ButtonLink>
                ) : null
              }
            />
            <CardBody flush>
              <ResultsTable results={plan.results} showProcess emptyText={status === 'CANCELLED' ? '취소된 계획이라 실적이 없어요' : '아직 등록된 작업 실적이 없어요'} />
            </CardBody>
          </Card>

          <PlanLotsCard lots={plan.lots} />
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardHead title="연결된 수주 품목" />
            <CardBody>
              {so ? (
                <KvList
                  items={[
                    {
                      label: '수주',
                      value: (
                        <>
                          <Link href={`/sales-orders/${so.salesOrderId}`} className="font-mono text-run hover:underline">
                            {so.salesOrderNo}
                          </Link>{' '}
                          <span className="text-ink-3">품목 {so.lineNo}</span>
                        </>
                      ),
                    },
                    { label: '고객사', value: so.customerName ?? '-' },
                    {
                      label: '납기',
                      value: (
                        <>
                          {fmtDate(so.dueDate)}{' '}
                          <span className={isOverdue(dLabel(so.dueDate), status) ? 'font-semibold text-danger' : 'text-ink-3'}>{dLabel(so.dueDate)}</span>
                        </>
                      ),
                    },
                    { label: '수주 매수', value: `${so.orderedQty}${unit}` },
                    { label: '품목 상태', value: plan.salesOrderItemStatus ? SALES_ORDER_ITEM_STATUS_LABEL[plan.salesOrderItemStatus] : '-' },
                    { label: '수주 담당', value: plan.salesOrderOwnerName ?? '-' },
                    { label: '이 계획 잔여 목표', value: `${plan.progress.remainingTargetQty}${unit}` },
                  ]}
                />
              ) : (
                <span className="text-cap leading-normal text-ink-3">
                  수주 연결이 없는 계획이에요. 만들어진 합격 슬래브는 여재(가용재고)로 남아요.
                </span>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHead title="진행" meta={`분모 = 부족 매수 ${plan.formation?.shortageQty ?? 0}${unit}`} />
            <CardBody>
              <KvList
                items={[
                  { label: '합격', value: `${plan.progress.passedQty}${unit}` },
                  { label: '판정 대기', value: `${plan.progress.pendingQty}${unit}` },
                  { label: '불합격·히트 불합격', value: `${plan.progress.failedQty}${unit}` },
                  { label: '슬래브', value: `${plan.progress.slabQty}매` },
                  ...(plan.item.itemType === 'COIL'
                    ? [
                        { label: '코일', value: `${plan.progress.coilQty}개` },
                        { label: '열연 배정', value: `${plan.progress.hotRollingAllocatedQty}매` },
                      ]
                    : []),
                  { label: '용선 (이 계획)', value: fmtTon(plan.progress.hotMetalTon) },
                  { label: '등록', value: `${fmtDateTime(plan.createdAt)}${plan.createdEmployeeName ? ` · ${plan.createdEmployeeName}` : ''}` },
                ]}
              />
            </CardBody>
          </Card>
        </div>
      </div>

      {modal === 'cancel' ? <CancelPlanModal planId={plan.id} planNo={plan.productionPlanNo} updatedAt={plan.updatedAt} onClose={() => setModal(null)} /> : null}
      {modal === 'reproduce' && repro ? <ReproductionModal check={repro} itemType={plan.item.itemType} onClose={() => setModal(null)} /> : null}
    </>
  );
}

function PlanDetail({ planId }: { planId: number }) {
  const detail = useProductionPlanDetail(planId);
  const plan = detail.data;
  useShellTitle(plan ? `생산계획 · ${plan.productionPlanNo}` : '생산계획', plan?.salesOrder ? `${plan.salesOrder.salesOrderNo} · ${plan.salesOrder.customerName ?? ''}` : undefined);
  return <QueryBoundary query={detail}>{(d) => <PlanDetailBody plan={d} />}</QueryBoundary>;
}

export function ProductionPlanScreen() {
  const list = useProductionPlanList();
  const [planParam, setPlan] = useProductionPlanParam();
  const plans = list.data ?? [];
  const selectedId = planParam ?? plans[0]?.id ?? null;
  return (
    <>
      {list.data ? (
        <PlanList plans={plans} selectedId={selectedId} onPick={setPlan} />
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
            <StateView kind="empty" title="생산계획을 골라 주세요" text="왼쪽 목록에서 계획을 고르면 히트 편성과 진행 상황을 볼 수 있어요." />
          )
        ) : (
          <PlanDetail key={selectedId} planId={selectedId} />
        )}
      </PageMain>
    </>
  );
}
