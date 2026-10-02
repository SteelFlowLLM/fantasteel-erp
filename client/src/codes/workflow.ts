// 수주·생산·구매·품질·출하 상태 공통 코드. 값·표시명은 공통 코드 정의서 그대로 (PLAN 4장).

/**
 * 수주 품목 상태. 헤더 상태는 품목 상태에서 계산한다.
 * 예약 완료·생산 중·출하 대기·납기 위험은 계산해서 보여 주는 값이라 저장하지 않는다.
 */
export const SALES_ORDER_ITEM_STATUS = {
  OPEN: 'OPEN',
  PARTIALLY_SHIPPED: 'PARTIALLY_SHIPPED',
  SHIPPED: 'SHIPPED',
  CANCELLED: 'CANCELLED',
} as const;
export type SalesOrderItemStatus = (typeof SALES_ORDER_ITEM_STATUS)[keyof typeof SALES_ORDER_ITEM_STATUS];
export const SALES_ORDER_ITEM_STATUS_LABEL: Record<SalesOrderItemStatus, string> = {
  OPEN: '진행중',
  PARTIALLY_SHIPPED: '부분출하',
  SHIPPED: '출하완료',
  CANCELLED: '취소',
};

/** 첫 실적 등록 때 IN_PROGRESS가 되고, PLANNED일 때만 취소할 수 있다. 편성 확정 상태는 따로 두지 않는다. */
export const PRODUCTION_PLAN_STATUS = {
  PLANNED: 'PLANNED',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;
export type ProductionPlanStatus = (typeof PRODUCTION_PLAN_STATUS)[keyof typeof PRODUCTION_PLAN_STATUS];
export const PRODUCTION_PLAN_STATUS_LABEL: Record<ProductionPlanStatus, string> = {
  PLANNED: '계획',
  IN_PROGRESS: '진행중',
  COMPLETED: '완료',
  CANCELLED: '취소',
};

/** 임시 저장은 없다. 반려되면 요청자가 고쳐 다시 승인 대기로 보낸다. */
export const PURCHASE_REQUISITION_STATUS = {
  WAITING_APPROVAL: 'WAITING_APPROVAL',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  ORDERED: 'ORDERED',
} as const;
export type PurchaseRequisitionStatus = (typeof PURCHASE_REQUISITION_STATUS)[keyof typeof PURCHASE_REQUISITION_STATUS];
export const PURCHASE_REQUISITION_STATUS_LABEL: Record<PurchaseRequisitionStatus, string> = {
  WAITING_APPROVAL: '승인 대기',
  APPROVED: '승인',
  REJECTED: '반려',
  ORDERED: '발주 완료',
};

export const PURCHASE_ORDER_STATUS = {
  CONFIRMED: 'CONFIRMED',
  PARTIALLY_RECEIVED: 'PARTIALLY_RECEIVED',
  RECEIVED: 'RECEIVED',
} as const;
export type PurchaseOrderStatus = (typeof PURCHASE_ORDER_STATUS)[keyof typeof PURCHASE_ORDER_STATUS];
export const PURCHASE_ORDER_STATUS_LABEL: Record<PurchaseOrderStatus, string> = {
  CONFIRMED: '발주 확정',
  PARTIALLY_RECEIVED: '부분 입고',
  RECEIVED: '입고 완료',
};

/** PENDING = 판정 대기 (필수 항목·기준 누락 포함) */
export const INSPECTION_RESULT = {
  PENDING: 'PENDING',
  PASS: 'PASS',
  FAIL: 'FAIL',
} as const;
export type InspectionResult = (typeof INSPECTION_RESULT)[keyof typeof INSPECTION_RESULT];
export const INSPECTION_RESULT_LABEL: Record<InspectionResult, string> = {
  PENDING: '판정 대기',
  PASS: '합격',
  FAIL: '불합격',
};

/** 불합격 판정 때는 값 없이 두고 품질 담당이 지정한다 */
export const DISPOSITION_STATUS = {
  HOLD: 'HOLD',
  DOWNGRADED: 'DOWNGRADED',
  SCRAPPED: 'SCRAPPED',
} as const;
export type DispositionStatus = (typeof DISPOSITION_STATUS)[keyof typeof DISPOSITION_STATUS];
export const DISPOSITION_STATUS_LABEL: Record<DispositionStatus, string> = {
  HOLD: '보류',
  DOWNGRADED: '격하',
  SCRAPPED: '폐기',
};

export const SHIPMENT_REQUEST_STATUS = {
  REQUESTED: 'REQUESTED',
  ALLOCATED: 'ALLOCATED',
  ISSUED: 'ISSUED',
  CANCELLED: 'CANCELLED',
} as const;
export type ShipmentRequestStatus = (typeof SHIPMENT_REQUEST_STATUS)[keyof typeof SHIPMENT_REQUEST_STATUS];
export const SHIPMENT_REQUEST_STATUS_LABEL: Record<ShipmentRequestStatus, string> = {
  REQUESTED: '배정 대기',
  ALLOCATED: '배정 확정',
  ISSUED: '출고 완료',
  CANCELLED: '취소',
};
