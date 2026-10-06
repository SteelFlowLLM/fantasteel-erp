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

/** 밀시트에 찍는 검사 한 건 (슬래브·코일 또는 히트). 기준(min·max)은 발행 시점 값을 복사해 둔다 */
export interface MillSheetInspectionSnapshot {
  lotNo: string;
  processType: string;
  inspectionStandardCode: string;
  version: number;
  inspectionResult: string;
  inspectedAt: string;
  values: {
    inspectionItemCode: string;
    inspectionItemName: string;
    unit: string | null;
    /** 소수 4자리 문자열 */
    minValue: string | null;
    maxValue: string | null;
    measuredValue: string;
    /** 기준(이상·이하, 경계 포함) 안이면 true. 기준이 없으면 null */
    isPassed: boolean | null;
  }[];
}

/** 밀시트의 출고 LOT 1매. 기존 재고와 새 생산분이 섞이면 LOT마다 다른 히트 값이 그대로 들어간다 */
export interface MillSheetLotSnapshot {
  lotId: number;
  lotNo: string;
  lotType: string;
  producedDate: string | null;
  /** 1매 이론중량(t), 소수 3자리 */
  theoreticalWeightTon: string;
  heatLotId: number | null;
  heatNo: string | null;
  /** 코일이면 투입한 슬래브 LOT 번호 */
  slabNo: string | null;
  /** 슬래브 검사 또는 코일 검사 */
  productInspection: MillSheetInspectionSnapshot | null;
}

export interface MillSheetItemSnapshot {
  salesOrderItemId: number;
  itemId: number;
  itemCode: string;
  itemName: string;
  itemType: string;
  steelGradeCode: string | null;
  /** KS 규격 번호 (TRM-113) */
  standardNo: string | null;
  thicknessMm: string | null;
  widthMm: string | null;
  lengthMm: string | null;
  theoreticalWeightTon: string;
  /** 이번 출고 매수 */
  qty: number;
  totalWeightTon: string;
  lots: MillSheetLotSnapshot[];
}

export interface MillSheetHeatSnapshot {
  heatLotId: number;
  heatNo: string;
  converterCode: string | null;
  producedDate: string | null;
  steelGradeCode: string | null;
  /** 히트 성분 검사 */
  inspection: MillSheetInspectionSnapshot | null;
}

/** 밀시트 스냅샷: 출고 확정 때 한 번 만들고 이후 바꾸지 않는다 (REQ-SHP-003, TRM-083) */
export interface MillSheetSnapshot {
  millSheetNo: string;
  issuedAt: string;
  issuedDate: string;
  customer: { customerId: number; customerCode: string; customerName: string };
  salesOrder: { salesOrderId: number; salesOrderNo: string };
  shipmentRequest: { shipmentRequestId: number; shipmentRequestNo: string; shipDate: string | null; issuedAt: string | null; issuedEmployeeName: string | null };
  items: MillSheetItemSnapshot[];
  heats: MillSheetHeatSnapshot[];
  totalQty: number;
  totalWeightTon: string;
  /** 스냅샷에 들어간 제품·히트 LOT id (측정값 수정 차단 확인용) */
  lotIds: number[];
}

/** 밀시트 조회 (API-233). snapshot은 출고 확정 때 저장한 값 그대로이고 현재 값을 다시 읽지 않는다 (REQ-SHP-003·004) */
export interface MillSheetDetail extends MillSheetSummary {
  snapshot: MillSheetSnapshot;
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
