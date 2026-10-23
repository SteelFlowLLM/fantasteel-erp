// 구매 API 응답 타입 (docs/backend/purchasing.md). 톤은 소수 3자리 문자열.
import type { LotStatus, PurchaseOrderStatus, PurchaseRequisitionStatus } from './codes';

/** 구매요청 목록 한 줄 (API-141·210). ERD: 구매요청 1건 = 원료 1품목 */
export interface PurchaseRequisitionSummary {
  id: number;
  purchaseRequisitionNo: string;
  purchaseRequisitionStatus: PurchaseRequisitionStatus;
  itemId: number;
  itemCode: string;
  itemName: string;
  /** 원료의 기본 공급업체. 발주는 이 공급업체로만 한다 (발주 후보를 공급업체별로 묶을 때 쓴다) */
  defaultSupplierId: number | null;
  defaultSupplierName: string | null;
  requestedTon: string;
  desiredReceiptDate: string;
  requesterId: number;
  requesterName: string;
  /** 요청자 소속 부서 (구매요청에 저장하지 않고 요청자 사원에서 읽는다) */
  departmentId: number;
  departmentName: string;
  /** 승인·반려한 부서장 */
  approverId: number | null;
  approverName: string | null;
  approvedAt: string | null;
  productionPlanId: number | null;
  productionPlanNo: string | null;
  /** Message → ERP 초안으로 만든 요청이면 원본 초안 */
  actionDraftId: number | null;
  /** 발주했으면 발주번호 (발주 품목 1행 = 구매요청 1건) */
  purchaseOrderNo: string | null;
  /** 반려된 요청이면 마지막 반려 작업 로그 시각 (ERD에 칸이 없다) */
  rejectedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 구매요청 상세 (API-142·212): 요청 근거·반려 사유와 관련 수주 */
export interface PurchaseRequisitionDetail extends PurchaseRequisitionSummary {
  requestReason: string | null;
  rejectReason: string | null;
  /** 근거 계획이 수주에 연결돼 있을 때 (production_plan → sales_order_item → sales_order) */
  salesOrderId: number | null;
  salesOrderNo: string | null;
}

/** 발주 품목 1행 = 구매요청 1건. 입고 누계·미입고량은 저장하지 않고 입고 기록으로 계산한다 (ERD) */
export interface PurchaseOrderItemView {
  purchaseOrderItemId: number;
  purchaseRequisitionId: number;
  purchaseRequisitionNo: string;
  itemId: number;
  itemCode: string;
  itemName: string;
  orderedTon: string;
  expectedReceiptDate: string | null;
  /** 입고 누계 = 입고 기록 합계 */
  receivedTon: string;
  /** 미입고량(입고예정) = 발주량 − 입고 누계. 발주 취소·잔량 마감한 발주는 0 */
  remainingTon: string;
  /** 발주 취소·잔량 마감으로 닫은 양 (= 발주량 − 입고 누계, 그 상태일 때만. 아니면 0) */
  closedTon: string;
}

/** 발주 목록·상세 (API-147·148). 목록도 품목별 미입고량을 보여 주므로 같은 모양을 쓴다 */
export interface PurchaseOrderView {
  id: number;
  purchaseOrderNo: string;
  purchaseOrderStatus: PurchaseOrderStatus;
  supplierId: number;
  supplierName: string;
  /** 발주한 사원 (작업 로그 PURCHASE_ORDER_CREATED, ERD에 칸이 없다) */
  orderedEmployeeName: string | null;
  totalOrderedTon: string;
  totalReceivedTon: string;
  totalRemainingTon: string;
  totalClosedTon: string;
  /** 발주 취소·잔량 마감한 기록 (그 상태일 때만, 작업 로그 PURCHASE_ORDER_CANCELLED·CLOSED. ERD에 칸이 없다) */
  statusChange: PurchaseOrderStatusChange | null;
  createdAt: string;
  updatedAt: string;
  items: PurchaseOrderItemView[];
}

export interface PurchaseOrderStatusChange {
  reason: string | null;
  employeeName: string | null;
  at: string;
}

/**
 * 입고 기록 1건과 생성된 원료 LOT (API-150·219). 입고는 등록이 곧 확정이라 상태값이 없다.
 * 입고 취소는 원래 입고를 그대로 두고 음수 입고 1행(반대 거래)을 더한다. 취소 행은 LOT이 없다
 */
export interface GoodsReceiptView {
  id: number;
  goodsReceiptNo: string;
  purchaseOrderId: number;
  purchaseOrderNo: string;
  /** 발주 상태 (발주 조회 권한이 없어도 입고 화면이 취소·마감을 알 수 있게) */
  purchaseOrderStatus: PurchaseOrderStatus;
  purchaseOrderItemId: number;
  itemId: number;
  itemCode: string;
  itemName: string;
  receivedTon: string;
  /** 원료 FIFO 기준일 */
  receivedDate: string;
  lotId: number | null;
  lotNo: string | null;
  /** 생성된 원료 LOT의 지금 상태 (취소 행은 null) */
  lotStatus: LotStatus | null;
  yardId: number | null;
  yardName: string | null;
  /** 입고를 확정한 사원 (작업 로그 GOODS_RECEIPT_CONFIRMED, ERD에 칸이 없다). 취소 행이면 취소한 사원(GOODS_RECEIPT_CANCELLED) */
  confirmedEmployeeName: string | null;
  /** 이 행이 입고 취소면 취소한 원래 입고 (receivedTon은 음수) */
  reversedGoodsReceiptId: number | null;
  reversedGoodsReceiptNo: string | null;
  /** 이 입고를 취소했으면 취소 행의 입고번호 */
  reversalGoodsReceiptNo: string | null;
  /** 입고 취소 사유 (원래 입고·취소 행 모두, 작업 로그 GOODS_RECEIPT_CANCELLED) */
  cancelReason: string | null;
  /** 지금 입고 취소할 수 있는지: 원래 입고·아직 취소 안 함·원료 LOT을 안 씀(재고 상태·잔량 = 처음 양·투입·배정 없음)·취소한 발주 아님. 최종 판단은 취소할 때 서버가 다시 한다 */
  isCancellable: boolean;
  createdAt: string;
}
