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
import { Icon } from '@/components/Icon';
import { Input } from '@/components/Input';
import { MasterPane, PageMain } from '@/components/Page';
import { QueryBoundary } from '@/components/QueryBoundary';
import { EmptyNote, StateView } from '@/components/StateView';
import { DISPOSITION_STATUS_LABEL, LOT_STATUS_LABEL, LOT_TYPE_LABEL, PERMISSION, SALES_ORDER_ITEM_STATUS_LABEL, type DispositionStatus } from '@/codes';
import { PastCaseRegisterModal } from '@/features/pastCases/PastCaseRegisterModal';
import { similarCaseHref } from '@/features/pastCases/pastCaseExample';
import { PastCaseMenu } from '@/features/quality/components/PastCaseMenu';
import { DispositionForm } from '@/features/quality/components/DispositionForm';
import { ImpactCard } from '@/features/quality/components/ImpactCard';
import { InspectionValuesTable } from '@/features/quality/components/InspectionValuesTable';
import { inspectionHref } from '@/features/quality/components/InspectionWorkspace';
import { GradeSpec, InfoGrid, LotHeader, MasterItemLink, lotTraceHref } from '@/features/quality/components/LotHeader';
import { LotHistoryCard } from '@/features/quality/components/LotHistoryCard';
import { DispositionBadge, RejectReasonBadge, ResultBadge } from '@/features/quality/components/QualityBadges';
import { inspectionNameOf, limitText, lotIconOf, qtyUnitOfItem, trimNum } from '@/features/quality/lib/qualityDisplay';
import { useRejectedLotDetail, useRejectedLots } from '@/hooks/useDispositions';
import { useCanUse } from '@/hooks/usePermission';
import { cn } from '@/lib/cn';
import { dLabel, fmtDate, fmtMDHM } from '@/lib/format';

type StatusFilter = 'ALL' | 'NONE' | DispositionStatus;
type ReasonFilter = 'ALL' | 'FAILED' | 'HEAT_FAILED';

const statusOf = (row: RejectedLotListRow): Exclude<StatusFilter, 'ALL'> => row.dispositionStatus ?? 'NONE';

/** 목록 한 칸: LOT 한 줄, 또는 불합격 히트와 그 하위 LOT 묶음 (히트가 거름에서 빠졌으면 heat = null) */
type ListEntry = { kind: 'row'; row: RejectedLotListRow } | { kind: 'heat'; heatNo: string; heat: RejectedLotListRow | null; children: RejectedLotListRow[] };

/**
 * 같은 히트에서 나온 하위 LOT을 히트 아래로 묶는다. 하위 LOT은 원인(히트 성분)·영향 수주가 히트와 같아서
 * 줄마다 같은 글자와 "재생산 필요 N매"가 되풀이되던 것을 히트 줄 한 번으로 줄인다. 목록 순서는 그대로 둔다.
 */
function groupByHeat(list: readonly RejectedLotListRow[]): ListEntry[] {
  const childrenOf = new Map<string, RejectedLotListRow[]>();
  for (const r of list) {
    if (r.reason === 'HEAT_FAILED' && r.heatNo) childrenOf.set(r.heatNo, [...(childrenOf.get(r.heatNo) ?? []), r]);
  }
  const heatsInList = new Set(list.filter((r) => r.lotType === 'HEAT').map((r) => r.lotNo));
  const placed = new Set<string>();
  const out: ListEntry[] = [];
  for (const r of list) {
    if (r.reason === 'HEAT_FAILED' && r.heatNo) {
      // 히트가 목록에 있으면 히트 줄 아래에서 그린다. 없으면(원인 거름 등) 히트 번호 머리로 한 번만 묶는다
      if (heatsInList.has(r.heatNo) || placed.has(r.heatNo)) continue;
      placed.add(r.heatNo);
      out.push({ kind: 'heat', heatNo: r.heatNo, heat: null, children: childrenOf.get(r.heatNo) ?? [] });
      continue;
    }
    const children = r.lotType === 'HEAT' ? (childrenOf.get(r.lotNo) ?? []) : [];
    out.push(children.length > 0 ? { kind: 'heat', heatNo: r.lotNo, heat: r, children } : { kind: 'row', row: r });
  }
  return out;
}
const failedNames = (row: RejectedLotListRow): string => row.failedItems.map((f) => f.inspectionItemName).join(' · ');
const rejectedHref = (lotId: number): string => `/quality/rejected?lot=${lotId}`;
const REJECTED_GUIDE = '검사 기준을 충족하지 못한 LOT과 불합격 히트의 하위 LOT이에요. 예약·배정·출고 대상에서 빠져 있고, 여기서는 불합격 상태와 사유만 기록해요.';

const TILES: readonly { key: Exclude<StatusFilter, 'ALL'>; label: string; className: string; onClassName: string }[] = [
  { key: 'NONE', label: '미지정', className: 'bg-surface-3 text-ink-2', onClassName: 'shadow-[inset_0_0_0_2px_var(--color-ink-2)]' },
  { key: 'HOLD', label: DISPOSITION_STATUS_LABEL.HOLD, className: 'bg-wait-bg text-wait', onClassName: 'shadow-[inset_0_0_0_2px_var(--color-wait)]' },
  {
    key: 'DOWNGRADED',
    label: DISPOSITION_STATUS_LABEL.DOWNGRADED,
    className: 'bg-run-bg text-run',
    onClassName: 'shadow-[inset_0_0_0_2px_var(--color-run)]',
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
  /** 사람이 펼친 히트 묶음. 고른 LOT이 들어 있는 묶음은 따로 펼치지 않아도 열린다 */
  const [openHeats, setOpenHeats] = useState<ReadonlySet<string>>(() => new Set());
  const toggleHeat = (heatNo: string) =>
    setOpenHeats((current) => {
      const next = new Set(current);
      if (next.has(heatNo)) next.delete(heatNo);
      else next.add(heatNo);
      return next;
    });

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
        petKey="card:rejectedLots.list"
        head={
          <>
            <div className="flex items-baseline gap-2">
              <b className="text-base font-semibold">불합격 LOT</b>
              <span className="text-cap text-ink-3">{rows.length}건</span>
            </div>
            <div className="grid grid-cols-4 gap-1.5" role="group" aria-label="불합격 상태">
              {TILES.map((tile) => {
                const n = count(tile.key);
                return (
                  <button
                    key={tile.key}
                    type="button"
                    aria-pressed={status === tile.key}
                    data-pet-term={tile.label}
                    onClick={() => setStatus(status === tile.key ? 'ALL' : tile.key)}
                    className={cn(
                      'flex flex-col items-start gap-0.5 rounded-md px-2.5 py-1.5 text-left',
                      // 0건이면 회색: 처리할 일이 없는데 경고색이 칠해져 있지 않게 (색은 건수가 있을 때만)
                      n > 0 ? tile.className : 'bg-surface-2 text-ink-3',
                      status === tile.key && tile.onClassName,
                    )}
                  >
                    <span className="text-cap">{tile.label}</span>
                    <b className="text-lg font-semibold tabular-nums">{n}</b>
                  </button>
                );
              })}
            </div>
            {/* 세 칩이 목록 칸 안에 한 줄로 들어가게 간격·좌우 여백만 줄인다 (문구는 용어 사전 TRM-078 그대로). 불합격 LOT이 없으면 거를 것이 없어 숨긴다 */}
            <div className={cn('flex flex-nowrap gap-1', rows.length === 0 && 'hidden')} role="group" aria-label="불합격 원인">
              <Chip on={reason === 'ALL'} onClick={() => setReason('ALL')} className="px-2" data-pet-term="모든 원인">
                모든 원인
              </Chip>
              <Chip on={reason === 'FAILED'} onClick={() => setReason('FAILED')} className="px-2" data-pet-term="검사 불합격">
                검사 불합격
              </Chip>
              <Chip on={reason === 'HEAT_FAILED'} onClick={() => setReason('HEAT_FAILED')} className="px-2" data-pet-term="불합격 히트의 하위 LOT">
                불합격 히트의 하위 LOT
              </Chip>
            </div>
            <Input type="search" leadingIcon="search" placeholder="LOT 번호·히트 번호 검색" aria-label="LOT 번호 검색" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
          </>
        }
      >
        {groupByHeat(list).map((entry) =>
          entry.kind === 'row' ? (
            <RejectedItem key={entry.row.lotId} row={entry.row} active={entry.row.lotId === activeId} />
          ) : (
            <HeatGroup
              key={`heat-${entry.heatNo}`}
              entry={entry}
              activeId={activeId}
              // 히트가 거름에서 빠진 묶음은 하위 LOT이 곧 찾던 대상이라 처음부터 연다
              open={entry.heat === null || openHeats.has(entry.heatNo) || entry.children.some((c) => c.lotId === activeId)}
              onToggle={() => toggleHeat(entry.heatNo)}
            />
          ),
        )}
        {/* 목록이 비면 오른쪽이 같은 안내를 크게 보이므로 되풀이하지 않는다. 오른쪽에 주소로 연 LOT이 떠 있을 때만 여기서 말한다 */}
        {list.length === 0 && activeId !== null ? <EmptyNote>{rows.length === 0 ? '불합격 LOT이 없어요' : '조건에 맞는 불합격 LOT이 없어요'}</EmptyNote> : null}
        {rows.length > 0 ? (
          <Banner className="mx-4 my-3.5 text-xs leading-snug" icon="info">
            {REJECTED_GUIDE}
          </Banner>
        ) : null}
      </MasterPane>

      <PageMain>
        {activeId === null ? (
          rows.length === 0 ? (
            // 불합격 LOT이 하나도 없으면 왼쪽 안내 상자 대신 여기서 이 화면이 무엇인지 함께 말한다 (가운데 정렬 두 줄이라 낱말 중간에서 끊기지 않게)
            <StateView kind="empty" title="불합격 LOT이 없어요" text={<span className="break-keep">{REJECTED_GUIDE}</span>} />
          ) : (
            <StateView kind="empty" title="조건에 맞는 불합격 LOT이 없어요" text="상태·원인·검색어를 바꿔 보세요." />
          )
        ) : (
          <Detail key={activeId} lotId={activeId} />
        )}
      </PageMain>
    </>
  );
}

function RejectedItem({ row, active }: { row: RejectedLotListRow; active: boolean }) {
  const names = failedNames(row);
  const need = row.salesOrderItem?.shortage.reproductionNeedQty ?? 0;
  return (
    <MasterItemLink href={rejectedHref(row.lotId)} active={active} petItem="lot" petTitle={row.lotNo}>
      <div className="flex items-center gap-1.5">
        <Icon name={lotIconOf(row.lotType)} size="sm" className={active ? 'text-brand' : 'text-ink-3'} />
        <span className={active ? 'font-mono text-mono font-semibold' : 'font-mono text-mono'} data-pet-field="LOT 번호">
          {row.lotNo}
        </span>
        <span className="ml-auto" data-pet-field="불합격 상태">
          <DispositionBadge status={row.dispositionStatus} />
        </span>
      </div>
      <span className="text-cap text-ink-3" data-pet-field="유형 · 강종 · 규격">
        {LOT_TYPE_LABEL[row.lotType]} · {row.steelGradeCode ?? '—'}
        {row.itemCode ? ` ${row.itemCode}` : ''}
      </span>
      <div className="flex min-w-0 items-center gap-1.5 text-xs">
        <span className="inline-flex" data-pet-field="불합격 원인">
          <RejectReasonBadge reason={row.reason} />
        </span>
        <span className="min-w-0 truncate text-danger" title={names} data-pet-field="불합격 항목">
          {row.reason === 'HEAT_FAILED' ? `${row.heatNo ?? '히트'} ${names || '성분'}` : names || '기준 밖'}
        </span>
      </div>
      <div className="flex items-center gap-1.5 text-cap text-ink-3">
        <span className="min-w-0 truncate" data-pet-field="영향받는 수주 품목">
          {row.salesOrderItem ? `${row.salesOrderItem.salesOrderNo} 품목 ${row.salesOrderItem.lineNo}` : '연결 수주 없음'}
        </span>
        {need > 0 ? (
          <span className="ml-auto inline-flex" data-pet-field="재생산 필요" data-pet-term="재생산 필요">
            <Badge tone="danger">
              재생산 필요 {need}
              {qtyUnitOfItem(row.salesOrderItem)}
            </Badge>
          </span>
        ) : null}
      </div>
    </MasterItemLink>
  );
}

/** 불합격 히트와 하위 LOT 묶음: 원인·영향은 히트 줄에서 한 번만 보이고, 하위 LOT은 펼쳐서 번호·규격·상태만 본다 */
function HeatGroup({
  entry,
  activeId,
  open,
  onToggle,
}: {
  entry: Extract<ListEntry, { kind: 'heat' }>;
  activeId: number | null;
  open: boolean;
  onToggle: () => void;
}) {
  const { heat, heatNo, children } = entry;
  const headNeed = children[0]?.salesOrderItem?.shortage.reproductionNeedQty ?? 0;
  return (
    <>
      {heat ? <RejectedItem row={heat} active={heat.lotId === activeId} /> : null}
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex w-full items-center gap-1.5 border-b border-line bg-surface-2 py-1.5 pr-4 pl-8 text-left text-cap text-ink-2 hover:bg-surface-3"
      >
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size="sm" className="text-ink-3" />
        {heat ? (
          <span>
            하위 LOT <b className="font-semibold">{`${children.length}개`}</b> <span className="text-ink-3">· 같은 히트 성분 불합격</span>
          </span>
        ) : (
          <span className="min-w-0 truncate">
            히트 <span className="font-mono">{heatNo}</span>의 하위 LOT <b className="font-semibold">{`${children.length}개`}</b>
          </span>
        )}
        {/* 히트 줄이 거름에서 빠졌으면 영향(재생산 필요)을 묶음 머리에서 한 번 보인다 */}
        {!heat && headNeed > 0 ? (
          <span className="ml-auto inline-flex flex-none" data-pet-term="재생산 필요">
            <Badge tone="danger">{`재생산 필요 ${headNeed}${qtyUnitOfItem(children[0]?.salesOrderItem)}`}</Badge>
          </span>
        ) : null}
      </button>
      {open ? children.map((c) => <HeatChildItem key={c.lotId} row={c} active={c.lotId === activeId} />) : null}
    </>
  );
}

/** 하위 LOT 한 줄: 원인·영향 수주는 히트 줄과 같아서 되풀이하지 않는다 */
function HeatChildItem({ row, active }: { row: RejectedLotListRow; active: boolean }) {
  return (
    <MasterItemLink href={rejectedHref(row.lotId)} active={active} petItem="lot" petTitle={row.lotNo} className="gap-0.5 py-2 pl-8">
      <div className="flex items-center gap-1.5">
        <Icon name={lotIconOf(row.lotType)} size="sm" className={active ? 'text-brand' : 'text-ink-3'} />
        <span className={active ? 'font-mono text-mono font-semibold' : 'font-mono text-mono'} data-pet-field="LOT 번호">
          {row.lotNo}
        </span>
        <span className="ml-auto" data-pet-field="불합격 상태">
          <DispositionBadge status={row.dispositionStatus} />
        </span>
      </div>
      <span className="truncate text-cap text-ink-3" data-pet-field="유형 · 강종 · 규격">
        {LOT_TYPE_LABEL[row.lotType]} · {row.steelGradeCode ?? '—'}
        {row.itemCode ? ` ${row.itemCode}` : ''}
      </span>
    </MasterItemLink>
  );
}

function Detail({ lotId }: { lotId: number }) {
  const detail = useRejectedLotDetail(lotId);
  // 상단 바는 화면 이름(불합격 관리) 그대로 둔다: LOT 번호로 바꾸면 바로 아래 LOT 머리와 같은 번호가 크게 두 번 보였다
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
  const [registering, setRegistering] = useState(false);
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
            {/* 과거 사례(EX): 사례로 등록(REQ-CASE-002)은 AI 초안 창을, 비슷한 사례 찾기(REQ-CASE-004)는 강종·LOT 종류로 검색한 과거 사례 화면을 연다 */}
            <PastCaseMenu
              items={[
                {
                  label: '사례로 등록',
                  icon: 'plus',
                  onSelect: () => setRegistering(true),
                  disabledReason: canEdit ? undefined : '불합격 처리 상태 지정 사용 권한이 있어야 해요',
                },
                { label: '비슷한 사례 찾기', icon: 'search', href: similarCaseHref(row.steelGradeCode, row.lotType) },
              ]}
            />
          </>
        }
      />
      {registering ? <PastCaseRegisterModal lotId={row.lotId} lotNo={row.lotNo} onClose={() => setRegistering(false)} /> : null}

      <Card className="flex-none" petKey="card:rejectedLots.lotInfo">
        <CardBody className="px-4 py-3">
          <InfoGrid
            items={[
              { label: '강종 · 규격', value: <GradeSpec steelGradeCode={row.steelGradeCode} itemCode={row.itemCode} /> },
              {
                label: '불합격 원인',
                value: own ? (
                  '검사 불합격'
                ) : (
                  <span>
                    상위 히트{' '}
                    {/* 히트 LOT id는 근거 검사(evidence)에만 있다. 없으면 lot=0으로 가서 목록 첫 LOT이 열렸으니, 그때는 히트 번호로 LOT 추적을 연다 (검사 입력의 상위 히트 링크와 같음) */}
                    {row.heatNo ? (
                      <Link href={evidence ? rejectedHref(evidence.lot.lotId) : lotTraceHref(row.heatNo)} className="font-mono text-run hover:underline">
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
                  // 한 덩어리로 두면 칸이 좁을 때 날짜 중간("2026-" / "10-12")에서 줄이 바뀐다: 두 줄로 나누고 조각마다 줄바꿈을 막는다
                  <span className="flex flex-col">
                    <span>
                      <Link href={`/sales-orders/${soItem.salesOrderId}`} className="font-mono text-run hover:underline">
                        {soItem.salesOrderNo}
                      </Link>{' '}
                      품목 {soItem.lineNo} · {soItem.customerName}
                    </span>
                    <span className="text-cap font-normal text-ink-3" title={`납기 ${fmtDate(soItem.dueDate)} · 수주 매수 ${soItem.orderedQty}${qtyUnitOfItem(soItem)}`}>
                      <span className="whitespace-nowrap">
                        납기 {fmtDate(soItem.dueDate).slice(5)} ({dLabel(soItem.dueDate)})
                      </span>{' '}
                      · <span className="whitespace-nowrap">
                        {soItem.orderedQty}
                        {qtyUnitOfItem(soItem)}
                      </span> ·{' '}
                      <span className="whitespace-nowrap">{SALES_ORDER_ITEM_STATUS_LABEL[soItem.salesOrderItemStatus]}</span>
                    </span>
                  </span>
                ) : (
                  <span className="text-ink-3">없음 · 연결된 수주 품목이 없어요</span>
                ),
              },
              // 히트에는 생산완료일 칸이 없다(서버). "-"만 보이던 칸을 뺀다
              ...(row.lotType !== 'HEAT' ? [{ label: '생산완료일', value: fmtDate(row.producedDate) }] : []),
              { label: 'LOT 상태', value: LOT_STATUS_LABEL[row.lotStatus] },
            ]}
          />
        </CardBody>
      </Card>

      <div className="grid flex-none grid-cols-1 items-start gap-4 xl:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-4">
          <Card className="flex-none" petKey="card:rejectedLots.evidence">
            <CardHead
              title="검사값"
              meta={
                <span data-pet-term="판정에 쓴 검사 기준">
                  {evidence ? `${evidence.standard ? `${evidence.standard.inspectionStandardCode} v${evidence.standard.version} · ` : ''}불합격 ${failedCount}/${evidence.items.length}개` : '검사 기록 없음'}
                </span>
              }
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
                  <span key={f.inspectionItemCode} className="text-xs text-danger" data-pet-item="qualityInspectionValue" data-pet-item-title={f.inspectionItemName}>
                    {f.inspectionItemName}{' '}
                    <span data-pet-field="측정값">
                      {trimNum(f.measuredValue)}
                      {f.unit ? ` ${f.unit}` : ''}
                    </span>{' '}
                    (기준 <span data-pet-field="기준">{limitText(f)}</span>)
                  </span>
                ))}
              </div>
            ) : null}
          </Card>
          <DispositionForm key={`${row.lotId}-${row.updatedAt}`} row={row} canEdit={canEdit} />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <ImpactCard detail={detail} />
          <LotHistoryCard petKey="card:rejectedLots.history" lotId={row.lotId} events={detail.history} itemNames={detail.inspectionItemNames} />
        </div>
      </div>
    </>
  );
}
