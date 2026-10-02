import { useMutation } from '@tanstack/react-query';
import { mockDataApi } from '@/api/mockData';
import { toast } from '@/stores/useToastStore';

/** 시드로 초기화. 모든 조회 무효화는 MockDbProvider가 초기화 알림을 받아 한다. */
export function useResetToSeed(onDone?: () => void) {
  return useMutation({
    mutationFn: mockDataApi.resetToSeed,
    onSuccess: () => {
      toast.ok('시드로 초기화했어요');
      onDone?.();
    },
    onError: (error) => toast.apiError(error),
  });
}
