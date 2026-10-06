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
  /** 마지막 변경 시각 (취소된 요청이면 취소 시각) */
  updatedAt: string;
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

/** 밀시트 목록 한 줄 (API-232). 발행 뒤 바뀌지 않는 번호·시각만 보여 준다 */
export interface MillSheetSummary {
  id: number;
  millSheetNo: string;
  shipmentRequestId: number;
  shipmentRequestNo: string;
  salesOrderId: number;
  salesOrderNo: string;
  issuedAt: string;
  /** PDF를 만든 적이 있으면 Storage 경로 */
  pdfPath: string | null;
}

/**
 * 밀시트 조회 (API-233). snapshot은 출고 확정 때 저장한 값 그대로이고 현재 값을 다시 읽지 않는다 (REQ-SHP-003·004).
 * snapshot의 모양은 출고 확정(밀시트 생성)을 구현할 때 정한다.
 */
export interface MillSheetDetail extends MillSheetSummary {
  snapshot: unknown;
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
  /** 상위 히트 번호 (슬래브는 부모 히트, 코일은 슬래브를 거친 히트) */
  heatNo: string | null;
  yardId: number | null;
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
  heatNo: string | null;
  yardId: number | null;
  /** 앞에서부터 미배정 매수만큼 추천 */
  isRecommended: boolean;
}

/**
 * 출하요청 품목별 배정 후보 (GET allocations/recommendations, 작업 로그 없음).
 * 같은 규격 품목이 여러 줄이면 앞 줄이 추천받은 LOT은 뒤 줄 추천에서 뺀다.
 */
export interface ShipmentAllocationCandidates {
  shipmentRequestItemId: number;
  salesOrderItemId: number;
  itemId: number;
  requestQty: number;
  /** 확정 배정 수 */
  allocatedQty: number;
  unallocatedQty: number;
  candidates: AllocationCandidate[];
}

export interface AllocationRecommendation {
  allocationPurpose: AllocationPurpose;
  shipmentRequestItemId: number;
  itemId: number;
  unallocatedQty: number;
  candidates: AllocationCandidate[];
}
