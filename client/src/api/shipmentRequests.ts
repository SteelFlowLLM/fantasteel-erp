// 출하요청·출하 배정 API (REQ-SHP-001, REQ-INV-006·007·009, BP-SHP-01).
// 서버를 부른다 (api/server/shipmentRequests.ts). 규칙·작업 로그는 서버가 맡는다.
import { type AllocationStatus, type ProductItemType, type SalesOrderItemStatus, type ShipmentRequestStatus } from '@/codes';
import { serverShipmentRequestApi } from '@/api/server/shipmentRequests';

export interface ShipmentLotView {
  lotId: number;
  lotNo: string;
  producedDate: string;
  heatNo: string | null;
  yardId: number | null;
}

export interface ShipmentRequestSummary {
  id: number;
  shipmentRequestNo: string;
  customerId: number;
  customerName: string;
  requestedShipDate: string;
  shipmentRequestStatus: ShipmentRequestStatus;
  requesterName: string | null;
  createdAt: string;
  updatedAt: string;
  issuedAt: string | null;
  issuedEmployeeName: string | null;
  cancelledAt: string | null;
  salesOrderNos: string[];
  totalRequestQty: number;
  totalAllocatedQty: number;
  /** 배정 대기 매수 합계 (요청 − CONFIRMED·CONSUMED 배정) */
  waitingAllocationQty: number;
  totalWeightTon: string;
}

export interface ShipmentRequestLineView {
  shipmentRequestItemId: number;
  lineNo: number;
  salesOrderId: number;
  salesOrderNo: string;
  salesOrderItemId: number;
  salesOrderLineNo: number;
  itemId: number;
  itemCode: string;
  itemName: string;
  itemType: ProductItemType;
  theoreticalWeightTon: string;
  requestQty: number;
  requestTon: string;
  allocatedQty: number;
  waitingAllocationQty: number;
  allocations: (ShipmentLotView & { allocationId: number; allocationStatus: AllocationStatus; confirmedAt: string; confirmedEmployeeName: string | null })[];
}

export interface ShipmentRequestDetail extends ShipmentRequestSummary {
  lines: ShipmentRequestLineView[];
  millSheets: { id: number; millSheetNo: string; salesOrderId: number; issuedAt: string; pdfPath: string | null }[];
}

export interface ShippableItem {
  salesOrderItemId: number;
  salesOrderId: number;
  salesOrderNo: string;
  lineNo: number;
  itemId: number;
  itemCode: string;
  itemName: string;
  itemType: ProductItemType;
  theoreticalWeightTon: string;
  orderedQty: number;
  shippedQty: number;
  dueDate: string;
  activeReservedQty: number;
  openRequestQty: number;
  /** 출하 가능 잔량 = ACTIVE 예약 − 진행 중 출하요청 매수 */
  shippableQty: number;
}

export const shipmentRequestKeys = {
  all: ['shipmentRequests'] as const,
  list: () => [...shipmentRequestKeys.all, 'list'] as const,
  detail: (id: number) => [...shipmentRequestKeys.all, 'detail', id] as const,
  shippableCustomers: () => [...shipmentRequestKeys.all, 'shippableCustomers'] as const,
  shippableItems: (customerId: number) => [...shipmentRequestKeys.all, 'shippableItems', customerId] as const,
};

export interface ShipmentListRow extends ShipmentRequestSummary {
  /** 품목 규격 코드 (표의 '품목' 칸) */
  itemCodes: string[];
  itemTypes: ProductItemType[];
  salesOrderIds: number[];
  /** 수주 링크용 (id·번호 짝, 줄 순서) */
  salesOrders: { salesOrderId: number; salesOrderNo: string }[];
  millSheets: { id: number; millSheetNo: string }[];
}

export interface ShipmentLotOption extends ShipmentLotView {
  yardName: string | null;
}

export interface ShipmentLineDetail extends Omit<ShipmentRequestLineView, 'allocations'> {
  steelGradeCode: string | null;
  orderedQty: number;
  shippedQty: number;
  dueDate: string;
  salesOrderItemStatus: SalesOrderItemStatus;
  allocations: (ShipmentRequestLineView['allocations'][number] & { yardName: string | null })[];
  /** FIFO 추천 (배정 대기 매수만큼, 저장 안 함 — SHP-001) */
  recommendedLots: ShipmentLotOption[];
  /** 고를 수 있는 적격·미배정 LOT 전부 (FIFO 순) */
  candidateLots: ShipmentLotOption[];
}

export interface ShipmentRequestDetailView extends Omit<ShipmentRequestDetail, 'lines'> {
  lines: ShipmentLineDetail[];
  /** 배정·취소를 바꿀 수 있는 상태 (배정 대기·배정 확정) */
  editable: boolean;
}

export interface ShippableCustomer {
  customerId: number;
  customerCode: string;
  customerName: string;
  /** 출하할 수 있는 수주 품목 수 */
  itemCount: number;
  /** 그 품목들의 수주 id (수주 화면에서 ?salesOrderId=로 들어올 때 고객사를 고른다) */
  salesOrderIds: number[];
}

export interface CreateShipmentRequestForm {
  customerId: number;
  requestedShipDate: string;
  /** 출하 매수는 입력한 글자 그대로 넘긴다 (지우거나 바꾸지 않는다, SO-002) */
  items: { salesOrderItemId: number; requestQty: string }[];
}

export const shipmentRequestApi = {
  list: () => serverShipmentRequestApi.list(),
  detail: (id: number) => serverShipmentRequestApi.detail(id),
  /** 출하요청 등록: 고객사마다 출하할 수 있는 품목 수 */
  shippableCustomers: () => serverShipmentRequestApi.shippableCustomers(),
  /** 이 고객사의 출하할 수 있는 수주 품목 (출하 가능 잔량 = ACTIVE 예약 − 진행 중 출하요청 매수) */
  shippableItems: (customerId: number) => serverShipmentRequestApi.shippableItems(customerId),
  /** 등록. 결과에 FIFO 추천이 함께 온다 (화면은 바로 배정 화면으로 가서 추천을 연다) */
  create: (input: CreateShipmentRequestForm) => serverShipmentRequestApi.create(input),
  /** 배정 확정 (품목마다 고른 LOT → CONFIRMED) */
  confirmAllocations: (input: { shipmentRequestId: number; lines: { shipmentRequestItemId: number; lotIds: number[] }[] }) => serverShipmentRequestApi.confirmAllocations(input),
  /** 배정 변경 = 기존 해제 + 새 배정 (사유 필수) */
  changeAllocation: (input: { allocationId: number; newLotId: number; reasonText: string }) => serverShipmentRequestApi.changeAllocation(input),
  releaseAllocation: (input: { allocationId: number; reasonText?: string | null }) => serverShipmentRequestApi.releaseAllocation(input),
  /** 취소: 출고 확정이면 SHP-003. 배정은 해제, 예약은 ACTIVE 그대로 */
  cancel: (input: { shipmentRequestId: number; expectedUpdatedAt?: string | null }) => serverShipmentRequestApi.cancel(input),
};
