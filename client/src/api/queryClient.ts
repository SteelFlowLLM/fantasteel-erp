import { QueryClient } from '@tanstack/react-query';

// 조회 키의 첫 요소는 API 복수 명사(예: 'employees', 'product-specs')로 둔다.
// 저장·확정 후에는 그 주제로 시작하는 조회를 무효화하고, 다른 탭의 변경은 전체를 무효화한다.
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: false,
      },
      mutations: {
        retry: false,
      },
    },
  });
}
