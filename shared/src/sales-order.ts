// 수주 API 응답 타입 (docs/backend/sales-order.md). 톤은 소수 3자리 문자열, 매수는 정수.
import type { ItemType, ProductionPlanStatus, PurchaseOrderStatus, PurchaseRequisitionStatus, ReservationStatus, SalesOrderItemStatus, ShipmentRequestStatus } from './codes';

/**
 * 수주 품목 한 줄의 최대 매수 (가정값, #496). 문서에 상한이 없는데, 21억을 넘으면 DB 정수 범위 밖 오류가 나고
 * 100만 매 같은 오타는 거대한 생산계획을 만든다. 서버 수주 등록·화면 수주 폼·철강맨AI 수주 카드·메시지 수주 초안이 같은 값을 쓴다
 */
export const MAX_ORDERED_QTY = 9_999;

/** 매수가 상한을 넘었을 때 문구 (SO-002와 함께 보낸다) */
export const ORDERED_QTY_OVER_MESSAGE = `수량은 품목 한 줄에 ${MAX_ORDERED_QTY.toLocaleString('en-US')}까지 입력할 수 있어요`;

/** 진행률 같은 지표: 값과 분모를 함께 준다 (업무 프로세스 4.5 — 단계를 더해 주문보다 큰 값으로 보이지 않게) */
export interface ProgressMeasure {
  qty: number;
  denominatorQty: number;
  /** 0~1. 분모가 0이면 null */
  ratio: number | null;
}

/** 수주 품목 충족 현황 (REQ-SO-004, TRM-042) */
export interface SalesOrderItemFulfillment {
  salesOrderItemId: number;
  itemId: number;
  itemCode: string;
  itemName: string;
  itemType: ItemType;
  theoreticalWeightTon: string;
  orderedQty: number;
  /** 수주 톤 = 매수 × 1매 이론중량 (저장하지 않음) */
  orderedTon: string;
  dueDate: string;
  salesOrderItemStatus: SalesOrderItemStatus;
  /** 납기까지 남은 일수 ≤ 납기 위험 기준일이고 미출하 매수가 있으면 true (TRM-107) */
  isDueRisk: boolean;
  /** 출하 = 누적 출고 확정 매수 (CONVERTED 예약 합계) */
  shippedQty: number;
  /** 미출하 = 주문 − 출하 */
  unshippedQty: number;
  /** 예약 = ACTIVE 예약 매수 */
  activeReservedQty: number;
  /** 검사합격 = 예약 + 출하 (이 품목 몫으로 확보한 합격 제품) */
  passedQty: number;
  /** 생산중 = 진행중(IN_PROGRESS) 연결 계획의 잔여 목표 매수 */
  inProductionQty: number;
  /** 시작 전(PLANNED) 연결 계획의 잔여 목표 매수 */
  plannedQty: number;
  /** 현재 미확보 = max(0, 미출하 − 예약) */
  unsecuredQty: number;
  /** 추가 계획 필요 = max(0, 미확보 − 진행 계획 잔여 목표) */
  additionalPlanQty: number;
  /** 진행률 = 출하 ÷ 주문 */
  progress: ProgressMeasure;
  /** 진행 계획 잔여 목표 = 생산중 + 시작 전 */
  openPlanRemainingQty: number;
  /** 같은 규격의 지금 예약 가용 (여재 포함) */
  reservationAvailableQty: number;
  /** 재생산 필요 = max(0, 추가 계획 필요 − 예약 가용) (14.1-6) */
  reproductionNeedQty: number;
}

/** 목록 한 줄의 품목 요약 */
export interface SalesOrderItemLine {
  salesOrderItemId: number;
  itemId: number;
  itemName: string;
  itemType: ItemType;
  orderedQty: number;
  dueDate: string;
  salesOrderItemStatus: SalesOrderItemStatus;
}

export interface SalesOrderSummary {
  id: number;
  salesOrderNo: string;
  customerId: number;
  customerName: string;
  ownerEmployeeId: number;
  ownerEmployeeName: string;
  /** 헤더 상태: 저장하지 않고 품목 상태에서 계산 */
  salesOrderStatus: SalesOrderItemStatus;
  itemCount: number;
  totalOrderedQty: number;
  totalOrderedTon: string;
  totalShippedQty: number;
  /** ACTIVE 예약 매수 합계 */
  totalActiveReservedQty: number;
  /** 재생산이 필요한 품목이 있는지 (재생산 필요 매수 > 0, 14.1-6) */
  hasReproductionNeed: boolean;
  /** 취소 품목을 뺀 가장 이른 납기 */
  earliestDueDate: string | null;
  isDueRisk: boolean;
  /** 진행률 = 출하 ÷ 수주 매수 (취소 품목 제외) */
  progress: ProgressMeasure;
  createdAt: string;
  updatedAt: string;
  items: SalesOrderItemLine[];
}

export interface SalesOrderReservationView {
  id: number;
  salesOrderItemId: number;
  itemId: number;
  itemCode: string;
  itemName: string;
  reservedQty: number;
  reservationStatus: ReservationStatus;
  createdAt: string;
  updatedAt: string;
}

export interface SalesOrderProductionPlanView {
  id: number;
  productionPlanNo: string;
  salesOrderItemId: number;
  itemId: number;
  shortageQty: number;
  heatCount: number;
  isReproduction: boolean;
  productionPlanStatus: ProductionPlanStatus;
  /** 잔여 목표 = 시작 전·진행중 계획의 max(0, 부족 매수 − 합격 제품 매수) */
  remainingTargetQty: number;
}

export interface SalesOrderShipmentRequestView {
  id: number;
  shipmentRequestNo: string;
  shipmentRequestStatus: ShipmentRequestStatus;
  shipDate: string | null;
  issuedAt: string | null;
  /** allocatedQty = 확정·소진 배정 수 */
  items: { salesOrderItemId: number; requestQty: number; allocatedQty: number }[];
}

/** 취소로 일어난 일 (SALES_ORDER_CANCELLED 작업 로그의 after_data) */
export interface SalesOrderCancellation {
  cancelledAt: string;
  reason: string | null;
  releasedReservations: { salesOrderItemId: number; releasedQty: number }[];
  cancelledPlanNos: string[];
  unlinkedPlanNos: string[];
}

/** 취소를 막는 사유. null = 취소 가능, CANCELLED = 이미 취소됨(부분 출고 뒤 잔량 취소 포함), SO-003 = 전량 출고, SO-004 = 진행 중 출하요청 */
export type SalesOrderCancelBlock = 'SO-003' | 'SO-004' | 'CANCELLED' | null;

export interface SalesOrderDetail extends Omit<SalesOrderSummary, 'items'> {
  items: SalesOrderItemFulfillment[];
  productionPlans: SalesOrderProductionPlanView[];
  shipmentRequests: SalesOrderShipmentRequestView[];
  cancelBlock: SalesOrderCancelBlock;
  cancellation: SalesOrderCancellation | null;
}

export interface SalesOrderFulfillment {
  salesOrderId: number;
  salesOrderNo: string;
  salesOrderStatus: SalesOrderItemStatus;
  /** 진행률 = 출하 ÷ 수주 매수 (취소 품목 제외) */
  progress: ProgressMeasure;
  items: SalesOrderItemFulfillment[];
}

export interface CreateSalesOrderResult {
  salesOrderId: number;
  salesOrderNo: string;
  items: {
    salesOrderItemId: number;
    itemId: number;
    orderedQty: number;
    orderedTon: string;
    /** 재고 우선 예약 매수 */
    reservedQty: number;
    /** 생산계획으로 넘긴 부족 매수 */
    shortageQty: number;
    productionPlanNo: string | null;
  }[];
  totalReservedQty: number;
  totalShortageQty: number;
}

export interface CancelSalesOrderResult {
  salesOrderId: number;
  salesOrderNo: string;
  cancellation: SalesOrderCancellation;
}

/** 수주를 취소하면 생산계획이: CANCEL 시작 전 계획 취소 · UNLINK 진행중 계획의 수주 연결 해제(산출물은 여재) */
export type SalesOrderCancelPlanEffect = 'CANCEL' | 'UNLINK';

/**
 * 수주 취소 창의 구매 진행 영향 한 줄 (BP-PRD-01): 취소·연결 해제될 생산계획에 연결된 구매요청과 그 발주.
 * 수주 취소는 구매요청·발주를 바꾸지 않아 보여 주기만 한다.
 */
export interface SalesOrderCancelPurchaseImpactLine {
  purchaseRequisitionId: number;
  purchaseRequisitionNo: string;
  purchaseRequisitionStatus: PurchaseRequisitionStatus;
  itemName: string;
  requestedTon: string;
  productionPlanId: number;
  productionPlanNo: string;
  planEffect: SalesOrderCancelPlanEffect;
  /** 발주했으면 그 발주 (구매요청 1건 = 발주 품목 1행) */
  purchaseOrderId: number | null;
  purchaseOrderNo: string | null;
  purchaseOrderStatus: PurchaseOrderStatus | null;
}
