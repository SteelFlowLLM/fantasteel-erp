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
import { ERROR_MESSAGE, INSPECTION_RESULT_LABEL, LOT_STATUS_LABEL, LOT_TYPE_LABEL, PERMISSION, PROCESS_TYPE_LABEL, type ProcessType } from '@/codes';
import { InspectionForm } from '@/features/quality/components/InspectionForm';
import { LotHistoryCard } from '@/features/quality/components/LotHistoryCard';
import { InfoGrid, LotHeader, MasterItemLink, lotTraceHref } from '@/features/quality/components/LotHeader';
import { ResultBadge } from '@/features/quality/components/QualityBadges';
import { inspectionNameOf, lotIconOf } from '@/features/quality/lib/qualityDisplay';
import { useShellTitle } from '@/features/shell/useShellTitle';
import { useInspectionDetail, useInspectionQueue } from '@/hooks/useInspections';
import { useCanUse } from '@/hooks/usePermission';
import { fmtDate, fmtMDHM } from '@/lib/format';
import { withIGa } from '@/lib/josa';
import type { InspectionQueueRow } from '@/mock/services';

type ProcessFilter = 'ALL' | Extract<ProcessType, 'STEELMAKING' | 'CONTINUOUS_CASTING' | 'HOT_ROLLING'>;
type ResultFilter = 'ALL' | 'PENDING' | 'PASS' | 'FAIL';

const PROCESS_FILTERS: readonly ProcessFilter[] = ['ALL', 'STEELMAKING', 'CONTINUOUS_CASTING', 'HOT_ROLLING'];
const RESULT_FILTERS: readonly Exclude<ResultFilter, 'ALL'>[] = ['PENDING', 'PASS', 'FAIL'];
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
  const nextPending = pending.find((r) => r.lotId !== activeId) ?? null;

  // 고른 LOT을 주소에 둔다: 저장 뒤 목록 필터에서 빠져도 같은 LOT을 계속 보인다
  useEffect(() => {
    if (paramId === null && activeId !== null) router.replace(inspectionHref(activeId));
  }, [paramId, activeId, router]);

  const processCount = (p: ProcessFilter) => rows.filter((r) => r.inspectionResult === 'PENDING' && (p === 'ALL' || r.processType === p)).length;
  const resultCount = (r: Exclude<ResultFilter, 'ALL'>) => byProcess.filter((row) => row.inspectionResult === r).length;

  return (
    <>
      <MasterPane
        head={
          <>
            <div className="flex items-baseline gap-2">
              <b className="text-base font-semibold">검사 대상 LOT</b>
              <span className="text-cap text-ink-3">판정 대기 먼저 · 생산완료일 순</span>
            </div>
            <Segmented
              ariaLabel="공정별 보기"
              items={PROCESS_FILTERS.map((p) => ({ key: p, label: `${p === 'ALL' ? '전체' : PROCESS_TYPE_LABEL[p]} ${processCount(p)}` }))}
              active={process}
              onChange={setProcess}
            />
            <span className="text-cap text-ink-3">{PROCESS_HINT[process]}</span>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="판정 결과">
              {RESULT_FILTERS.map((r) => (
                <Chip key={r} on={result === r} onClick={() => setResult(result === r ? 'ALL' : r)}>
                  {INSPECTION_RESULT_LABEL[r]} <b>{resultCount(r)}</b>
                </Chip>
              ))}
              <Chip on={result === 'ALL'} onClick={() => setResult('ALL')}>
                전체 <b>{byProcess.length}</b>
              </Chip>
            </div>
            <Input type="search" leadingIcon="search" placeholder="LOT 번호 검색" aria-label="LOT 번호 검색" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
          </>
        }
      >
        {list.map((r) => (
          <QueueItem key={r.lotId} row={r} active={r.lotId === activeId} />
        ))}
        {list.length === 0 ? <EmptyNote>{rows.length === 0 ? '검사 대상 LOT이 없어요' : '조건에 맞는 LOT이 없어요'}</EmptyNote> : null}
        <Banner className="mx-4 my-3.5 text-xs leading-[17px]" icon="info">
          제강·연주·열연 실적이 저장되면 LOT이 이 목록에 올라와요. 상위 히트가 판정 대기여도 슬래브·코일은 먼저 검사할 수 있어요.
        </Banner>
      </MasterPane>

      <PageMain>
        {activeId === null ? (
          <StateView kind="empty" title="검사 대상 LOT이 없어요" text="제강·연주·열연 실적이 저장되면 목록에 올라와요." />
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

function QueueItem({ row, active }: { row: InspectionQueueRow; active: boolean }) {
  const heatNote =
    row.lotType !== 'HEAT' && row.heatResult !== null && row.heatResult !== 'PASS' ? ` · 상위 히트 ${INSPECTION_RESULT_LABEL[row.heatResult]}` : '';
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
      <span className="text-cap text-ink-3">
        {LOT_TYPE_LABEL[row.lotType]} · {inspectionNameOf(row.processType)} · {row.steelGradeCode ?? '—'}
        {row.itemCode ? ` ${row.itemCode}` : ''}
      </span>
      <span className="text-cap text-ink-3">
        {row.productionPlanNo ? `계획 ${row.productionPlanNo}` : '계획 없음'} · 생산완료일 {fmtDate(row.producedDate)}
        {heatNote}
      </span>
      {row.inspectionResult !== 'PENDING' || row.inspectedAt ? (
        <span className="text-cap text-ink-3">
          검사 {fmtMDHM(row.inspectedAt)} · {row.inspectorName ?? '—'}
          {row.inspectionStandardCode ? ` · ${row.inspectionStandardCode} v${row.inspectionStandardVersion ?? ''}` : ''}
        </span>
      ) : null}
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
  const itemNames = new Map(data.items.map((i) => [i.inspectionItemCode, i.inspectionItemName]));

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
              { label: '강종 · 규격', value: <span className="font-mono">{[lot.steelGradeCode, lot.itemCode].filter(Boolean).join(' ') || '—'}</span> },
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
                      value: lot.heatLotNo ? (
                        <span className="flex flex-wrap items-center gap-1.5">
                          <Link href={lot.heatLotId ? inspectionHref(lot.heatLotId) : lotTraceHref(lot.heatLotNo)} className="font-mono text-run hover:underline">
                            {lot.heatLotNo}
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
          <b>{ERROR_MESSAGE['MST-001']} (MST-001)</b> · {PROCESS_TYPE_LABEL[lot.processType as ProcessType] ?? ''} {lot.steelGradeCode ?? ''} 검사 기준이 없어 판정할 수 없어요. 품질 담당이 검사 기준을 등록해야 해요.
        </Banner>
      ) : null}
      {data.locked ? (
        <Banner icon="lock">
          밀시트({data.lockedMillSheetNos.join(', ')})가 발행된 LOT이라 측정값을 고칠 수 없어요.
        </Banner>
      ) : null}
      {lot.lotType !== 'HEAT' && lot.heatResult === 'PENDING' ? (
        <Banner tone="wait">
          상위 히트 {lot.heatLotNo}의 성분 검사가 판정 대기예요. 먼저 검사할 수 있고, 히트가 합격해야 예약·배정할 수 있어요.
        </Banner>
      ) : null}
      {lot.lotType !== 'HEAT' && lot.heatResult === 'FAIL' ? (
        <Banner tone="danger">상위 히트 {withIGa(lot.heatLotNo ?? '')} 성분 불합격이라 이 LOT은 합격해도 예약·배정·출고할 수 없어요.</Banner>
      ) : null}

      {outcome ? <OutcomeCard outcome={outcome} lotType={lot.lotType} heatPending={lot.lotType !== 'HEAT' && lot.heatResult !== 'PASS'} nextPending={nextPending} onNext={onNext} /> : null}

      <InspectionForm key={`${lot.lotId}-${data.updatedAt ?? 'new'}-${data.standard?.id ?? 0}`} detail={data} canEdit={canEdit} onSaved={onSaved} />

      <LotHistoryCard events={data.history} itemNames={itemNames} />
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
  const notes: string[] = [];
  if (outcome.inspectionResult === 'PASS') {
    if (outcome.autoReservedQty > 0) notes.push(`원래 수주 품목에 ${outcome.autoReservedQty}매를 자동 예약했어요`);
    if (outcome.surplusLotNos.length > 0) notes.push(`수주에 필요한 매수를 넘는 ${outcome.surplusLotNos.length}매는 여재가 됐어요 (${outcome.surplusLotNos.join(', ')})`);
    if (lotType !== 'HEAT' && heatPending) notes.push('상위 히트가 합격하면 예약·배정할 수 있어요');
    if (lotType === 'HEAT') notes.push('이미 제품 검사에 합격한 하위 슬래브·코일이 있으면 같이 예약·배정할 수 있게 돼요');
  } else if (outcome.inspectionResult === 'FAIL') {
    notes.push(lotType === 'HEAT' ? '하위 슬래브·코일도 쓸 수 없어요' : '예약·배정·출고 대상에서 빠져요');
    if (outcome.excludedLotQty > 0) notes.push(`적격에서 빠진 LOT ${outcome.excludedLotQty}개 · 걸려 있던 배정은 해제하고 부족분만 예약을 조정했어요`);
  } else {
    notes.push('필수 항목이 비어 있어 판정 대기로 저장했어요');
  }
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
