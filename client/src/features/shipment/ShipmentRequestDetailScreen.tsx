'use client';
// 출하요청 배정 (REQ-SHP-001, REQ-INV-006, BP-SHP-01, 보고서 1 A-7).
// 등록 직후 배정 대기 품목마다 FIFO 추천이 펼쳐져 있다(SHP-001). [추천대로 모두 확정]으로 한 번에 확정할 수 있다.
// 취소: 출고 확정이면 SHP-003(버튼 숨김). 확정된 배정은 해제되고 예약은 ACTIVE 그대로.
import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { PERMISSION } from '@/codes';
import type { ShipmentRequestDetailView } from '@/api/shipmentRequests';
import { Banner } from '@/components/Banner';
import { Button, ButtonLink } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { KvList } from '@/components/KvList';
import { PageHead, PageMain } from '@/components/Page';
import { QueryBoundary } from '@/components/QueryBoundary';
import { ReadOnlyHint } from '@/components/ReadOnlyHint';
import { StateView } from '@/components/StateView';
import { Steps, type StepItem } from '@/components/Steps';
import { useShellTitle } from '@/features/shell/useShellTitle';
import { AllocationLineCard } from '@/features/shipment/components/AllocationLineCard';
import { MillSheetLink, SalesOrderLink, ShipmentRequestStatusBadge } from '@/features/shipment/components/ShipmentBadges';
import { ShipmentRequestMaster } from '@/features/shipment/components/ShipmentRequestMaster';
import { qtyUnitOf } from '@/features/shipment/lib/shipmentForm';
import { useCanUse } from '@/hooks/usePermission';
import { useCancelShipmentRequest, useConfirmShipmentAllocations, useShipmentRequestDetail } from '@/hooks/useShipmentRequests';
import { fmtDateTime, fmtMDHM, fmtTon } from '@/lib/format';
import { withEulReul } from '@/lib/josa';
import { permissionNeedText } from '@/lib/permissions';

export function ShipmentRequestDetailScreen({ id }: { id: number }) {
  const query = useShipmentRequestDetail(Number.isSafeInteger(id) && id > 0 ? id : null);
  return (
    <>
      <ShipmentRequestMaster selectedId={id} />
      <PageMain>
        {!Number.isSafeInteger(id) || id <= 0 ? (
          <StateView kind="empty" title="출하요청을 찾을 수 없어요" text="왼쪽 목록에서 골라 주세요." />
        ) : (
          <QueryBoundary query={query} loadingLabel="출하요청을 불러오는 중…">
            {(detail) => <DetailBody key={detail.id} detail={detail} />}
          </QueryBoundary>
        )}
      </PageMain>
    </>
  );
}

function stepsOf(detail: ShipmentRequestDetailView): StepItem[] {
  const s = detail.shipmentRequestStatus;
  const allocated = s === 'ALLOCATED' || s === 'ISSUED';
  return [
    { key: 'request', label: '출하요청', state: 'done' },
    { key: 'allocate', label: 'LOT 배정', state: allocated ? 'done' : s === 'REQUESTED' ? 'run' : 'todo' },
    { key: 'issue', label: '출고 확정', state: s === 'ISSUED' ? 'done' : s === 'ALLOCATED' ? 'run' : 'todo' },
    { key: 'mill', label: '밀시트', state: detail.millSheets.length > 0 ? 'done' : 'todo' },
  ];
}

function DetailBody({ detail }: { detail: ShipmentRequestDetailView }) {
  const params = useSearchParams();
  const justCreated = params.get('new') === '1';
  const canEdit = useCanUse(PERMISSION.SHIPMENT_REQUEST_MANAGE);
  const [cancelOpen, setCancelOpen] = useState(false);
  const cancel = useCancelShipmentRequest(() => setCancelOpen(false));
  const confirmAll = useConfirmShipmentAllocations();
  useShellTitle(`${detail.shipmentRequestNo} 배정`, detail.customerName);

  const unit = qtyUnitOf(detail.lines.map((l) => l.itemType));
  const salesOrders = [...new Map(detail.lines.map((l) => [l.salesOrderId, l.salesOrderNo])).entries()];
  const lockTitle = canEdit ? undefined : permissionNeedText([PERMISSION.SHIPMENT_REQUEST_MANAGE]);
  const recommendLines = detail.lines.filter((l) => l.waitingAllocationQty > 0 && l.recommendedLots.length > 0);
  const confirmedQty = detail.lines.reduce((s, l) => s + l.allocations.filter((a) => a.allocationStatus === 'CONFIRMED').length, 0);
  const allDone = detail.lines.every((l) => l.waitingAllocationQty === 0);

  return (
    <>
      <PageHead
        crumb="출하요청 › LOT 배정"
        title={
          <span className="flex items-center gap-2.5">
            <span className="font-mono">{detail.shipmentRequestNo}</span>
            <ShipmentRequestStatusBadge status={detail.shipmentRequestStatus} />
          </span>
        }
        actions={
          <>
            {canEdit ? null : <ReadOnlyHint permissions={[PERMISSION.SHIPMENT_REQUEST_MANAGE]} />}
            {salesOrders[0] ? (
              <ButtonLink href={`/business-events?salesOrderId=${salesOrders[0][0]}`} icon="history" variant="ghost">
                작업 로그
              </ButtonLink>
            ) : null}
            {detail.editable ? (
              <Button variant="danger-outline" disabled={!canEdit} title={lockTitle} onClick={() => setCancelOpen(true)}>
                출하요청 취소
              </Button>
            ) : null}
            {detail.shipmentRequestStatus === 'ALLOCATED' ? (
              <ButtonLink href={`/goods-issues?request=${detail.id}`} variant="primary" icon="truck">
                출고 확정 화면
              </ButtonLink>
            ) : null}
            {detail.shipmentRequestStatus === 'ISSUED' && detail.millSheets[0] ? (
              <ButtonLink href={`/mill-sheets?id=${detail.millSheets[0].id}`} variant="primary" icon="file">
                밀시트 보기
              </ButtonLink>
            ) : null}
          </>
        }
      />
      <div className="-mt-2 flex flex-wrap items-center gap-2 text-sm text-ink-2">
        <span className="font-medium text-ink">{detail.customerName}</span>
        {salesOrders.map(([salesOrderId, salesOrderNo]) => (
          <SalesOrderLink key={salesOrderId} salesOrderId={salesOrderId} salesOrderNo={salesOrderNo} />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-6 rounded-md border border-line bg-surface px-4 py-3 shadow-1">
        <KvList
          columns={3}
          className="flex-1"
          items={[
            { label: '요청', value: `${detail.requesterName ?? '-'} · ${fmtMDHM(detail.createdAt)}` },
            { label: '출하 요청일', value: detail.requestedShipDate },
            { label: '배정 매수', value: `${detail.totalAllocatedQty} / ${detail.totalRequestQty}${unit}` },
            { label: '고객사', value: detail.customerName },
            { label: '이론중량', value: fmtTon(detail.totalWeightTon) },
            { label: '품목', value: `${detail.lines.length}품목` },
          ]}
        />
        <Steps items={stepsOf(detail)} />
      </div>

      {justCreated && detail.shipmentRequestStatus === 'REQUESTED' ? (
        <Banner tone="ok">출하요청을 등록했어요. 아래 FIFO 추천을 확인하고 배정을 확정해 주세요.</Banner>
      ) : null}
      {detail.shipmentRequestStatus === 'REQUESTED' && recommendLines.length > 1 ? (
        <Banner
          tone="run"
          icon="flow"
          actions={
            <Button
              size="sm"
              variant="primary"
              disabled={!canEdit || confirmAll.isPending}
              title={lockTitle}
              onClick={() =>
                confirmAll.mutate({
                  shipmentRequestId: detail.id,
                  lines: recommendLines.map((l) => ({ shipmentRequestItemId: l.shipmentRequestItemId, lotIds: l.recommendedLots.map((lot) => lot.lotId) })),
                })
              }
            >
              추천대로 모두 확정
            </Button>
          }
        >
          {recommendLines.length}개 품목에 FIFO 추천이 있어요. 품목마다 확인하거나 추천대로 한 번에 확정할 수 있어요.
        </Banner>
      ) : null}
      {detail.shipmentRequestStatus === 'ALLOCATED' ? (
        <Banner tone="run">모든 품목의 배정을 확정했어요. 물류가 출고를 확정할 수 있어요. 출고 확정 전까지는 배정을 바꿀 수 있어요.</Banner>
      ) : null}
      {detail.shipmentRequestStatus === 'ISSUED' ? (
        <Banner tone="ok">
          출고 확정 · {detail.issuedEmployeeName ?? '-'} · {fmtDateTime(detail.issuedAt)} · 밀시트{' '}
          {detail.millSheets.map((m, i) => (
            <span key={m.id}>
              {i > 0 ? ', ' : ''}
              <MillSheetLink id={m.id} no={m.millSheetNo} />
            </span>
          ))}
        </Banner>
      ) : null}
      {detail.shipmentRequestStatus === 'CANCELLED' ? (
        <Banner tone="neutral">취소된 출하요청이에요 ({fmtDateTime(detail.cancelledAt)}). 배정은 해제됐고 예약은 그대로라 같은 매수를 다시 요청할 수 있어요.</Banner>
      ) : null}

      {detail.lines.map((line) => (
        <AllocationLineCard key={line.shipmentRequestItemId} shipmentRequestId={detail.id} line={line} editable={detail.editable} canEdit={canEdit} />
      ))}

      <div className="flex items-center gap-3 text-xs text-ink-3">
        <span className="font-medium text-ink-2">{allDone ? `${detail.lines.length}개 품목 모두 배정 확정` : `배정 확정 ${detail.lines.filter((l) => l.waitingAllocationQty === 0).length}/${detail.lines.length} 품목`}</span>
        <span>추천은 저장하지 않고, 확정할 때 작업 로그에 남아요.</span>
      </div>

      {cancelOpen ? (
        <ConfirmDialog
          title="출하요청 취소"
          confirmLabel="출하요청 취소"
          cancelLabel="닫기"
          tone="danger"
          pending={cancel.isPending}
          onCancel={() => setCancelOpen(false)}
          onConfirm={() => cancel.mutate({ shipmentRequestId: detail.id, expectedUpdatedAt: detail.updatedAt })}
        >
          <p className="text-sm">
            <b className="font-mono">{withEulReul(detail.shipmentRequestNo)}</b> 취소할까요? 확정된 배정(LOT {confirmedQty}
            {unit})은 모두 해제되고, 수주 예약은 그대로 남아요. 출고 확정 뒤에는 취소할 수 없어요.
          </p>
        </ConfirmDialog>
      ) : null}
    </>
  );
}
