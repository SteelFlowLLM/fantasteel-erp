// 그래프에서 고른 노드의 상세 패널: LOT 상세(GET /lots/:id) + 추적 응답의 수주·출하 연결.
import { useState } from 'react';
import { Link } from 'react-router';
import { LOT_EVIDENCE_TYPE_LABEL, LOT_TYPE_LABEL, PROCESS_CODE_LABEL, type ProcessCode } from '@fantasteel/shared';
import type { LotDetail, LotInspectionDetail, LotTraceNode, LotTraceShipment, TraceDirection } from '@/api/lots';
import { Badge, EmptyNote, QueryBoundary } from '@/components/ui';
import { fmtDate, fmtDateTime, fmtDims, fmtTon } from '@/lib/format';
import { useLotDetail } from './traceHooks';
import type { ShipGroup } from './traceLayout';
import { InspectionBadge, LotLinkId, LotStatusBadge, LotTypeIcon, fmtPeriod, traceHref } from './traceUi';

const LINK_TYPE_LABEL = { PRODUCED_FOR: '생산 수주', ALLOCATED: '배정', SHIPPED: '출고' } as const;

const processLabel = (code: string) => PROCESS_CODE_LABEL[code as ProcessCode] ?? code;

function KV({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="hl-kv" style={{ rowGap: 8 }}>
      {rows.map(([k, v]) => [<dt key={`t${k}`}>{k}</dt>, <dd key={`d${k}`} style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{v}</dd>])}
    </dl>
  );
}

function Section({ title, children, meta }: { title: string; children: React.ReactNode; meta?: React.ReactNode }) {
  return (
    <section className="lt-sec">
      <div className="lt-sec__head"><b>{title}</b>{meta ? <span className="hl-cap" style={{ marginLeft: 'auto' }}>{meta}</span> : null}</div>
      {children}
    </section>
  );
}

function ShipmentBlock({ s }: { s: LotTraceShipment }) {
  return (
    <KV rows={[
      ['출고번호', <span className="mono">{s.goodsIssueNo}</span>],
      ['출고일시', <span className="tnum">{fmtDateTime(s.issuedAt)}</span>],
      ['출하요청', <Link className="hl-link-id" to={`/shipment-requests/${s.shipmentRequestId}`}>{s.shipmentRequestNo}</Link>],
      ['수주', <><Link className="hl-link-id" to={`/sales-orders/${s.salesOrderId}`}>{s.salesOrderNo}</Link> <span className="hl-muted">품목 {s.lineNo}</span></>],
      ['고객사', s.customerName],
      ['밀시트', s.millSheetIds.length ? (
        <span className="hl-row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {s.millSheetIds.map((id, i) => <Link key={id} className="hl-link-id" to={`/mill-sheets?id=${id}`}>{s.millSheetNos[i] ?? `#${id}`}</Link>)}
        </span>
      ) : <span className="hl-muted">발행 전</span>],
    ]} />
  );
}

function InspectionBlock({ q, open, onToggle }: { q: LotInspectionDetail; open: boolean; onToggle: () => void }) {
  return (
    <div className="lt-insp">
      <button type="button" className="lt-insp__head" aria-expanded={open} onClick={onToggle}>
        <span className="mono">{q.qualityInspectionNo}</span>
        <span className="hl-tag">{processLabel(q.processCode)}</span>
        <InspectionBadge result={q.result} label={q.resultLabel} />
        <span className="hl-cap" style={{ marginLeft: 'auto' }}>{fmtDateTime(q.inspectedAt)}</span>
        <i className={`ic ic-chevron-${open ? 'up' : 'down'} ic--sm`} aria-hidden="true" />
      </button>
      {open ? (
        <div style={{ padding: '0 0 6px' }}>
          {q.inspectorName || q.memo ? <div className="hl-cap" style={{ padding: '6px 10px' }}>{q.inspectorName ? `검사자 ${q.inspectorName}` : ''}{q.inspectorName && q.memo ? ' · ' : ''}{q.memo ?? ''}</div> : null}
          {q.values.length ? (
            <table className="hl-table hl-table--compact lt-vtable">
              <thead><tr><th>항목</th><th>기준</th><th className="num">측정값</th><th className="ctr">판정</th></tr></thead>
              <tbody>
                {q.values.map((v) => (
                  <tr key={v.inspectionItemCode} className={v.isPassed === false ? 'is-risk' : undefined}>
                    <td>{v.inspectionItemName}</td>
                    <td className="hl-muted">{v.minValue ?? '-'} ~ {v.maxValue ?? '-'}{v.unit ? ` ${v.unit}` : ''}</td>
                    <td className="num">{v.measuredValue ?? '-'}</td>
                    <td className="ctr">{v.isPassed === null ? '-' : v.isPassed ? <Badge tone="ok">합격</Badge> : <Badge tone="danger">불합격</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <EmptyNote>측정 항목이 없어요</EmptyNote>}
        </div>
      ) : null}
    </div>
  );
}

function LotBody({ lot, node, direction, onReroot }: { lot: LotDetail; node: LotTraceNode | null; direction: TraceDirection; onReroot: (lotNo: string) => void }) {
  const [openInsp, setOpenInsp] = useState(0);
  const isProduct = lot.lotType === 'SLAB' || lot.lotType === 'COIL';
  const rows: [string, React.ReactNode][] = [['종류', <span className="hl-row" style={{ gap: 6 }}><LotTypeIcon type={lot.lotType} />{LOT_TYPE_LABEL[lot.lotType]}</span>]];
  if (lot.rawMaterial) rows.push(['원료', `${lot.rawMaterial.materialName} (${lot.rawMaterial.materialCode}) · ${lot.rawMaterial.rawMaterialTypeLabel}`]);
  if (lot.supplier) rows.push(['공급사', lot.supplier.supplierName]);
  if (lot.blastFurnaceNo) rows.push(['고로', `${lot.blastFurnaceNo}고로`]);
  if (lot.converterNo) rows.push(['전로', `${lot.converterNo}전로`]);
  if (lot.steelGrade) rows.push(['강종', `${lot.steelGrade.steelGradeCode} · ${lot.steelGrade.steelGradeName}`]);
  if (lot.productSpec) {
    const p = lot.productSpec;
    rows.push(['규격', <><span className="mono">{p.specCode}</span><br /><span className="hl-muted">{fmtDims(p.thicknessMm, p.widthMm, p.lengthMm)} mm</span></>]);
  }
  if (lot.weightTon) rows.push([lot.lotType === 'SLAB' ? '1매 이론중량' : '1개 이론중량', <span className="tnum">{fmtTon(lot.weightTon)}</span>]);
  if (lot.initialTon) rows.push(['초기 수량', <span className="tnum">{fmtTon(lot.initialTon)}</span>]);
  if (lot.remainingTon) rows.push(['잔량', <span className="tnum">{fmtTon(lot.remainingTon)}</span>]);
  if (lot.heat) rows.push(['상위 히트', <LotLinkId lotNo={lot.heat.lotNo} />]);
  if (lot.yard) rows.push(['야드', lot.yard.yardName]);
  rows.push(['생산완료', <span className="tnum">{fmtDateTime(lot.producedAt)}</span>]);
  if (lot.consumedAt) rows.push(['소진·출고', <span className="tnum">{fmtDateTime(lot.consumedAt)}</span>]);
  if (isProduct) rows.push(['예약·배정', lot.isSurplus ? <Badge tone="wait">여재</Badge> : lot.isEligible ? <Badge tone="ok">가능</Badge> : <Badge tone="neutral">불가</Badge>]);

  const orderLinks = node?.salesOrderLinks ?? [];
  // 배정 응답에는 수주 id가 없어서, 같은 품목의 수주 연결에서 id를 찾는다
  const allocItemId = lot.allocation?.salesOrderItemId ?? null;
  const allocSoId = allocItemId === null ? null
    : orderLinks.find((l) => l.salesOrderItemId === allocItemId)?.salesOrderId ?? (lot.salesOrderItem?.salesOrderItemId === allocItemId ? lot.salesOrderItem.salesOrderId : null);
  const link = (l: LotDetail['parents'][number]) => (
    <li key={`${l.lotId}-${l.relationType}`} className="lt-rel">
      <LotLinkId lotNo={l.lotNo} direction={direction} />
      <span className="hl-tag">{LOT_TYPE_LABEL[l.lotType]}</span>
      {l.evidenceType === 'PERIOD'
        ? <span className="hl-cap" title="실제 투입량이 아니라 이 기간에 쓰였을 수 있는 원료예요">기간 기반 · {fmtPeriod(l.periodStart, l.periodEnd)}</span>
        : <span className="hl-cap">{LOT_EVIDENCE_TYPE_LABEL[l.evidenceType]}{l.inputTon ? ` · ${fmtTon(l.inputTon)}` : ''}</span>}
    </li>
  );

  return (
    <>
      <div className="hl-card__body" style={{ padding: '12px 16px', gap: 14, overflow: 'auto' }}>
        <KV rows={rows} />
        {lot.disposition ? (
          <Section title="불합격 처리">
            <KV rows={[
              ['처리 상태', <Badge tone="danger">{lot.disposition.statusLabel}</Badge>],
              ['사유', lot.disposition.reason ?? '-'],
              ['처리 시각', <span className="tnum">{fmtDateTime(lot.disposition.at)}</span>],
            ]} />
          </Section>
        ) : null}
        {lot.allocation ? (
          <Section title="현재 배정" meta={fmtDateTime(lot.allocation.confirmedAt)}>
            <KV rows={[
              ['용도', lot.allocation.purposeLabel],
              ...(lot.allocation.salesOrderNo
                ? [['수주', allocSoId !== null
                  ? <Link className="hl-link-id" to={`/sales-orders/${allocSoId}`}>{lot.allocation.salesOrderNo} · 품목 {lot.allocation.lineNo}</Link>
                  : <span className="mono">{lot.allocation.salesOrderNo} · 품목 {lot.allocation.lineNo}</span>] as [string, React.ReactNode]]
                : []),
              ...(lot.allocation.productionPlanNo ? [['생산계획', <Link className="hl-link-id" to={`/production/plans?plan=${lot.allocation.productionPlanId}`}>{lot.allocation.productionPlanNo}</Link>] as [string, React.ReactNode]] : []),
              ...(lot.allocation.shipmentRequestNo ? [['출하요청', <Link className="hl-link-id" to={`/shipment-requests/${lot.allocation.shipmentRequestId}`}>{lot.allocation.shipmentRequestNo}</Link>] as [string, React.ReactNode]] : []),
            ]} />
          </Section>
        ) : null}
        {lot.salesOrderItem || orderLinks.length ? (
          <Section title="연결된 수주 품목">
            <ul className="lt-list">
              {lot.salesOrderItem && !orderLinks.some((l) => l.salesOrderItemId === lot.salesOrderItem!.salesOrderItemId && l.linkType === 'PRODUCED_FOR') ? (
                <li className="lt-rel">
                  <Link className="hl-link-id" to={`/sales-orders/${lot.salesOrderItem.salesOrderId}`}>{lot.salesOrderItem.salesOrderNo} · 품목 {lot.salesOrderItem.lineNo}</Link>
                  <span className="hl-tag">{LINK_TYPE_LABEL.PRODUCED_FOR}</span>
                  <span className="hl-cap">{lot.salesOrderItem.customerName} · 납기 {fmtDate(lot.salesOrderItem.dueDate)}</span>
                </li>
              ) : null}
              {orderLinks.map((l) => (
                <li key={`${l.salesOrderItemId}-${l.linkType}`} className="lt-rel">
                  <Link className="hl-link-id" to={`/sales-orders/${l.salesOrderId}`}>{l.salesOrderNo} · 품목 {l.lineNo}</Link>
                  <span className="hl-tag">{LINK_TYPE_LABEL[l.linkType]}</span>
                  <span className="hl-cap">{l.customerName} · 납기 {fmtDate(l.dueDate)}</span>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}
        {node?.shipment ? <Section title="출하·밀시트"><ShipmentBlock s={node.shipment} /></Section> : null}
        {lot.parents.length || lot.children.length ? (
          <Section title="바로 연결된 LOT" meta={`위 ${lot.parents.length} · 아래 ${lot.children.length}`}>
            {lot.parents.length ? <><div className="hl-cap">위 (상위)</div><ul className="lt-list">{lot.parents.map(link)}</ul></> : null}
            {lot.children.length ? <><div className="hl-cap">아래 (하위)</div><ul className="lt-list lt-list--scroll">{lot.children.map(link)}</ul></> : null}
          </Section>
        ) : null}
        <Section title="검사" meta={lot.inspections.length ? `${lot.inspections.length}건` : undefined}>
          {lot.inspections.length ? lot.inspections.map((q, i) => (
            <InspectionBlock key={q.qualityInspectionId} q={q} open={openInsp === i} onToggle={() => setOpenInsp(openInsp === i ? -1 : i)} />
          )) : <div className="hl-cap">{lot.lotType === 'RAW_MATERIAL' || lot.lotType === 'HOT_METAL' ? '원료·용선은 검사하지 않아요' : '검사 기록이 아직 없어요'}</div>}
        </Section>
      </div>
      <div className="hl-card__foot" style={{ flexWrap: 'wrap' }}>
        <Link className="hl-btn hl-btn--sm" to={`/business-events?lot=${encodeURIComponent(lot.lotNo)}`}><i className="ic ic-history" />이 LOT 작업 로그</Link>
        <button type="button" className="hl-btn hl-btn--sm hl-btn--primary" onClick={() => onReroot(lot.lotNo)}><i className="ic ic-trace" />이 LOT부터 다시 추적</button>
      </div>
    </>
  );
}

export function LotDetailPanel({ lotId, node, direction, onReroot }: { lotId: number; node: LotTraceNode | null; direction: TraceDirection; onReroot: (lotNo: string) => void }) {
  const q = useLotDetail(lotId);
  return (
    <section className="hl-card lt-panel" aria-label="LOT 상세">
      <header className="hl-card__head">
        <h2>LOT 상세</h2>
        <div className="hl-card__actions">
          {q.data ? <><InspectionBadge result={q.data.inspectionResult} label={q.data.inspectionResultLabel} /><LotStatusBadge status={q.data.lotStatus} label={q.data.lotStatusLabel} /></> : null}
        </div>
      </header>
      <div className="lt-panel__id"><span className="mono" style={{ fontWeight: 600, fontSize: 14 }}>{node?.lotNo ?? q.data?.lotNo ?? ''}</span><span className="hl-cap lt-ell">{node?.title ?? q.data?.title}</span></div>
      <QueryBoundary query={q}>{(lot) => <LotBody lot={lot} node={node} direction={direction} onReroot={onReroot} />}</QueryBoundary>
    </section>
  );
}

export function ShipPanel({ ship, onSelectLot }: { ship: ShipGroup; onSelectLot: (lotId: number) => void }) {
  return (
    <section className="hl-card lt-panel" aria-label="출하 상세">
      <header className="hl-card__head">
        <h2>출하 상세</h2>
        <div className="hl-card__actions"><Badge tone="run">출고 확정</Badge></div>
      </header>
      <div className="hl-card__body" style={{ padding: '12px 16px', gap: 14, overflow: 'auto' }}>
        <ShipmentBlock s={ship} />
        <Section title="이 출고에 실린 LOT" meta={`${ship.lotNos.length}개`}>
          <ul className="lt-list lt-list--scroll">
            {ship.lotIds.map((id, i) => (
              <li key={id} className="lt-rel">
                <button type="button" className="hl-link-id lt-linkbtn" onClick={() => onSelectLot(id)}>{ship.lotNos[i]}</button>
                <Link className="hl-cap" to={traceHref(ship.lotNos[i], 'backward')}>역추적</Link>
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </section>
  );
}
