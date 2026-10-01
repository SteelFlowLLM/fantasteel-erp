// 변경 요청 공통 훅: 실패하면 오류를 토스트로 보이고, 성공하면 조회를 무효화하고 안내한다 (옛 hooks/useApi.ts).
// const save = useAction(salesOrderApi.create, { success: '수주를 등록했어요' });
// 가짜 DB는 한 번의 변경이 여러 화면(수주·재고·LOT·알림 배지 …)에 걸치므로, 성공하면 모든 조회를 무효화한다.
import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { toast } from '@/stores/useToastStore';

export interface ActionOptions<TInput, TOutput> {
  success?: string | ((data: TOutput) => string);
  /** 먼저 다시 불러올 조회 키 앞부분. 그 밖의 조회도 모두 무효화된다. */
  invalidate?: readonly QueryKey[];
  onSuccess?: (data: TOutput, input: TInput) => void;
  onError?: (error: unknown, input: TInput) => void;
  /** false면 실패 토스트를 띄우지 않는다 (화면에서 직접 보일 때) */
  toastOnError?: boolean;
}

export function useAction<TInput, TOutput>(fn: (input: TInput) => Promise<TOutput>, options: ActionOptions<TInput, TOutput> = {}) {
  const queryClient = useQueryClient();
  return useMutation<TOutput, unknown, TInput>({
    mutationFn: fn,
    onSuccess: async (data, input) => {
      await Promise.all((options.invalidate ?? []).map((queryKey) => queryClient.invalidateQueries({ queryKey })));
      await queryClient.invalidateQueries();
      if (options.success) toast.ok(typeof options.success === 'function' ? options.success(data) : options.success);
      options.onSuccess?.(data, input);
    },
    onError: (error, input) => {
      if (options.toastOnError !== false) toast.apiError(error);
      options.onError?.(error, input);
    },
  });
}
