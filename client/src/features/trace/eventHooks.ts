// 작업 로그 조회 훅. 쿼리 키 첫 요소 'business-events' = 서버 실시간 주제 → 새 이벤트가 생기면 자동으로 다시 불린다.
import { useInfiniteQuery } from '@tanstack/react-query';
import { businessEventApi, type BusinessEventQuery } from '@/api/businessEvents';

export const EVENT_PAGE_SIZE = 50;

/** 커서 방식 목록: nextCursor를 같은 조건 그대로 다음 요청에 보낸다. */
export function useBusinessEvents(filters: Omit<BusinessEventQuery, 'cursor' | 'limit'>, enabled = true) {
  return useInfiniteQuery({
    queryKey: ['business-events', 'list', filters],
    queryFn: ({ pageParam }) => businessEventApi.list({ ...filters, limit: EVENT_PAGE_SIZE, cursor: pageParam }),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => (last.hasMore && last.nextCursor !== null ? last.nextCursor : undefined),
    enabled,
  });
}
