'use client';

// 불합격 관리 (REQ-QC-004, REQ-INV-007, BP-QC-01): 왼쪽 불합격 LOT 목록 | 오른쪽 근거 검사값 · 불합격 상태 지정 · 영향과 재생산 · 이력.
// 목록 = 검사 기준을 충족하지 못한 LOT(히트 포함)과 불합격 히트의 하위 LOT(용어 사전 TRM-078). 후속 처리 로직은 없다.
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { RejectedLotDetail, RejectedLotListRow } from '@/api/dispositions';
import { Badge } from '@/components/Badge';
import { Banner } from '@/components/Banner';
import { ButtonLink } from '@/components/Button';
import { Card, CardBody, CardHead } from '@/components/Card';
import { Chip } from '@/components/Chip';
import { ComingSoon } from '@/components/ComingSoon';
import { Icon } from '@/components/Icon';
import { Input } from '@/components/Input';
import { MasterPane, PageMain } from '@/components/Page';
import { QueryBoundary } from '@/components/QueryBoundary';
import { EmptyNote, StateView } from '@/components/StateView';
import { DISPOSITION_STATUS_LABEL, LOT_STATUS_LABEL, LOT_TYPE_LABEL, PERMISSION, SALES_ORDER_ITEM_STATUS_LABEL, type DispositionStatus } from '@/codes';
import { DispositionForm } from '@/features/quality/components/DispositionForm';
import { ImpactCard } from '@/features/quality/components/ImpactCard';
import { InspectionValuesTable } from '@/features/quality/components/InspectionValuesTable';
import { inspectionHref } from '@/features/quality/components/InspectionWorkspace';
import { InfoGrid, LotHeader, MasterItemLink, lotTraceHref } from '@/features/quality/components/LotHeader';
import { LotHistoryCard } from '@/features/quality/components/LotHistoryCard';
import { DispositionBadge, RejectReasonBadge, ResultBadge } from '@/features/quality/components/QualityBadges';
import { inspectionNameOf, limitText, lotIconOf, trimNum } from '@/features/quality/lib/qualityDisplay';
import { useShellTitle } from '@/features/shell/useShellTitle';
import { useRejectedLotDetail, useRejectedLots } from '@/hooks/useDispositions';
import { useCanUse } from '@/hooks/usePermission';
import { cn } from '@/lib/cn';
import { dLabel, fmtDate, fmtMDHM } from '@/lib/format';

type StatusFilter = 'ALL' | 'NONE' | DispositionStatus;
type ReasonFilter = 'ALL' | 'FAILED' | 'HEAT_FAILED';

const statusOf = (row: RejectedLotListRow): Exclude<StatusFilter, 'ALL'> => row.dispositionStatus ?? 'NONE';
const failedNames = (row: RejectedLotListRow): string => row.failedItems.map((f) => f.inspectionItemName).join(' · ');
const rejectedHref = (lotId: number): string => `/quality/rejected?lot=${lotId}`;

const TILES: readonly { key: Exclude<StatusFilter, 'ALL'>; label: string; className: string; onClassName: string }[] = [
  { key: 'NONE', label: '미지정', className: 'bg-surface-3 text-ink-2', onClassName: 'shadow-[inset_0_0_0_2px_var(--color-ink-2)]' },
  { key: 'HOLD', label: DISPOSITION_STATUS_LABEL.HOLD, className: 'bg-wait-bg text-wait', onClassName: 'shadow-[inset_0_0_0_2px_var(--color-wait)]' },
  {
    key: 'DOWNGRADED',
    label: DISPOSITION_STATUS_LABEL.DOWNGRADED,
    className: 'bg-surface text-ink-2 shadow-[inset_0_0_0_1px_var(--color-line-strong)]',
    onClassName: 'shadow-[inset_0_0_0_2px_var(--color-ink-2)]',
  },
  { key: 'SCRAPPED', label: DISPOSITION_STATUS_LABEL.SCRAPPED, className: 'bg-danger-bg text-danger', onClassName: 'shadow-[inset_0_0_0_2px_var(--color-danger)]' },
];

export function RejectedLotWorkspace() {
  const list = useRejectedLots();
  return (
    <QueryBoundary query={list} loadingLabel="불합격 LOT을 불러오는 중…">
      {(rows) => <Workspace rows={rows} />}
    </QueryBoundary>
  );
}

function Workspace({ rows }: { rows: RejectedLotListRow[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<StatusFilter>('ALL');
  const [reason, setReason] = useState<ReasonFilter>('ALL');
  const [keyword, setKeyword] = useState('');

  const needle = keyword.trim().toUpperCase();
  const list = rows.filter(
    (r) =>
      (status === 'ALL' || statusOf(r) === status) &&
      (reason === 'ALL' || r.reason === reason) &&
      (!needle || r.lotNo.toUpperCase().includes(needle) || (r.heatNo ?? '').toUpperCase().includes(needle)),
  );
  const paramId = Number(searchParams.get('lot')) || null;
  const activeId = paramId ?? list[0]?.lotId ?? null;
  // 고른 LOT을 주소에 둔다: 상태를 지정해 필터에서 빠져도 같은 LOT을 계속 보인다
  useEffect(() => {
    if (paramId === null && activeId !== null) router.replace(rejectedHref(activeId));
  }, [paramId, activeId, router]);
  const count = (s: Exclude<StatusFilter, 'ALL'>) => rows.filter((r) => statusOf(r) === s).length;

  return (
    <>
      <MasterPane
        head={
          <>
            <div className="flex items-baseline gap-2">
              <b className="text-base font-semibold">불합격 LOT</b>
              <span className="text-cap text-ink-3">{rows.length}건</span>
            </div>
            <div className="grid grid-cols-4 gap-1.5" role="group" aria-label="불합격 상태">
              {TILES.map((tile) => (
                <button
                  key={tile.key}
                  type="button"
                  aria-pressed={status === tile.key}
                  onClick={() => setStatus(status === tile.key ? 'ALL' : tile.key)}
                  className={cn('flex flex-col items-start gap-0.5 rounded-md px-2.5 py-1.5 text-left', tile.className, status === tile.key && tile.onClassName)}
                >
                  <span className="text-cap">{tile.label}</span>
                  <b className="text-lg leading-6 font-semibold tabular-nums">{count(tile.key)}</b>
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="불합격 원인">
              <Chip on={reason === 'ALL'} onClick={() => setReason('ALL')}>
                모든 원인
              </Chip>
              <Chip on={reason === 'FAILED'} onClick={() => setReason('FAILED')}>
                검사 불합격
              </Chip>
              <Chip on={reason === 'HEAT_FAILED'} onClick={() => setReason('HEAT_FAILED')}>
                불합격 히트의 하위 LOT
              </Chip>
            </div>
            <Input type="search" leadingIcon="search" placeholder="LOT 번호·히트 번호 검색" aria-label="LOT 번호 검색" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
          </>
        }
      >
        {list.map((r) => (
          <RejectedItem key={r.lotId} row={r} active={r.lotId === activeId} />
        ))}
        {list.length === 0 ? <EmptyNote>{rows.length === 0 ? '불합격 LOT이 없어요' : '조건에 맞는 불합격 LOT이 없어요'}</EmptyNote> : null}
        <Banner className="mx-4 my-3.5 text-xs leading-[17px]" icon="info">
          검사 기준을 충족하지 못한 LOT과 불합격 히트의 하위 LOT이에요. 예약·배정·출고 대상에서 빠져 있고, 여기서는 불합격 상태와 사유만 기록해요.
        </Banner>
      </MasterPane>

      <PageMain>
        {activeId === null ? <StateView kind="empty" title="불합격 LOT이 없어요" /> : <Detail key={activeId} lotId={activeId} />}
      </PageMain>
    </>
  );
}

function RejectedItem({ row, active }: { row: RejectedLotListRow; active: boolean }) {
  const names = failedNames(row);
  const need = row.salesOrderItem?.shortage.reproductionNeedQty ?? 0;
  return (
    <MasterItemLink href={rejectedHref(row.lotId)} active={active}>
      <div className="flex items-center gap-1.5">
        <Icon name={lotIconOf(row.lotType)} size="sm" className={active ? 'text-brand' : 'text-ink-3'} />
        <span className={active ? 'font-mono text-mono font-semibold' : 'font-mono text-mono'}>{row.lotNo}</span>
        <span className="ml-auto">
          <DispositionBadge status={row.dispositionStatus} />
        </span>
      </div>
      <span className="text-cap text-ink-3">
        {LOT_TYPE_LABEL[row.lotType]} · {row.steelGradeCode ?? '—'}
        {row.itemCode ? ` ${row.itemCode}` : ''}
      </span>
      <div className="flex min-w-0 items-center gap-1.5 text-xs">
        <RejectReasonBadge reason={row.reason} />
        <span className="min-w-0 truncate text-danger" title={names}>
          {row.reason === 'HEAT_FAILED' ? `${row.heatNo ?? '히트'} ${names || '성분'}` : names || '기준 밖'}
        </span>
      </div>
      <div className="flex items-center gap-1.5 text-cap text-ink-3">
        <span className="min-w-0 truncate">{row.salesOrderItem ? `${row.salesOrderItem.salesOrderNo} 품목 ${row.salesOrderItem.lineNo}` : '연결 수주 없음'}</span>
        {need > 0 ? (
          <Badge tone="danger" className="ml-auto">
            재생산 필요 {need}매
          </Badge>
        ) : null}
      </div>
    </MasterItemLink>
  );
}

function Detail({ lotId }: { lotId: number }) {
  const detail = useRejectedLotDetail(lotId);
  useShellTitle(detail.data?.row.lotNo, detail.data ? '불합격 관리' : undefined);
  return (
    <QueryBoundary query={detail} loadingLabel="불합격 LOT을 불러오는 중…">
      {(data) =>
        data === null ? (
          <StateView
            kind="empty"
            title="이 LOT은 불합격 목록에 없어요"
            text="불합격이 아니거나 아직 판정 대기인 LOT이에요."
            actions={<ButtonLink href={inspectionHref(lotId)}>검사 입력에서 보기</ButtonLink>}
          />
        ) : (
          <DetailBody detail={data} />
        )
      }
    </QueryBoundary>
  );
}

function DetailBody({ detail }: { detail: RejectedLotDetail }) {
  const canEdit = useCanUse(PERMISSION.DISPOSITION_SET);
  const { row, evidence } = detail;
  const own = row.reason === 'FAILED';
  const soItem = row.salesOrderItem;
  const typeName = LOT_TYPE_LABEL[row.lotType];
  const failedCount = evidence?.items.filter((i) => i.isPassed === false).length ?? row.failedItems.length;

  return (
    <>
      <LotHeader
        area="불합격 관리"
        lotNo={row.lotNo}
        typeName={typeName}
        badges={
          <>
            <DispositionBadge status={row.dispositionStatus} />
            <RejectReasonBadge reason={row.reason} />
          </>
        }
        actions={
          <>
            {evidence ? (
              <ButtonLink href={inspectionHref(evidence.lot.lotId)} icon="quality">
                {own ? '검사 결과' : '상위 히트 검사 결과'}
              </ButtonLink>
            ) : null}
            <ButtonLink href={lotTraceHref(row.lotNo, 'forward')} icon="trace">
              LOT 추적 (영향 범위)
            </ButtonLink>
            {/* 과거 사례(EX)는 준비 중: 누르면 과거 사례 화면(디자인 미리 보기)으로 간다 (REQ-CASE-002) */}
            <ButtonLink href="/past-cases" icon="search">
              사례로 등록 <ComingSoon grade="EX" />
            </ButtonLink>
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
              { label: '강종 · 규격', value: <span className="font-mono">{[row.steelGradeCode, row.itemCode].filter(Boolean).join(' ') || '—'}</span> },
              {
                label: '불합격 원인',
                value: own ? (
                  '검사 불합격'
                ) : (
                  <span>
                    상위 히트{' '}
                    {row.heatNo ? (
                      <Link href={rejectedHref(evidence?.lot.lotId ?? 0)} className="font-mono text-run hover:underline">
                        {row.heatNo}
                      </Link>
                    ) : null}{' '}
                    성분 불합격
                  </span>
                ),
              },
              {
                label: '근거 검사',
                value: evidence ? (
                  <span>
                    {inspectionNameOf(evidence.lot.processType)} <span className="text-cap text-ink-3">· {fmtMDHM(row.inspectedAt)}</span>
                  </span>
                ) : (
                  <span className="text-ink-3">기록 없음</span>
                ),
              },
              ...(row.lotType !== 'HEAT' ? [{ label: '상위 히트', value: row.heatNo ? <span className="font-mono">{row.heatNo}</span> : '—' }] : []),
              {
                label: '생산계획',
                value:
                  row.productionPlanId && row.productionPlanNo ? (
                    <Link href={`/production/plans?plan=${row.productionPlanId}`} className="font-mono text-run hover:underline">
                      {row.productionPlanNo}
                    </Link>
                  ) : (
                    <span className="text-ink-3">없음</span>
                  ),
              },
              {
                label: '영향받는 수주 품목',
                value: soItem ? (
                  <span>
                    <Link href={`/sales-orders/${soItem.salesOrderId}`} className="font-mono text-run hover:underline">
                      {soItem.salesOrderNo}
                    </Link>{' '}
                    품목 {soItem.lineNo}{' '}
                    <span className="text-cap text-ink-3">
                      {soItem.customerName} · 납기 {fmtDate(soItem.dueDate)} {dLabel(soItem.dueDate)} · 수주 매수 {soItem.orderedQty}매 ·{' '}
                      {SALES_ORDER_ITEM_STATUS_LABEL[soItem.salesOrderItemStatus]}
                    </span>
                  </span>
                ) : (
                  <span className="text-ink-3">없음 · 연결된 수주 품목이 없어요</span>
                ),
              },
              { label: '생산완료일', value: fmtDate(row.producedDate) },
              { label: 'LOT 상태', value: LOT_STATUS_LABEL[row.lotStatus] },
            ]}
          />
        </CardBody>
      </Card>

      <div className="grid flex-none grid-cols-1 items-start gap-4 xl:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-4">
          <Card className="flex-none">
            <CardHead
              title="검사값"
              meta={evidence ? `${evidence.standard ? `${evidence.standard.inspectionStandardCode} 버전 ${evidence.standard.version} · ` : ''}불합격 ${failedCount}/${evidence.items.length}개` : '검사 기록 없음'}
              actions={evidence ? <ResultBadge result={evidence.inspectionResult} /> : null}
            />
            {!own && evidence ? (
              <Banner tone="wait" className="mx-4 mt-3 text-xs">
                이 LOT 자신이 아니라 상위 히트 {evidence.lot.lotNo}의 성분 검사 결과예요.
              </Banner>
            ) : null}
            <CardBody flush>{evidence ? <InspectionValuesTable items={evidence.items} /> : <EmptyNote>연결된 검사 기록이 없어요</EmptyNote>}</CardBody>
            {!evidence && row.failedItems.length > 0 ? (
              <div className="flex flex-col items-start gap-1 rounded-b-md border-t border-line bg-surface-2 px-4 py-2.5">
                <span className="text-cap text-ink-3">불합격 항목</span>
                {row.failedItems.map((f) => (
                  <span key={f.inspectionItemCode} className="text-xs text-danger">
                    {f.inspectionItemName} {trimNum(f.measuredValue)}
                    {f.unit ? ` ${f.unit}` : ''} (기준 {limitText(f)})
                  </span>
                ))}
              </div>
            ) : null}
          </Card>
          <DispositionForm key={`${row.lotId}-${row.updatedAt}`} row={row} canEdit={canEdit} />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <ImpactCard detail={detail} />
          <LotHistoryCard lotId={row.lotId} events={detail.history} itemNames={detail.inspectionItemNames} />
        </div>
      </div>
    </>
  );
}
