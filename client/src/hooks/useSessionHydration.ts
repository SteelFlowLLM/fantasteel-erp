import { useEffect, useState } from 'react';
import { useSessionStore } from '@/stores/useSessionStore';

/**
 * 브라우저에서 이 탭의 세션을 불러온다. 다 불러오기 전에는 false라서
 * 서버 렌더링 결과와 첫 화면이 같다(하이드레이션 불일치 없음).
 */
export function useSessionHydration(): boolean {
  const hydrateSession = useSessionStore((state) => state.hydrate);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    hydrateSession();
    setReady(true);
  }, [hydrateSession]);

  return ready;
}
