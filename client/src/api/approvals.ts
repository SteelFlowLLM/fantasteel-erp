// 승인함 (REQ-PUR-002, REQ-AUTH-004): 구매요청은 요청 시점 요청자 소속 부서(purchase_requisition.department_id)의 부서장이 승인한다.
// 승인·반려는 권한 코드가 아니라 "요청 부서의 부서장인지"로 판단한다. 결과 알림(APPROVAL_RESULT)·작업 로그는 core 서비스가 남긴다.
// NEXT_PUBLIC_DATA_SOURCE=server면 실제 서버를 부른다 (api/server/purchaseRequisitions.ts, 승인함 = GET purchase-requisitions?approvable=true).
import { requireDepartmentHead } from '@/api/actor';
import { mockMutation, mockQuery } from '@/api/client';
import { isServerDataSource } from '@/api/http';
import { serverApprovalApi } from '@/api/server/purchaseRequisitions';
import { approvalInbox, approvePurchaseRequisition, rejectPurchaseRequisition, requisitionDepartmentId, requisitionView, userActor, type RequisitionView } from '@/mock/services';

export const approvalKeys = {
  all: ['purchase-requisitions', 'approvals'] as const,
  inbox: () => ['purchase-requisitions', 'approvals', 'inbox'] as const,
};

export interface ApprovalInput {
  purchaseRequisitionId: number;
  /** 화면을 연 시점의 updatedAt (그사이 바뀌었으면 COM-001) */
  expectedUpdatedAt: string;
}

export interface RejectInput extends ApprovalInput {
  rejectReason: string;
}

export const approvalApi = {
  /** 셸 배지: 이 사원이 승인할 구매요청 수 */
  countWaiting: (employeeId: number): Promise<number> =>
    isServerDataSource()
      ? serverApprovalApi.countWaiting()
      : mockQuery((tables) => {
          const headOf = new Set(tables.department.filter((d) => d.headEmployeeId === employeeId).map((d) => d.id));
          return tables.purchaseRequisition.filter((purchaseRequisition) => purchaseRequisition.purchaseRequisitionStatus === 'WAITING_APPROVAL' && headOf.has(requisitionDepartmentId(tables, purchaseRequisition) ?? 0)).length;
        }),

  /** 승인함: 내가 부서장인 부서의 승인 대기 구매요청 (먼저 온 것부터). 부서장이 아니면 COM-002. */
  inbox: (): Promise<RequisitionView[]> =>
    isServerDataSource()
      ? serverApprovalApi.inbox()
      : mockQuery((tables) => {
          const actor = requireDepartmentHead(tables);
          return approvalInbox(tables, actor.employee.id);
        }),

  /** 승인 → 요청자에게 결과 알림, 구매 담당이 발주할 수 있다 */
  approve: (input: ApprovalInput): Promise<RequisitionView> =>
    isServerDataSource()
      ? serverApprovalApi.approve(input)
      : mockMutation((tx) => {
          const actor = requireDepartmentHead(tx.tables);
          const updated = approvePurchaseRequisition(tx, userActor(actor.employee.id), input);
          return requisitionView(tx.tables, updated);
        }),

  /** 반려 (사유 필수) → 요청자에게 사유와 함께 결과 알림 */
  reject: (input: RejectInput): Promise<RequisitionView> =>
    isServerDataSource()
      ? serverApprovalApi.reject(input)
      : mockMutation((tx) => {
          const actor = requireDepartmentHead(tx.tables);
          const updated = rejectPurchaseRequisition(tx, userActor(actor.employee.id), input);
          return requisitionView(tx.tables, updated);
        }),
};
