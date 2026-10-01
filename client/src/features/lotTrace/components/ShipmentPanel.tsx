'use client';

// 그래프에서 고른 출하요청: 고객사·수주·출고 일시·밀시트와 이 출하요청에 실린 LOT.
import type { TraceLotNode, TraceShipment } from '@/api/lotTrace';
import { Card, CardHead } from '@/components/Card';
import { KvList } from '@/components/KvList';
import { EmptyNote } from '@/components/StateView';
import { lotTraceHref } from '@/features/businessEvents/lib/eventTargets';
import { LinkId, PanelSection, ShipmentStatusBadge } from '@/features/lotTrace/components/TraceBits';
import { fmtDate, fmtDateTime } from '@/lib/format';

export function ShipmentSummary({ shipment }: { shipment: TraceShipment }) {
  return (
    <KvList
      items={[
        { label: '출하요청', value: <LinkId href={`/shipment-requests/${shipment.shipmentRequestId}`}>{shipment.shipmentRequestNo}</LinkId> },
        { label: '고객사', value: shipment.customerName },
        {
          label: '수주',
          value: shipment.salesOrders.length ? (
            <span className="inline-flex flex-wrap gap-2">
              {shipment.salesOrders.map((so) => (
                <LinkId key={so.salesOrderId} href={`/sales-orders/${so.salesOrderId}`}>
                  {so.salesOrderNo}
                </LinkId>
              ))}
            </span>
          ) : (
            '-'
          ),
        },
        { label: '출하 요청일', value: <span className="tabular-nums">{fmtDate(shipment.requestedShipDate)}</span> },
        { label: '출고 일시', value: <span className="tabular-nums">{shipment.issuedAt ? fmtDateTime(shipment.issuedAt) : '출고 전'}</span> },
        {
          label: '밀시트',
          value: shipment.millSheets.length ? (
            <span className="inline-flex flex-wrap gap-2">
              {shipment.millSheets.map((m) => (
                <LinkId key={m.id} href={`/mill-sheets?id=${m.id}`}>
                  {m.millSheetNo}
                </LinkId>
              ))}
            </span>
          ) : (
            <span className="text-ink-3">발행 전</span>
          ),
        },
      ]}
    />
  );
}

export function ShipmentPanel({ shipment, nodes, onSelectLot }: { shipment: TraceShipment; nodes: readonly TraceLotNode[]; onSelectLot: (lotId: number) => void }) {
  const lots = shipment.lotIds.map((id) => nodes.find((n) => n.id === id)).filter((n): n is TraceLotNode => n !== undefined);
  return (
    <Card className="min-h-0 flex-[1_1_auto]">
      <CardHead title="출하요청 상세" actions={<ShipmentStatusBadge status={shipment.shipmentRequestStatus} />} />
      <div className="flex min-h-0 flex-col gap-3.5 overflow-auto px-4 py-3">
        <ShipmentSummary shipment={shipment} />
        <PanelSection title="이 출하요청에 배정된 LOT" meta={`${lots.length}개`}>
          {lots.length ? (
            <ul className="m-0 flex max-h-[220px] list-none flex-col gap-1.5 overflow-auto p-0">
              {lots.map((lot) => (
                <li key={lot.id} className="flex items-center gap-2 text-xs">
                  <button type="button" className="border-0 bg-transparent p-0 font-mono text-mono text-run hover:underline" onClick={() => onSelectLot(lot.id)}>
                    {lot.lotNo}
                  </button>
                  <LinkId href={lotTraceHref(lot.lotNo, 'backward')} className="ml-auto font-sans text-cap">
                    역추적
                  </LinkId>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyNote>배정된 LOT이 없어요</EmptyNote>
          )}
        </PanelSection>
      </div>
    </Card>
  );
}
