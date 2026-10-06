// 구매 API 응답 타입 (docs/backend/purchasing.md). 톤은 소수 3자리 문자열.
import type { PurchaseRequisitionStatus } from './codes';

/** 구매요청 목록 한 줄 (API-141·210). ERD: 구매요청 1건 = 원료 1품목 */
export interface PurchaseRequisitionSummary {
  id: number;
  purchaseRequisitionNo: string;
  purchaseRequisitionStatus: PurchaseRequisitionStatus;
  itemId: number;
  itemCode: string;
  itemName: string;
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
