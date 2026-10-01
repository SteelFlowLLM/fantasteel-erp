// 정추적 영향 요약 (TRM-073 "불합격 영향 범위 확인"): 하위 슬래브·코일 수, 출고된·출고 전 제품, 출하요청, 수주.
import { LOT_STATUS_LABEL, LOT_TYPE_LABEL } from '@/codes';
import type { LotTraceView, TraceImpact } from '@/api/lotTrace';
import { Badge } from '@/components/Badge';
import { Card, CardHead } from '@/components/Card';
import { EmptyNote } from '@/components/StateView';
import { LinkId, PanelSection, ShipmentStatusBadge } from '@/features/lotTrace/components/TraceBits';
import { cn } from '@/lib/cn';
import { fmtDate, fmtInt } from '@/lib/format';

function Stat({ label, value, danger }: { label: string; value: number; danger?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-sm border border-line bg-surface-2 px-2 py-1.5">
      <span className="text-cap text-ink-3">{label}</span>
      <b className={cn('text-lg leading-[22px] font-semibold tabular-nums', danger && value > 0 && 'text-danger')}>{fmtInt(value)}</b>
    </div>
  );
}

export function ImpactSummary({ impact, shipments }: { impact: TraceImpact; shipments: LotTraceView['shipments'] }) {
  return (
    <Card className="max-h-[360px] flex-none">
      <CardHead title="영향 요약" meta="이 LOT에서 이어진 하위 LOT·출하요청·수주" />
      <div className="flex min-h-0 flex-col gap-3 overflow-auto px-4 py-3">
        <div className="grid grid-cols-4 gap-1.5">
          <Stat label={LOT_TYPE_LABEL.SLAB} value={impact.slabCount} />
          <Stat label={LOT_TYPE_LABEL.COIL} value={impact.coilCount} />
          <Stat label="출고된 제품" value={impact.shippedLotCount} danger />
          <Stat label="출고 전 제품" value={impact.unshippedLotCount} />
        </div>
        {impact.consumedLotCount > 0 ? (
          <p className="m-0 text-cap text-ink-3">
            {LOT_STATUS_LABEL.CONSUMED} {fmtInt(impact.consumedLotCount)}개는 다음 공정 LOT에 들어가 출고 전 제품에서 뺐어요
          </p>
        ) : null}
        <PanelSection title="출하요청" meta={`${shipments.length}건`}>
          {shipments.length ? (
            <ul className="m-0 flex max-h-[160px] list-none flex-col gap-1.5 overflow-auto p-0">
              {shipments.map((s) => (
                <li key={s.shipmentRequestId} className="flex flex-wrap items-center gap-2 rounded-sm border border-line px-2 py-1.5 text-[12.5px]">
                  <LinkId href={`/shipment-requests/${s.shipmentRequestId}`}>{s.shipmentRequestNo}</LinkId>
                  <ShipmentStatusBadge status={s.shipmentRequestStatus} />
                  <span>{s.customerName}</span>
                  <span className="ml-auto text-cap text-ink-3">LOT {s.lotIds.length}</span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyNote>영향받은 출하요청이 없어요</EmptyNote>
          )}
        </PanelSection>
        <PanelSection title="수주" meta={`${impact.salesOrders.length}건`}>
          {impact.salesOrders.length ? (
            <ul className="m-0 flex max-h-[160px] list-none flex-col gap-1.5 overflow-auto p-0">
              {impact.salesOrders.map((so) => (
                <li key={so.salesOrderId} className="flex flex-col gap-0.5 rounded-sm border border-line px-2 py-1.5 text-[12.5px]">
                  <div className="flex items-center gap-2">
                    <LinkId href={`/sales-orders/${so.salesOrderId}`}>{so.salesOrderNo}</LinkId>
                    <span>{so.customerName}</span>
                    <span className="ml-auto">{so.hasShipped ? <Badge tone="danger">출고됨</Badge> : <Badge>출고 전</Badge>}</span>
                  </div>
                  <span className="text-cap text-ink-3">
                    납기 {fmtDate(so.dueDate)} · 영향 LOT {so.lotCount}개
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyNote>영향받은 수주가 없어요</EmptyNote>
          )}
        </PanelSection>
      </div>
    </Card>
  );
}
