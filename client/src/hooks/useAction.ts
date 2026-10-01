// 변경 요청 공통 훅: 실패하면 오류를 토스트로 보이고, 성공하면 관련 조회를 무효화하고 안내한다 (옛 hooks/useApi.ts).
// const save = useAction(salesOrderApi.create, { success: '수주를 등록했어요', invalidate: [['sales-orders']] });
import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { toast } from '@/stores/useToastStore';

export interface ActionOptions<TInput, TOutput> {
  success?: string | ((data: TOutput) => string);
  /** 성공 후 무효화할 조회 키 앞부분 (예: [['sales-orders'], ['inventories']]) */
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
      if (options.success) toast.ok(typeof options.success === 'function' ? options.success(data) : options.success);
      options.onSuccess?.(data, input);
    },
    onError: (error, input) => {
      if (options.toastOnError !== false) toast.apiError(error);
      options.onError?.(error, input);
    },
  });
}
