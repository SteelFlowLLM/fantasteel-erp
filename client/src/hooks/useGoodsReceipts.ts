// 입고 조회·확정·취소 훅
import { useQuery } from '@tanstack/react-query';
import { goodsReceiptApi, goodsReceiptKeys, type GoodsReceiptCancelInput, type GoodsReceiptInput, type GoodsReceiptResult, type GoodsReceiptView } from '@/api/goodsReceipts';
import { inventoryKeys } from '@/api/inventories';
import { lotTraceKeys } from '@/api/lotTrace';
import { mrpKeys } from '@/api/mrp';
import { purchaseOrderKeys } from '@/api/purchasing';
import { useAction, type ActionOptions } from '@/hooks/useAction';

export function useReceiptLines(enabled = true) {
  return useQuery({ queryKey: goodsReceiptKeys.lines(), queryFn: goodsReceiptApi.lines, enabled });
}

export function useGoodsReceiptList(enabled = true, withSupplierNames = true) {
  return useQuery({ queryKey: goodsReceiptKeys.list(withSupplierNames), queryFn: () => goodsReceiptApi.list(withSupplierNames), enabled });
}

/** 입고 확정. 입력 오류는 입력칸 아래에 보이므로 토스트를 띄우지 않는다. */
export function useReceiveGoods(options: ActionOptions<GoodsReceiptInput, GoodsReceiptResult> = {}) {
  return useAction(goodsReceiptApi.receive, { invalidate: [goodsReceiptKeys.all], toastOnError: false, ...options });
}

/** 입고 취소. 거부 이유(LOT을 썼음 등)는 확인 창에 보이므로 토스트를 띄우지 않는다 */
export function useCancelGoodsReceipt(options: ActionOptions<GoodsReceiptCancelInput, GoodsReceiptView> = {}) {
  // 원료 LOT이 입고 취소·잔량 0이 되고 입고예정이 되돌아온다: 재고·LOT 추적·MRP도 다시 읽는다
  return useAction(goodsReceiptApi.cancel, { invalidate: [goodsReceiptKeys.all, purchaseOrderKeys.all, inventoryKeys.all, lotTraceKeys.all, mrpKeys.all], toastOnError: false, ...options });
}
