// LOT 추적 그래프 배치 (순수 함수). 열 = 공정 순서(원료 → 용선 → 히트 → 슬래브 → 코일 → 출하), 선 = lot_relation.
// 가장 노드가 많은 열을 기준으로 세우고, 나머지 열은 이미 놓인 이웃의 평균 높이에 맞춰 바깥쪽으로 쌓는다 (히트 1개 ↔ 슬래브 10여 매도 읽히게).
import type { LotTraceEdge, LotTraceNode, LotTraceResponse, LotTraceShipment } from '@/api/lots';

export type ColKey = 'RAW' | 'HM' | 'HEAT' | 'SLAB' | 'COIL' | 'SHIP';
export const COL_ORDER: ColKey[] = ['RAW', 'HM', 'HEAT', 'SLAB', 'COIL', 'SHIP'];

export const NODE_W = 204;
export const NODE_H = 96;
export const ROW_GAP = 10;
export const HEAD_H = 40;
const PAD_X = 8;
const PAD_BOTTOM = 12;

export interface ShipGroup extends LotTraceShipment {
  lotIds: number[];
  lotNos: string[];
}

export interface GNode {
  key: string; // 'lot:12' | 'ship:3'
  col: ColKey;
  lot?: LotTraceNode;
  ship?: ShipGroup;
  x: number;
  y: number;
}

export interface GEdge {
  key: string;
  from: string;
  to: string;
  edge?: LotTraceEdge; // 출하 연결선은 없음
  x1: number; y1: number; x2: number; y2: number;
}

export interface PeriodLabel { key: string; x: number; y: number; w: number; periodStart: string | null; periodEnd: string | null }
export interface EdgeLabel { key: string; x: number; y: number; text: string; sub: string | null }
export interface ColHead { col: ColKey; x: number; title: string; count: number }

export interface TraceLayout {
  nodes: GNode[];
  edges: GEdge[];
  periodLabels: PeriodLabel[];
  edgeLabels: EdgeLabel[];
  heads: ColHead[];
  width: number;
  height: number;
}

export const lotKey = (id: number) => `lot:${id}`;
export const shipKey = (giId: number) => `ship:${giId}`;

const LOT_COL = { RAW_MATERIAL: 'RAW', HOT_METAL: 'HM', HEAT: 'HEAT', SLAB: 'SLAB', COIL: 'COIL' } as const;

export const isAlloy = (n: LotTraceNode) => n.lotType === 'RAW_MATERIAL' && n.rawMaterialType === 'FERROALLOY';
/** 합금철은 히트에 직접 들어가므로 용선 열에 둔다 (원료 → 용선 연결선과 섞이지 않게). */
const colOf = (n: LotTraceNode): ColKey => (isAlloy(n) ? 'HM' : LOT_COL[n.lotType]);

export function colTitle(col: ColKey, nodes: GNode[]): string {
  const inCol = nodes.filter((n) => n.col === col);
  if (col === 'RAW') return '원료';
  if (col === 'HM') {
    const hasHm = inCol.some((n) => n.lot && n.lot.lotType === 'HOT_METAL');
    const hasAlloy = inCol.some((n) => n.lot && isAlloy(n.lot));
    return hasHm && hasAlloy ? '용선 · 합금철' : hasAlloy ? '합금철' : '용선';
  }
  return { HEAT: '히트', SLAB: '슬래브', COIL: '코일', SHIP: '출하' }[col];
}

/** 출고번호별로 묶은 출하 (정추적 그래프의 출하 열, 상세 패널). */
export function buildShipGroups(trace: LotTraceResponse): Map<number, ShipGroup> {
  const ships = new Map<number, ShipGroup>();
  const sorted = [...trace.nodes].sort((a, b) => a.depth - b.depth || a.producedAt.localeCompare(b.producedAt) || a.id - b.id);
  for (const n of sorted) {
    const s = n.shipment;
    if (!s) continue;
    const g = ships.get(s.goodsIssueId) ?? { ...s, lotIds: [], lotNos: [] };
    g.lotIds.push(n.id);
    g.lotNos.push(n.lotNo);
    ships.set(s.goodsIssueId, g);
  }
  return ships;
}

export function layoutTrace(trace: LotTraceResponse): TraceLayout {
  const byId = new Map<number, LotTraceNode>(trace.nodes.map((n) => [n.id, n]));
  const order = new Map<number, number>();
  for (const lv of trace.levels) lv.nodeIds.forEach((id, i) => order.set(id, order.size + i));
  trace.nodes.forEach((n, i) => { if (!order.has(n.id)) order.set(n.id, 100000 + i); });

  // 1) 노드 만들기 (+ 정추적이면 출하 노드)
  const gnodes = new Map<string, GNode>();
  const seq: string[] = [];
  const nodesSorted = [...trace.nodes].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  for (const n of nodesSorted) {
    const g: GNode = { key: lotKey(n.id), col: colOf(n), lot: n, x: 0, y: 0 };
    gnodes.set(g.key, g);
    seq.push(g.key);
  }
  const rawEdges: { key: string; from: string; to: string; edge?: LotTraceEdge }[] = [];
  for (const e of trace.edges) {
    if (byId.has(e.parentId) && byId.has(e.childId)) rawEdges.push({ key: `e:${e.id}`, from: lotKey(e.parentId), to: lotKey(e.childId), edge: e });
  }
  if (trace.direction === 'forward') {
    for (const g of buildShipGroups(trace).values()) {
      const k = shipKey(g.goodsIssueId);
      gnodes.set(k, { key: k, col: 'SHIP', ship: g, x: 0, y: 0 });
      seq.push(k);
      for (const id of g.lotIds) rawEdges.push({ key: `s:${id}:${g.goodsIssueId}`, from: lotKey(id), to: k });
    }
  }

  // 2) 열
  const cols = COL_ORDER.filter((c) => seq.some((k) => gnodes.get(k)!.col === c));
  const colNodes = new Map<ColKey, GNode[]>(cols.map((c) => [c, seq.map((k) => gnodes.get(k)!).filter((n) => n.col === c)]));
  const parents = new Map<string, string[]>();
  const children = new Map<string, string[]>();
  for (const e of rawEdges) {
    (children.get(e.from) ?? children.set(e.from, []).get(e.from)!).push(e.to);
    (parents.get(e.to) ?? parents.set(e.to, []).get(e.to)!).push(e.from);
  }

  // 3) 높이: 가장 많은 열 기준으로 바깥쪽으로
  const placed = new Set<string>();
  const cy = (k: string) => gnodes.get(k)!.y + NODE_H / 2;
  const stack = (list: GNode[], desiredOf: (n: GNode) => number | null) => {
    const withD = list.map((n, i) => ({ n, i, d: desiredOf(n) }));
    // 이웃이 없는 노드는 원래 순서대로 맨 아래에 이어 붙인다
    const known = withD.filter((x) => x.d !== null).sort((a, b) => a.d! - b.d! || a.i - b.i);
    const unknown = withD.filter((x) => x.d === null);
    let bottom = -Infinity;
    for (const x of [...known, ...unknown]) {
      const want = x.d === null ? bottom + ROW_GAP : x.d;
      x.n.y = Math.max(want, bottom + ROW_GAP);
      bottom = x.n.y + NODE_H;
      placed.add(x.n.key);
    }
  };
  let anchor = 0;
  cols.forEach((c, i) => { if (colNodes.get(c)!.length > colNodes.get(cols[anchor])!.length) anchor = i; });
  colNodes.get(cols[anchor])!.forEach((n, i) => { n.y = i * (NODE_H + ROW_GAP); placed.add(n.key); });
  const mean = (keys: string[] | undefined) => {
    const ys = (keys ?? []).filter((k) => placed.has(k)).map(cy);
    return ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length - NODE_H / 2 : null;
  };
  for (let i = anchor - 1; i >= 0; i--) stack(colNodes.get(cols[i])!, (n) => mean(children.get(n.key)));
  for (let i = anchor + 1; i < cols.length; i++) stack(colNodes.get(cols[i])!, (n) => mean(parents.get(n.key)));
  const all = [...gnodes.values()];
  const minY = Math.min(...all.map((n) => n.y));
  for (const n of all) n.y = n.y - minY + HEAD_H;

  // 4) 가로: 열 사이 간격 (원료→용선은 "기간 기반" 표지, 용선→히트는 "직접 투입" 표지가 들어갈 자리)
  const hasPeriod = rawEdges.some((e) => e.edge?.isPeriodBased);
  const directLabelEdges = rawEdges.filter((e) => e.edge && (e.edge.relationType === 'HOT_METAL_TO_HEAT' || e.edge.relationType === 'ALLOY_TO_HEAT'));
  const showDirectLabels = directLabelEdges.length > 0 && directLabelEdges.length <= 16;
  const colX = new Map<ColKey, number>();
  let x = PAD_X;
  cols.forEach((c, i) => {
    colX.set(c, x);
    const next = cols[i + 1];
    const gap = c === 'RAW' && next === 'HM' && hasPeriod ? 176 : c === 'HM' && next === 'HEAT' && showDirectLabels ? 112 : 84;
    x += NODE_W + gap;
  });
  const width = x - (cols.length ? 84 : 0) + PAD_X;
  for (const n of all) n.x = colX.get(n.col)!;
  const height = Math.max(...all.map((n) => n.y + NODE_H)) + PAD_BOTTOM;

  // 5) 선·표지
  const edges: GEdge[] = rawEdges.map((e) => {
    const a = gnodes.get(e.from)!;
    const b = gnodes.get(e.to)!;
    return { key: e.key, from: e.from, to: e.to, edge: e.edge, x1: a.x + NODE_W, y1: a.y + NODE_H / 2, x2: b.x, y2: b.y + NODE_H / 2 };
  });
  const periodLabels: PeriodLabel[] = [];
  const seen = new Set<string>();
  for (const e of edges) {
    if (!e.edge?.isPeriodBased) continue;
    const k = `${e.to}|${e.edge.periodStart}|${e.edge.periodEnd}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const child = gnodes.get(e.to)!;
    const leftEdge = child.x - 176 + 8;
    periodLabels.push({ key: k, x: leftEdge, y: child.y + NODE_H / 2 - 24, w: 176 - 16, periodStart: e.edge.periodStart, periodEnd: e.edge.periodEnd });
  }
  const edgeLabels: EdgeLabel[] = showDirectLabels
    ? edges.filter((e) => e.edge && (e.edge.relationType === 'HOT_METAL_TO_HEAT' || e.edge.relationType === 'ALLOY_TO_HEAT')).map((e) => ({
        key: e.key, x: (e.x1 + e.x2) / 2, y: (e.y1 + e.y2) / 2, text: e.edge!.evidenceLabel, sub: e.edge!.inputTon,
      }))
    : [];
  const heads: ColHead[] = cols.map((c) => ({ col: c, x: colX.get(c)!, title: colTitle(c, colNodes.get(c)!), count: colNodes.get(c)!.length }));
  return { nodes: all, edges, periodLabels, edgeLabels, heads, width, height };
}
