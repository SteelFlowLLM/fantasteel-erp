'use client';

// LOT 관계 그래프: 열(공정 순서) + 노드 카드 + 연결선(SVG). 배치는 lib/traceLayout.ts. 옛 TraceGraph를 옮겼다.
// 실선 = 실제 투입, 점선 = 기간 기반(그 기간에 쓰였을 수 있는 원료), 파란 선 = 출하요청 배정.
import { useLayoutEffect, useMemo, useRef } from 'react';
import { LOT_TYPE_LABEL, LOT_RELATION_EVIDENCE_LABEL } from '@/codes';
import type { LotTraceView, TraceLotNode } from '@/api/lotTrace';
import { Icon } from '@/components/Icon';
import { Tag } from '@/components/Tag';
import { InspectionBadge, LotStatusBadge, LotTypeIcon, ShipmentStatusBadge, fmtPeriod } from '@/features/lotTrace/components/TraceBits';
import { HEAD_H, NODE_H, NODE_W, isAlloyNode, layoutTrace, type GraphEdge } from '@/features/lotTrace/lib/traceLayout';
import { cn } from '@/lib/cn';
import { fmtDate, fmtNum, fmtTon } from '@/lib/format';

/** 'lot:12' | 'ship:3' */
export type TraceSelection = string | null;

function nodeLines(node: TraceLotNode): [string, string] {
  switch (node.lotType) {
    case 'RAW_MATERIAL':
    case 'HOT_METAL':
      return [
        node.lotType === 'RAW_MATERIAL' ? (node.itemName ?? '') : (node.blastFurnaceCode ?? ''),
        `잔량 ${fmtNum(node.remainingTon, 3)} / ${fmtTon(node.initialTon)}`,
      ];
    case 'HEAT':
      return [[node.converterCode, node.steelGradeCode].filter(Boolean).join(' · '), fmtTon(node.initialTon)];
    default:
      return [[node.steelGradeCode, node.itemCode].filter(Boolean).join(' · '), `이론중량 ${fmtTon(node.theoreticalWeightTon)}`];
  }
}

function edgePath(e: GraphEdge): string {
  const dx = Math.max(24, (e.x2 - e.x1) / 2);
  return `M${e.x1},${e.y1} C${e.x1 + dx},${e.y1} ${e.x2 - dx},${e.y2} ${e.x2},${e.y2}`;
}

function edgeTitle(e: GraphEdge): string {
  if (!e.relation) return '출하요청 배정';
  const r = e.relation;
  const parts = [LOT_RELATION_EVIDENCE_LABEL[r.lotRelationEvidence]];
  if (r.lotRelationEvidence === 'PERIOD_BASED') parts.push(`${fmtPeriod(r.periodStartedAt, r.periodEndedAt, true)} 사이 사용 가능성 (실제 투입량이 아니에요)`);
  if (r.inputTon) parts.push(`투입 ${fmtTon(r.inputTon)}`);
  return parts.join(' · ');
}

const NODE_BASE =
  'absolute m-0 flex flex-col justify-between gap-0.5 overflow-hidden rounded-md border bg-surface px-2.5 py-[7px] text-left text-ink shadow-1 hover:border-brand';

export function TraceGraph({ trace, selected, onSelect }: { trace: Pick<LotTraceView, 'nodes' | 'edges' | 'shipments'>; selected: TraceSelection; onSelect: (key: string) => void }) {
  const layout = useMemo(() => layoutTrace(trace), [trace]);
  const canvasRef = useRef<HTMLDivElement>(null);
  const startKey = layout.nodes.find((n) => n.lot?.isStart)?.key ?? null;

  // 시작 LOT이 화면 밖이면 가운데로 가로 스크롤 (역추적은 시작 LOT이 맨 오른쪽)
  useLayoutEffect(() => {
    const box = canvasRef.current?.parentElement;
    const start = canvasRef.current?.querySelector<HTMLElement>('[data-start="true"]');
    if (!box || !start) return;
    const b = box.getBoundingClientRect();
    const r = start.getBoundingClientRect();
    const left = b.left + box.clientLeft;
    const right = left + box.clientWidth;
    if (r.left >= left && r.right <= right) return;
    box.scrollLeft += (r.left + r.right) / 2 - (left + right) / 2;
  }, [startKey, layout.width]);

  return (
    <div ref={canvasRef} className="relative flex-none" style={{ width: layout.width, height: layout.height }}>
      {layout.heads.map((h) => (
        <div key={h.column} className="absolute top-0 flex items-baseline gap-1.5 text-xs" style={{ left: h.x, width: NODE_W, height: HEAD_H - 8 }}>
          <b className="text-[12.5px] font-semibold">{h.title}</b>
          <span className="text-cap text-ink-3">{h.count}</span>
        </div>
      ))}
      <svg className="pointer-events-none absolute top-0 left-0 overflow-visible" width={layout.width} height={layout.height} aria-hidden="true">
        {layout.edges.map((e) => {
          const on = selected !== null && (e.from === selected || e.to === selected);
          const off = selected !== null && !on;
          return (
            <path
              key={e.key}
              d={edgePath(e)}
              className={cn(
                'fill-none [pointer-events:stroke]',
                e.relation ? 'stroke-[#8593a3]' : 'stroke-run',
                e.relation?.lotRelationEvidence === 'PERIOD_BASED' && '[stroke-dasharray:5_4]',
                on ? 'stroke-brand opacity-100' : off ? 'opacity-15' : 'opacity-75',
              )}
              strokeWidth={on ? 2.2 : 1.4}
            >
              <title>{edgeTitle(e)}</title>
            </path>
          );
        })}
      </svg>
      {layout.periodLabels.map((p) => (
        <div
          key={p.key}
          className="absolute z-[2] flex flex-col gap-px rounded-xs border border-dashed border-[#6e829a] bg-surface px-1.5 py-1 text-2xs text-ink-2"
          style={{ left: p.x, top: p.y, width: p.w }}
          title="원료가 이 기간에 용선에 쓰였을 수 있다는 뜻이에요. 실제 투입량이 아니에요"
        >
          <b className="font-semibold text-brand">{LOT_RELATION_EVIDENCE_LABEL.PERIOD_BASED}</b>
          <span className="tabular-nums">{fmtPeriod(p.periodStartedAt, p.periodEndedAt)}</span>
        </div>
      ))}
      {layout.edgeLabels.map((l) => (
        <div
          key={l.key}
          className="pointer-events-none absolute z-[2] flex -translate-x-1/2 -translate-y-1/2 flex-col items-center rounded-[9px] bg-surface px-1.5 py-px text-[10px] leading-[13px] whitespace-nowrap text-ink-2 shadow-[inset_0_0_0_1px_var(--color-line-strong)]"
          style={{ left: l.x, top: l.y }}
        >
          <span>{LOT_RELATION_EVIDENCE_LABEL.ACTUAL_INPUT}</span>
          {l.inputTon ? <span className="tabular-nums">{fmtTon(l.inputTon)}</span> : null}
        </div>
      ))}
      {layout.nodes.map((n) => {
        const on = selected === n.key;
        const style = { left: n.x, top: n.y, width: NODE_W, height: NODE_H };
        if (n.shipment) {
          const s = n.shipment;
          return (
            <button
              key={n.key}
              type="button"
              aria-pressed={on}
              onClick={() => onSelect(n.key)}
              style={style}
              className={cn(NODE_BASE, on ? 'border-run bg-[#f6f9ff] shadow-[0_0_0_2px_var(--color-run)]' : 'border-line')}
            >
              <span className="flex min-w-0 items-center gap-1.5 text-cap font-semibold text-ink-2">
                <Icon name="truck" size="sm" />
                출하요청
                <span className="ml-auto">
                  <ShipmentStatusBadge status={s.shipmentRequestStatus} />
                </span>
              </span>
              <span className="truncate font-mono text-mono font-semibold">{s.shipmentRequestNo}</span>
              <span className="truncate text-cap text-ink-3">{s.customerName}</span>
              <span className="truncate text-cap text-ink-3">
                {s.salesOrders.map((so) => so.salesOrderNo).join(', ')} · LOT {s.lotIds.length}
                {s.issuedAt ? ` · ${fmtDate(s.issuedAt)}` : ''}
                {s.millSheets.length ? ` · 밀시트 ${s.millSheets.length}` : ''}
              </span>
            </button>
          );
        }
        const lot = n.lot;
        if (!lot) return null;
        const [line1, line2] = nodeLines(lot);
        return (
          <button
            key={n.key}
            type="button"
            aria-pressed={on}
            data-start={lot.isStart ? 'true' : undefined}
            onClick={() => onSelect(n.key)}
            style={style}
            className={cn(
              NODE_BASE,
              lot.inspectionResult === 'FAIL' ? 'border-[#e3a7a2]' : lot.isStart ? 'border-brand' : 'border-line',
              on && 'border-run bg-[#f6f9ff] shadow-[0_0_0_2px_var(--color-run)]',
            )}
          >
            <span className={cn('flex min-w-0 items-center gap-1.5 text-cap font-semibold text-ink-2', lot.isStart && 'pr-8')}>
              <LotTypeIcon type={lot.lotType} />
              <span className="truncate">{isAlloyNode(lot) ? '합금철' : LOT_TYPE_LABEL[lot.lotType]}</span>
              {lot.inspectionResult ? (
                <span className="ml-auto">
                  <InspectionBadge result={lot.inspectionResult} />
                </span>
              ) : null}
            </span>
            <span className="truncate font-mono text-mono font-semibold" title={lot.lotNo}>
              {lot.lotNo}
            </span>
            <span className="truncate text-cap text-ink-3" title={line1}>
              {line1 || '-'}
            </span>
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-cap text-ink-3" title={line2}>
                {line2}
              </span>
              <span className="ml-auto flex-none">
                <LotStatusBadge status={lot.lotStatus} />
              </span>
            </span>
            {lot.isStart ? (
              <Tag size="sm" tone="brand" className="absolute top-0 right-0 rounded-none rounded-bl-md bg-brand text-on-brand">
                시작
              </Tag>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
