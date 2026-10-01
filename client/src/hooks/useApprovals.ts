// 승인함 훅: 부서장의 승인 대기 구매요청과 승인·반려
import { useQuery } from '@tanstack/react-query';
import { approvalApi, approvalKeys, type ApprovalInput, type RejectInput } from '@/api/approvals';
import type { RequisitionView } from '@/api/purchasing';
import { useAction, type ActionOptions } from '@/hooks/useAction';

export function useApprovalInbox(enabled = true) {
  return useQuery({ queryKey: approvalKeys.inbox(), queryFn: approvalApi.inbox, enabled });
}

export function useApproveRequisition(options: ActionOptions<ApprovalInput, RequisitionView> = {}) {
  return useAction(approvalApi.approve, { invalidate: [approvalKeys.all], success: '승인했어요. 구매 담당이 발주할 수 있어요', ...options });
}

/** 반려. 사유 입력 오류는 입력칸 아래에 보이므로 토스트를 띄우지 않는다. */
export function useRejectRequisition(options: ActionOptions<RejectInput, RequisitionView> = {}) {
  return useAction(approvalApi.reject, { invalidate: [approvalKeys.all], success: '반려했어요. 요청자에게 사유가 전달돼요', toastOnError: false, ...options });
}
