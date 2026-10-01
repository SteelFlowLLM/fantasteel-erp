// 발주 조회·확정 훅
import { useQuery } from '@tanstack/react-query';
import { purchaseOrderApi, purchaseOrderKeys, type PurchaseOrderCreateInput, type PurchaseOrderView } from '@/api/purchasing';
import { useAction, type ActionOptions } from '@/hooks/useAction';

export function usePurchaseOrderList(enabled = true) {
  return useQuery({ queryKey: purchaseOrderKeys.list(), queryFn: purchaseOrderApi.list, enabled });
}

export function usePurchaseOrderCandidateItems(enabled = true) {
  return useQuery({ queryKey: purchaseOrderKeys.candidateItems(), queryFn: purchaseOrderApi.candidateItems, enabled });
}

export function useCreatePurchaseOrders(options: ActionOptions<PurchaseOrderCreateInput, PurchaseOrderView[]> = {}) {
  return useAction(purchaseOrderApi.create, { invalidate: [purchaseOrderKeys.all], ...options });
}
