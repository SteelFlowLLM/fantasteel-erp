'use client';

// 그래프에서 고른 LOT의 상세: 기본 정보, 불합격 처리 상태, 배정, 출하·밀시트, 바로 연결된 LOT(LOT 관계), 품질검사.
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import {
  ALLOCATION_PURPOSE_LABEL,
  INSPECTION_RESULT_LABEL,
  LOT_RELATION_EVIDENCE_LABEL,
  LOT_TYPE_LABEL,
  PROCESS_TYPE_LABEL,
  RAW_MATERIAL_TYPE_LABEL,
} from '@/codes';
import type { LotDetailView, LotInspectionView, RelatedLot } from '@/api/lotTrace';
import { Badge } from '@/components/Badge';
import { Button, ButtonLink } from '@/components/Button';
import { Card, CardFoot, CardHead } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { KvList, type KvItem } from '@/components/KvList';
import { QueryBoundary } from '@/components/QueryBoundary';
import { EmptyNote } from '@/components/StateView';
import { Table, Td, Th } from '@/components/Table';
import { Tag } from '@/components/Tag';
import { lotTraceHref } from '@/features/businessEvents/lib/eventTargets';
import {
  InspectionBadge,
  LinkId,
  LotStatusBadge,
  LotTypeIcon,
  PanelSection,
  ShipmentStatusBadge,
  fmtPeriod,
} from '@/features/lotTrace/components/TraceBits';
import type { TraceDirection } from '@/features/lotTrace/lib/traceGraph';
import { DispositionBadge } from '@/features/quality/components/QualityBadges';
import { AllocationStatusBadge } from '@/features/shipment/components/ShipmentBadges';
import { useLotDetail } from '@/hooks/useLotTrace';
import { fmtDate, fmtDateTime, fmtDims, fmtTon } from '@/lib/format';

function RelatedLotRow({ lot, direction }: { lot: RelatedLot; direction: TraceDirection }) {
  return (
    <li className="flex min-w-0 flex-wrap items-center gap-2 text-xs">
      <LinkId href={lotTraceHref(lot.lotNo, direction)}>{lot.lotNo}</LinkId>
      <Tag>{lot.rawMaterialType === 'FERROALLOY' ? RAW_MATERIAL_TYPE_LABEL.FERROALLOY : LOT_TYPE_LABEL[lot.lotType]}</Tag>
      {lot.lotRelationEvidence === 'PERIOD_BASED' ? (
        <span className="text-cap text-ink-3" title="실제 투입량이 아니라 이 기간에 쓰였을 수 있는 원료예요">
          {LOT_RELATION_EVIDENCE_LABEL.PERIOD_BASED} · {fmtPeriod(lot.periodStartedAt, lot.periodEndedAt)}
        </span>
      ) : (
        <span className="text-cap text-ink-3">
          {LOT_RELATION_EVIDENCE_LABEL.ACTUAL_INPUT}
          {lot.inputTon ? ` · ${fmtTon(lot.inputTon)}` : ''}
        </span>
      )}
    </li>
  );
}

function InspectionBlock({ inspection, lotId }: { inspection: LotInspectionView; lotId: number }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="overflow-hidden rounded-sm border border-line">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 border-0 bg-surface-2 px-2.5 py-1.5 text-left text-xs text-ink"
      >
        <Tag>{PROCESS_TYPE_LABEL[inspection.processType]}</Tag>
        <InspectionBadge result={inspection.inspectionResult} />
        {inspection.inspectionStandardCode ? (
          <span className="truncate font-mono text-cap text-ink-3" title="판정에 쓴 검사 기준">
            {inspection.inspectionStandardCode} v{inspection.standardVersion}
          </span>
        ) : null}
        <span className="ml-auto text-cap text-ink-3 tabular-nums">{fmtDateTime(inspection.inspectedAt)}</span>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size="sm" />
      </button>
      {open ? (
        <div className="flex flex-col gap-1.5 pb-1.5">
          <div className="flex items-center gap-2 px-2.5 pt-1.5 text-cap text-ink-3">
            {inspection.inspectorName ? <span>검사자 {inspection.inspectorName}</span> : null}
            <Link href={`/quality/inspections?lot=${lotId}`} className="ml-auto text-run hover:underline">
              검사 입력 화면
            </Link>
          </div>
          {inspection.values.length ? (
            <Table compact className="text-xs">
              <thead>
                <tr>
                  <Th>항목</Th>
                  <Th>기준</Th>
                  <Th align="right">측정값</Th>
                  <Th align="center">판정</Th>
                </tr>
              </thead>
              <tbody>
                {inspection.values.map((v) => (
                  <tr key={v.id} data-risk={v.isPassed === false || undefined}>
                    <Td className="px-2">{v.inspectionItemName}</Td>
                    <Td className="px-2 text-ink-3">
                      {v.minValue ?? '-'} ~ {v.maxValue ?? '-'}
                      {v.unit ? ` ${v.unit}` : ''}
                    </Td>
                    <Td align="right" className="px-2">
                      {v.measuredValue ?? '-'}
                    </Td>
                    <Td align="center" className="px-2">
                      {v.isPassed === null ? '-' : v.isPassed ? <Badge tone="ok">{INSPECTION_RESULT_LABEL.PASS}</Badge> : <Badge tone="danger">{INSPECTION_RESULT_LABEL.FAIL}</Badge>}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <EmptyNote>측정 항목이 없어요</EmptyNote>
          )}
        </div>
      ) : null}
    </div>
  );
}

function LotBody({ lot, direction, onReroot }: { lot: LotDetailView; direction: TraceDirection; onReroot: (lotNo: string) => void }) {
  const isProduct = lot.lotType === 'SLAB' || lot.lotType === 'COIL';
  const rows: KvItem[] = [
    {
      label: '종류',
      value: (
        <span className="inline-flex items-center gap-1.5">
          <LotTypeIcon type={lot.lotType} />
          {lot.item?.rawMaterialType === 'FERROALLOY' ? RAW_MATERIAL_TYPE_LABEL.FERROALLOY : LOT_TYPE_LABEL[lot.lotType]}
        </span>
      ),
    },
  ];
  if (lot.lotType === 'RAW_MATERIAL' && lot.item) {
    rows.push({ label: '원료', value: `${lot.item.itemName} (${lot.item.itemCode})${lot.item.rawMaterialType ? ` · ${RAW_MATERIAL_TYPE_LABEL[lot.item.rawMaterialType]}` : ''}` });
  }
  if (lot.supplierName) rows.push({ label: '공급업체', value: lot.supplierName });
  if (lot.goodsReceiptNo) rows.push({ label: '입고', value: <span className="font-mono text-mono">{lot.goodsReceiptNo}</span> });
  if (lot.blastFurnaceCode) rows.push({ label: '고로', value: <span className="font-mono text-mono">{lot.blastFurnaceCode}</span> });
  if (lot.converterCode) rows.push({ label: '전로', value: <span className="font-mono text-mono">{lot.converterCode}</span> });
  if (lot.steelGrade) rows.push({ label: '강종', value: lot.steelGrade.steelGradeCode });
  if (isProduct && lot.item) {
    rows.push({
      label: '규격',
      value: (
        <>
          <span className="font-mono text-mono">{lot.item.itemCode}</span>
          {lot.item.thicknessMm && lot.item.widthMm && lot.item.lengthMm ? (
            <span className="block text-cap text-ink-3">{fmtDims(lot.item.thicknessMm, lot.item.widthMm, lot.item.lengthMm)} mm</span>
          ) : null}
        </>
      ),
    });
    if (lot.item.theoreticalWeightTon) {
      rows.push({ label: lot.lotType === 'SLAB' ? '1매 이론중량' : '1개 이론중량', value: <span className="tabular-nums">{fmtTon(lot.item.theoreticalWeightTon)}</span> });
    }
  }
  if (lot.initialTon) rows.push({ label: '초기 수량', value: <span className="tabular-nums">{fmtTon(lot.initialTon)}</span> });
  if (lot.remainingTon) rows.push({ label: '잔량', value: <span className="tabular-nums">{fmtTon(lot.remainingTon)}</span> });
  if (lot.heatLot) rows.push({ label: '상위 히트', value: <LinkId href={lotTraceHref(lot.heatLot.lotNo)}>{lot.heatLot.lotNo}</LinkId> });
  if (lot.productionPlan) rows.push({ label: '생산계획', value: <LinkId href={`/production/plans?plan=${lot.productionPlan.id}`}>{lot.productionPlan.productionPlanNo}</LinkId> });
  if (lot.yardName) rows.push({ label: '야드', value: lot.yardName });
  rows.push({ label: lot.lotType === 'RAW_MATERIAL' ? '입고일' : '생산완료일', value: <span className="tabular-nums">{fmtDate(lot.producedDate)}</span> });
  if (lot.consumedAt) rows.push({ label: '투입 소진', value: <span className="tabular-nums">{fmtDateTime(lot.consumedAt)}</span> });
  if (lot.shippedAt) rows.push({ label: '출고', value: <span className="tabular-nums">{fmtDateTime(lot.shippedAt)}</span> });
  if (lot.surplusAt) rows.push({ label: '여재', value: <span className="tabular-nums">{fmtDateTime(lot.surplusAt)}</span> });

  return (
    <>
      <div className="flex min-h-0 flex-col gap-3.5 overflow-auto px-4 py-3">
        <KvList items={rows} />
        {lot.disposition ? (
          <PanelSection title="불합격 상태">
            <KvList
              items={[
                { label: '불합격 상태', value: <DispositionBadge status={lot.disposition.dispositionStatus} /> },
                { label: '사유', value: lot.disposition.dispositionReason ?? '-' },
                { label: '지정 시각', value: <span className="tabular-nums">{fmtDateTime(lot.disposition.dispositionAt)}</span> },
              ]}
            />
          </PanelSection>
        ) : null}
        {lot.allocations.length ? (
          <PanelSection title="배정" meta={`${lot.allocations.length}건`}>
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
              {lot.allocations.map((a) => (
                <li key={a.id} className="flex min-w-0 flex-wrap items-center gap-2 text-xs">
                  <Tag>{ALLOCATION_PURPOSE_LABEL[a.allocationPurpose]}</Tag>
                  <AllocationStatusBadge status={a.allocationStatus} />
                  {a.salesOrder ? (
                    <LinkId href={`/sales-orders/${a.salesOrder.salesOrderId}`}>
                      {a.salesOrder.salesOrderNo} · 품목 {a.salesOrder.lineNo}
                    </LinkId>
                  ) : null}
                  {a.shipmentRequest ? <LinkId href={`/shipment-requests/${a.shipmentRequest.id}`}>{a.shipmentRequest.shipmentRequestNo}</LinkId> : null}
                  {a.productionPlan ? <LinkId href={`/production/plans?plan=${a.productionPlan.id}`}>{a.productionPlan.productionPlanNo}</LinkId> : null}
                  <span className="ml-auto text-cap text-ink-3 tabular-nums">{fmtDateTime(a.confirmedAt)}</span>
                </li>
              ))}
            </ul>
          </PanelSection>
        ) : null}
        {lot.shipments.length ? (
          <PanelSection title="출하·밀시트">
            {lot.shipments.map((s) => (
              <KvList
                key={s.shipmentRequestId}
                items={[
                  {
                    label: '출하요청',
                    value: (
                      <span className="inline-flex items-center gap-2">
                        <LinkId href={`/shipment-requests/${s.shipmentRequestId}`}>{s.shipmentRequestNo}</LinkId>
                        <ShipmentStatusBadge status={s.shipmentRequestStatus} />
                      </span>
                    ),
                  },
                  { label: '출고 일시', value: <span className="tabular-nums">{s.issuedAt ? fmtDateTime(s.issuedAt) : '출고 전'}</span> },
                  { label: '수주', value: s.salesOrder ? <LinkId href={`/sales-orders/${s.salesOrder.salesOrderId}`}>{s.salesOrder.salesOrderNo}</LinkId> : '-' },
                  { label: '고객사', value: s.customerName },
                  {
                    label: '밀시트',
                    value: s.millSheets.length ? (
                      <span className="inline-flex flex-wrap gap-2">
                        {s.millSheets.map((m) => (
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
            ))}
          </PanelSection>
        ) : null}
        {lot.parents.length || lot.children.length ? (
          <PanelSection title="바로 연결된 LOT" meta={`위 ${lot.parents.length} · 아래 ${lot.children.length}`}>
            {lot.parents.length ? (
              <>
                <span className="text-cap text-ink-3">위 (상위)</span>
                <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                  {lot.parents.map((p) => (
                    <RelatedLotRow key={p.relationId} lot={p} direction={direction} />
                  ))}
                </ul>
              </>
            ) : null}
            {lot.children.length ? (
              <>
                <span className="text-cap text-ink-3">아래 (하위)</span>
                <ul className="m-0 flex max-h-[180px] list-none flex-col gap-1.5 overflow-auto p-0">
                  {lot.children.map((c) => (
                    <RelatedLotRow key={c.relationId} lot={c} direction={direction} />
                  ))}
                </ul>
              </>
            ) : null}
          </PanelSection>
        ) : null}
        <PanelSection title="품질검사">
          {lot.inspection ? (
            <InspectionBlock inspection={lot.inspection} lotId={lot.id} />
          ) : (
            <span className="text-cap text-ink-3">
              {lot.lotType === 'RAW_MATERIAL' || lot.lotType === 'HOT_METAL' ? '원료·용선은 검사하지 않아요' : '검사 기록이 아직 없어요'}
            </span>
          )}
        </PanelSection>
      </div>
      <CardFoot className="flex-wrap">
        <ButtonLink size="sm" icon="history" href={`/business-events?lotId=${lot.id}`}>
          이 LOT 작업 로그
        </ButtonLink>
        <Button size="sm" variant="primary" icon="trace" onClick={() => onReroot(lot.lotNo)}>
          이 LOT부터 다시 추적
        </Button>
      </CardFoot>
    </>
  );
}

export function LotDetailPanel({ lotId, direction, onReroot, header }: { lotId: number; direction: TraceDirection; onReroot: (lotNo: string) => void; header?: ReactNode }) {
  const query = useLotDetail(lotId);
  return (
    <Card className="min-h-0 flex-[1_1_auto]">
      <CardHead
        title="LOT 상세"
        actions={
          query.data ? (
            <>
              <InspectionBadge result={query.data.inspectionResult} />
              <LotStatusBadge status={query.data.lotStatus} />
            </>
          ) : null
        }
      />
      {header}
      <div className="px-4 pt-2.5">
        <span className="font-mono text-base font-semibold">{query.data?.lotNo ?? ''}</span>
      </div>
      <QueryBoundary query={query}>{(lot) => <LotBody lot={lot} direction={direction} onReroot={onReroot} />}</QueryBoundary>
    </Card>
  );
}
