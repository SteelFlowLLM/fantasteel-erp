// LOT 추적 그래프 배치 (순수 함수). 열 = 공정 순서(원료 → 용선·합금철 → 히트 → 슬래브 → 코일 → 출하요청), 선 = LOT 관계.
// 노드가 가장 많은 열을 기준으로 세우고, 나머지 열은 이미 놓인 이웃의 평균 높이에 맞춰 쌓는다 (히트 1개 ↔ 슬래브 여러 매도 읽히게).
// 옛 traceLayout.ts를 옮겼다. 합금철은 히트에 직접 들어가므로 용선 열에 둔다(BP-LOT-01).
import type { LotTraceView, TraceLotNode, TraceRelationEdge, TraceShipment } from '@/api/lotTrace';

export type ColumnKey = 'RAW' | 'HM' | 'HEAT' | 'SLAB' | 'COIL' | 'SHIP';
export const COLUMN_ORDER: readonly ColumnKey[] = ['RAW', 'HM', 'HEAT', 'SLAB', 'COIL', 'SHIP'];

export const NODE_W = 204;
export const NODE_H = 96;
export const HEAD_H = 40;
const ROW_GAP = 10;
const PAD_X = 8;
const PAD_BOTTOM = 12;
const GAP = 84;
const PERIOD_GAP = 176;
const LABEL_GAP = 112;
const MAX_EDGE_LABELS = 16;

export const lotKey = (id: number) => `lot:${id}`;
export const shipKey = (id: number) => `ship:${id}`;

export interface GraphNode {
  key: string;
  column: ColumnKey;
  lot?: TraceLotNode;
  shipment?: TraceShipment;
  x: number;
  y: number;
}

export interface GraphEdge {
  key: string;
  from: string;
  to: string;
  /** 출하요청 연결선은 없음 */
  relation?: TraceRelationEdge;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface PeriodLabel {
  key: string;
  x: number;
  y: number;
  w: number;
  periodStartedAt: string | null;
  periodEndedAt: string | null;
}

export interface EdgeLabel {
  key: string;
  x: number;
  y: number;
  inputTon: string | null;
}

export interface ColumnHead {
  column: ColumnKey;
  x: number;
  title: string;
  count: number;
}

export interface TraceLayout {
  nodes: GraphNode[];
  edges: GraphEdge[];
  periodLabels: PeriodLabel[];
  edgeLabels: EdgeLabel[];
  heads: ColumnHead[];
  width: number;
  height: number;
}

export const isAlloyNode = (node: TraceLotNode) => node.lotType === 'RAW_MATERIAL' && node.rawMaterialType === 'FERROALLOY';

const LOT_COLUMN = { RAW_MATERIAL: 'RAW', HOT_METAL: 'HM', HEAT: 'HEAT', SLAB: 'SLAB', COIL: 'COIL' } as const;
const columnOf = (node: TraceLotNode): ColumnKey => (isAlloyNode(node) ? 'HM' : LOT_COLUMN[node.lotType]);

function columnTitle(column: ColumnKey, nodes: readonly GraphNode[]): string {
  if (column === 'HM') {
    const hasHotMetal = nodes.some((n) => n.lot?.lotType === 'HOT_METAL');
    const hasAlloy = nodes.some((n) => n.lot && isAlloyNode(n.lot));
    return hasHotMetal && hasAlloy ? '용선 · 합금철' : hasAlloy ? '합금철' : '용선';
  }
  return { RAW: '원료', HEAT: '히트', SLAB: '슬래브', COIL: '코일', SHIP: '출하요청' }[column];
}

/** 용선 → 히트, 합금철 → 히트 (실제 투입량 표지를 다는 선) */
const isInputToHeat = (edge: GraphEdge, byKey: Map<string, GraphNode>) => {
  const from = byKey.get(edge.from)?.lot;
  const to = byKey.get(edge.to)?.lot;
  return !!edge.relation && to?.lotType === 'HEAT' && (from?.lotType === 'HOT_METAL' || (from !== undefined && isAlloyNode(from)));
};

export function layoutTrace(trace: Pick<LotTraceView, 'nodes' | 'edges' | 'shipments'>): TraceLayout {
  const byKey = new Map<string, GraphNode>();
  const sequence: GraphNode[] = [];
  for (const lot of trace.nodes) {
    const node: GraphNode = { key: lotKey(lot.id), column: columnOf(lot), lot, x: 0, y: 0 };
    byKey.set(node.key, node);
    sequence.push(node);
  }
  const raw: Omit<GraphEdge, 'x1' | 'y1' | 'x2' | 'y2'>[] = [];
  for (const relation of trace.edges) {
    const from = lotKey(relation.parentLotId);
    const to = lotKey(relation.childLotId);
    if (byKey.has(from) && byKey.has(to)) raw.push({ key: `r:${relation.id}`, from, to, relation });
  }
  for (const shipment of trace.shipments) {
    const node: GraphNode = { key: shipKey(shipment.shipmentRequestId), column: 'SHIP', shipment, x: 0, y: 0 };
    byKey.set(node.key, node);
    sequence.push(node);
    for (const lotId of shipment.lotIds) {
      if (byKey.has(lotKey(lotId))) raw.push({ key: `s:${lotId}:${shipment.shipmentRequestId}`, from: lotKey(lotId), to: node.key });
    }
  }

  const columns = COLUMN_ORDER.filter((c) => sequence.some((n) => n.column === c));
  const columnNodes = new Map<ColumnKey, GraphNode[]>(columns.map((c) => [c, sequence.filter((n) => n.column === c)]));
  const parents = new Map<string, string[]>();
  const children = new Map<string, string[]>();
  for (const edge of raw) {
    children.set(edge.from, [...(children.get(edge.from) ?? []), edge.to]);
    parents.set(edge.to, [...(parents.get(edge.to) ?? []), edge.from]);
  }

  // 높이: 노드가 가장 많은 열을 기준으로, 나머지 열은 이웃 평균에 맞춰 바깥쪽으로 쌓는다
  const placed = new Set<string>();
  const centerY = (key: string) => (byKey.get(key)?.y ?? 0) + NODE_H / 2;
  const meanOf = (keys: readonly string[] | undefined): number | null => {
    const ys = (keys ?? []).filter((k) => placed.has(k)).map(centerY);
    return ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length - NODE_H / 2 : null;
  };
  const stack = (list: readonly GraphNode[], desiredOf: (n: GraphNode) => number | null) => {
    const withDesired = list.map((n, i) => ({ n, i, d: desiredOf(n) }));
    const known = withDesired.filter((x) => x.d !== null).sort((a, b) => (a.d ?? 0) - (b.d ?? 0) || a.i - b.i);
    const unknown = withDesired.filter((x) => x.d === null);
    let bottom = -Infinity;
    for (const x of [...known, ...unknown]) {
      const want = x.d === null ? bottom + ROW_GAP : x.d;
      x.n.y = Math.max(want, bottom + ROW_GAP);
      bottom = x.n.y + NODE_H;
      placed.add(x.n.key);
    }
  };
  let anchor = 0;
  columns.forEach((c, i) => {
    if ((columnNodes.get(c)?.length ?? 0) > (columnNodes.get(columns[anchor] ?? c)?.length ?? 0)) anchor = i;
  });
  const anchorColumn = columns[anchor];
  (anchorColumn ? (columnNodes.get(anchorColumn) ?? []) : []).forEach((n, i) => {
    n.y = i * (NODE_H + ROW_GAP);
    placed.add(n.key);
  });
  for (let i = anchor - 1; i >= 0; i -= 1) {
    const column = columns[i];
    if (column) stack(columnNodes.get(column) ?? [], (n) => meanOf(children.get(n.key)));
  }
  for (let i = anchor + 1; i < columns.length; i += 1) {
    const column = columns[i];
    if (column) stack(columnNodes.get(column) ?? [], (n) => meanOf(parents.get(n.key)));
  }
  const minY = sequence.length ? Math.min(...sequence.map((n) => n.y)) : 0;
  for (const n of sequence) n.y = n.y - minY + HEAD_H;

  // 가로: 원료 → 용선 사이는 '기간 기반' 표지, 용선 → 히트 사이는 '실제 투입' 표지 자리를 넓힌다
  const preliminary: GraphEdge[] = raw.map((e) => ({ ...e, x1: 0, y1: 0, x2: 0, y2: 0 }));
  const hasPeriod = raw.some((e) => e.relation?.lotRelationEvidence === 'PERIOD_BASED');
  const inputEdges = preliminary.filter((e) => isInputToHeat(e, byKey));
  const showInputLabels = inputEdges.length > 0 && inputEdges.length <= MAX_EDGE_LABELS;
  const columnX = new Map<ColumnKey, number>();
  let x = PAD_X;
  columns.forEach((c, i) => {
    columnX.set(c, x);
    const next = columns[i + 1];
    const gap = c === 'RAW' && next === 'HM' && hasPeriod ? PERIOD_GAP : c === 'HM' && next === 'HEAT' && showInputLabels ? LABEL_GAP : GAP;
    x += NODE_W + gap;
  });
  const width = columns.length ? x - GAP + PAD_X : 0;
  for (const n of sequence) n.x = columnX.get(n.column) ?? 0;
  const height = sequence.length ? Math.max(...sequence.map((n) => n.y + NODE_H)) + PAD_BOTTOM : 0;

  const edges: GraphEdge[] = raw.map((e) => {
    const a = byKey.get(e.from);
    const b = byKey.get(e.to);
    return { ...e, x1: (a?.x ?? 0) + NODE_W, y1: (a?.y ?? 0) + NODE_H / 2, x2: b?.x ?? 0, y2: (b?.y ?? 0) + NODE_H / 2 };
  });

  const periodLabels: PeriodLabel[] = [];
  const seen = new Set<string>();
  for (const e of edges) {
    if (e.relation?.lotRelationEvidence !== 'PERIOD_BASED') continue;
    const key = `${e.to}|${e.relation.periodStartedAt}|${e.relation.periodEndedAt}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const child = byKey.get(e.to);
    if (!child) continue;
    periodLabels.push({
      key,
      x: child.x - PERIOD_GAP + 8,
      y: child.y + NODE_H / 2 - 24,
      w: PERIOD_GAP - 16,
      periodStartedAt: e.relation.periodStartedAt,
      periodEndedAt: e.relation.periodEndedAt,
    });
  }
  const edgeLabels: EdgeLabel[] = showInputLabels
    ? edges.filter((e) => isInputToHeat(e, byKey)).map((e) => ({ key: e.key, x: (e.x1 + e.x2) / 2, y: (e.y1 + e.y2) / 2, inputTon: e.relation?.inputTon ?? null }))
    : [];
  const heads: ColumnHead[] = columns.map((c) => ({ column: c, x: columnX.get(c) ?? 0, title: columnTitle(c, columnNodes.get(c) ?? []), count: columnNodes.get(c)?.length ?? 0 }));
  return { nodes: sequence, edges, periodLabels, edgeLabels, heads, width, height };
}
