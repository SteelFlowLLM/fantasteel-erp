// 구매요청 조회·등록·재요청 훅
import { useQuery } from '@tanstack/react-query';
import {
  purchaseRequisitionApi,
  purchaseRequisitionKeys,
  type RequisitionInput,
  type RequisitionResubmitInput,
  type RequisitionView,
} from '@/api/purchasing';
import { useAction, type ActionOptions } from '@/hooks/useAction';

export function usePurchaseRequisitionList(enabled = true) {
  return useQuery({ queryKey: purchaseRequisitionKeys.list(), queryFn: purchaseRequisitionApi.list, enabled });
}

export function usePurchaseRequisitionDetail(id: number | null) {
  return useQuery({
    queryKey: purchaseRequisitionKeys.detail(id ?? 0),
    queryFn: () => purchaseRequisitionApi.detail(id ?? 0),
    enabled: id !== null,
  });
}

export function usePurchaseRequisitionFormContext() {
  return useQuery({ queryKey: purchaseRequisitionKeys.formContext(), queryFn: purchaseRequisitionApi.formContext });
}

/** 등록. 입력 오류는 창 안에 보이므로 토스트를 띄우지 않는다. */
export function useCreatePurchaseRequisition(options: ActionOptions<RequisitionInput, RequisitionView> = {}) {
  return useAction(purchaseRequisitionApi.create, { invalidate: [purchaseRequisitionKeys.all], toastOnError: false, ...options });
}

/** 반려 뒤 고쳐 다시 요청 */
export function useResubmitPurchaseRequisition(options: ActionOptions<RequisitionResubmitInput, RequisitionView> = {}) {
  return useAction(purchaseRequisitionApi.resubmit, { invalidate: [purchaseRequisitionKeys.all], toastOnError: false, ...options });
}
