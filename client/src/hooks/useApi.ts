import { useMutation } from '@tanstack/react-query';
import { invalidateTopics } from '@/api/queryClient';
import { toast } from '@/stores/toast';

/**
 * 변경 요청 공통 훅: 실패하면 서버 메시지를 토스트로, 성공하면 안내 문구와 함께 관련 조회를 새로 불러온다.
 * const save = useAction((dto: Dto) => salesOrderApi.create(dto), { success: '수주를 등록했어요', invalidate: ['sales-orders'] });
 */
export function useAction<TInput, TOutput>(
  fn: (input: TInput) => Promise<TOutput>,
  options: { success?: string | ((data: TOutput) => string); invalidate?: string[]; onSuccess?: (data: TOutput, input: TInput) => void; onError?: (error: unknown, input: TInput) => void } = {},
) {
  return useMutation<TOutput, unknown, TInput>({
    mutationFn: fn,
    onSuccess: (data, input) => {
      if (options.invalidate?.length) invalidateTopics(options.invalidate);
      if (options.success) toast.ok(typeof options.success === 'function' ? options.success(data) : options.success);
      options.onSuccess?.(data, input);
    },
    onError: (e, input) => {
      toast.apiError(e);
      options.onError?.(e, input);
    },
  });
}
