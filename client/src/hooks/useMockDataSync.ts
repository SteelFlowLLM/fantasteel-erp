import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { mockDataApi } from '@/api/mockData';
import { useSessionStore } from '@/stores/useSessionStore';

/**
 * 브라우저에서 가짜 DB와 이 탭의 세션을 불러온다. 다 불러오기 전에는 false라서
 * 서버 렌더링 결과와 첫 화면이 같다(하이드레이션 불일치 없음).
 * 다른 탭이 데이터를 바꾸거나 시드로 초기화하면 모든 조회를 무효화한다.
 */
export function useMockDataSync(): boolean {
  const queryClient = useQueryClient();
  const hydrateSession = useSessionStore((state) => state.hydrate);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const stop = mockDataApi.start((source) => {
      if (source !== 'local') void queryClient.invalidateQueries();
    });
    hydrateSession();
    setReady(true);
    return stop;
  }, [queryClient, hydrateSession]);

  return ready;
}
