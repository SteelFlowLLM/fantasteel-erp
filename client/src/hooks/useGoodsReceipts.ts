// 입고 조회·확정 훅
import { useQuery } from '@tanstack/react-query';
import { goodsReceiptApi, goodsReceiptKeys, type GoodsReceiptInput, type GoodsReceiptResult } from '@/api/goodsReceipts';
import { useAction, type ActionOptions } from '@/hooks/useAction';

export function useReceiptLines(enabled = true) {
  return useQuery({ queryKey: goodsReceiptKeys.lines(), queryFn: goodsReceiptApi.lines, enabled });
}

export function useGoodsReceiptList(enabled = true) {
  return useQuery({ queryKey: goodsReceiptKeys.list(), queryFn: goodsReceiptApi.list, enabled });
}

/** 입고 확정. 입력 오류는 입력칸 아래에 보이므로 토스트를 띄우지 않는다. */
export function useReceiveGoods(options: ActionOptions<GoodsReceiptInput, GoodsReceiptResult> = {}) {
  return useAction(goodsReceiptApi.receive, { invalidate: [goodsReceiptKeys.all], toastOnError: false, ...options });
}
