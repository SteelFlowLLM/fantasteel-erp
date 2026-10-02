// shipment 모듈 응답 타입 (REQ-SHP-001). 이름은 ERD 컬럼명, 날짜는 'YYYY-MM-DD', 시각은 ISO 8601.
import type { AllocationPurpose, AllocationStatus, ItemType, LotStatus, ShipmentRequestStatus } from './codes';

export interface ShipmentRequestSummary {
  id: number;
  shipmentRequestNo: string;
  customerId: number;
  customerName: string;
  shipDate: string | null;
  shipmentRequestStatus: ShipmentRequestStatus;
  /** 품목별 요청 매수 합계 */
  totalRequestQty: number;
  issuedAt: string | null;
  createdAt: string;
}

export interface ShipmentRequestAllocation {
  allocationId: number;
  lotId: number;
  lotNo: string;
  allocationStatus: AllocationStatus;
}

export interface ShipmentRequestItemDetail {
  id: number;
  salesOrderItemId: number;
  salesOrderId: number;
  salesOrderNo: string;
  itemId: number;
  itemCode: string;
  itemName: string;
  requestQty: number;
  /** 미배정 매수 = 요청 매수 − CONFIRMED 배정 수 (TRM-115). 0보다 크면 배정 대기 */
  unallocatedQty: number;
  /** 해제(RELEASED)된 배정은 빼고 보여 준다 */
  allocations: ShipmentRequestAllocation[];
}

export interface ShipmentRequestDetail extends ShipmentRequestSummary {
  issuedEmployeeId: number | null;
  issuedEmployeeName: string | null;
  items: ShipmentRequestItemDetail[];
}

/** 출하 가능 품목 (같은 고객사의 수주 품목만 한 출하요청으로 묶는다) */
export interface ShippableSalesOrderItem {
  salesOrderId: number;
  salesOrderNo: string;
  salesOrderItemId: number;
  customerId: number;
  customerName: string;
  itemId: number;
  itemCode: string;
  itemName: string;
  itemType: ItemType;
  orderedQty: number;
  dueDate: string;
  /** ACTIVE 예약 매수 */
  activeReservedQty: number;
  /** 진행 중(배정 대기·배정 확정) 출하요청에 이미 담긴 매수 */
  pendingRequestQty: number;
  /** 출하 가능 = 예약 − 진행 중 출하요청 매수 */
  shippableQty: number;
}

/** 배정 (allocations API 응답) */
export interface AllocationView {
  id: number;
  allocationPurpose: AllocationPurpose;
  allocationStatus: AllocationStatus;
  lotId: number;
  lotNo: string;
  producedDate: string | null;
  lotStatus: LotStatus;
  shipmentRequestItemId: number | null;
  productionPlanId: number | null;
  createdAt: string;
  updatedAt: string;
}

/** 배정 후보 LOT (FIFO: 생산완료일 오래된 순, 같으면 LOT 번호 순) */
export interface AllocationCandidate {
  lotId: number;
  lotNo: string;
  producedDate: string | null;
  /** 앞에서부터 미배정 매수만큼 추천 */
  isRecommended: boolean;
}

export interface AllocationRecommendation {
  allocationPurpose: AllocationPurpose;
  shipmentRequestItemId: number;
  itemId: number;
  unallocatedQty: number;
  candidates: AllocationCandidate[];
}
