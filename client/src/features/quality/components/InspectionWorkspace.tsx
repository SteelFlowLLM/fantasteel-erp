'use client';

// 검사 입력 (REQ-QC-001·003, BP-QC-01): 왼쪽 검사 대상 LOT 목록(판정 대기 먼저) | 오른쪽 측정값 입력·시스템 판정·판정 뒤 처리·이력.
// 고른 LOT은 주소(?lot=)에 둔다. 판정 뒤 자동 예약·여재·히트 불합격 연쇄는 핵심 서비스가 같은 저장에서 처리하고, 여기서는 그 결과를 보인다.
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { InspectionDetail, LinkedSalesOrderItem, RegisterInspectionOutcome } from '@/api/inspections';
import { Badge } from '@/components/Badge';
import { Banner } from '@/components/Banner';
import { Button, ButtonLink } from '@/components/Button';
import { Card, CardBody } from '@/components/Card';
import { Chip } from '@/components/Chip';
import { ComingSoon } from '@/components/ComingSoon';
import { Icon } from '@/components/Icon';
import { Input } from '@/components/Input';
import { MasterPane, PageMain } from '@/components/Page';
import { QueryBoundary } from '@/components/QueryBoundary';
import { EmptyNote, StateView } from '@/components/StateView';
import { Segmented } from '@/components/Tabs';
import { INSPECTION_RESULT_LABEL, LOT_STATUS_LABEL, LOT_TYPE_LABEL, PERMISSION, PROCESS_TYPE_LABEL, type ProcessType } from '@/codes';
import { InspectionForm } from '@/features/quality/components/InspectionForm';
import { LotHistoryCard } from '@/features/quality/components/LotHistoryCard';
import { GradeSpec, InfoGrid, LotHeader, MasterItemLink, lotTraceHref } from '@/features/quality/components/LotHeader';
import { inspectionOutcomeNotes } from '@/features/quality/lib/inspectionOutcomeNotes';
import { pickNextPendingLot } from '@/features/quality/lib/nextPendingLot';
import { ResultBadge } from '@/features/quality/components/QualityBadges';
import { inspectionNameOf, lotIconOf } from '@/features/quality/lib/qualityDisplay';
import { useShellTitle } from '@/features/shell/useShellTitle';
import { useInspectionDetail, useInspectionQueue } from '@/hooks/useInspections';
import { useCanUse } from '@/hooks/usePermission';
import { cn } from '@/lib/cn';
import { fmtDate, fmtMD, fmtMDHM } from '@/lib/format';
import { withIGa } from '@/lib/josa';
import type { InspectionQueueRow } from '@/mock/services';

type ProcessFilter = 'ALL' | Extract<ProcessType, 'STEELMAKING' | 'CONTINUOUS_CASTING' | 'HOT_ROLLING'>;
type ResultFilter = 'ALL' | 'PENDING' | 'PASS' | 'FAIL';

const PROCESS_FILTERS: readonly ProcessFilter[] = ['ALL', 'STEELMAKING', 'CONTINUOUS_CASTING', 'HOT_ROLLING'];
/** 판정 결과 칩 순서: 전체 · 합격 · 불합격 · 판정 대기 (처음 고른 칩은 판정 대기) */
const RESULT_FILTERS: readonly ResultFilter[] = ['ALL', 'PASS', 'FAIL', 'PENDING'];
const PROCESS_HINT: Record<ProcessFilter, string> = {
  ALL: '제강 히트 성분 · 연주 슬래브 표면·치수 · 열연 코일 치수·기계적 성질',
  STEELMAKING: inspectionNameOf('STEELMAKING'),
  CONTINUOUS_CASTING: inspectionNameOf('CONTINUOUS_CASTING'),
  HOT_ROLLING: inspectionNameOf('HOT_ROLLING'),
};

export const inspectionHref = (lotId: number): string => `/quality/inspections?lot=${lotId}`;

export function InspectionWorkspace() {
  const queue = useInspectionQueue();
  return (
    <QueryBoundary query={queue} loadingLabel="검사 대상 LOT을 불러오는 중…">
      {(rows) => <Workspace rows={rows} />}
    </QueryBoundary>
  );
}

function Workspace({ rows }: { rows: InspectionQueueRow[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const paramId = Number(searchParams.get('lot')) || null;
  const paramRow = paramId === null ? undefined : rows.find((r) => r.lotId === paramId);
  const [process, setProcess] = useState<ProcessFilter>('ALL');
  // 처음에는 판정 대기만. 주소로 판정이 끝난 LOT을 열었으면 전체를 보인다.
  const [result, setResult] = useState<ResultFilter>(() => (paramRow && paramRow.inspectionResult !== 'PENDING' ? 'ALL' : 'PENDING'));
  const [keyword, setKeyword] = useState('');
  /** 방금 저장한 결과 (LOT별). 판정 뒤 처리를 보여 준다. */
  const [outcome, setOutcome] = useState<RegisterInspectionOutcome | null>(null);
  const byProcess = rows.filter((r) => process === 'ALL' || r.processType === process);
  const needle = keyword.trim().toUpperCase();
  const list = byProcess.filter((r) => (result === 'ALL' || r.inspectionResult === result) && (!needle || r.lotNo.toUpperCase().includes(needle)));
  const activeId = paramId ?? list[0]?.lotId ?? null;
  const pending = rows.filter((r) => r.inspectionResult === 'PENDING');
  const nextPending = pickNextPendingLot(pending, rows.find((r) => r.lotId === activeId) ?? null);

  // 고른 LOT을 주소에 둔다: 저장 뒤 목록 필터에서 빠져도 같은 LOT을 계속 보인다
  useEffect(() => {
    if (paramId === null && activeId !== null) router.replace(inspectionHref(activeId));
  }, [paramId, activeId, router]);

  const processCount = (p: ProcessFilter) => rows.filter((r) => r.inspectionResult === 'PENDING' && (p === 'ALL' || r.processType === p)).length;
  const resultCount = (r: Exclude<ResultFilter, 'ALL'>) => byProcess.filter((row) => row.inspectionResult === r).length;
  // 판정 대기만 보는데 판정할 LOT이 없다 (판정이 끝난 LOT은 있다): 할 일이 없다는 좋은 상태로 보인다
  const noPending = rows.length > 0 && result === 'PENDING' && !needle && resultCount('PENDING') === 0;

  return (
    <>
      <MasterPane
        head={
          <>
            <div className="flex items-baseline gap-2">
              <b className="text-base font-semibold">검사 대상 LOT</b>
              <span className="text-cap text-ink-3">판정 대기 먼저 · 생산완료일 순</span>
            </div>
            {/* 탭 숫자는 판정 대기 수다. 아래 판정 결과 칩(모든 LOT 수)과 같은 "전체 0 / 전체 20"이 겹쳐 보이지 않게, 0이면 숫자를 붙이지 않는다 */}
            <Segmented
              ariaLabel="공정별 보기"
              items={PROCESS_FILTERS.map((p) => {
                const name = p === 'ALL' ? '전체' : PROCESS_TYPE_LABEL[p];
                const count = processCount(p);
                return {
                  key: p,
                  label:
                    count > 0 ? (
                      <span className="inline-flex items-center gap-1" title={`판정 대기 ${count}개`}>
                        {name}
                        <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-run px-1 text-2xs font-semibold text-white tabular-nums">{count}</span>
                      </span>
                    ) : (
                      name
                    ),
                };
              })}
              active={process}
              onChange={setProcess}
            />
            <span className="text-cap text-ink-3">{PROCESS_HINT[process]}</span>
            <span className="-mt-1.5 text-cap text-ink-3">탭 숫자 = 판정 대기 (없으면 숫자를 붙이지 않아요)</span>
            {/* 네 칩이 목록 칸(320px) 안에 한 줄로 들어가게 간격·좌우 여백만 줄인다 */}
            <div className="flex flex-nowrap gap-1" role="group" aria-label="판정 결과">
              {RESULT_FILTERS.map((r) =>
                r === 'ALL' ? (
                  <Chip key={r} on={result === 'ALL'} onClick={() => setResult('ALL')} className="px-2">
                    전체 <b>{byProcess.length}</b>
                  </Chip>
                ) : (
                  <Chip key={r} on={result === r} onClick={() => setResult(result === r ? 'ALL' : r)} className="px-2">
                    {INSPECTION_RESULT_LABEL[r]} <b>{resultCount(r)}</b>
                  </Chip>
                ),
              )}
            </div>
            <Input type="search" leadingIcon="search" placeholder="LOT 번호 검색" aria-label="LOT 번호 검색" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
          </>
        }
      >
        {list.map((r) => (
          <QueueItem key={r.lotId} row={r} active={r.lotId === activeId} />
        ))}
        {list.length === 0 ? <EmptyNote>{rows.length === 0 ? '검사 대상 LOT이 없어요' : noPending ? '판정 대기 LOT 없음' : '조건에 맞는 LOT이 없어요'}</EmptyNote> : null}
        {/* 목록이 비면 오른쪽이 같은 안내를 크게 보이므로 여기서는 되풀이하지 않는다 */}
        {list.length > 0 ? (
          <Banner className="mx-4 my-3.5 text-xs leading-snug" icon="info">
            제강·연주·열연 실적이 저장되면 LOT이 이 목록에 올라와요. 상위 히트가 판정 대기여도 슬래브·코일은 먼저 검사할 수 있어요.
          </Banner>
        ) : null}
      </MasterPane>

      <PageMain>
        {activeId === null ? (
          noPending ? (
            <NoPendingView doneCount={byProcess.length} onShowAll={() => setResult('ALL')} />
          ) : (
            <StateView
              kind="empty"
              title={rows.length === 0 ? '검사 대상 LOT이 없어요' : '조건에 맞는 LOT이 없어요'}
              text={rows.length === 0 ? '제강·연주·열연 실적이 저장되면 목록에 올라와요.' : '공정·판정 결과·검색어를 바꿔 보세요.'}
            />
          )
        ) : (
          <Detail
            key={activeId}
            lotId={activeId}
            outcome={outcome?.lotId === activeId ? outcome : null}
            onSaved={setOutcome}
            nextPending={nextPending}
            onNext={() => {
              setOutcome(null);
              if (nextPending) router.replace(inspectionHref(nextPending.lotId));
            }}
          />
        )}
      </PageMain>
    </>
  );
}

/** 판정할 LOT이 없을 때 (판정이 끝난 LOT은 있다). "LOT이 없다"로 읽히지 않게 할 일이 없다는 것과 판정 끝난 LOT으로 가는 길을 보인다 */
function NoPendingView({ doneCount, onShowAll }: { doneCount: number; onShowAll: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-10 text-center">
      <span className="flex size-14 items-center justify-center rounded-full bg-ok-bg text-ok [&_.ic]:size-6">
        <Icon name="check" />
      </span>
      <b className="text-lg font-semibold text-ink">판정할 LOT이 없어요</b>
      <p className="max-w-[420px] text-sm leading-normal text-ink-2">
        {doneCount > 0 ? (
          <>
            판정이 끝난 LOT {doneCount}개는 <b className="font-semibold">전체</b>에서 볼 수 있어요.{' '}
          </>
        ) : null}
        새 실적이 저장되면 판정 대기로 올라와요.
      </p>
      {doneCount > 0 ? (
        <Button size="sm" onClick={onShowAll}>
          판정 끝난 LOT 보기 (전체 {doneCount})
        </Button>
      ) : null}
    </div>
  );
}

/**
 * 목록 한 줄은 두 줄로: LOT · 판정 / 규격(히트는 강종) · 생산일 (+ 상위 히트가 합격이 아니면 그 판정).
 * 검사 종류는 앞 아이콘(히트·슬래브·코일)으로 알 수 있고, 계획·검사 일시·담당·기준 버전은 LOT을 고르면 오른쪽 상세 머리에 있다.
 * 마우스를 올리면 뺀 내용까지 한 번에 보인다. 한 화면에 보이는 LOT이 늘어 판정할 LOT을 찾는 스크롤이 줄어든다.
 */
function QueueItem({ row, active }: { row: InspectionQueueRow; active: boolean }) {
  const heatResult = row.lotType !== 'HEAT' && row.heatResult !== null && row.heatResult !== 'PASS' ? row.heatResult : null;
  const spec = row.itemCode ?? row.steelGradeCode ?? '—';
  const fullText = [
    inspectionNameOf(row.processType),
    spec,
    row.productionPlanNo ? `계획 ${row.productionPlanNo}` : '계획 없음',
    `생산완료일 ${fmtDate(row.producedDate)}`,
    row.inspectionResult !== 'PENDING' || row.inspectedAt ? `검사 ${fmtMDHM(row.inspectedAt)} · ${row.inspectorName ?? '—'}` : null,
    row.inspectionStandardCode ? `${row.inspectionStandardCode} v${row.inspectionStandardVersion ?? ''}` : null,
    heatResult ? `상위 히트 ${INSPECTION_RESULT_LABEL[heatResult]}` : null,
  ]
    .filter((part): part is string => part !== null)
    .join(' · ');
  return (
    <MasterItemLink href={inspectionHref(row.lotId)} active={active}>
      <div className="flex items-center gap-1.5">
        <Icon name={lotIconOf(row.lotType)} size="sm" className={active ? 'text-brand' : 'text-ink-3'} />
        <span className={active ? 'font-mono text-mono font-semibold' : 'font-mono text-mono'}>{row.lotNo}</span>
        {row.locked ? <Icon name="lock" size="sm" className="text-ink-3" /> : null}
        <span className="ml-auto">
          <ResultBadge result={row.inspectionResult} />
        </span>
      </div>
      <span className="flex min-w-0 gap-1 text-cap text-ink-3" title={fullText}>
        <span className="min-w-0 truncate">
          {spec} · 생산 {fmtMD(row.producedDate)}
        </span>
        {/* 상위 히트가 합격이 아니면 판정에 영향을 주므로 잘리지 않게 따로 둔다 */}
        {heatResult ? (
          <span className={cn('flex-none font-medium', heatResult === 'FAIL' ? 'text-danger' : 'text-wait')}>· 상위 히트 {INSPECTION_RESULT_LABEL[heatResult]}</span>
        ) : null}
      </span>
    </MasterItemLink>
  );
}

interface DetailProps {
  lotId: number;
  outcome: RegisterInspectionOutcome | null;
  onSaved: (outcome: RegisterInspectionOutcome) => void;
  nextPending: InspectionQueueRow | null;
  onNext: () => void;
}

function Detail({ lotId, outcome, onSaved, nextPending, onNext }: DetailProps) {
  const detail = useInspectionDetail(lotId);
  useShellTitle(detail.data?.lot.lotNo, detail.data ? '검사 입력' : undefined);
  return (
    <QueryBoundary query={detail} loadingLabel="검사 기록을 불러오는 중…">
      {(data) => <DetailBody data={data} outcome={outcome} onSaved={onSaved} nextPending={nextPending} onNext={onNext} />}
    </QueryBoundary>
  );
}

function DetailBody({ data, outcome, onSaved, nextPending, onNext }: Omit<DetailProps, 'lotId'> & { data: InspectionDetail }) {
  const canEdit = useCanUse(PERMISSION.INSPECTION_REGISTER);
  const { lot } = data;
  const typeName = LOT_TYPE_LABEL[lot.lotType];

  return (
    <>
      <LotHeader
        area="검사 입력"
        lotNo={lot.lotNo}
        typeName={typeName}
        badges={
          <>
            <ResultBadge result={data.inspectionResult} />
            {data.locked ? (
              <Badge tone="outline" title={`밀시트 ${data.lockedMillSheetNos.join(', ')}`}>
                밀시트 발행 · 수정 불가
              </Badge>
            ) : null}
          </>
        }
        actions={
          <>
            <ButtonLink href={lotTraceHref(lot.lotNo)} icon="trace">
              LOT 추적
            </ButtonLink>
            {data.inspectionResult === 'FAIL' ? (
              <ButtonLink href={`/quality/rejected?lot=${lot.lotId}`} icon="alert">
                불합격 관리
              </ButtonLink>
            ) : null}
            {/* 과거 사례(EX)는 준비 중: 누르면 과거 사례 화면(디자인 미리 보기)으로 간다 (REQ-CASE-004) */}
            <ButtonLink href="/past-cases" icon="search">
              비슷한 사례 찾기 <ComingSoon grade="EX" />
            </ButtonLink>
          </>
        }
      />

      <Card className="flex-none">
        <CardBody className="px-4 py-3">
          <InfoGrid
            items={[
              { label: '강종 · 규격', value: <GradeSpec steelGradeCode={lot.steelGradeCode} itemCode={lot.itemCode} /> },
              { label: '검사', value: inspectionNameOf(lot.processType) },
              {
                label: '검사 기준',
                value: data.standard ? (
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono">{data.standard.inspectionStandardCode}</span>
                    <span>버전 {data.standard.version}</span>
                    {data.standard.isCurrent ? null : (
                      <Badge tone="outline" title={`현재 버전 ${data.currentStandard?.version ?? '—'} · 값을 넣은 검사는 판정에 쓴 버전으로 계속 판정해요`}>
                        현재 버전 아님
                      </Badge>
                    )}
                  </span>
                ) : (
                  <span className="text-danger">없음</span>
                ),
              },
              { label: 'LOT 상태', value: LOT_STATUS_LABEL[lot.lotStatus] },
              { label: '생산완료일', value: fmtDate(lot.producedDate) },
              ...(lot.lotType !== 'HEAT'
                ? [
                    {
                      label: '상위 히트 성분 검사',
                      value: lot.heatNo ? (
                        <span className="flex flex-wrap items-center gap-1.5">
                          <Link href={lot.heatLotId ? inspectionHref(lot.heatLotId) : lotTraceHref(lot.heatNo)} className="font-mono text-run hover:underline">
                            {lot.heatNo}
                          </Link>
                          {lot.heatResult ? <ResultBadge result={lot.heatResult} /> : null}
                        </span>
                      ) : (
                        '—'
                      ),
                    },
                  ]
                : []),
              {
                label: '생산계획',
                value:
                  data.productionPlanId && lot.productionPlanNo ? (
                    <Link href={`/production/plans?plan=${data.productionPlanId}`} className="font-mono text-run hover:underline">
                      {lot.productionPlanNo}
                    </Link>
                  ) : (
                    <span className="text-ink-3">없음</span>
                  ),
              },
              { label: '수주', value: <SalesOrderLink item={data.salesOrderItem} /> },
              ...(lot.inspectedAt ? [{ label: '검사 일시 · 담당', value: `${fmtMDHM(lot.inspectedAt)} · ${lot.inspectorName ?? '—'}` }] : []),
            ]}
          />
        </CardBody>
      </Card>

      {data.standard === null ? (
        <Banner tone="danger" actions={<ButtonLink href="/quality/standards" size="sm">검사 기준</ButtonLink>}>
          {/* 9.3 MST-001 문구의 '배합'은 용어 사전 TRM-027 금지어라 문구는 싣지 않고 코드만 보인다 (기준정보 준비 상태 띠와 같음, docs/rework/areas/master.md 4번) */}
          <b>{PROCESS_TYPE_LABEL[lot.processType as ProcessType] ?? ''} {lot.steelGradeCode ?? ''} 검사 기준이 없어 판정할 수 없어요</b> <span className="font-mono text-cap">MST-001</span> · 품질 담당이 검사 기준을 등록해야 해요.
        </Banner>
      ) : null}
      {data.locked ? (
        <Banner icon="lock">
          밀시트({data.lockedMillSheetNos.join(', ')})가 발행된 LOT이라 측정값을 고칠 수 없어요.
        </Banner>
      ) : null}
      {lot.lotType !== 'HEAT' && lot.heatResult === 'PENDING' ? (
        <Banner tone="wait">
          상위 히트 {lot.heatNo}의 성분 검사가 판정 대기예요. 먼저 검사할 수 있고, 히트가 합격해야 예약·배정할 수 있어요.
        </Banner>
      ) : null}
      {lot.lotType !== 'HEAT' && lot.heatResult === 'FAIL' ? (
        <Banner tone="danger">상위 히트 {withIGa(lot.heatNo ?? '')} 성분 불합격이라 이 LOT은 합격해도 예약·배정·출고할 수 없어요.</Banner>
      ) : null}

      {outcome ? <OutcomeCard outcome={outcome} lotType={lot.lotType} heatPending={lot.lotType !== 'HEAT' && lot.heatResult !== 'PASS'} nextPending={nextPending} onNext={onNext} /> : null}

      <InspectionForm key={`${lot.lotId}-${data.updatedAt ?? 'new'}-${data.standard?.id ?? 0}`} detail={data} canEdit={canEdit} onSaved={onSaved} />

      <LotHistoryCard lotId={lot.lotId} events={data.history} itemNames={data.inspectionItemNames} />
    </>
  );
}

function SalesOrderLink({ item }: { item: LinkedSalesOrderItem | null }) {
  if (!item) return <span className="text-ink-3">없음</span>;
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <Link href={`/sales-orders/${item.salesOrderId}`} className="font-mono text-run hover:underline">
        {item.salesOrderNo}
      </Link>
      <span className="text-cap text-ink-3">
        품목 {item.lineNo} · {item.customerName}
      </span>
      {item.shortage.reproductionNeedQty > 0 ? <Badge tone="danger">재생산 필요 {item.shortage.reproductionNeedQty}매</Badge> : null}
    </span>
  );
}

/** 방금 저장한 검사의 시스템 판정과 같은 저장에서 일어난 일 (자동 예약·여재·적격 제외·부족) */
function OutcomeCard({
  outcome,
  lotType,
  heatPending,
  nextPending,
  onNext,
}: {
  outcome: RegisterInspectionOutcome;
  lotType: InspectionQueueRow['lotType'];
  heatPending: boolean;
  nextPending: InspectionQueueRow | null;
  onNext: () => void;
}) {
  const shortage = outcome.salesOrderItem?.shortage ?? null;
  const notes = inspectionOutcomeNotes(outcome, lotType, heatPending);
  const pass = outcome.inspectionResult === 'PASS';
  const fail = outcome.inspectionResult === 'FAIL';
  return (
    <Card className="flex-none">
      <div className="px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className={pass ? 'flex items-center gap-3 rounded-md bg-ok-bg px-3 py-2 text-[#115c38]' : fail ? 'flex items-center gap-3 rounded-md bg-danger-bg px-3 py-2 text-[#8e231e]' : 'flex items-center gap-3 rounded-md bg-wait-bg px-3 py-2 text-[#7a3d00]'}>
            <Icon name={pass ? 'check-circle' : fail ? 'x-circle' : 'clock'} size="lg" />
            <div className="flex flex-col">
              <span className="text-cap opacity-80">시스템 판정</span>
              <b className="text-lg font-semibold">{INSPECTION_RESULT_LABEL[outcome.inspectionResult]}</b>
            </div>
          </div>
          <ul className="flex min-w-0 flex-1 flex-col gap-0.5 text-sm text-ink-2">
            {notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
            {shortage && outcome.salesOrderItem ? (
              <li>
                수주 {outcome.salesOrderItem.salesOrderNo} 품목 {outcome.salesOrderItem.lineNo}: 미확보 {shortage.unsecuredQty}매 · 진행 계획 잔여 {shortage.openPlanRemainingQty}매
                {shortage.reproductionNeedQty > 0 ? <b className="ml-1 font-semibold text-danger">· 재생산 필요 {shortage.reproductionNeedQty}매</b> : null}
              </li>
            ) : null}
          </ul>
          <div className="ml-auto flex flex-wrap gap-2">
            {fail ? (
              <ButtonLink href={`/quality/rejected?lot=${outcome.lotId}`} icon="alert" size="sm">
                불합격 관리에서 상태 지정
              </ButtonLink>
            ) : null}
            <Button variant="primary" size="sm" onClick={onNext} disabled={!nextPending}>
              {nextPending ? `다음 판정 대기 LOT ${nextPending.lotNo}` : '판정 대기 LOT 없음'}
              <Icon name="arrow-right" />
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}
