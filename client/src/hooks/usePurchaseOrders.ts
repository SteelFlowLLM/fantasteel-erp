// 발주 조회·확정·취소·잔량 마감 훅
import { useQuery } from '@tanstack/react-query';
import { goodsReceiptKeys } from '@/api/goodsReceipts';
import { inventoryKeys } from '@/api/inventories';
import { mrpKeys } from '@/api/mrp';
import { purchaseOrderApi, purchaseOrderKeys, purchaseRequisitionKeys, type PurchaseOrderCreateInput, type PurchaseOrderReasonInput, type PurchaseOrderView } from '@/api/purchasing';

/** 발주 취소·잔량 마감이 바꾸는 조회: 발주·입고 줄, 구매요청 상태·재요청, MRP 입고예정·기존 요청, 원료 재고의 입고예정 */
const PURCHASE_ORDER_END_KEYS = [purchaseOrderKeys.all, goodsReceiptKeys.all, purchaseRequisitionKeys.all, mrpKeys.all, inventoryKeys.all] as const;
import { useAction, type ActionOptions } from '@/hooks/useAction';

export function usePurchaseOrderList(enabled = true) {
  return useQuery({ queryKey: purchaseOrderKeys.list(), queryFn: purchaseOrderApi.list, enabled });
}

export function usePurchaseOrderCandidateItems(enabled = true) {
  return useQuery({ queryKey: purchaseOrderKeys.candidateItems(), queryFn: purchaseOrderApi.candidateItems, enabled });
}

export function useCreatePurchaseOrders(options: ActionOptions<readonly PurchaseOrderCreateInput[], PurchaseOrderView[]> = {}) {
  return useAction(purchaseOrderApi.create, { invalidate: [purchaseOrderKeys.all], ...options });
}

/** 발주 취소. 거부 이유는 확인 창에 보이므로 토스트를 띄우지 않는다 */
export function useCancelPurchaseOrder(options: ActionOptions<PurchaseOrderReasonInput, PurchaseOrderView> = {}) {
  return useAction(purchaseOrderApi.cancel, { invalidate: PURCHASE_ORDER_END_KEYS, toastOnError: false, ...options });
}

/** 잔량 마감. 거부 이유는 확인 창에 보이므로 토스트를 띄우지 않는다 */
export function useClosePurchaseOrder(options: ActionOptions<PurchaseOrderReasonInput, PurchaseOrderView> = {}) {
  return useAction(purchaseOrderApi.close, { invalidate: PURCHASE_ORDER_END_KEYS, toastOnError: false, ...options });
}
