// LOT 계보 그래프: 열(공정 순서) + 노드 카드 + 연결선(SVG). 배치는 traceLayout.ts.
import { useLayoutEffect, useMemo, useRef } from 'react';
import type { LotTraceResponse } from '@/api/lots';
import { Icon } from '@/components/ui';
import { fmtDate, fmtNum, fmtTon } from '@/lib/format';
import { InspectionBadge, LotStatusBadge, LotTypeIcon, fmtPeriod } from './traceUi';
import { HEAD_H, NODE_H, NODE_W, layoutTrace, isAlloy, type GEdge, type GNode } from './traceLayout';

export type TraceSelection = string | null; // 'lot:12' | 'ship:3'

function lotMeta(n: NonNullable<GNode['lot']>): [string, string] {
  switch (n.lotType) {
    case 'RAW_MATERIAL':
      return [n.rawMaterialName ?? n.title, `잔량 ${fmtNum(n.remainingTon, 3)} / ${fmtTon(n.initialTon)}`];
    case 'HOT_METAL':
      return [n.blastFurnaceNo ? `${n.blastFurnaceNo}고로` : n.title, `잔량 ${fmtNum(n.remainingTon, 3)} / ${fmtTon(n.initialTon)}`];
    case 'HEAT':
      return [`${n.converterNo ? `${n.converterNo}전로 · ` : ''}${n.steelGradeCode ?? ''}`, fmtTon(n.initialTon)];
    default:
      return [[n.steelGradeCode, n.productSpecCode].filter(Boolean).join(' · ') || n.title, `이론중량 ${fmtTon(n.weightTon)}`];
  }
}

function edgePath(e: GEdge): string {
  const dx = Math.max(24, (e.x2 - e.x1) / 2);
  return `M${e.x1},${e.y1} C${e.x1 + dx},${e.y1} ${e.x2 - dx},${e.y2} ${e.x2},${e.y2}`;
}

function edgeTitle(e: GEdge): string {
  if (!e.edge) return '출고 연결';
  const x = e.edge;
  const parts = [x.evidenceLabel];
  if (x.isPeriodBased) parts.push(`${fmtPeriod(x.periodStart, x.periodEnd, true)} 사이 사용 가능성 (실제 투입량이 아니에요)`);
  if (x.inputTon) parts.push(`투입 ${fmtTon(x.inputTon)}`);
  return parts.join(' · ');
}

export function TraceGraph({ trace, selected, onSelect }: { trace: LotTraceResponse; selected: TraceSelection; onSelect: (key: string) => void }) {
  const L = useMemo(() => layoutTrace(trace), [trace]);
  const canvasRef = useRef<HTMLDivElement>(null);
  // 고른 LOT(시작 노드)이 화면 밖이면 가운데로 가로 스크롤 (역추적은 시작 노드가 맨 오른쪽). LOT·방향이 바뀔 때만
  useLayoutEffect(() => {
    const box = canvasRef.current?.parentElement;
    const start = canvasRef.current?.querySelector<HTMLElement>('.is-focus');
    if (!box || !start) return;
    const b = box.getBoundingClientRect();
    const r = start.getBoundingClientRect();
    const left = b.left + box.clientLeft;
    const right = left + box.clientWidth;
    if (r.left >= left && r.right <= right) return;
    box.scrollLeft += (r.left + r.right) / 2 - (left + right) / 2;
  }, [trace.rootId, trace.direction]);
  return (
    <div ref={canvasRef} className="lt-canvas" style={{ width: L.width, height: L.height }}>
      {L.heads.map((h) => (
        <div key={h.col} className="lt-colhead" style={{ left: h.x, width: NODE_W, height: HEAD_H - 8 }}>
          <b>{h.title}</b>
          <span className="hl-cap">{h.count}</span>
        </div>
      ))}
      <svg className="lt-svg" width={L.width} height={L.height} aria-hidden="true">
        {L.edges.map((e) => {
          const on = selected !== null && (e.from === selected || e.to === selected);
          const cls = ['lt-edge', e.edge?.isPeriodBased ? 'lt-edge--period' : '', e.edge ? '' : 'lt-edge--ship', on ? 'is-on' : selected ? 'is-off' : ''].filter(Boolean).join(' ');
          return (
            <path key={e.key} d={edgePath(e)} className={cls}>
              <title>{edgeTitle(e)}</title>
            </path>
          );
        })}
      </svg>
      {L.periodLabels.map((p) => (
        <div key={p.key} className="lt-period" style={{ left: p.x, top: p.y, width: p.w }} title="원료가 이 기간에 용선에 쓰였을 수 있다는 뜻이에요. 실제 투입량이 아니에요">
          <b>기간 기반</b>
          <span className="tnum">{fmtPeriod(p.periodStart, p.periodEnd)}</span>
        </div>
      ))}
      {L.edgeLabels.map((l) => (
        <div key={l.key} className="lt-elabel" style={{ left: l.x, top: l.y }}>
          <span>{l.text}</span>
          {l.sub ? <span className="tnum">{fmtTon(l.sub)}</span> : null}
        </div>
      ))}
      {L.nodes.map((n) => {
        const on = selected === n.key;
        const style = { left: n.x, top: n.y, width: NODE_W, height: NODE_H };
        if (n.ship) {
          const s = n.ship;
          return (
            <button key={n.key} type="button" className={`hl-node lt-node${on ? ' is-selected' : ''}`} style={style} aria-pressed={on} onClick={() => onSelect(n.key)}>
              <span className="hl-node__type"><Icon name="truck" size="sm" />출하{s.millSheetNos.length ? <span className="hl-tag" style={{ marginLeft: 'auto' }}>밀시트 {s.millSheetNos.length}</span> : null}</span>
              <span className="hl-node__id lt-ell">{s.goodsIssueNo}</span>
              <span className="hl-node__meta lt-ell">{s.customerName}</span>
              <span className="hl-node__meta lt-ell">{s.salesOrderNo} · LOT {s.lotIds.length} · {fmtDate(s.issuedAt)}</span>
            </button>
          );
        }
        const lot = n.lot!;
        const [m1, m2] = lotMeta(lot);
        const cls = ['hl-node', 'lt-node', lot.isRoot ? 'is-focus' : '', lot.inspectionResult === 'FAIL' ? 'is-danger' : '', on ? 'is-selected' : ''].filter(Boolean).join(' ');
        return (
          <button key={n.key} type="button" className={cls} style={style} aria-pressed={on} onClick={() => onSelect(n.key)}>
            <span className="hl-node__type">
              <LotTypeIcon type={lot.lotType} />
              <span className="lt-ell">{isAlloy(lot) ? '합금철' : lot.lotTypeLabel}</span>
              {lot.inspectionResult ? <span style={{ marginLeft: 'auto' }}><InspectionBadge result={lot.inspectionResult} label={lot.inspectionResultLabel} /></span> : null}
            </span>
            <span className="hl-node__id lt-ell" title={lot.lotNo}>{lot.lotNo}</span>
            <span className="hl-node__meta lt-ell" title={m1}>{m1}</span>
            <span className="hl-row lt-node__foot">
              <span className="hl-node__meta lt-ell" title={m2}>{m2}</span>
              <span style={{ marginLeft: 'auto', flex: 'none' }}><LotStatusBadge status={lot.lotStatus} label={lot.lotStatusLabel} /></span>
            </span>
            {lot.isRoot ? <span className="lt-root-tag">시작</span> : null}
          </button>
        );
      })}
    </div>
  );
}
