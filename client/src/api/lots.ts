// LOT 조회·정/역추적 API — docs/api/lot.md 의 모양 그대로. 모두 조회 전용이다.
import type { InspectionResult, LotEvidenceType, LotRelationType, LotStatus, LotType } from '@fantasteel/shared';
import { api } from './client';

export interface LotInspectionSummary {
  qualityInspectionId: number;
  qualityInspectionNo: string;
  /** STEELMAKING(히트 성분) | CASTING(슬래브) | HOT_ROLLING(코일) */
  processCode: string;
  result: InspectionResult;
  resultLabel: string;
  inspectedAt: string | null;
  itemCount: number;
  failedItemCount: number;
}

export interface LotSalesOrderItemView {
  salesOrderItemId: number;
  salesOrderId: number;
  salesOrderNo: string;
  lineNo: number;
  customerId: number;
  customerName: string;
  /** ISO — 날짜는 앞 10자리 */
  dueDate: string;
}

export interface LotView {
  id: number;
  lotNo: string;
  lotType: LotType;
  lotTypeLabel: string;
  lotStatus: LotStatus;
  lotStatusLabel: string;
  title: string;
  rawMaterial: { id: number; materialCode: string; materialName: string; rawMaterialType: string; rawMaterialTypeLabel: string } | null;
  productSpec: { id: number; specCode: string; thicknessMm: string; widthMm: string; lengthMm: string; theoreticalWeightTon: string } | null;
  steelGrade: { id: number; steelGradeCode: string; steelGradeName: string } | null;
  heat: { id: number; lotNo: string; isPassed: boolean | null } | null;
  yard: { id: number; yardCode: string; yardName: string } | null;
  supplier: { id: number; supplierName: string } | null;
  blastFurnaceNo: string | null;
  converterNo: string | null;
  weightTon: string | null;
  initialTon: string | null;
  remainingTon: string | null;
  isPassed: boolean | null;
  inspectionResult: InspectionResult | null;
  inspectionResultLabel: string | null;
  inspection: LotInspectionSummary | null;
  disposition: { status: string; statusLabel: string; reason: string | null; at: string | null } | null;
  allocation: {
    allocationId: number; purpose: string; purposeLabel: string; status: string; confirmedAt: string;
    salesOrderItemId: number | null; salesOrderNo: string | null; lineNo: number | null;
    productionPlanId: number | null; productionPlanNo: string | null;
    shipmentRequestId: number | null; shipmentRequestNo: string | null;
  } | null;
  salesOrderItem: LotSalesOrderItemView | null;
  isEligible: boolean | null;
  isSurplus: boolean | null;
  producedAt: string;
  consumedAt: string | null;
}

export interface LotListResponse {
  items: LotView[];
  total: number;
  limit: number;
}

export interface LotListQuery {
  lotType?: LotType;
  lotStatus?: LotStatus;
  q?: string;
  limit?: number;
}

export interface LotLink {
  lotId: number;
  lotNo: string;
  lotType: LotType;
  relationType: LotRelationType;
  evidenceType: LotEvidenceType;
  inputTon: string | null;
  periodStart: string | null;
  periodEnd: string | null;
}

export interface LotInspectionDetail {
  qualityInspectionId: number;
  qualityInspectionNo: string;
  processCode: string;
  result: InspectionResult;
  resultLabel: string;
  inspectorName: string | null;
  inspectedAt: string | null;
  memo: string | null;
  values: {
    inspectionItemCode: string;
    inspectionItemName: string;
    unit: string | null;
    minValue: string | null;
    maxValue: string | null;
    measuredValue: string | null;
    isPassed: boolean | null;
  }[];
}

export interface LotDetail extends LotView {
  inspections: LotInspectionDetail[];
  parents: LotLink[];
  children: LotLink[];
}

export type LotSearchItem = { id: number; lotNo: string; lotType: LotType; lotTypeLabel: string; lotStatus: LotStatus; lotStatusLabel: string };

export type TraceDirection = 'backward' | 'forward';

export interface LotTraceShipment {
  goodsIssueId: number;
  goodsIssueNo: string;
  issuedAt: string | null;
  shipmentRequestId: number;
  shipmentRequestNo: string;
  customerId: number;
  customerCode: string;
  customerName: string;
  salesOrderId: number;
  salesOrderNo: string;
  salesOrderItemId: number;
  lineNo: number;
  millSheetIds: number[];
  millSheetNos: string[];
}

export interface LotTraceNode {
  id: number;
  lotNo: string;
  lotType: LotType;
  lotTypeLabel: string;
  lotStatus: LotStatus;
  lotStatusLabel: string;
  isRoot: boolean;
  depth: number;
  title: string;
  steelGradeCode: string | null;
  productSpecCode: string | null;
  rawMaterialCode: string | null;
  rawMaterialName: string | null;
  /** FERROALLOY = 합금철 */
  rawMaterialType: 'IRON_ORE' | 'COAL' | 'LIMESTONE' | 'FERROALLOY' | null;
  blastFurnaceNo: string | null;
  converterNo: string | null;
  heatLotNo: string | null;
  initialTon: string | null;
  remainingTon: string | null;
  weightTon: string | null;
  producedAt: string;
  isPassed: boolean | null;
  inspectionResult: InspectionResult | null;
  inspectionResultLabel: string | null;
  inspection: LotInspectionSummary | null;
  /** PRODUCED_FOR 생산한 원래 수주 품목 / ALLOCATED 배정된 수주 품목 / SHIPPED 출고된 수주 품목 */
  salesOrderLinks: (LotSalesOrderItemView & { linkType: 'PRODUCED_FOR' | 'ALLOCATED' | 'SHIPPED' })[];
  shipment: LotTraceShipment | null;
}

export interface LotTraceEdge {
  id: number;
  parentId: number;
  childId: number;
  relationType: LotRelationType;
  evidenceType: LotEvidenceType;
  /** "기간 기반" | "직접 투입" */
  evidenceLabel: string;
  isPeriodBased: boolean;
  inputTon: string | null;
  periodStart: string | null;
  periodEnd: string | null;
}

export interface LotTraceImpact {
  shippedProductLotCount: number;
  unshippedProductLotCount: number;
  shipments: {
    goodsIssueId: number; goodsIssueNo: string; issuedAt: string | null; shipmentRequestNo: string;
    customerId: number; customerName: string; salesOrderId: number; salesOrderNo: string;
    millSheetNos: string[]; lotIds: number[]; lotNos: string[];
  }[];
  salesOrders: { salesOrderId: number; salesOrderNo: string; customerName: string; dueDate: string; lotCount: number; hasShipped: boolean }[];
}

export interface LotTraceResponse {
  direction: TraceDirection;
  rootId: number;
  nodes: LotTraceNode[];
  edges: LotTraceEdge[];
  levels: { lotType: LotType; label: string; nodeIds: number[] }[];
  summary: {
    nodeCount: number;
    edgeCount: number;
    countByType: Partial<Record<LotType, number>>;
    hasPeriodEvidence: boolean;
    hasCycle: boolean;
    truncated: boolean;
  };
  /** forward에서만. backward는 null */
  impact: LotTraceImpact | null;
}

// 이전 빌드의 서버는 노드의 수주 연결을 `orderLinks`라는 이름으로 준다 (문서는 `salesOrderLinks`). 둘 다 받아 준다.
type RawTraceNode = Omit<LotTraceNode, 'salesOrderLinks'> & { salesOrderLinks?: LotTraceNode['salesOrderLinks']; orderLinks?: LotTraceNode['salesOrderLinks'] };
type RawTrace = Omit<LotTraceResponse, 'nodes'> & { nodes: RawTraceNode[] };

export const lotApi = {
  list: (q: LotListQuery = {}) => api.get<LotListResponse>('/lots', { ...q }),
  search: (q: string, limit = 20) => api.get<LotSearchItem[]>('/lots/search', { q, limit }),
  byNo: (lotNo: string) => api.get<LotDetail>(`/lots/by-no/${encodeURIComponent(lotNo)}`),
  detail: (id: number) => api.get<LotDetail>(`/lots/${id}`),
  trace: async (id: number, direction: TraceDirection): Promise<LotTraceResponse> => {
    const raw = await api.get<RawTrace>(`/lots/${id}/trace`, { direction });
    return { ...raw, nodes: raw.nodes.map(({ orderLinks, ...n }) => ({ ...n, salesOrderLinks: n.salesOrderLinks ?? orderLinks ?? [] })) };
  },
};
