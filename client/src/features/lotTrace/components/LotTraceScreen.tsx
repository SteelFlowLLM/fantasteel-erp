'use client';

// LOT 추적 (REQ-LOT-005, BP-LOT-01): 코일 → 원료 역추적 / 원료·히트 → 출하요청·수주 정추적. 조회 전용.
// 주소: /lots/trace?lot=<LOT 번호>&direction=backward|forward  또는  /lots/trace?shipmentRequestNo=<출하요청 번호>
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { LOT_RELATION_EVIDENCE_LABEL, LOT_TYPE_LABEL } from '@/codes';
import { ApiError } from '@/api/client';
import type { LotTraceInput, LotTraceView } from '@/api/lotTrace';
import { Button, ButtonLink } from '@/components/Button';
import { Card, CardFoot, CardHead } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { PageHead, PageMain } from '@/components/Page';
import { QueryBoundary } from '@/components/QueryBoundary';
import { EmptyNote, StateView } from '@/components/StateView';
import { Tag } from '@/components/Tag';
import { ImpactSummary } from '@/features/lotTrace/components/ImpactSummary';
import { LotDetailPanel } from '@/features/lotTrace/components/LotDetailPanel';
import { ShipmentPanel, ShipmentSummary } from '@/features/lotTrace/components/ShipmentPanel';
import { InspectionBadge, LotStatusBadge, ShipmentStatusBadge } from '@/features/lotTrace/components/TraceBits';
import { TraceGraph, type TraceSelection } from '@/features/lotTrace/components/TraceGraph';
import { TraceSearchPane } from '@/features/lotTrace/components/TraceSearchPane';
import { TRACE_DIRECTION_LABEL, isTraceDirection, type TraceDirection } from '@/features/lotTrace/lib/traceGraph';
import { isAlloyNode, layoutTrace, lotKey, shipKey } from '@/features/lotTrace/lib/traceLayout';
import { useShellTitle } from '@/features/shell/useShellTitle';
import { useLotTrace } from '@/hooks/useLotTrace';
import { fmtInt } from '@/lib/format';

export function LotTraceScreen() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const lotNo = params.get('lot')?.trim() ?? '';
  const shipmentRequestNo = params.get('shipmentRequestNo')?.trim() ?? '';
  const directionParam = params.get('direction');
  const requestedDirection = isTraceDirection(directionParam) ? directionParam : undefined;

  const input: LotTraceInput | null = useMemo(
    () => (lotNo ? { lotNo, direction: requestedDirection } : shipmentRequestNo ? { shipmentRequestNo } : null),
    [lotNo, shipmentRequestNo, requestedDirection],
  );
  const trace = useLotTrace(input);
  const direction: TraceDirection = trace.data?.direction ?? requestedDirection ?? 'backward';

  useShellTitle(lotNo || shipmentRequestNo || 'LOT 추적', input ? TRACE_DIRECTION_LABEL[direction] : undefined);

  const go = (next: Record<string, string>) => router.push(`${pathname}?${new URLSearchParams(next).toString()}`);
  const pickLot = (no: string) => go({ lot: no });
  const pickShipmentRequest = (no: string) => go({ shipmentRequestNo: no });
  const setDirection = (d: TraceDirection) => {
    if (lotNo) go({ lot: lotNo, direction: d });
  };

  const notFound = trace.error instanceof ApiError && trace.error.code === 'COM-003';

  return (
    <>
      <TraceSearchPane
        activeLotNo={lotNo}
        activeShipmentRequestNo={shipmentRequestNo}
        direction={direction}
        canChangeDirection={!!lotNo && !!trace.data}
        onPickLot={pickLot}
        onPickShipmentRequest={pickShipmentRequest}
        onDirection={setDirection}
      />
      <PageMain className="gap-3.5">
        {!input ? (
          <StateView
            kind="empty"
            icon="trace"
            title="추적할 LOT을 골라 주세요"
            text="왼쪽에서 LOT 번호나 출하요청 번호를 검색하거나 최근 LOT을 눌러 보세요. 코일·슬래브는 어디서 왔는지(역추적), 원료·히트는 어디로 갔는지(정추적)를 보여줘요."
          />
        ) : notFound ? (
          <StateView
            kind="error"
            title={lotNo ? `'${lotNo}'에 맞는 LOT이 없어요` : `'${shipmentRequestNo}'에 맞는 출하요청이 없어요`}
            text={trace.error instanceof ApiError ? [trace.error.message, trace.error.detail].filter(Boolean).join(' · ') : undefined}
            code="COM-003"
            actions={
              <Button size="sm" onClick={() => router.push(pathname)}>
                조건 지우기
              </Button>
            }
          />
        ) : (
          <QueryBoundary query={trace} loadingLabel="LOT 관계를 불러오는 중…">
            {(data) => <TraceBody key={`${data.start.kind}-${lotNo}-${shipmentRequestNo}-${data.direction}`} trace={data} onReroot={pickLot} />}
          </QueryBoundary>
        )}
      </PageMain>
    </>
  );
}

function TraceHead({ trace }: { trace: LotTraceView }) {
  const start = trace.start;
  const crumb = (
    <>
      <Link href="/dashboard" className="text-ink-3 hover:underline">
        대시보드
      </Link>
      <Icon name="chevron-right" size="sm" />
      LOT 추적
      <Icon name="chevron-right" size="sm" />
      {TRACE_DIRECTION_LABEL[trace.direction]}
    </>
  );
  if (start.kind === 'SHIPMENT_REQUEST') {
    const s = start.shipment;
    return (
      <PageHead
        crumb={crumb}
        title={
          <span className="flex flex-wrap items-center gap-2.5">
            <span className="font-mono">{s.shipmentRequestNo}</span>
            <Tag>출하요청</Tag>
            <ShipmentStatusBadge status={s.shipmentRequestStatus} />
            <span className="text-xs font-normal text-ink-3">
              {s.customerName} · 배정 LOT {s.lotIds.length}개
            </span>
          </span>
        }
        actions={
          <ButtonLink icon="truck" href={`/shipment-requests/${s.shipmentRequestId}`}>
            출하요청 상세
          </ButtonLink>
        }
      />
    );
  }
  return (
    <PageHead
      crumb={crumb}
      title={
        <span className="flex flex-wrap items-center gap-2.5">
          <span className="font-mono">{start.lotNo}</span>
          <Tag>{LOT_TYPE_LABEL[start.lotType]}</Tag>
          <LotStatusBadge status={start.lotStatus} />
          <InspectionBadge result={start.inspectionResult} />
          {start.summary ? <span className="text-xs font-normal text-ink-3">{start.summary}</span> : null}
        </span>
      }
      actions={
        <ButtonLink icon="history" href={`/business-events?lotId=${start.lotId}`}>
          작업 로그
        </ButtonLink>
      }
    />
  );
}

function TraceBody({ trace, onReroot }: { trace: LotTraceView; onReroot: (lotNo: string) => void }) {
  const defaultKey = trace.start.kind === 'LOT' ? lotKey(trace.start.lotId) : shipKey(trace.start.shipment.shipmentRequestId);
  const [selected, setSelected] = useState<TraceSelection>(null);
  const activeKey = selected ?? defaultKey;
  const activeLotId = activeKey.startsWith('lot:') ? Number(activeKey.slice(4)) : null;
  const activeShipment = activeKey.startsWith('ship:') ? trace.shipments.find((s) => shipKey(s.shipmentRequestId) === activeKey) : undefined;
  const heads = useMemo(() => layoutTrace(trace).heads, [trace]);
  const hasAlloy = trace.nodes.some(isAlloyNode);
  const isEmptyShipment = trace.start.kind === 'SHIPMENT_REQUEST' && trace.nodes.length === 0;

  return (
    <>
      <TraceHead trace={trace} />
      {isEmptyShipment && trace.start.kind === 'SHIPMENT_REQUEST' ? (
        <Card>
          <CardHead title="출하요청" />
          <div className="flex flex-col gap-3 px-4 py-3">
            <ShipmentSummary shipment={trace.start.shipment} />
            <EmptyNote>이 출하요청에는 아직 배정된 LOT이 없어요</EmptyNote>
          </div>
        </Card>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_372px] gap-3.5 max-[1180px]:grid-cols-1">
          <Card className="min-h-[420px]">
            <CardHead
              title={`${TRACE_DIRECTION_LABEL[trace.direction]} · LOT 관계`}
              meta={`${heads.map((h) => `${h.title} ${fmtInt(h.count)}`).join(' · ')} · 연결 ${fmtInt(trace.edges.length)}`}
            />
            <div className="min-h-0 flex-1 overflow-auto px-4 pt-3 pb-4">
              <TraceGraph trace={trace} selected={selected} onSelect={(key) => setSelected(key === selected ? null : key)} />
            </div>
            <CardFoot className="flex-wrap gap-3 text-xs">
              <span className="text-cap text-ink-3">범례</span>
              <span className="inline-flex items-center gap-1.5">
                <svg width="26" height="6" aria-hidden="true">
                  <line x1="0" y1="3" x2="26" y2="3" className="stroke-brand" strokeWidth={2} />
                </svg>
                {LOT_RELATION_EVIDENCE_LABEL.ACTUAL_INPUT}
                {hasAlloy ? ' (합금철 포함)' : ''}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <svg width="26" height="6" aria-hidden="true">
                  <line x1="0" y1="3" x2="26" y2="3" className="stroke-[#6e829a] [stroke-dasharray:5_4]" strokeWidth={1.6} />
                </svg>
                {LOT_RELATION_EVIDENCE_LABEL.PERIOD_BASED} (그 기간에 쓰였을 수 있는 원료 · 실제 투입량 아님)
              </span>
              {trace.shipments.length ? (
                <span className="inline-flex items-center gap-1.5">
                  <svg width="26" height="6" aria-hidden="true">
                    <line x1="0" y1="3" x2="26" y2="3" className="stroke-run" strokeWidth={1.6} />
                  </svg>
                  출하요청 배정
                </span>
              ) : null}
              <span className="ml-auto text-cap text-ink-3">왼쪽 → 오른쪽 = 생산 흐름 · 노드를 누르면 상세가 열려요</span>
            </CardFoot>
          </Card>
          <div className="flex min-h-0 min-w-0 flex-col gap-3.5 overflow-auto max-[1180px]:overflow-visible">
            {trace.impact ? <ImpactSummary impact={trace.impact} shipments={trace.shipments} /> : null}
            {activeShipment ? (
              <ShipmentPanel shipment={activeShipment} nodes={trace.nodes} onSelectLot={(id) => setSelected(lotKey(id))} />
            ) : activeLotId !== null ? (
              <LotDetailPanel key={activeLotId} lotId={activeLotId} direction={trace.direction} onReroot={onReroot} />
            ) : null}
          </div>
        </div>
      )}
    </>
  );
}
