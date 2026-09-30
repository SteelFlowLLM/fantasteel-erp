// 출하요청 · 출고 확정 · 밀시트 API — docs/api/shipment.md 의 모양 그대로.
import type { AllocationStatus, PdfStatus, SalesOrderItemStatus, ShipmentRequestItemStatus, ShipmentRequestStatus } from '@fantasteel/shared';
import { api } from './client';

export interface EmployeeRef { id: number; employeeNo: string; employeeName: string }
export interface CustomerRef { id: number; customerCode: string; customerName: string }
export interface MillSheetRef { id: number; millSheetNo: string; salesOrderId: number; pdfStatus: PdfStatus }
export type ProductItemType = 'SLAB' | 'COIL';

// ── 출하요청 ─────────────────────────────────────────────
/** 확정(CONFIRMED)·소진(CONSUMED) 배정. 해제된 것은 빠진다 */
export interface ShipmentAllocationView {
  id: number;
  lotId: number;
  lotNo: string;
  lotType: string;
  heatNo: string | null;
  producedAt: string;
  status: AllocationStatus;
  confirmedAt: string;
}

export interface ShipmentRequestItemView {
  /** shipmentRequestItemId (배정 API에 쓴다) */
  id: number;
  lineNo: number;
  salesOrderItemId: number;
  salesOrderId: number;
  salesOrderNo: string;
  salesOrderLineNo: number;
  productSpecId: number;
  specCode: string;
  itemType: ProductItemType;
  qtyUnit: string;
  steelGradeCode: string;
  theoreticalWeightTon: string;
  requestQty: number;
  requestTon: string;
  /** requestQty와 같으면 배정 완료 */
  allocatedQty: number;
  shipmentRequestItemStatus: ShipmentRequestItemStatus;
  allocations: ShipmentAllocationView[];
}

export interface ShipmentRequestView {
  id: number;
  shipmentRequestNo: string;
  customer: CustomerRef;
  /** 'YYYY-MM-DD' */
  requestedShipDate: string;
  shipmentRequestStatus: ShipmentRequestStatus;
  requester: EmployeeRef | null;
  memo: string | null;
  cancelledAt: string | null;
  createdAt: string;
  requestQty: number;
  requestTon: string;
  allocatedQty: number;
  items: ShipmentRequestItemView[];
  goodsIssue: { id: number; goodsIssueNo: string; confirmedAt: string | null; confirmedEmployee: EmployeeRef | null } | null;
  millSheets: MillSheetRef[];
}

export interface ListShipmentRequestsQuery {
  status?: ShipmentRequestStatus;
  customerId?: number;
  salesOrderId?: number;
  shipFrom?: string;
  shipTo?: string;
  keyword?: string;
}

/** 출하요청할 수 있는 수주 품목 (shippableQty > 0) */
export interface ShippableItemView {
  salesOrderItemId: number;
  salesOrderId: number;
  salesOrderNo: string;
  lineNo: number;
  customer: CustomerRef;
  /** 'YYYY-MM-DD' */
  dueDate: string;
  productSpecId: number;
  specCode: string;
  itemType: ProductItemType;
  qtyUnit: string;
  steelGradeCode: string;
  theoreticalWeightTon: string;
  orderedQty: number;
  shippedQty: number;
  /** ACTIVE 예약 매수 */
  reservedQty: number;
  /** 다른 미출고 출하요청에 이미 들어 있는 매수 */
  requestedQty: number;
  /** 지금 요청할 수 있는 매수 = reservedQty − requestedQty */
  shippableQty: number;
  shippableTon: string;
}
export interface ListShippableQuery { customerId?: number; salesOrderId?: number }

export interface CreateShipmentRequestBody {
  customerId: number;
  requestedShipDate: string;
  memo?: string;
  items: { salesOrderItemId: number; requestQty: number }[];
}

// ── 출고 ────────────────────────────────────────────────
export interface GoodsIssueItemView {
  shipmentRequestItemId: number;
  salesOrderItemId: number;
  salesOrderId: number;
  salesOrderNo: string;
  salesOrderLineNo: number;
  productSpecId: number;
  specCode: string;
  itemType: ProductItemType;
  qtyUnit: string;
  steelGradeCode: string;
  /** 이번 출고 매수 (= 예약 CONVERTED 전환 매수) */
  issuedQty: number;
  issuedTon: string;
  orderedQty: number;
  /** 수주 품목의 누적 출고 매수 (조회 시점 값) */
  shippedQty: number;
  salesOrderItemStatus: SalesOrderItemStatus;
  lots: { lotId: number; lotNo: string; heatNo: string | null }[];
}

export interface GoodsIssueView {
  id: number;
  goodsIssueNo: string;
  goodsIssueStatus: string;
  confirmedAt: string | null;
  confirmedEmployee: EmployeeRef | null;
  shipmentRequestId: number;
  shipmentRequestNo: string;
  customer: CustomerRef;
  issuedQty: number;
  issuedTon: string;
  items: GoodsIssueItemView[];
  millSheets: MillSheetRef[];
}

export interface ListGoodsIssuesQuery {
  shipmentRequestId?: number;
  customerId?: number;
  salesOrderId?: number;
  from?: string;
  to?: string;
}

// ── 밀시트 ───────────────────────────────────────────────
export interface MillSheetInspectionValue {
  inspectionItemCode: string;
  inspectionItemName: string;
  unit: string | null;
  minValue: string | null;
  maxValue: string | null;
  measuredValue: string | null;
  isPassed: boolean | null;
}
export interface MillSheetInspection {
  qualityInspectionNo: string;
  /** 'STEELMAKING' | 'CASTING' | 'HOT_ROLLING' */
  processCode: string;
  inspectionResult: string;
  inspectedAt: string | null;
  values: MillSheetInspectionValue[];
}
export interface MillSheetSnapshotLot {
  lotNo: string;
  lotType: ProductItemType;
  heatNo: string | null;
  producedAt: string;
  inspection: MillSheetInspection | null;
  /** 코일이면 압연 전 슬래브와 그 검사, 슬래브면 null */
  parentSlab: { lotNo: string; inspection: MillSheetInspection | null } | null;
}
/** 발행 시점에 복사해 둔 값. 조회와 PDF는 이것만 쓴다 */
export interface MillSheetSnapshot {
  millSheetNo: string;
  issuedAt: string;
  customer: { customerCode: string; customerName: string };
  salesOrder: { salesOrderId: number; salesOrderNo: string; salesOrderItemId: number; lineNo: number };
  shipment: { shipmentRequestNo: string; goodsIssueNo: string; goodsIssuedAt: string };
  productSpec: {
    specCode: string;
    itemType: ProductItemType;
    steelGradeCode: string;
    steelGradeName: string;
    standardNo: string | null;
    thicknessMm: string;
    widthMm: string;
    lengthMm: string;
    theoreticalWeightTon: string;
  };
  qty: number;
  qtyUnit: string;
  weightTon: string;
  heats: { heatNo: string; composition: MillSheetInspection | null }[];
  lots: MillSheetSnapshotLot[];
}

export interface MillSheetListItem {
  id: number;
  millSheetNo: string;
  issuedAt: string;
  pdfStatus: PdfStatus;
  goodsIssueId: number;
  goodsIssueNo: string;
  salesOrderId: number;
  salesOrderNo: string;
  lineNo: number;
  customerId: number;
  customerName: string;
  specCode: string;
  itemType: ProductItemType;
  steelGradeCode: string;
  qty: number;
  qtyUnit: string;
  weightTon: string;
  heatNos: string[];
}

export interface MillSheetView {
  id: number;
  millSheetNo: string;
  goodsIssueId: number;
  salesOrderId: number;
  customerId: number;
  issuedAt: string;
  pdfStatus: PdfStatus;
  /** READY면 '/api/v1/mill-sheets/:id/pdf', 아니면 null */
  pdfUrl: string | null;
  snapshot: MillSheetSnapshot;
}

export interface ListMillSheetsQuery {
  customerId?: number;
  salesOrderId?: number;
  goodsIssueId?: number;
  from?: string;
  to?: string;
  keyword?: string;
}

export const shipmentRequestApi = {
  list: (q: ListShipmentRequestsQuery = {}) => api.get<ShipmentRequestView[]>('/shipment-requests', { ...q }),
  get: (id: number) => api.get<ShipmentRequestView>(`/shipment-requests/${id}`),
  shippable: (q: ListShippableQuery = {}) => api.get<ShippableItemView[]>('/shipment-requests/shippable', { ...q }),
  create: (body: CreateShipmentRequestBody) => api.post<ShipmentRequestView>('/shipment-requests', body),
  cancel: (input: { id: number; reason?: string }) => api.post<ShipmentRequestView>(`/shipment-requests/${input.id}/cancel`, { reason: input.reason || undefined }),
  /** 출고 확정. 같은 키로 다시 보내면 처음 응답을 돌려준다 (두 번 출고되지 않는다) */
  confirmGoodsIssue: (input: { id: number; idempotencyKey: string }) =>
    api.post<GoodsIssueView>(`/shipment-requests/${input.id}/goods-issue`, undefined, { 'Idempotency-Key': input.idempotencyKey }),
};

export const goodsIssueApi = {
  list: (q: ListGoodsIssuesQuery = {}) => api.get<GoodsIssueView[]>('/goods-issues', { ...q }),
};

export const millSheetApi = {
  list: (q: ListMillSheetsQuery = {}) => api.get<MillSheetListItem[]>('/mill-sheets', { ...q }),
  get: (id: number) => api.get<MillSheetView>(`/mill-sheets/${id}`),
  /** 저장된 스냅샷으로 PDF를 만든다. 실패하면 500 SHP-001 (스냅샷·출고는 그대로) */
  generatePdf: (id: number) => api.post<MillSheetView>(`/mill-sheets/${id}/pdf`),
  /** fileUrl()에 넘길 경로 */
  pdfPath: (id: number) => `/mill-sheets/${id}/pdf`,
};
