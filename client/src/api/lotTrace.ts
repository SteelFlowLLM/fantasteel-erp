// LOT 추적 조회 (REQ-LOT-005, BP-LOT-01, 업무 프로세스 12.2 GET /lots/:id/trace?direction=). 조회 전용이라 변경 함수가 없다.
// - 시작점: LOT 번호 또는 출하요청 번호 (PLAN 6장: '출하번호' → '출하요청 번호').
// - LOT 관계는 lot_relation의 부모·자식 id로만 따라간다(LOT 번호를 해석하지 않음). 출하는 배정(SHIPMENT, CONFIRMED·CONSUMED)으로 잇는다.
// - LOT 추적은 모든 사원이 여는 화면이다(screens.ts). 서버를 부른다 (api/server/lotTrace.ts). LOT·출하요청 id는 서버 id다.
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
import { serverLotTraceApi } from '@/api/server/lotTrace';
import { type TraceDirection } from '@/features/lotTrace/lib/traceGraph';

export type { TraceDirection } from '@/features/lotTrace/lib/traceGraph';

// ── 응답 모양 ─────────────────────────────────────────────

export interface LotListItem {
  id: number;
  lotNo: string;
  lotType: LotType;
  lotStatus: LotStatus;
  inspectionResult: InspectionResult | null;
  producedDate: string;
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
  initialTon: string | null;
  remainingTon: string | null;
  /** 제품(슬래브·코일) 1매·1개 이론중량 */
  theoreticalWeightTon: string | null;
  producedDate: string;
  inspectionResult: InspectionResult | null;
}

export interface TraceRelationEdge {
  id: number;
  parentLotId: number;
  childLotId: number;
  lotRelationEvidence: LotRelationEvidence;
  inputTon: string | null;
  periodStartedAt: string | null;
  periodEndedAt: string | null;
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
  requestedShipDate: string;
  issuedAt: string | null;
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
  dueDate: string | null;
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
  inputTon: string | null;
  periodStartedAt: string | null;
  periodEndedAt: string | null;
}

export interface LotAllocationView {
  id: number;
  allocationPurpose: AllocationPurpose;
  allocationStatus: AllocationStatus;
  confirmedAt: string;
  consumedAt: string | null;
  salesOrder: (SalesOrderRef & { lineNo: number; customerName: string; dueDate: string }) | null;
  shipmentRequest: { id: number; shipmentRequestNo: string } | null;
  productionPlan: { id: number; productionPlanNo: string } | null;
}

export interface LotInspectionView {
  id: number;
  processType: ProcessType;
  inspectionResult: InspectionResult;
  inspectedAt: string | null;
  inspectorName: string | null;
  inspectionStandardCode: string | null;
  standardVersion: number | null;
  values: {
    id: number;
    inspectionItemCode: string;
    inspectionItemName: string;
    unit: string | null;
    minValue: string | null;
    maxValue: string | null;
    measuredValue: string | null;
    isPassed: boolean | null;
  }[];
}

export interface LotShipmentView {
  shipmentRequestId: number;
  shipmentRequestNo: string;
  shipmentRequestStatus: ShipmentRequestStatus;
  allocationStatus: AllocationStatus;
  issuedAt: string | null;
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
    thicknessMm: string | null;
    widthMm: string | null;
    lengthMm: string | null;
    theoreticalWeightTon: string | null;
  } | null;
  steelGrade: { steelGradeCode: string; steelGradeName: string } | null;
  supplierName: string | null;
  goodsReceiptNo: string | null;
  blastFurnaceCode: string | null;
  converterCode: string | null;
  initialTon: string | null;
  remainingTon: string | null;
  heatLot: { id: number; lotNo: string } | null;
  yardName: string | null;
  producedDate: string;
  consumedAt: string | null;
  shippedAt: string | null;
  surplusAt: string | null;
  productionPlan: { id: number; productionPlanNo: string } | null;
  disposition: { dispositionStatus: DispositionStatus; dispositionReason: string | null; dispositionAt: string | null } | null;
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

// ── API ──────────────────────────────────────────────────

export const lotTraceApi = {
  /** LOT 목록: 번호 일부로 찾기(정확히 같은 번호가 맨 앞), 없으면 최근 생산 순 */
  searchLots: (query: LotSearchQuery = {}): Promise<LotListResult> => serverLotTraceApi.searchLots(query),
  /** 출하요청 번호 일부로 찾기 (BP-LOT-01 입력: 출하요청 번호) */
  searchShipmentRequests: (keyword: string): Promise<ShipmentRequestHit[]> => serverLotTraceApi.searchShipmentRequests(keyword),
  /**
   * 역추적·정추적. LOT 번호로 찾으면 방향을 생략할 때 LOT 종류로 고른다(코일·슬래브 = 역추적, 원료·용선·히트 = 정추적).
   * 출하요청 번호로 찾으면 그 출하요청에 배정·출고된 LOT 전부에서 역추적한다.
   * 없는 번호는 COM-003.
   */
  trace: (input: LotTraceInput): Promise<LotTraceView> => serverLotTraceApi.trace(input),
  /** LOT 상세: 기본 정보, 바로 연결된 LOT(LOT 관계), 배정, 출하·밀시트, 품질검사 */
  detail: (lotId: number): Promise<LotDetailView> => serverLotTraceApi.detail(lotId),
};
