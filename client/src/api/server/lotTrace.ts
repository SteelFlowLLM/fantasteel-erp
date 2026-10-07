// LOT 추적 화면 ↔ 서버 API (server/src/modules/lot). 화면 주소는 LOT 번호라 GET /lots?lotNo=로 id를 찾아 추적한다.
// 서버 추적은 LOT id 하나에서 시작한다. 출하요청 번호로 시작하는 추적(docs/backend/lot.md 8장)은
// 출하요청 상세의 배정 LOT마다 역추적해 하나로 합친다. 출하요청 조회 권한이 없는 역할(구매·생산)은 COM-002다.
// 서버 LOT 응답에 없는 값(공급업체, 생산계획, 배정 확정 시각·수주, 소진·출고·여재 시각)은 비운다.
// 이론중량·치수는 규격 목록(GET /items)에서 채우고, 그 권한이 없는 역할(물류)은 비운다.
import type {
  ItemView,
  LotDetail,
  LotSummary,
  LotTrace,
  MillSheetSummary,
  PageResult,
  ShipmentRequestDetail,
  ShipmentRequestSummary,
  TraceLotNode as ServerTraceLotNode,
  TraceShipment as ServerTraceShipment,
} from '@fantasteel/shared';
import { ApiError } from '@/api/errors';
import { serverRequest } from '@/api/http';
import type {
  LotDetailView,
  LotListItem,
  LotListResult,
  LotSearchQuery,
  LotTraceInput,
  LotTraceView,
  RelatedLot,
  ShipmentRequestHit,
  TraceDirection,
  TraceLotNode,
  TraceRelationEdge,
  TraceShipment,
} from '@/api/lotTrace';
import { allPages, orEmpty } from '@/api/server/inspections';

const DEFAULT_SEARCH_LIMIT = 40;
/** 서버 최대 페이지 크기 */
const MAX_PAGE_SIZE = 100;

const normalize = (text: string) => text.trim().toUpperCase();
const isProduct = (lotType: string) => lotType === 'SLAB' || lotType === 'COIL';

/** 목록·노드 한 줄 요약: 원료명 / 고로 / 전로 · 강종 / 강종 · 규격 (가짜 DB lotSummary와 같은 규칙) */
function summaryOf(lot: Pick<LotSummary, 'lotType' | 'itemCode' | 'itemName' | 'steelGradeCode'> & { blastFurnaceCode?: string | null; converterCode?: string | null }): string {
  switch (lot.lotType) {
    case 'RAW_MATERIAL':
      return lot.itemName && lot.itemCode ? `${lot.itemName} (${lot.itemCode})` : '';
    case 'HOT_METAL':
      return lot.blastFurnaceCode ?? '';
    case 'HEAT':
      return [lot.converterCode, lot.steelGradeCode].filter(Boolean).join(' · ');
    default:
      return [lot.steelGradeCode, lot.itemCode].filter(Boolean).join(' · ');
  }
}

/** 규격 목록 (이론중량·치수). 권한이 없으면 빈 목록 */
const readItems = async (): Promise<Map<string, ItemView>> => new Map((await orEmpty(() => serverRequest<ItemView[]>('GET', '/items'), [])).map((i) => [i.itemCode, i]));

const exactFirst = <T>(rows: T[], noOf: (row: T) => string, term: string): T[] =>
  rows.map((row, index) => ({ row, index })).sort((a, b) => Number(normalize(noOf(b.row)) === term) - Number(normalize(noOf(a.row)) === term) || a.index - b.index).map((r) => r.row);

function toListItem(lot: LotSummary): LotListItem {
  return { id: lot.id, lotNo: lot.lotNo, lotType: lot.lotType, lotStatus: lot.lotStatus, inspectionResult: lot.inspectionResult, producedDate: lot.producedDate ?? '', summary: summaryOf(lot) };
}

async function searchLots(query: LotSearchQuery = {}): Promise<LotListResult> {
  const term = normalize(query.keyword ?? '');
  const size = Math.min(Math.max(query.limit ?? DEFAULT_SEARCH_LIMIT, 1), MAX_PAGE_SIZE);
  const result = await serverRequest<PageResult<LotSummary>>('GET', '/lots', { query: { lotNo: term || undefined, lotType: query.lotType || undefined, page: 1, size } });
  return { items: exactFirst(result.items, (l) => l.lotNo, term).map(toListItem), total: result.total };
}

/** 번호가 정확히 같은 LOT (서버 lotNo 필터는 앞부분 일치라 같은 앞부분 LOT 가운데서 고른다) */
async function lotByNo(lotNo: string): Promise<LotSummary> {
  const term = normalize(lotNo);
  for (let page = 1; ; page++) {
    const result = await serverRequest<PageResult<LotSummary>>('GET', '/lots', { query: { lotNo: term, page, size: MAX_PAGE_SIZE } });
    const found = result.items.find((l) => normalize(l.lotNo) === term);
    if (found) return found;
    if (page * MAX_PAGE_SIZE >= result.total || result.items.length === 0) throw new ApiError('COM-003', `LOT ${lotNo.trim()}`);
  }
}

function toNode(node: ServerTraceLotNode, items: Map<string, ItemView>): TraceLotNode {
  return {
    id: node.id,
    lotNo: node.lotNo,
    lotType: node.lotType,
    lotStatus: node.lotStatus,
    isStart: node.isStart,
    depth: node.depth,
    itemCode: node.itemCode,
    itemName: node.itemName,
    rawMaterialType: node.rawMaterialType,
    steelGradeCode: node.steelGradeCode,
    blastFurnaceCode: node.blastFurnaceCode,
    converterCode: node.converterCode,
    initialTon: node.initialTon,
    remainingTon: node.remainingTon,
    theoreticalWeightTon: isProduct(node.lotType) && node.itemCode ? (items.get(node.itemCode)?.theoreticalWeightTon ?? null) : null,
    producedDate: node.producedDate ?? '',
    inspectionResult: node.inspectionResult,
  };
}

const needsItems = (nodes: readonly { lotType: string }[]) => nodes.some((n) => isProduct(n.lotType));

/** 서버는 출하요청 × 수주 단위로 준다. 화면은 출하요청 한 줄에 수주 여러 개다 */
function groupShipments(rows: readonly ServerTraceShipment[]): TraceShipment[] {
  const groups = new Map<number, TraceShipment>();
  for (const row of rows) {
    let group = groups.get(row.shipmentRequestId);
    if (!group) {
      group = {
        shipmentRequestId: row.shipmentRequestId,
        shipmentRequestNo: row.shipmentRequestNo,
        shipmentRequestStatus: row.shipmentRequestStatus,
        customerName: row.customerName,
        // 출하 요청일은 서버 추적 응답에 없다
        requestedShipDate: '',
        issuedAt: row.issuedAt,
        salesOrders: [],
        lotIds: [],
        millSheets: [],
      };
      groups.set(row.shipmentRequestId, group);
    }
    const g = group;
    if (row.salesOrder && !g.salesOrders.some((s) => s.salesOrderId === row.salesOrder?.salesOrderId)) g.salesOrders.push(row.salesOrder);
    for (const id of row.lotIds) if (!g.lotIds.includes(id)) g.lotIds.push(id);
    for (const m of row.millSheets) if (!g.millSheets.some((x) => x.id === m.id)) g.millSheets.push(m);
  }
  const shipments = [...groups.values()];
  for (const s of shipments) {
    s.salesOrders.sort((a, b) => a.salesOrderNo.localeCompare(b.salesOrderNo));
    s.millSheets.sort((a, b) => a.id - b.id);
  }
  return shipments.sort((a, b) => a.shipmentRequestNo.localeCompare(b.shipmentRequestNo));
}

const readTrace = (lotId: number, direction?: TraceDirection) => serverRequest<LotTrace>('GET', `/lots/${lotId}/trace`, { query: { direction } });

async function traceLot(lotNo: string, direction?: TraceDirection): Promise<LotTraceView> {
  const lot = await lotByNo(lotNo);
  const trace = await readTrace(lot.id, direction);
  const items = needsItems(trace.nodes) ? await readItems() : new Map<string, ItemView>();
  const startNode = trace.nodes.find((n) => n.isStart);
  return {
    start: {
      kind: 'LOT',
      lotId: trace.start.id,
      lotNo: trace.start.lotNo,
      lotType: trace.start.lotType,
      lotStatus: trace.start.lotStatus,
      inspectionResult: trace.start.inspectionResult,
      summary: summaryOf({ ...trace.start, blastFurnaceCode: startNode?.blastFurnaceCode, converterCode: startNode?.converterCode }),
    },
    direction: trace.direction,
    nodes: trace.nodes.map((n) => toNode(n, items)),
    edges: trace.edges,
    shipments: groupShipments(trace.shipments),
    impact: trace.impact,
  };
}

const shipmentRequestsAll = () => allPages<ShipmentRequestSummary>('/shipment-requests');

/** 출하요청 번호 일부로 찾기. 출하요청 조회 권한이 없으면 빈 결과 */
async function searchShipmentRequests(keyword: string): Promise<ShipmentRequestHit[]> {
  const term = normalize(keyword);
  if (!term) return [];
  const rows = (await orEmpty(shipmentRequestsAll, [])).filter((r) => normalize(r.shipmentRequestNo).includes(term));
  return rows
    .sort((a, b) => Number(normalize(b.shipmentRequestNo) === term) - Number(normalize(a.shipmentRequestNo) === term) || b.shipmentRequestNo.localeCompare(a.shipmentRequestNo))
    .slice(0, 10)
    .map((r) => ({ id: r.id, shipmentRequestNo: r.shipmentRequestNo, shipmentRequestStatus: r.shipmentRequestStatus, customerName: r.customerName }));
}

/** 출하요청 하나에 배정·출고된 LOT 전부에서 역추적해 합친다. 같은 LOT은 가장 가까운 거리로 한 번만 둔다 */
async function traceShipmentRequest(shipmentRequestNo: string): Promise<LotTraceView> {
  const term = normalize(shipmentRequestNo);
  const found = (await shipmentRequestsAll()).find((r) => normalize(r.shipmentRequestNo) === term);
  if (!found) throw new ApiError('COM-003', `출하요청 ${shipmentRequestNo.trim()}`);
  const [request, millSheets] = await Promise.all([
    serverRequest<ShipmentRequestDetail>('GET', `/shipment-requests/${found.id}`),
    orEmpty(() => allPages<MillSheetSummary>('/mill-sheets', { shipmentRequestId: found.id }), []),
  ]);
  const lotIds = [...new Set(request.items.flatMap((i) => i.allocations.filter((a) => a.allocationStatus !== 'RELEASED').map((a) => a.lotId)))];
  const salesOrders = [...new Map(request.items.map((i) => [i.salesOrderId, { salesOrderId: i.salesOrderId, salesOrderNo: i.salesOrderNo }])).values()];
  const shipment: TraceShipment = {
    shipmentRequestId: request.id,
    shipmentRequestNo: request.shipmentRequestNo,
    shipmentRequestStatus: request.shipmentRequestStatus,
    customerName: request.customerName,
    requestedShipDate: request.shipDate ?? '',
    issuedAt: request.issuedAt,
    salesOrders: salesOrders.sort((a, b) => a.salesOrderNo.localeCompare(b.salesOrderNo)),
    lotIds,
    millSheets: millSheets.sort((a, b) => a.id - b.id).map((m) => ({ id: m.id, millSheetNo: m.millSheetNo, salesOrderId: m.salesOrderId })),
  };

  const traces = await Promise.all(lotIds.map((id) => readTrace(id, 'backward')));
  const roots = new Set(lotIds);
  const nodes = new Map<number, ServerTraceLotNode>();
  const edges = new Map<number, TraceRelationEdge>();
  for (const trace of traces) {
    for (const n of trace.nodes) {
      const seen = nodes.get(n.id);
      if (!seen || n.depth < seen.depth) nodes.set(n.id, { ...n, isStart: roots.has(n.id) });
    }
    for (const e of trace.edges) edges.set(e.id, e);
  }
  const merged = [...nodes.values()].sort((a, b) => a.depth - b.depth || a.id - b.id);
  const items = needsItems(merged) ? await readItems() : new Map<string, ItemView>();
  return {
    start: { kind: 'SHIPMENT_REQUEST', shipment },
    direction: 'backward',
    nodes: merged.map((n) => toNode(n, items)),
    edges: [...edges.values()].sort((a, b) => a.id - b.id),
    shipments: [shipment],
    impact: null,
  };
}

function trace(input: LotTraceInput): Promise<LotTraceView> {
  return 'shipmentRequestNo' in input ? traceShipmentRequest(input.shipmentRequestNo) : traceLot(input.lotNo, input.direction);
}

const relatedOf = (r: LotDetail['parents'][number]): RelatedLot => ({ ...r, rawMaterialType: null });

async function detail(lotId: number): Promise<LotDetailView> {
  const lot = await serverRequest<LotDetail>('GET', `/lots/${lotId}`);
  const item = lot.itemCode ? (await readItems()).get(lot.itemCode) : undefined;
  return {
    id: lot.id,
    lotNo: lot.lotNo,
    lotType: lot.lotType,
    lotStatus: lot.lotStatus,
    inspectionResult: lot.inspectionResult,
    item: lot.itemCode
      ? {
          itemCode: lot.itemCode,
          itemName: lot.itemName ?? '',
          rawMaterialType: lot.rawMaterialType,
          thicknessMm: item?.thicknessMm ?? null,
          widthMm: item?.widthMm ?? null,
          lengthMm: item?.lengthMm ?? null,
          theoreticalWeightTon: item?.theoreticalWeightTon ?? null,
        }
      : null,
    steelGrade: lot.steelGradeCode ? { steelGradeCode: lot.steelGradeCode, steelGradeName: lot.steelGradeName ?? lot.steelGradeCode } : null,
    supplierName: null,
    goodsReceiptNo: lot.goodsReceiptNo,
    blastFurnaceCode: lot.blastFurnaceCode,
    converterCode: lot.converterCode,
    initialTon: lot.initialTon,
    remainingTon: lot.remainingTon,
    heatLot: lot.heat,
    yardName: lot.yardName,
    producedDate: lot.producedDate ?? '',
    // 소진·출고·여재 시각과 처리 지정 시각은 ERD lot에 컬럼이 없다
    consumedAt: null,
    shippedAt: null,
    surplusAt: null,
    productionPlan: null,
    disposition: lot.disposition ? { ...lot.disposition, dispositionAt: null } : null,
    allocations: lot.allocations.map((a) => ({
      id: a.id,
      allocationPurpose: a.allocationPurpose,
      allocationStatus: a.allocationStatus,
      confirmedAt: '',
      consumedAt: null,
      salesOrder: null,
      shipmentRequest: a.shipmentRequest,
      productionPlan: a.productionPlan,
    })),
    parents: lot.parents.map(relatedOf),
    children: lot.children.map(relatedOf),
    inspection: lot.inspection
      ? {
          // 서버 응답에 검사 id가 없다 (LOT당 검사 1건이라 LOT id로 둔다)
          id: lot.id,
          processType: lot.inspection.processType,
          inspectionResult: lot.inspection.inspectionResult,
          inspectedAt: lot.inspection.inspectedAt,
          inspectorName: lot.inspection.inspectorName,
          inspectionStandardCode: lot.inspection.inspectionStandardCode,
          standardVersion: lot.inspection.standardVersion,
          values: lot.inspection.values.map((v, index) => ({ ...v, id: index + 1 })),
        }
      : null,
    shipments: lot.shipments,
  };
}

export const serverLotTraceApi = { searchLots, searchShipmentRequests, trace, detail };
