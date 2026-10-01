// 출고 확정 조회·변경 훅 (TanStack Query)
import { useQuery } from '@tanstack/react-query';
import { goodsIssueApi, goodsIssueKeys } from '@/api/goodsIssues';
import { useAction } from '@/hooks/useAction';
import { withEulReul } from '@/lib/josa';

export function useGoodsIssueQueue() {
  return useQuery({ queryKey: goodsIssueKeys.queue(), queryFn: goodsIssueApi.queue });
}

export function useGoodsIssueDetail(shipmentRequestId: number | null) {
  return useQuery({
    queryKey: goodsIssueKeys.detail(shipmentRequestId ?? 0),
    queryFn: () => goodsIssueApi.detail(shipmentRequestId ?? 0),
    enabled: shipmentRequestId !== null,
  });
}

/** 실패는 화면 배너로 보이므로 토스트를 띄우지 않는다 */
export function useConfirmGoodsIssue(options: { onSuccess?: () => void; onError?: (error: unknown) => void } = {}) {
  return useAction(goodsIssueApi.confirm, {
    success: (r) => `출하요청 ${withEulReul(r.shipmentRequestNo)} 출고 확정했어요 · 밀시트 ${r.millSheets.length}장 발행`,
    invalidate: [goodsIssueKeys.all],
    toastOnError: false,
    onSuccess: () => options.onSuccess?.(),
    onError: (error) => options.onError?.(error),
  });
}
