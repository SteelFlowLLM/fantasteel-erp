// 변경 요청 공통 훅: 실패하면 오류를 토스트로 보이고, 성공하면 조회를 무효화하고 안내한다 (옛 hooks/useApi.ts).
// const save = useAction(salesOrderApi.create, { success: '수주를 등록했어요' });
// 한 번의 변경이 여러 화면(수주·재고·LOT·알림 배지 …)에 걸치므로, 성공하면 업무 데이터 조회를 모두 무효화한다 (세션·검색·AI 연결 같은 독립 조회는 제외, api/queryRefresh.ts).
import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { isStaleError, refreshAfterAction } from '@/api/queryRefresh';
import { toast } from '@/stores/useToastStore';

export interface ActionOptions<TInput, TOutput> {
  success?: string | ((data: TOutput) => string);
  /** 먼저 다시 불러올 조회 키 앞부분. 그 밖의 조회도 모두 무효화된다. */
  invalidate?: readonly QueryKey[];
  onSuccess?: (data: TOutput, input: TInput) => void;
  onError?: (error: unknown, input: TInput) => void;
  /** false면 실패 토스트를 띄우지 않는다 (화면에서 직접 보일 때) */
  toastOnError?: boolean;
  /** true면 "그 사이 다른 곳에서 먼저 고쳤다"(COM-001)로 막혔을 때 조회를 다시 불러온다: 화면이 옛 수정 시각을 들고 같은 오류를 되풀이하지 않게 */
  refreshOnStale?: boolean;
  /** COM-001로 막혀 조회를 다시 불러온 뒤에 부른다 (예: 옛 값으로 열린 수정 창을 닫아 새 값으로 다시 열게) */
  onStale?: (input: TInput) => void;
}

/**
 * 성공한 뒤의 순서. 저장·확정 안내(토스트)는 다시 불러오기를 기다리지 않고 바로 띄운다(느릴 때 안내가 20초 넘게 늦었다).
 * options.onSuccess는 새 데이터에 기대는 곳이 있어 다시 불러오기가 끝난 뒤에 부른다.
 */
export async function afterActionSuccess<TInput, TOutput>(refresh: () => Promise<void>, options: ActionOptions<TInput, TOutput>, data: TOutput, input: TInput): Promise<void> {
  if (options.success) toast.ok(typeof options.success === 'function' ? options.success(data) : options.success);
  await refresh();
  options.onSuccess?.(data, input);
}

export function useAction<TInput, TOutput>(fn: (input: TInput) => Promise<TOutput>, options: ActionOptions<TInput, TOutput> = {}) {
  const queryClient = useQueryClient();
  return useMutation<TOutput, unknown, TInput>({
    mutationFn: fn,
    onSuccess: (data, input) => afterActionSuccess(() => refreshAfterAction(queryClient, options.invalidate), options, data, input),
    onError: async (error, input) => {
      if (options.toastOnError !== false) toast.apiError(error);
      options.onError?.(error, input);
      if (options.refreshOnStale && isStaleError(error)) {
        await refreshAfterAction(queryClient, options.invalidate);
        options.onStale?.(input);
      }
    },
  });
}
