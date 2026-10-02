// LOT 추적 조회 (REQ-LOT-005, BP-LOT-01, 업무 프로세스 12.2 GET /lots/:id/trace?direction=). 조회 전용이라 변경 함수가 없다.
// - 시작점: LOT 번호 또는 출하요청 번호 (PLAN 6장: '출하번호' → '출하요청 번호').
// - LOT 관계는 lot_relation의 부모·자식 id로만 따라간다(LOT 번호를 해석하지 않음). 출하는 배정(SHIPMENT, CONFIRMED·CONSUMED)으로 잇는다.
// - LOT 추적은 모든 사원이 여는 화면이라(screens.ts) 로그인한 사용 중 사원인지만 확인한다.
import type {
  AllocationPurpose,
  AllocationStatus,
  DispositionStatus,
  InspectionResult,
  LotRelationEvidence,
  LotStatus,
  LotType,
  ProcessType,
  RawMaterialType,
  ShipmentRequestStatus,
} from '@/codes';
import { requireActor } from '@/api/actor';
import { ApiError, mockQuery } from '@/api/client';
import { defaultTraceDirection, walkLotRelations, type TraceDirection } from '@/features/lotTrace/lib/traceGraph';
import type { AllocationRow, DateString, DecimalString, IsoDateTime, LotRow, MockTables } from '@/mock/schema';
import { findRow } from '@/mock/store';

export type { TraceDirection } from '@/features/lotTrace/lib/traceGraph';

// ── 응답 모양 ─────────────────────────────────────────────

export interface LotListItem {
  id: number;
  lotNo: string;
  lotType: LotType;
  lotStatus: LotStatus;
  inspectionResult: InspectionResult | null;
  producedDate: DateString;
  /** 원료명 · 고로 코드 · 전로 코드 · 강종 · 규격 */
  summary: string;
}

export interface LotListResult {
  items: LotListItem[];
  total: number;
}

export interface ShipmentRequestHit {
  id: number;
  shipmentRequestNo: string;
  shipmentRequestStatus: ShipmentRequestStatus;
  customerName: string;
}

export interface TraceLotNode {
  id: number;
  lotNo: string;
  lotType: LotType;
  lotStatus: LotStatus;
  /** 시작 LOT (출하요청으로 찾으면 그 출하요청의 LOT 전부) */
  isStart: boolean;
  depth: number;
  itemCode: string | null;
  itemName: string | null;
  rawMaterialType: RawMaterialType | null;
  steelGradeCode: string | null;
  blastFurnaceCode: string | null;
  converterCode: string | null;
  initialTon: DecimalString | null;
  remainingTon: DecimalString | null;
  /** 제품(슬래브·코일) 1매·1개 이론중량 */
  theoreticalWeightTon: DecimalString | null;
  producedDate: DateString;
  inspectionResult: InspectionResult | null;
}

export interface TraceRelationEdge {
  id: number;
  parentLotId: number;
  childLotId: number;
  lotRelationEvidence: LotRelationEvidence;
  inputTon: DecimalString | null;
  periodStartedAt: IsoDateTime | null;
  periodEndedAt: IsoDateTime | null;
}

export interface SalesOrderRef {
  salesOrderId: number;
  salesOrderNo: string;
}

export interface MillSheetRef {
  id: number;
  millSheetNo: string;
  salesOrderId: number;
}

export interface TraceShipment {
  shipmentRequestId: number;
  shipmentRequestNo: string;
  shipmentRequestStatus: ShipmentRequestStatus;
  customerName: string;
  requestedShipDate: DateString;
  issuedAt: IsoDateTime | null;
  salesOrders: SalesOrderRef[];
  /** 이 출하요청에 배정된(또는 출고된) LOT 가운데 추적 결과에 있는 것 */
  lotIds: number[];
  millSheets: MillSheetRef[];
}

export interface ImpactSalesOrder extends SalesOrderRef {
  customerName: string;
  /** 영향 LOT 가운데 이 수주로 출고된 것이 있는지 */
  hasShipped: boolean;
  lotCount: number;
  /** 연결된 수주 품목 가운데 가장 이른 납기 */
  dueDate: DateString | null;
}

export interface TraceImpact {
  slabCount: number;
  coilCount: number;
  /** 출고(SHIPPED)된 슬래브·코일 */
  shippedLotCount: number;
  /** 아직 재고(AVAILABLE)인 슬래브·코일 = 출고 전 제품 */
  unshippedLotCount: number;
  /** 다음 공정에 모두 투입된(CONSUMED) 슬래브 — 그 코일이 따로 세어진다 */
  consumedLotCount: number;
  salesOrders: ImpactSalesOrder[];
}

export type TraceStart =
  | { kind: 'LOT'; lotId: number; lotNo: string; lotType: LotType; lotStatus: LotStatus; inspectionResult: InspectionResult | null; summary: string }
  | { kind: 'SHIPMENT_REQUEST'; shipment: TraceShipment };

export interface LotTraceView {
  start: TraceStart;
  direction: TraceDirection;
  nodes: TraceLotNode[];
  edges: TraceRelationEdge[];
  /** 정추적이거나 출하요청에서 시작했을 때만 */
  shipments: TraceShipment[];
  /** 정추적일 때만 */
  impact: TraceImpact | null;
}

export type LotTraceInput = { lotNo: string; direction?: TraceDirection } | { shipmentRequestNo: string };

export interface RelatedLot {
  relationId: number;
  lotId: number;
  lotNo: string;
  lotType: LotType;
  rawMaterialType: RawMaterialType | null;
  lotRelationEvidence: LotRelationEvidence;
  inputTon: DecimalString | null;
  periodStartedAt: IsoDateTime | null;
  periodEndedAt: IsoDateTime | null;
}

export interface LotAllocationView {
  id: number;
  allocationPurpose: AllocationPurpose;
  allocationStatus: AllocationStatus;
  confirmedAt: IsoDateTime;
  consumedAt: IsoDateTime | null;
  salesOrder: (SalesOrderRef & { lineNo: number; customerName: string; dueDate: DateString }) | null;
  shipmentRequest: { id: number; shipmentRequestNo: string } | null;
  productionPlan: { id: number; productionPlanNo: string } | null;
}

export interface LotInspectionView {
  id: number;
  processType: ProcessType;
  inspectionResult: InspectionResult;
  inspectedAt: IsoDateTime | null;
  inspectorName: string | null;
  inspectionStandardCode: string | null;
  standardVersion: number | null;
  values: {
    id: number;
    inspectionItemCode: string;
    inspectionItemName: string;
    unit: string | null;
    minValue: DecimalString | null;
    maxValue: DecimalString | null;
    measuredValue: DecimalString | null;
    isPassed: boolean | null;
  }[];
}

export interface LotShipmentView {
  shipmentRequestId: number;
  shipmentRequestNo: string;
  shipmentRequestStatus: ShipmentRequestStatus;
  allocationStatus: AllocationStatus;
  issuedAt: IsoDateTime | null;
  customerName: string;
  salesOrder: SalesOrderRef | null;
  millSheets: MillSheetRef[];
}

export interface LotDetailView {
  id: number;
  lotNo: string;
  lotType: LotType;
  lotStatus: LotStatus;
  inspectionResult: InspectionResult | null;
  item: {
    itemCode: string;
    itemName: string;
    rawMaterialType: RawMaterialType | null;
    thicknessMm: DecimalString | null;
    widthMm: DecimalString | null;
    lengthMm: DecimalString | null;
    theoreticalWeightTon: DecimalString | null;
  } | null;
  steelGrade: { steelGradeCode: string; steelGradeName: string } | null;
  supplierName: string | null;
  goodsReceiptNo: string | null;
  blastFurnaceCode: string | null;
  converterCode: string | null;
  initialTon: DecimalString | null;
  remainingTon: DecimalString | null;
  heatLot: { id: number; lotNo: string } | null;
  yardName: string | null;
  producedDate: DateString;
  consumedAt: IsoDateTime | null;
  shippedAt: IsoDateTime | null;
  surplusAt: IsoDateTime | null;
  productionPlan: { id: number; productionPlanNo: string } | null;
  disposition: { dispositionStatus: DispositionStatus; dispositionReason: string | null; dispositionAt: IsoDateTime | null } | null;
  allocations: LotAllocationView[];
  parents: RelatedLot[];
  children: RelatedLot[];
  inspection: LotInspectionView | null;
  shipments: LotShipmentView[];
}

// ── 조회 키 ───────────────────────────────────────────────

export interface LotSearchQuery {
  keyword?: string;
  lotType?: LotType | '';
  limit?: number;
}

export const lotTraceKeys = {
  all: ['lots'] as const,
  search: (query: LotSearchQuery) => ['lots', 'search', query] as const,
  shipmentRequestSearch: (keyword: string) => ['lots', 'shipment-request-search', keyword] as const,
  trace: (input: LotTraceInput) => ['lots', 'trace', input] as const,
  detail: (lotId: number) => ['lots', 'detail', lotId] as const,
};

// ── 읽기 도우미 ───────────────────────────────────────────

const LIVE_ALLOCATION: readonly AllocationStatus[] = ['CONFIRMED', 'CONSUMED'];
const DEFAULT_SEARCH_LIMIT = 40;
const MAX_SEARCH_LIMIT = 200;

const normalize = (text: string) => text.trim().toUpperCase();

function inspectionResultOf(tables: Readonly<MockTables>, lotId: number): InspectionResult | null {
  return tables.qualityInspection.find((q) => q.lotId === lotId)?.inspectionResult ?? null;
}

/** 목록·노드 한 줄 요약: 원료명 / 고로 / 전로 · 강종 / 강종 · 규격 */
function lotSummary(tables: Readonly<MockTables>, lot: LotRow): string {
  const item = findRow(tables, 'item', lot.itemId);
  const grade = findRow(tables, 'steelGrade', lot.steelGradeId ?? item?.steelGradeId ?? null);
  switch (lot.lotType) {
    case 'RAW_MATERIAL':
      return item ? `${item.itemName} (${item.itemCode})` : '';
    case 'HOT_METAL':
      return lot.blastFurnaceCode ?? '';
    case 'HEAT':
      return [lot.converterCode, grade?.steelGradeCode].filter(Boolean).join(' · ');
    default:
      return [grade?.steelGradeCode, item?.itemCode].filter(Boolean).join(' · ');
  }
}

function toListItem(tables: Readonly<MockTables>, lot: LotRow): LotListItem {
  return {
    id: lot.id,
    lotNo: lot.lotNo,
    lotType: lot.lotType,
    lotStatus: lot.lotStatus,
    inspectionResult: inspectionResultOf(tables, lot.id),
    producedDate: lot.producedDate,
    summary: lotSummary(tables, lot),
  };
}

function toNode(tables: Readonly<MockTables>, lot: LotRow, depth: number, isStart: boolean): TraceLotNode {
  const item = findRow(tables, 'item', lot.itemId);
  const grade = findRow(tables, 'steelGrade', lot.steelGradeId ?? item?.steelGradeId ?? null);
  const isProduct = lot.lotType === 'SLAB' || lot.lotType === 'COIL';
  return {
    id: lot.id,
    lotNo: lot.lotNo,
    lotType: lot.lotType,
    lotStatus: lot.lotStatus,
    isStart,
    depth,
    itemCode: item?.itemCode ?? null,
    itemName: item?.itemName ?? null,
    rawMaterialType: item?.rawMaterialType ?? null,
    steelGradeCode: grade?.steelGradeCode ?? null,
    blastFurnaceCode: lot.blastFurnaceCode,
    converterCode: lot.converterCode,
    initialTon: lot.initialTon,
    remainingTon: lot.remainingTon,
    theoreticalWeightTon: isProduct ? (item?.theoreticalWeightTon ?? null) : null,
    producedDate: lot.producedDate,
    inspectionResult: inspectionResultOf(tables, lot.id),
  };
}

function salesOrderRefOfItem(tables: Readonly<MockTables>, salesOrderItemId: number | null) {
  const soItem = findRow(tables, 'salesOrderItem', salesOrderItemId);
  const so = soItem ? findRow(tables, 'salesOrder', soItem.salesOrderId) : undefined;
  if (!soItem || !so) return null;
  return {
    salesOrderId: so.id,
    salesOrderNo: so.salesOrderNo,
    lineNo: soItem.lineNo,
    dueDate: soItem.dueDate,
    customerName: findRow(tables, 'customer', so.customerId)?.customerName ?? '',
  };
}

function millSheetsOf(tables: Readonly<MockTables>, shipmentRequestId: number, salesOrderIds?: readonly number[]): MillSheetRef[] {
  return tables.millSheet
    .filter((m) => m.shipmentRequestId === shipmentRequestId && (!salesOrderIds || salesOrderIds.includes(m.salesOrderId)))
    .sort((a, b) => a.id - b.id)
    .map((m) => ({ id: m.id, millSheetNo: m.millSheetNo, salesOrderId: m.salesOrderId }));
}

/** 출하 배정 (출하요청 품목이 있고 CONFIRMED·CONSUMED) */
function shipmentAllocations(tables: Readonly<MockTables>, lotIds?: ReadonlySet<number>): AllocationRow[] {
  return tables.allocation.filter(
    (a) =>
      a.allocationPurpose === 'SHIPMENT' &&
      a.shipmentRequestItemId !== null &&
      LIVE_ALLOCATION.includes(a.allocationStatus) &&
      (!lotIds || lotIds.has(a.lotId)),
  );
}

/** 배정을 출하요청별로 묶는다 (취소된 출하요청은 뺀다) */
function groupShipments(tables: Readonly<MockTables>, allocations: readonly AllocationRow[]): TraceShipment[] {
  const groups = new Map<number, TraceShipment>();
  for (const allocation of allocations) {
    const requestItem = findRow(tables, 'shipmentRequestItem', allocation.shipmentRequestItemId);
    const request = requestItem ? findRow(tables, 'shipmentRequest', requestItem.shipmentRequestId) : undefined;
    if (!requestItem || !request || request.shipmentRequestStatus === 'CANCELLED') continue;
    let group = groups.get(request.id);
    if (!group) {
      group = {
        shipmentRequestId: request.id,
        shipmentRequestNo: request.shipmentRequestNo,
        shipmentRequestStatus: request.shipmentRequestStatus,
        customerName: findRow(tables, 'customer', request.customerId)?.customerName ?? '',
        requestedShipDate: request.requestedShipDate,
        issuedAt: request.issuedAt,
        salesOrders: [],
        lotIds: [],
        millSheets: [],
      };
      groups.set(request.id, group);
    }
    const so = salesOrderRefOfItem(tables, requestItem.salesOrderItemId);
    if (so && !group.salesOrders.some((s) => s.salesOrderId === so.salesOrderId)) {
      group.salesOrders.push({ salesOrderId: so.salesOrderId, salesOrderNo: so.salesOrderNo });
    }
    if (!group.lotIds.includes(allocation.lotId)) group.lotIds.push(allocation.lotId);
  }
  const shipments = [...groups.values()];
  for (const s of shipments) {
    s.salesOrders.sort((a, b) => a.salesOrderNo.localeCompare(b.salesOrderNo));
    s.millSheets = millSheetsOf(tables, s.shipmentRequestId);
  }
  return shipments.sort((a, b) => a.shipmentRequestNo.localeCompare(b.shipmentRequestNo));
}

/** 출하요청 하나 (LOT은 그 요청의 살아 있는 배정) */
function shipmentOfRequest(tables: Readonly<MockTables>, shipmentRequestId: number): TraceShipment {
  const request = findRow(tables, 'shipmentRequest', shipmentRequestId);
  if (!request) throw new ApiError('COM-003', `출하요청 ${shipmentRequestId}`);
  const itemIds = new Set(tables.shipmentRequestItem.filter((i) => i.shipmentRequestId === request.id).map((i) => i.id));
  const allocations = shipmentAllocations(tables).filter((a) => a.shipmentRequestItemId !== null && itemIds.has(a.shipmentRequestItemId));
  const grouped = groupShipments(tables, allocations)[0];
  if (grouped) return grouped;
  // 배정이 아직 없거나 취소된 출하요청: LOT 없이 머리 정보만
  const salesOrders: SalesOrderRef[] = [];
  for (const item of tables.shipmentRequestItem.filter((i) => i.shipmentRequestId === request.id)) {
    const so = salesOrderRefOfItem(tables, item.salesOrderItemId);
    if (so && !salesOrders.some((s) => s.salesOrderId === so.salesOrderId)) salesOrders.push({ salesOrderId: so.salesOrderId, salesOrderNo: so.salesOrderNo });
  }
  return {
    shipmentRequestId: request.id,
    shipmentRequestNo: request.shipmentRequestNo,
    shipmentRequestStatus: request.shipmentRequestStatus,
    customerName: findRow(tables, 'customer', request.customerId)?.customerName ?? '',
    requestedShipDate: request.requestedShipDate,
    issuedAt: request.issuedAt,
    salesOrders,
    lotIds: [],
    millSheets: millSheetsOf(tables, request.id),
  };
}

/**
 * 배정의 수주 품목. 열연 투입 배정(HOT_ROLLING)은 sales_order_item_id가 비어 있고
 * production_plan_id로만 수주에 이어지므로 생산계획의 수주 품목을 쓴다 (ERD allocation.production_plan_id).
 */
function allocationSalesOrderItemId(tables: Readonly<MockTables>, allocation: Pick<AllocationRow, 'salesOrderItemId' | 'allocationPurpose' | 'productionPlanId'>): number | null {
  if (allocation.salesOrderItemId !== null) return allocation.salesOrderItemId;
  if (allocation.allocationPurpose !== 'HOT_ROLLING') return null;
  return findRow(tables, 'productionPlan', allocation.productionPlanId)?.salesOrderItemId ?? null;
}

/**
 * 정추적 영향 요약: 하위 제품 LOT 수, 출고 여부, 연결된 수주 (배정의 수주 품목 + 생산계획의 수주 품목).
 * 시작 LOT이 슬래브·코일이면 그 LOT도 영향 제품으로 센다(출하요청 목록과 맞춘다).
 */
function impactOf(tables: Readonly<MockTables>, nodes: readonly TraceLotNode[]): TraceImpact {
  const products = nodes.filter((n) => n.lotType === 'SLAB' || n.lotType === 'COIL');
  const productIds = new Set(products.map((n) => n.id));
  const bySalesOrder = new Map<number, ImpactSalesOrder & { lots: Set<number> }>();
  const touch = (salesOrderItemId: number | null, lotId: number, shipped: boolean) => {
    const so = salesOrderRefOfItem(tables, salesOrderItemId);
    if (!so) return;
    let entry = bySalesOrder.get(so.salesOrderId);
    if (!entry) {
      entry = { salesOrderId: so.salesOrderId, salesOrderNo: so.salesOrderNo, customerName: so.customerName, hasShipped: false, lotCount: 0, dueDate: null, lots: new Set() };
      bySalesOrder.set(so.salesOrderId, entry);
    }
    entry.lots.add(lotId);
    if (shipped) entry.hasShipped = true;
    if (entry.dueDate === null || so.dueDate < entry.dueDate) entry.dueDate = so.dueDate;
  };
  for (const allocation of tables.allocation) {
    if (!productIds.has(allocation.lotId) || !LIVE_ALLOCATION.includes(allocation.allocationStatus)) continue;
    touch(allocationSalesOrderItemId(tables, allocation), allocation.lotId, allocation.allocationPurpose === 'SHIPMENT' && allocation.allocationStatus === 'CONSUMED');
  }
  for (const node of products) {
    const lot = findRow(tables, 'lot', node.id);
    const plan = findRow(tables, 'productionPlan', lot?.productionPlanId ?? null);
    if (plan) touch(plan.salesOrderItemId, node.id, false);
  }
  const salesOrders = [...bySalesOrder.values()]
    .map(({ lots, ...rest }) => ({ ...rest, lotCount: lots.size }))
    .sort((a, b) => a.salesOrderNo.localeCompare(b.salesOrderNo));
  return {
    slabCount: products.filter((n) => n.lotType === 'SLAB').length,
    coilCount: products.filter((n) => n.lotType === 'COIL').length,
    shippedLotCount: products.filter((n) => n.lotStatus === 'SHIPPED').length,
    unshippedLotCount: products.filter((n) => n.lotStatus === 'AVAILABLE').length,
    consumedLotCount: products.filter((n) => n.lotStatus === 'CONSUMED').length,
    salesOrders,
  };
}

function buildTrace(tables: Readonly<MockTables>, rootIds: readonly number[], direction: TraceDirection) {
  const walk = walkLotRelations(tables.lotRelation, rootIds, direction);
  const roots = new Set(rootIds);
  const nodes: TraceLotNode[] = [];
  for (const id of walk.lotIds) {
    const lot = findRow(tables, 'lot', id);
    if (lot) nodes.push(toNode(tables, lot, walk.depthById.get(id) ?? 0, roots.has(id)));
  }
  const relationIds = new Set(walk.relationIds);
  const edges: TraceRelationEdge[] = tables.lotRelation
    .filter((r) => relationIds.has(r.id))
    .map((r) => ({
      id: r.id,
      parentLotId: r.parentLotId,
      childLotId: r.childLotId,
      lotRelationEvidence: r.lotRelationEvidence,
      inputTon: r.inputTon,
      periodStartedAt: r.periodStartedAt,
      periodEndedAt: r.periodEndedAt,
    }));
  return { nodes, edges };
}

function relatedLots(tables: Readonly<MockTables>, lotId: number, side: 'parents' | 'children'): RelatedLot[] {
  const out: RelatedLot[] = [];
  for (const r of tables.lotRelation) {
    if (r.parentLotId === r.childLotId) continue;
    const otherId = side === 'parents' ? (r.childLotId === lotId ? r.parentLotId : null) : r.parentLotId === lotId ? r.childLotId : null;
    if (otherId === null) continue;
    const other = findRow(tables, 'lot', otherId);
    if (!other) continue;
    out.push({
      relationId: r.id,
      lotId: other.id,
      lotNo: other.lotNo,
      lotType: other.lotType,
      rawMaterialType: findRow(tables, 'item', other.itemId)?.rawMaterialType ?? null,
      lotRelationEvidence: r.lotRelationEvidence,
      inputTon: r.inputTon,
      periodStartedAt: r.periodStartedAt,
      periodEndedAt: r.periodEndedAt,
    });
  }
  return out.sort((a, b) => a.lotNo.localeCompare(b.lotNo));
}

function inspectionOf(tables: Readonly<MockTables>, lotId: number): LotInspectionView | null {
  const inspection = tables.qualityInspection.find((q) => q.lotId === lotId);
  if (!inspection) return null;
  const standard = findRow(tables, 'inspectionStandard', inspection.inspectionStandardId);
  const values = tables.qualityInspectionValue
    .filter((v) => v.qualityInspectionId === inspection.id)
    .map((v) => ({ value: v, item: findRow(tables, 'inspectionStandardItem', v.inspectionStandardItemId) }))
    .sort((a, b) => (a.item?.sortOrder ?? 0) - (b.item?.sortOrder ?? 0) || a.value.id - b.value.id)
    .map(({ value, item }) => ({
      id: value.id,
      inspectionItemCode: item?.inspectionItemCode ?? '',
      inspectionItemName: item?.inspectionItemName ?? '',
      unit: item?.unit ?? null,
      minValue: item?.minValue ?? null,
      maxValue: item?.maxValue ?? null,
      measuredValue: value.measuredValue,
      isPassed: value.isPassed,
    }));
  return {
    id: inspection.id,
    processType: inspection.processType,
    inspectionResult: inspection.inspectionResult,
    inspectedAt: inspection.inspectedAt,
    inspectorName: findRow(tables, 'employee', inspection.inspectorEmployeeId)?.employeeName ?? null,
    inspectionStandardCode: standard?.inspectionStandardCode ?? null,
    standardVersion: standard?.version ?? null,
    values,
  };
}

function supplierOf(tables: Readonly<MockTables>, lot: LotRow): { supplierName: string | null; goodsReceiptNo: string | null } {
  const receipt = findRow(tables, 'goodsReceipt', lot.goodsReceiptId);
  if (!receipt) return { supplierName: null, goodsReceiptNo: null };
  const poItem = findRow(tables, 'purchaseOrderItem', receipt.purchaseOrderItemId);
  const po = findRow(tables, 'purchaseOrder', poItem?.purchaseOrderId ?? null);
  return { supplierName: findRow(tables, 'supplier', po?.supplierId ?? null)?.supplierName ?? null, goodsReceiptNo: receipt.goodsReceiptNo };
}

function lotDetailOf(tables: Readonly<MockTables>, lot: LotRow): LotDetailView {
  const item = findRow(tables, 'item', lot.itemId);
  const grade = findRow(tables, 'steelGrade', lot.steelGradeId ?? item?.steelGradeId ?? null);
  const heat = findRow(tables, 'lot', lot.heatLotId);
  const plan = findRow(tables, 'productionPlan', lot.productionPlanId);
  const allocations: LotAllocationView[] = tables.allocation
    .filter((a) => a.lotId === lot.id && LIVE_ALLOCATION.includes(a.allocationStatus))
    .sort((a, b) => a.id - b.id)
    .map((a) => {
      const requestItem = findRow(tables, 'shipmentRequestItem', a.shipmentRequestItemId);
      const request = requestItem ? findRow(tables, 'shipmentRequest', requestItem.shipmentRequestId) : undefined;
      const allocationPlan = findRow(tables, 'productionPlan', a.productionPlanId);
      return {
        id: a.id,
        allocationPurpose: a.allocationPurpose,
        allocationStatus: a.allocationStatus,
        confirmedAt: a.confirmedAt,
        consumedAt: a.consumedAt,
        salesOrder: salesOrderRefOfItem(tables, allocationSalesOrderItemId(tables, a)),
        shipmentRequest: request ? { id: request.id, shipmentRequestNo: request.shipmentRequestNo } : null,
        productionPlan: allocationPlan ? { id: allocationPlan.id, productionPlanNo: allocationPlan.productionPlanNo } : null,
      };
    });
  const shipments: LotShipmentView[] = [];
  for (const a of shipmentAllocations(tables, new Set([lot.id]))) {
    const requestItem = findRow(tables, 'shipmentRequestItem', a.shipmentRequestItemId);
    const request = requestItem ? findRow(tables, 'shipmentRequest', requestItem.shipmentRequestId) : undefined;
    if (!requestItem || !request) continue;
    const so = salesOrderRefOfItem(tables, requestItem.salesOrderItemId);
    shipments.push({
      shipmentRequestId: request.id,
      shipmentRequestNo: request.shipmentRequestNo,
      shipmentRequestStatus: request.shipmentRequestStatus,
      allocationStatus: a.allocationStatus,
      issuedAt: request.issuedAt,
      customerName: findRow(tables, 'customer', request.customerId)?.customerName ?? '',
      salesOrder: so ? { salesOrderId: so.salesOrderId, salesOrderNo: so.salesOrderNo } : null,
      millSheets: millSheetsOf(tables, request.id, so ? [so.salesOrderId] : []),
    });
  }
  return {
    id: lot.id,
    lotNo: lot.lotNo,
    lotType: lot.lotType,
    lotStatus: lot.lotStatus,
    inspectionResult: inspectionResultOf(tables, lot.id),
    item: item
      ? {
          itemCode: item.itemCode,
          itemName: item.itemName,
          rawMaterialType: item.rawMaterialType,
          thicknessMm: item.thicknessMm,
          widthMm: item.widthMm,
          lengthMm: item.lengthMm,
          theoreticalWeightTon: item.theoreticalWeightTon,
        }
      : null,
    steelGrade: grade ? { steelGradeCode: grade.steelGradeCode, steelGradeName: grade.steelGradeName } : null,
    ...supplierOf(tables, lot),
    blastFurnaceCode: lot.blastFurnaceCode,
    converterCode: lot.converterCode,
    initialTon: lot.initialTon,
    remainingTon: lot.remainingTon,
    heatLot: heat ? { id: heat.id, lotNo: heat.lotNo } : null,
    yardName: findRow(tables, 'yard', lot.yardId)?.yardName ?? null,
    producedDate: lot.producedDate,
    consumedAt: lot.consumedAt,
    shippedAt: lot.shippedAt,
    surplusAt: lot.surplusAt,
    productionPlan: plan ? { id: plan.id, productionPlanNo: plan.productionPlanNo } : null,
    disposition: lot.dispositionStatus
      ? { dispositionStatus: lot.dispositionStatus, dispositionReason: lot.dispositionReason, dispositionAt: lot.dispositionAt }
      : null,
    allocations,
    parents: relatedLots(tables, lot.id, 'parents'),
    children: relatedLots(tables, lot.id, 'children'),
    inspection: inspectionOf(tables, lot.id),
    shipments,
  };
}

const byProducedDesc = (a: LotRow, b: LotRow) => b.producedDate.localeCompare(a.producedDate) || b.id - a.id;

// ── API ──────────────────────────────────────────────────

export const lotTraceApi = {
  /** LOT 목록: 번호 일부로 찾기(정확히 같은 번호가 맨 앞), 없으면 최근 생산 순 */
  searchLots: (query: LotSearchQuery = {}): Promise<LotListResult> =>
    mockQuery((tables) => {
      requireActor(tables);
      const term = normalize(query.keyword ?? '');
      const limit = Math.min(Math.max(query.limit ?? DEFAULT_SEARCH_LIMIT, 1), MAX_SEARCH_LIMIT);
      const matched = tables.lot
        .filter((lot) => (!query.lotType || lot.lotType === query.lotType) && (!term || lot.lotNo.toUpperCase().includes(term)))
        .sort((a, b) => Number(b.lotNo.toUpperCase() === term) - Number(a.lotNo.toUpperCase() === term) || byProducedDesc(a, b));
      return { items: matched.slice(0, limit).map((lot) => toListItem(tables, lot)), total: matched.length };
    }),

  /** 출하요청 번호 일부로 찾기 (BP-LOT-01 입력: 출하요청 번호) */
  searchShipmentRequests: (keyword: string): Promise<ShipmentRequestHit[]> =>
    mockQuery((tables) => {
      requireActor(tables);
      const term = normalize(keyword);
      if (!term) return [];
      return tables.shipmentRequest
        .filter((r) => r.shipmentRequestNo.toUpperCase().includes(term))
        .sort(
          (a, b) =>
            Number(b.shipmentRequestNo.toUpperCase() === term) - Number(a.shipmentRequestNo.toUpperCase() === term) ||
            b.shipmentRequestNo.localeCompare(a.shipmentRequestNo),
        )
        .slice(0, 10)
        .map((r) => ({
          id: r.id,
          shipmentRequestNo: r.shipmentRequestNo,
          shipmentRequestStatus: r.shipmentRequestStatus,
          customerName: findRow(tables, 'customer', r.customerId)?.customerName ?? '',
        }));
    }),

  /**
   * 역추적·정추적. LOT 번호로 찾으면 방향을 생략할 때 LOT 종류로 고른다(코일·슬래브 = 역추적, 원료·용선·히트 = 정추적).
   * 출하요청 번호로 찾으면 그 출하요청에 배정·출고된 LOT 전부에서 역추적한다.
   * 없는 번호는 COM-003.
   */
  trace: (input: LotTraceInput): Promise<LotTraceView> =>
    mockQuery((tables) => {
      requireActor(tables);
      if ('shipmentRequestNo' in input) {
        const term = normalize(input.shipmentRequestNo);
        const request = tables.shipmentRequest.find((r) => r.shipmentRequestNo.toUpperCase() === term);
        if (!request) throw new ApiError('COM-003', `출하요청 ${input.shipmentRequestNo.trim()}`);
        const shipment = shipmentOfRequest(tables, request.id);
        const { nodes, edges } = buildTrace(tables, shipment.lotIds, 'backward');
        return { start: { kind: 'SHIPMENT_REQUEST', shipment }, direction: 'backward', nodes, edges, shipments: [shipment], impact: null };
      }
      const term = normalize(input.lotNo);
      const lot = tables.lot.find((l) => l.lotNo.toUpperCase() === term);
      if (!lot) throw new ApiError('COM-003', `LOT ${input.lotNo.trim()}`);
      const direction = input.direction ?? defaultTraceDirection(lot.lotType);
      const { nodes, edges } = buildTrace(tables, [lot.id], direction);
      const shipments = direction === 'forward' ? groupShipments(tables, shipmentAllocations(tables, new Set(nodes.map((n) => n.id)))) : [];
      return {
        start: {
          kind: 'LOT',
          lotId: lot.id,
          lotNo: lot.lotNo,
          lotType: lot.lotType,
          lotStatus: lot.lotStatus,
          inspectionResult: inspectionResultOf(tables, lot.id),
          summary: lotSummary(tables, lot),
        },
        direction,
        nodes,
        edges,
        shipments,
        impact: direction === 'forward' ? impactOf(tables, nodes) : null,
      };
    }),

  /** LOT 상세: 기본 정보, 바로 연결된 LOT(LOT 관계), 배정, 출하·밀시트, 품질검사 */
  detail: (lotId: number): Promise<LotDetailView> =>
    mockQuery((tables) => {
      requireActor(tables);
      const lot = findRow(tables, 'lot', lotId);
      if (!lot) throw new ApiError('COM-003', `LOT ${lotId}`);
      return lotDetailOf(tables, lot);
    }),
};
