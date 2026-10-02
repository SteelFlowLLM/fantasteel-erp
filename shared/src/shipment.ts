// shipment 모듈 응답 타입 (REQ-SHP-001). 이름은 ERD 컬럼명, 날짜는 'YYYY-MM-DD', 시각은 ISO 8601.
import type { AllocationStatus, ShipmentRequestStatus } from './codes';

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
