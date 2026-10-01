'use client';

// 열연 투입 배정 화면 (/production/rolling): 코일 계획 목록 | 필요 매수·FIFO 추천·배정 확정·변경·해제·열연 실적·코일.
// REQ-PRD-004, REQ-INV-006·008·009, BP-INV-01, 14.2. '귀속' 단계는 없다. 판매 예약 몫은 침범하지 않는다.
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ALLOCATION_PURPOSE_LABEL, ALLOCATION_STATUS_LABEL, LOT_STATUS_LABEL, PERMISSION, PRODUCTION_PLAN_STATUS_LABEL } from '@/codes';
import type { RollingAllocationView, RollingDetail, RollingPlanListRow } from '@/api/rolling';
import { Badge } from '@/components/Badge';
import { Banner } from '@/components/Banner';
import { Button, ButtonLink } from '@/components/Button';
import { Card, CardBody, CardFoot, CardHead } from '@/components/Card';
import { Chip } from '@/components/Chip';
import { Icon } from '@/components/Icon';
import { Kpi, StatBar } from '@/components/Kpi';
import { MasterPane, PageHead, PageMain } from '@/components/Page';
import { QueryBoundary } from '@/components/QueryBoundary';
import { ReadOnlyHint } from '@/components/ReadOnlyHint';
import { EmptyNote, StateView } from '@/components/StateView';
import { Steps } from '@/components/Steps';
import { Table, Td, Th } from '@/components/Table';
import { MasterListGroup, MasterListItem, Row } from '@/features/production/components/MasterList';
import { LotQualityBadge, PlanStatusBadge } from '@/features/production/components/PlanBadges';
import { ChangeAllocationModal, HotRollingModal, ReleaseAllocationModal } from '@/features/production/components/RollingModals';
import { ResultsTable } from '@/features/production/components/ResultsTable';
import { useShellTitle } from '@/features/shell/useShellTitle';
import { useAction } from '@/hooks/useAction';
import { useCanUse } from '@/hooks/usePermission';
import { useProductionPlanParam } from '@/hooks/useProductionPlanParam';
import { useRollingDetail, useRollingPlanList } from '@/hooks/useRolling';
import { rollingApi } from '@/api/rolling';
import { fmtDate, fmtDateTime, fmtMD, fmtTon } from '@/lib/format';
import { permissionNeedText } from '@/lib/permissions';
import { calcWeightTon } from '@/lib/weight';

const isOpenStatus = (s: RollingPlanListRow['productionPlanStatus']) => s === 'PLANNED' || s === 'IN_PROGRESS';

/** 목록 묶음 제목: 생산계획 상태 표시명으로 만든다 (공통 코드) */
const OPEN_GROUP_TITLE = `${PRODUCTION_PLAN_STATUS_LABEL.PLANNED} · ${PRODUCTION_PLAN_STATUS_LABEL.IN_PROGRESS}`;
const CLOSED_GROUP_TITLE = `${PRODUCTION_PLAN_STATUS_LABEL.COMPLETED} · ${PRODUCTION_PLAN_STATUS_LABEL.CANCELLED}`;

function RollingPlanRow({ row, active, onPick }: { row: RollingPlanListRow; active: boolean; onPick: () => void }) {
  return (
    <MasterListItem active={active} onPick={onPick}>
      <Row>
        <span className="font-mono text-mono font-semibold">{row.productionPlanNo}</span>
        {!row.rollable && isOpenStatus(row.productionPlanStatus) ? (
          <Badge tone="outline" title="수주 연결이 없어 열연하지 않아요">
            수주 연결 없음
          </Badge>
        ) : null}
        <span className="ml-auto">
          <PlanStatusBadge status={row.productionPlanStatus} />
        </span>
      </Row>
      <Row className="text-xs">
        {row.salesOrderNo ? <span className="font-mono">{row.salesOrderNo}</span> : <span className="text-ink-3">수주 연결 없음</span>}
        <span className="ml-auto whitespace-nowrap tabular-nums">
          코일 {row.rolledQty}/{row.shortageQty}
          {row.failedCoilQty > 0 ? ` · 불합격 ${row.failedCoilQty}` : ''} · 배정 {row.allocatedQty}
        </span>
      </Row>
      <Row className="text-cap text-ink-3">
        <span className="truncate font-mono">{row.coilItemCode}</span>
        {row.dueDate ? <span className="ml-auto whitespace-nowrap">납기 {fmtMD(row.dueDate)}</span> : null}
      </Row>
      {row.rollable && row.neededQty > 0 ? <Row className="text-cap font-semibold text-wait">슬래브 {row.neededQty}매 더 배정해야 해요</Row> : null}
    </MasterListItem>
  );
}

function RollingPlanList({ rows, selectedId, onPick }: { rows: readonly RollingPlanListRow[]; selectedId: number | null; onPick: (id: number) => void }) {
  const [showAll, setShowAll] = useState(false);
  const open = rows.filter((r) => isOpenStatus(r.productionPlanStatus));
  const closed = rows.filter((r) => !isOpenStatus(r.productionPlanStatus));
  return (
    <MasterPane
      head={
        <>
          <div className="flex items-baseline gap-2">
            <h2 className="text-lg font-semibold">배정 대상</h2>
            <span className="text-xs text-ink-3">코일 계획</span>
          </div>
          <div className="flex gap-1.5">
            <Chip on={!showAll} onClick={() => setShowAll(false)}>
              {OPEN_GROUP_TITLE} <b>{open.length}</b>
            </Chip>
            <Chip on={showAll} onClick={() => setShowAll(true)}>
              전체 코일 계획 <b>{rows.length}</b>
            </Chip>
          </div>
        </>
      }
    >
      <MasterListGroup title={OPEN_GROUP_TITLE} count={open.length} />
      {open.length === 0 ? <EmptyNote>열연할 코일 계획이 없어요</EmptyNote> : open.map((r) => <RollingPlanRow key={r.productionPlanId} row={r} active={r.productionPlanId === selectedId} onPick={() => onPick(r.productionPlanId)} />)}
      {showAll ? (
        <>
          <MasterListGroup title={CLOSED_GROUP_TITLE} count={closed.length} />
          {closed.length === 0 ? <EmptyNote>완료·취소된 코일 계획이 없어요</EmptyNote> : closed.map((r) => <RollingPlanRow key={r.productionPlanId} row={r} active={r.productionPlanId === selectedId} onPick={() => onPick(r.productionPlanId)} />)}
        </>
      ) : null}
    </MasterPane>
  );
}

function CandidatesCard({ detail, canAllocate }: { detail: RollingDetail; canAllocate: boolean }) {
  const plan = detail.plan;
  const limit = plan.recommendableQty;
  const [selected, setSelected] = useState<number[]>(detail.recommendedLotIds);
  const confirm = useAction(rollingApi.confirm, {
    success: (r) => `슬래브 ${r.allocatedQty}매를 열연 투입으로 배정했어요`,
    onSuccess: () => setSelected([]),
  });
  const toggle = (id: number) =>
    setSelected((list) => (list.includes(id) ? list.filter((x) => x !== id) : list.length >= limit ? list : [...list, id]));
  const followsRecommendation = selected.length === detail.recommendedLotIds.length && selected.every((id) => detail.recommendedLotIds.includes(id));
  const needText = permissionNeedText([PERMISSION.HOT_ROLLING_ALLOCATE]);
  const pool = plan.slabPool;
  return (
    <Card>
      <CardHead
        title="FIFO 추천 슬래브"
        meta={`${plan.slabItem.itemCode} · 생산완료일 → LOT 번호 순 · 추천은 저장하지 않아요`}
        actions={
          <Button size="sm" variant="ghost" icon="refresh" onClick={() => setSelected(detail.recommendedLotIds)} disabled={detail.recommendedLotIds.length === 0}>
            추천대로 고르기
          </Button>
        }
      />
      <div className="flex flex-wrap gap-x-4 gap-y-1 border-b border-line bg-surface-2 px-4 py-2 text-xs text-ink-2">
        <span>
          미소진 합격 <b className="tabular-nums">{pool.eligibleQty}매</b>
        </span>
        <span>
          − 판매 예약 <b className="tabular-nums">{pool.activeReservedQty}매</b>
        </span>
        <span>
          − 열연 배정 <b className="tabular-nums">{pool.hotRollingConfirmedQty}매</b>
        </span>
        <span>
          = 예약 가용 <b className="tabular-nums">{Math.max(0, pool.availableQty)}매</b>
        </span>
        <span className="ml-auto">
          지금 배정할 수 있는 매수 <b className="tabular-nums text-ink">{limit}매</b> = min(더 필요한 {plan.neededQty}매, 예약 가용)
        </span>
      </div>
      <CardBody flush>
        {!plan.rollable ? (
          <EmptyNote>{plan.notRollableReason}</EmptyNote>
        ) : detail.candidates.length === 0 ? (
          <EmptyNote>배정할 수 있는 합격 슬래브가 없어요. 연주한 슬래브가 검사에 합격하면 여기에 나와요.</EmptyNote>
        ) : (
          <div className="max-h-[360px] overflow-auto">
            <Table compact>
              <thead>
                <tr>
                  <Th>선택</Th>
                  <Th align="right">순위</Th>
                  <Th>슬래브 LOT</Th>
                  <Th>히트</Th>
                  <Th>생산완료일</Th>
                  <Th>야드</Th>
                  <Th>생산계획</Th>
                  <Th>구분</Th>
                  <Th>추천</Th>
                </tr>
              </thead>
              <tbody>
                {detail.candidates.map((c) => {
                  const checked = selected.includes(c.lotId);
                  const disabled = !canAllocate || limit === 0 || (!checked && selected.length >= limit);
                  return (
                    <tr key={c.lotId} data-selected={checked ? true : undefined}>
                      <Td>
                        <input type="checkbox" checked={checked} disabled={disabled && !checked} onChange={() => toggle(c.lotId)} aria-label={`${c.lotNo} 선택`} />
                      </Td>
                      <Td align="right">{c.fifoRank}</Td>
                      <Td className="font-mono text-mono">{c.lotNo}</Td>
                      <Td className="font-mono text-mono text-ink-2">{c.heatLotNo ?? '-'}</Td>
                      <Td>{c.producedDate}</Td>
                      <Td>{c.yardName ?? '-'}</Td>
                      <Td className="font-mono text-mono">{c.sourcePlanNo ?? '-'}</Td>
                      <Td>{c.isOwnPlan ? <span className="text-ink-2">이 계획 생산분</span> : c.surplusAt ? <Badge tone="outline">여재</Badge> : <span className="text-ink-3">미배정 합격</span>}</Td>
                      <Td>{c.isRecommended ? <Badge tone="run">FIFO 추천</Badge> : <span className="text-cap text-ink-3">후보</span>}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </div>
        )}
      </CardBody>
      <CardFoot>
        <span className="text-xs text-ink-2">
          선택 {selected.length}매 · 이론중량 {fmtTon(calcWeightTon(selected.length, plan.slabItem.unitWeightTon))} (계산값)
          {selected.length > 0 && !followsRecommendation ? ' · 추천과 다르게 골랐어요 (작업 로그에 추천·선택 LOT이 함께 남아요)' : ''}
        </span>
        <div className="ml-auto flex gap-1.5">
          <Button size="sm" onClick={() => setSelected([])} disabled={selected.length === 0}>
            선택 해제
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={!canAllocate || selected.length === 0 || confirm.isPending || !plan.rollable}
            title={canAllocate ? undefined : needText}
            onClick={() => confirm.mutate({ productionPlanId: plan.productionPlanId, lotIds: selected })}
          >
            {confirm.isPending ? '배정하는 중…' : '배정 확정'}
          </Button>
        </div>
      </CardFoot>
    </Card>
  );
}

function AllocationsCard({ detail, canAllocate, canRoll }: { detail: RollingDetail; canAllocate: boolean; canRoll: boolean }) {
  const plan = detail.plan;
  const [changing, setChanging] = useState<RollingAllocationView | null>(null);
  const [releasing, setReleasing] = useState<RollingAllocationView | null>(null);
  const [rolling, setRolling] = useState(false);
  const allocNeed = permissionNeedText([PERMISSION.HOT_ROLLING_ALLOCATE]);
  const rollNeed = permissionNeedText([PERMISSION.PRODUCTION_RESULT_CONFIRM]);
  return (
    <Card>
      <CardHead
        title="확정 배정"
        meta={`열연 투입 대기 ${plan.allocatedQty}매`}
        actions={
          <Button
            size="sm"
            variant="primary"
            icon="coil"
            disabled={!canRoll || detail.rollableAllocationIds.length === 0 || !plan.rollable}
            title={!canRoll ? rollNeed : detail.rollableAllocationIds.length === 0 ? '배정 확정한 슬래브가 없어요' : undefined}
            onClick={() => setRolling(true)}
          >
            열연 실적 등록
          </Button>
        }
      />
      <CardBody flush>
        {plan.allocations.length === 0 ? (
          <EmptyNote>확정한 열연 배정이 없어요</EmptyNote>
        ) : (
          <Table compact>
            <thead>
              <tr>
                <Th>슬래브 LOT</Th>
                <Th>히트</Th>
                <Th>생산완료일</Th>
                <Th>배정 확정</Th>
                <Th>확정자</Th>
                <Th align="right">작업</Th>
              </tr>
            </thead>
            <tbody>
              {plan.allocations.map((a) => (
                <tr key={a.allocationId}>
                  <Td className="font-mono text-mono">{a.lotNo}</Td>
                  <Td className="font-mono text-mono text-ink-2">{a.heatLotNo ?? '-'}</Td>
                  <Td>{a.producedDate}</Td>
                  <Td>{fmtDateTime(a.confirmedAt)}</Td>
                  <Td>{a.confirmedEmployeeName ?? '-'}</Td>
                  <Td align="right">
                    <span className="inline-flex gap-1">
                      <Button size="sm" disabled={!canAllocate} title={canAllocate ? '해제와 새 배정을 한 번에 해요 (사유 필수)' : allocNeed} onClick={() => setChanging(a)}>
                        변경
                      </Button>
                      <Button size="sm" variant="danger-outline" disabled={!canAllocate} title={canAllocate ? undefined : allocNeed} onClick={() => setReleasing(a)}>
                        해제
                      </Button>
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </CardBody>
      {changing ? <ChangeAllocationModal allocation={changing} candidates={detail.candidates} onClose={() => setChanging(null)} /> : null}
      {releasing ? <ReleaseAllocationModal allocation={releasing} onClose={() => setReleasing(null)} /> : null}
      {rolling ? <HotRollingModal detail={detail} onClose={() => setRolling(false)} /> : null}
    </Card>
  );
}

function CoilsCard({ detail }: { detail: RollingDetail }) {
  return (
    <Card>
      <CardHead title="열연 실적 · 코일" meta={`코일 ${detail.coils.length}개${detail.plan.failedCoilQty > 0 ? ` (불합격 ${detail.plan.failedCoilQty}개)` : ''} · 슬래브 1매 = 코일 1개`} />
      <CardBody flush>
        <ResultsTable results={detail.results} emptyText="아직 등록된 열연 실적이 없어요" />
        {detail.coils.length > 0 ? (
          <div className="border-t border-line">
            <Table compact>
              <thead>
                <tr>
                  <Th>코일 LOT</Th>
                  <Th>투입 슬래브</Th>
                  <Th>생산완료일</Th>
                  <Th>검사</Th>
                  <Th>상태</Th>
                </tr>
              </thead>
              <tbody>
                {detail.coils.map((c) => (
                  <tr key={c.lotId}>
                    <Td>
                      <Link href={`/lots/trace?lot=${encodeURIComponent(c.lotNo)}`} className="font-mono text-mono text-run hover:underline">
                        {c.lotNo}
                      </Link>
                    </Td>
                    <Td className="font-mono text-mono text-ink-2">{c.slabLotNo ?? '-'}</Td>
                    <Td>{c.producedDate}</Td>
                    <Td>
                      <LotQualityBadge quality={c.quality} />
                    </Td>
                    <Td>{c.hasConfirmedAllocation ? `${ALLOCATION_STATUS_LABEL.CONFIRMED} · ${ALLOCATION_PURPOSE_LABEL.SHIPMENT}` : LOT_STATUS_LABEL[c.lotStatus]}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

export function RollingBody({ detail }: { detail: RollingDetail }) {
  const canAllocate = useCanUse(PERMISSION.HOT_ROLLING_ALLOCATE);
  const canRoll = useCanUse(PERMISSION.PRODUCTION_RESULT_CONFIRM);
  const plan = detail.plan;
  const steps = useMemo(
    () => [
      { key: 'recommend', label: 'FIFO 추천', state: plan.allocatedQty > 0 || plan.rolledQty > 0 ? ('done' as const) : plan.rollable ? ('run' as const) : ('todo' as const) },
      { key: 'confirm', label: `배정 확정 ${plan.allocatedQty}매`, state: plan.allocatedQty > 0 ? ('run' as const) : plan.rolledQty > 0 ? ('done' as const) : ('todo' as const) },
      { key: 'roll', label: `열연 실적 ${plan.rolledQty}/${plan.shortageQty}`, state: plan.rolledQty >= plan.shortageQty ? ('done' as const) : plan.rolledQty > 0 ? ('run' as const) : ('todo' as const) },
      {
        key: 'inspect',
        label: '코일 검사',
        state: detail.coils.length > 0 && detail.coils.every((c) => c.quality !== 'PENDING' && c.quality !== 'HEAT_PENDING') ? ('done' as const) : detail.coils.length > 0 ? ('run' as const) : ('todo' as const),
      },
    ],
    [plan, detail.coils],
  );
  return (
    <>
      <PageHead
        crumb={
          <>
            <Link href="/production/rolling">열연 투입 배정</Link>
            <Icon name="chevron-right" size="sm" />
            {detail.salesOrderId !== null && plan.salesOrderNo ? <Link href={`/sales-orders/${detail.salesOrderId}`}>{plan.salesOrderNo}</Link> : (plan.salesOrderNo ?? '수주 연결 없음')}
          </>
        }
        title={
          <span className="flex flex-wrap items-center gap-2.5">
            <span className="font-mono text-xl">{plan.productionPlanNo}</span>
            <PlanStatusBadge status={plan.productionPlanStatus} />
          </span>
        }
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            {canAllocate ? null : <ReadOnlyHint permissions={[PERMISSION.HOT_ROLLING_ALLOCATE]} />}
            {detail.salesOrderId !== null ? (
              <ButtonLink href={`/sales-orders/${detail.salesOrderId}`} icon="clipboard">
                수주 상세
              </ButtonLink>
            ) : null}
            <ButtonLink href={`/production/plans?plan=${plan.productionPlanId}`} icon="calendar">
              생산계획
            </ButtonLink>
            <ButtonLink href={`/production/results?plan=${plan.productionPlanId}`} icon="factory">
              작업 실적
            </ButtonLink>
            <ButtonLink href="/business-events" icon="history">
              작업 로그
            </ButtonLink>
          </div>
        }
      />
      {!plan.rollable && plan.notRollableReason ? (
        <Banner tone="wait">
          {plan.notRollableReason}. 남은 합격 슬래브는 미배정 여재(가용재고)로 남아요.
        </Banner>
      ) : null}

      <StatBar>
        <Kpi flat label="코일 규격" value={<span className="font-mono text-base">{plan.coilItem.itemCode}</span>} sub={plan.dueDate ? `납기 ${fmtDate(plan.dueDate)}` : undefined} />
        <Kpi flat label="소재 슬래브 (규격 매핑)" value={<span className="font-mono text-base">{plan.slabItem.itemCode}</span>} sub={`1매 ${fmtTon(plan.slabItem.unitWeightTon)} → 코일 ${fmtTon(plan.coilItem.unitWeightTon)}`} />
        <Kpi flat label="열연 완료 / 부족 매수" value={`${plan.rolledQty}/${plan.shortageQty}`} unit="개" sub={plan.failedCoilQty > 0 ? `불합격 코일 ${plan.failedCoilQty}개 제외` : undefined} />
        <Kpi flat label="배정 확정" value={plan.allocatedQty} unit="매" sub="열연 투입 대기" />
        <Kpi flat label="더 필요한 슬래브" value={plan.neededQty} unit="매" sub="부족 − 코일 − 배정" />
      </StatBar>
      <Steps items={steps} className="overflow-x-auto px-1" />

      <CandidatesCard key={detail.recommendedLotIds.join(',')} detail={detail} canAllocate={canAllocate} />
      <AllocationsCard detail={detail} canAllocate={canAllocate} canRoll={canRoll} />
      <CoilsCard detail={detail} />
    </>
  );
}

function RollingDetailView({ planId }: { planId: number }) {
  const detail = useRollingDetail(planId);
  const plan = detail.data?.plan;
  useShellTitle(plan ? `열연 투입 배정 · ${plan.productionPlanNo}` : '열연 투입 배정', plan?.salesOrderNo ?? undefined);
  return <QueryBoundary query={detail}>{(d) => <RollingBody detail={d} />}</QueryBoundary>;
}

export function RollingScreen() {
  const list = useRollingPlanList();
  const [planParam, setPlan] = useProductionPlanParam();
  const rows = list.data ?? [];
  const firstOpen = rows.find((r) => isOpenStatus(r.productionPlanStatus)) ?? rows[0];
  const selectedId = planParam ?? firstOpen?.productionPlanId ?? null;
  return (
    <>
      {list.data ? (
        <RollingPlanList rows={rows} selectedId={selectedId} onPick={setPlan} />
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
            <StateView kind="empty" title="열연할 코일 계획이 없어요" text="코일 수주의 부족분으로 만든 생산계획이 여기에 나와요." />
          )
        ) : (
          <RollingDetailView key={selectedId} planId={selectedId} />
        )}
      </PageMain>
    </>
  );
}
