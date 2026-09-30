// 출하요청 배정 (REQ-INV-006, REQ-SHP-001). v1 B안 24번: 왼쪽 출하요청 목록 | 오른쪽 품목별 FIFO 추천·배정 확정.
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { shipmentRequestApi, type ShipmentRequestView } from '@/api/shipments';
import { Icon, QueryBoundary, StateView } from '@/components/ui';
import { AllocationItemCard } from '@/features/shipment/AllocationItemCard';
import { ShipmentRequestMaster } from '@/features/shipment/ShipmentRequestMaster';
import { InfoStrip, OrderLinks, ReasonModal, ShipmentStatusBadge, ShipmentSteps, requestOrders, shipDateLabel, unitOf } from '@/features/shipment/shipmentUi';
import { useAction } from '@/hooks/useApi';
import { fmtInt, fmtMDHM, fmtTon } from '@/lib/format';
import { useShellTitle } from '@/shell/shellTitle';
import { canUse, useMe } from '@/stores/auth';

export function ShipmentRequestDetailPage() {
  const me = useMe();
  const id = Number(useParams().id);
  const valid = Number.isInteger(id) && id > 0;
  const canAllocate = canUse(me, 'SHIPMENT_REQUEST');
  const detail = useQuery({ queryKey: ['shipment-requests', 'detail', id], queryFn: () => shipmentRequestApi.get(id), enabled: valid });
  useShellTitle(detail.data ? `${detail.data.shipmentRequestNo} 배정` : '출하요청 배정', detail.data?.customer.customerName);

  return (
    <>
      <ShipmentRequestMaster activeId={valid ? id : null} canRequest={canAllocate} />
      <main className="hl-main">
        {valid ? (
          <QueryBoundary query={detail}>{(r) => <Detail key={r.id} r={r} canAllocate={canAllocate} />}</QueryBoundary>
        ) : (
          <StateView kind="empty" title="출하요청을 찾을 수 없어요" text="왼쪽 목록에서 골라 주세요" />
        )}
      </main>
    </>
  );
}

function Detail({ r, canAllocate }: { r: ShipmentRequestView; canAllocate: boolean }) {
  const [cancelling, setCancelling] = useState(false);
  const status = r.shipmentRequestStatus;
  /** 출고 확정·취소 전 */
  const editable = status === 'REQUESTED' || status === 'ALLOCATED';
  const unit = unitOf(r.items);
  const doneItems = r.items.filter((it) => it.shipmentRequestItemStatus !== 'WAITING_ALLOCATION').length;
  const allAllocated = r.items.length > 0 && doneItems === r.items.length;
  const orders = requestOrders(r);

  const cancel = useAction(shipmentRequestApi.cancel, {
    success: (x) => `출하요청 ${x.shipmentRequestNo}을(를) 취소했어요`,
    invalidate: ['shipment-requests', 'allocations', 'lots', 'inventories', 'sales-orders'],
    onSuccess: () => setCancelling(false),
  });

  const next = status === 'ISSUED' && r.millSheets.length ? (
    <Link className="hl-btn hl-btn--primary" to={`/mill-sheets?id=${r.millSheets[0].id}`}><Icon name="file" />밀시트 보기</Link>
  ) : status === 'ALLOCATED' ? (
    <Link className="hl-btn hl-btn--primary" to={`/goods-issues?request=${r.id}`}><Icon name="truck" />출고 확정 화면</Link>
  ) : null;

  return (
    <>
      <div className="hl-page-head">
        <div>
          <div className="hl-crumb">
            <Link to="/shipment-requests">출하요청</Link>
            <Icon name="chevron-right" size="sm" />
            {r.shipmentRequestNo} 배정
          </div>
          <div className="hl-row" style={{ gap: 10 }}>
            <h1 className="hl-title"><span className="mono" style={{ fontSize: 19 }}>{r.shipmentRequestNo}</span> 배정</h1>
            <ShipmentStatusBadge status={status} />
            <span className="hl-cap">{r.customer.customerName} · <OrderLinks request={r} /></span>
          </div>
        </div>
        <div className="hl-page-head__actions">
          {orders[0] ? <Link className="hl-btn" to={`/business-events?salesOrderId=${orders[0].id}`}><Icon name="history" />작업 로그</Link> : null}
          {editable ? (
            <button type="button" className="hl-btn hl-btn--danger-outline" disabled={!canAllocate || cancel.isPending} title={canAllocate ? undefined : '권한이 필요해요'} onClick={() => setCancelling(true)}>
              <Icon name={canAllocate ? 'x' : 'lock'} />출하요청 취소
            </button>
          ) : null}
          {next}
        </div>
      </div>

      <InfoStrip cells={[
        { label: '요청', value: `${r.requester?.employeeName ?? '-'} · ${fmtMDHM(r.createdAt)}` },
        { label: '고객사', value: r.customer.customerName },
        { label: '출하 요청일', value: <span className="tnum">{shipDateLabel(r.requestedShipDate)}</span> },
        { label: '배정 매수', value: <span className="tnum">{fmtInt(r.allocatedQty)} / {fmtInt(r.requestQty)}{unit}</span> },
        { label: '이론중량', value: <span className="tnum">{fmtTon(r.requestTon)}</span> },
        { label: '진행', value: <ShipmentSteps status={status} />, grow: true },
      ]} />

      {r.memo ? (
        <div className="hl-banner" style={{ flex: 'none' }}>
          <Icon name="note" />
          <div><b>메모</b> · {r.memo}</div>
        </div>
      ) : null}

      {status === 'ALLOCATED' ? (
        <div className="hl-banner hl-banner--ok" style={{ flex: 'none' }}>
          <Icon name="check-circle" />
          <div style={{ flex: 1 }}>모든 품목의 배정이 확정됐어요. 이제 <b>물류가 출고를 확정</b>할 수 있어요 (물류 담당에게 "출고 대기" 알림이 갔어요).</div>
          <Link className="hl-btn hl-btn--sm" to={`/goods-issues?request=${r.id}`}>출고 확정 화면 열기<Icon name="arrow-right" /></Link>
        </div>
      ) : null}
      {status === 'ISSUED' && r.goodsIssue ? (
        <div className="hl-banner hl-banner--ok" style={{ flex: 'none' }}>
          <Icon name="truck" />
          <div style={{ flex: 1 }}>
            출고 <b className="mono">{r.goodsIssue.goodsIssueNo}</b> 확정 · {r.goodsIssue.confirmedEmployee?.employeeName ?? '-'} · {fmtMDHM(r.goodsIssue.confirmedAt)}
            {r.millSheets.length ? <> · 밀시트 {r.millSheets.map((m, i) => <span key={m.id}>{i ? ', ' : ''}<Link className="hl-link-id" to={`/mill-sheets?id=${m.id}`}>{m.millSheetNo}</Link></span>)}</> : null}
          </div>
          <Link className="hl-btn hl-btn--sm" to={`/goods-issues?request=${r.id}`}>출고 내역</Link>
        </div>
      ) : null}
      {status === 'CANCELLED' ? (
        <div className="hl-banner" style={{ flex: 'none' }}>
          <Icon name="x-circle" />
          <div>취소된 출하요청이에요{r.cancelledAt ? ` (${fmtMDHM(r.cancelledAt)})` : ''}. 확정됐던 배정은 모두 해제됐고, 예약은 그대로라 같은 매수를 다시 요청할 수 있어요.</div>
        </div>
      ) : null}

      {r.items.map((it) => <AllocationItemCard key={it.id} item={it} editable={editable} canAllocate={canAllocate} />)}

      <div className="hl-row" style={{ gap: 12, marginTop: 'auto', padding: '10px 16px', background: '#FFFFFF', border: '1px solid #DDE2E7', borderRadius: 6, flex: 'none', flexWrap: 'wrap' }}>
        <Icon name={allAllocated ? 'check-circle' : 'clock'} style={{ color: allAllocated ? 'var(--ok)' : 'var(--ink-3)' }} />
        <span style={{ fontSize: 13 }}>
          <b>{allAllocated ? `${r.items.length}개 품목 모두 배정 확정` : `배정 확정 ${doneItems}/${r.items.length} 품목`}</b> · {fmtInt(r.allocatedQty)} / {fmtInt(r.requestQty)}{unit} · {fmtTon(r.requestTon)}
        </span>
        <span className="hl-cap">추천은 저장하지 않고, 확정할 때 작업 로그에 남아요.</span>
        {editable && !canAllocate ? <span className="hl-lockhint" style={{ marginLeft: 'auto' }}><Icon name="lock" size="sm" />배정 확정·변경은 영업 담당만 할 수 있어요</span> : (
          <span className="hl-cap" style={{ marginLeft: 'auto' }}>
            {status === 'REQUESTED' ? '품목별로 [FIFO 추천]을 확인하고 [배정 확정]해 주세요'
              : status === 'ALLOCATED' ? '출고 확정 전까지 배정 변경·해제 가능'
              : status === 'ISSUED' ? `출고 완료 ${fmtMDHM(r.goodsIssue?.confirmedAt)}` : '취소된 요청'}
          </span>
        )}
      </div>

      {cancelling ? (
        <ReasonModal
          title="출하요청 취소"
          confirmLabel="출하요청 취소"
          danger
          pending={cancel.isPending}
          onClose={() => setCancelling(false)}
          onConfirm={(reason) => cancel.mutate({ id: r.id, reason })}
        >
          <span className="mono">{r.shipmentRequestNo}</span>을(를) 취소할까요? 확정된 배정 {r.allocatedQty}건은 모두 해제돼요. 예약은 그대로라 같은 매수를 다시 요청할 수 있어요.
        </ReasonModal>
      ) : null}
    </>
  );
}
