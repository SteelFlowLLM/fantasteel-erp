import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './client';

// 쿼리 키 규칙: 첫 요소는 서버의 실시간 주제 이름(= API 복수 명사). 예: ['sales-orders', 'list', filters], ['sales-orders', id]
// 서버가 'changed' 이벤트로 주제를 보내면 그 주제로 시작하는 조회를 다시 불러온다.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5_000,
      refetchOnWindowFocus: false,
      retry: (count, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 1,
    },
  },
});

export function invalidateTopics(topics: string[]): void {
  for (const topic of topics) void queryClient.invalidateQueries({ queryKey: [topic] });
}
