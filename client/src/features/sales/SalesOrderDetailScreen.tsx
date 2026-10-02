'use client';

// 수주 상세 /sales-orders/[id] (REQ-SO-004~006, BP-SO-02, 보고서 1 A-3·A-4 + C 수정):
// 왼쪽 수주 목록 | 머리(상태·납기 위험·업무방·출하요청·취소) + 탭(충족 현황 · 생산 연결 · 예약 · 이력).
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { ApiError } from '@/api/client';
import type { SalesOrderDetail } from '@/api/salesOrders';
import { ERROR_MESSAGE, PERMISSION } from '@/codes';
import { Banner } from '@/components/Banner';
import { Button, ButtonLink } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { Input } from '@/components/Input';
import { MasterPane, PageMain } from '@/components/Page';
import { QueryBoundary } from '@/components/QueryBoundary';
import { ReadOnlyHint } from '@/components/ReadOnlyHint';
import { EmptyNote, StateView } from '@/components/StateView';
import { Tabs } from '@/components/Tabs';
import { Tag } from '@/components/Tag';
import { useShellTitle } from '@/features/shell/useShellTitle';
import { useCanUse } from '@/hooks/usePermission';
import { useSalesOrderDetail, useSalesOrderList, useSalesOrderProductionLinks, useSalesOrderTimeline } from '@/hooks/useSalesOrders';
import { fmtDateTime, fmtTon } from '@/lib/format';
import { progressOf } from '@/lib/inventoryMath';
import { permissionNeedText } from '@/lib/permissions';
import { CancelSalesOrderModal } from '@/features/sales/components/CancelSalesOrderModal';
import { FulfillmentTab } from '@/features/sales/components/FulfillmentTab';
import { HistoryTab } from '@/features/sales/components/HistoryTab';
import { ProductionLinkTab } from '@/features/sales/components/ProductionLinkTab';
import { ReservationTab } from '@/features/sales/components/ReservationTab';
import { ShipmentRequestButton, WorkRoomButton } from '@/features/sales/components/SalesOrderActions';
import { businessEventsHref, DueRiskBadge, DueText, MeasureBar, SalesOrderStatusBadge } from '@/features/sales/components/SalesOrderParts';
import { cancellationEffectsText, qtyUnitOf } from '@/features/sales/lib/salesOrderForm';

type DetailTab = 'fulfillment' | 'production' | 'reservations' | 'history';
type MasterChip = 'ALL' | 'OPEN' | 'RISK';

const MASTER_LIMIT = 50;

function SalesOrderMaster({ currentId }: { currentId: number | null }) {
  const list = useSalesOrderList();
  const canCreate = useCanUse(PERMISSION.SALES_ORDER_CREATE);
  const [keyword, setKeyword] = useState('');
  const [chip, setChip] = useState<MasterChip>('ALL');
  const rows = useMemo(() => {
    const k = keyword.trim().toLowerCase();
    return (list.data ?? [])
      .filter((r) => (chip === 'OPEN' ? r.status === 'OPEN' : chip === 'RISK' ? r.isDueRisk : true))
      .filter((r) => k === '' || r.salesOrderNo.toLowerCase().includes(k) || r.customerName.toLowerCase().includes(k));
  }, [list.data, keyword, chip]);

  const emptyText = keyword
    ? '검색 결과가 없어요'
    : chip === 'RISK'
      ? '납기 위험 수주가 없어요'
      : chip === 'OPEN'
        ? '진행중인 수주가 없어요'
        : '등록된 수주가 없어요';
  return (
    <MasterPane
      head={
        <>
          <div className="flex items-center gap-2">
            <b className="text-sm font-semibold">수주</b>
            <span className="text-cap text-ink-3">{list.data?.length ?? 0}건</span>
            <ButtonLink size="sm" variant="ghost" className="ml-auto" href="/sales-orders">
              목록
            </ButtonLink>
            {canCreate ? (
              <ButtonLink size="sm" icon="plus" href="/sales-orders/new">
                등록
              </ButtonLink>
            ) : null}
          </div>
          <Input
            leadingIcon="search"
            placeholder="수주번호·고객사 검색"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            aria-label="수주 검색"
          />
          <div className="flex gap-1.5">
            <Chip on={chip === 'ALL'} onClick={() => setChip('ALL')}>
              전체
            </Chip>
            <Chip on={chip === 'OPEN'} onClick={() => setChip('OPEN')}>
              진행중
            </Chip>
            <Chip on={chip === 'RISK'} onClick={() => setChip('RISK')}>
              납기 위험
            </Chip>
          </div>
        </>
      }
    >
      <QueryBoundary query={list} loadingLabel="수주 목록을 불러오는 중…">
        {() => (
          <>
            {rows.length === 0 ? <EmptyNote>{emptyText}</EmptyNote> : null}
            <ul className="flex flex-col">
              {rows.slice(0, MASTER_LIMIT).map((row) => {
                const unit = qtyUnitOf(row.itemTypes);
                return (
                  <li key={row.id}>
                    <Link
                      href={`/sales-orders/${row.id}`}
                      aria-current={row.id === currentId ? 'page' : undefined}
                      className="flex flex-col gap-1 border-b border-line px-4 py-2.5 hover:bg-surface-2 aria-[current=page]:bg-brand-tint"
                    >
                      <span className="flex items-center gap-1.5">
                        <b className="font-mono text-xs font-semibold">{row.salesOrderNo}</b>
                        <span className="ml-auto">{row.isDueRisk ? <DueRiskBadge /> : <SalesOrderStatusBadge status={row.status} />}</span>
                      </span>
                      <span className="truncate text-xs text-ink-2">
                        {row.customerName} · {row.totalOrderedQty}
                        {unit} · {fmtTon(row.totalOrderedTon)}
                      </span>
                      <span className="text-cap text-ink-3">
                        납기 <DueText dueDate={row.earliestDueDate} risk={row.isDueRisk} done={row.status === 'SHIPPED' || row.status === 'CANCELLED'} />
                      </span>
                      <MeasureBar
                        label="검사합격"
                        unit={unit}
                        tone="ok"
                        measure={progressOf(row.totalActiveReservedQty + row.totalShippedQty, row.totalOrderedQty)}
                      />
                    </Link>
                  </li>
                );
              })}
            </ul>
            <p className="px-4 py-2.5 text-cap text-ink-3">최신 등록순 · {MASTER_LIMIT}건까지 표시 · 막대 = 검사합격 ÷ 수주 매수</p>
          </>
        )}
      </QueryBoundary>
    </MasterPane>
  );
}

function CancelButton({ detail }: { detail: SalesOrderDetail }) {
  const canCancel = useCanUse(PERMISSION.SALES_ORDER_CANCEL);
  const [open, setOpen] = useState(false);
  if (detail.cancelBlock === 'CANCELLED') return null;
  const blockText = detail.cancelBlock ? `${ERROR_MESSAGE[detail.cancelBlock]} (${detail.cancelBlock})` : null;
  const title = !canCancel ? permissionNeedText([PERMISSION.SALES_ORDER_CANCEL]) : (blockText ?? undefined);
  return (
    <>
      <Button
        size="sm"
        variant="danger-outline"
        icon="x-circle"
        disabled={!canCancel || detail.cancelBlock !== null}
        title={title}
        onClick={() => setOpen(true)}
      >
        수주 취소
      </Button>
      {open ? <CancelSalesOrderModal detail={detail} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function DetailBody({ detail }: { detail: SalesOrderDetail }) {
  const [tab, setTab] = useState<DetailTab>('fulfillment');
  const canCancel = useCanUse(PERMISSION.SALES_ORDER_CANCEL);
  const production = useSalesOrderProductionLinks(detail.id);
  const timeline = useSalesOrderTimeline(detail.id);
  useShellTitle(detail.salesOrderNo, detail.customerName);

  const done = detail.status === 'SHIPPED' || detail.status === 'CANCELLED';
  const cancelBlockCode = detail.cancelBlock === 'SO-003' || detail.cancelBlock === 'SO-004' ? detail.cancelBlock : null;
  return (
    <>
      <div className="flex flex-none flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-mono text-2xl font-semibold">{detail.salesOrderNo}</h1>
          <span className="text-lg font-medium">{detail.customerName}</span>
          <SalesOrderStatusBadge status={detail.status} />
          {detail.isDueRisk ? <DueRiskBadge /> : null}
          {detail.hasReproductionNeed ? <Tag tone="outline">재생산 필요</Tag> : null}
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <WorkRoomButton salesOrderId={detail.id} salesOrderNo={detail.salesOrderNo} hasRoom={detail.workRoomId !== null} cancelled={detail.status === 'CANCELLED'} />
            <ButtonLink size="sm" icon="history" href={businessEventsHref(detail.id)}>
              작업 로그
            </ButtonLink>
            <ShipmentRequestButton summary={detail} />
            <CancelButton detail={detail} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-cap text-ink-3">
          <Tag>
            가장 이른 납기 <DueText dueDate={detail.earliestDueDate} risk={detail.isDueRisk} done={done} />
          </Tag>
          <span>
            등록 {fmtDateTime(detail.createdAt)} · 담당 {detail.ownerName ?? '-'}
          </span>
          {canCancel && cancelBlockCode ? (
            <span className="text-danger">
              취소 불가 · {ERROR_MESSAGE[cancelBlockCode]} ({cancelBlockCode})
            </span>
          ) : null}
          {canCancel ? null : <ReadOnlyHint permissions={[PERMISSION.SALES_ORDER_CANCEL]} />}
        </div>
      </div>

      {detail.cancelledAt ? (
        <Banner tone="danger">
          <b>취소된 수주예요</b> · {fmtDateTime(detail.cancelledAt)} · 사유: {detail.cancelReason ?? '-'}
          {detail.cancellation ? ` · ${cancellationEffectsText(detail.cancellation)}` : null}
        </Banner>
      ) : null}

      <div className="flex flex-none items-end gap-3">
        <Tabs<DetailTab>
          ariaLabel="수주 상세"
          className="flex-1"
          active={tab}
          onChange={setTab}
          items={[
            { key: 'fulfillment', label: '충족 현황' },
            { key: 'production', label: '생산 연결', count: production.data?.length },
            { key: 'reservations', label: '예약', count: detail.reservations.length },
            { key: 'history', label: '이력', count: timeline.data?.length },
          ]}
        />
        <span className="pb-2 text-cap text-ink-3">매수 기준 (슬래브 매 · 코일 개) · 톤은 계산값</span>
      </div>

      {tab === 'fulfillment' ? <FulfillmentTab detail={detail} /> : null}
      {tab === 'production' ? <ProductionLinkTab salesOrderId={detail.id} /> : null}
      {tab === 'reservations' ? <ReservationTab detail={detail} /> : null}
      {tab === 'history' ? <HistoryTab salesOrderId={detail.id} /> : null}
    </>
  );
}

export function SalesOrderDetailScreen() {
  const params = useParams<{ id: string }>();
  const rawId = params?.id ?? '';
  const parsed = /^\d+$/.test(rawId) ? Number(rawId) : null;
  const detail = useSalesOrderDetail(parsed);
  const notFound = parsed === null || (detail.error instanceof ApiError && detail.error.code === 'COM-003');

  return (
    <>
      <SalesOrderMaster currentId={parsed} />
      <PageMain>
        {notFound ? (
          <StateView
            kind="empty"
            title={`수주 ${rawId}를 찾을 수 없어요`}
            actions={
              <ButtonLink size="sm" href="/sales-orders">
                수주 목록으로
              </ButtonLink>
            }
          />
        ) : (
          <QueryBoundary query={detail} loadingLabel="수주를 불러오는 중…">
            {(data) => <DetailBody key={data.id} detail={data} />}
          </QueryBoundary>
        )}
      </PageMain>
    </>
  );
}
