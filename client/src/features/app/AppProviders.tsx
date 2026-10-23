'use client';

// 앱 전체 공급자: TanStack Query, 이 탭의 세션 불러오기, 토스트
import { QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { createQueryClient } from '@/api/queryClient';
import { FullScreenState } from '@/components/StateView';
import { Toaster } from '@/components/Toaster';
import { useSessionHydration } from '@/hooks/useSessionHydration';
import { watchSessionChange } from '@/lib/sessionReset';

function SessionGate({ children }: { children: ReactNode }) {
  const ready = useSessionHydration();
  if (!ready) return <FullScreenState kind="loading" title="데이터를 준비하는 중…" />;
  return <>{children}</>;
}

export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createQueryClient);
  // 로그아웃·다른 사원 로그인 때 앞 사원의 조회 캐시와 보내기 실패 메시지를 비운다
  useEffect(() => watchSessionChange(queryClient), [queryClient]);
  return (
    <QueryClientProvider client={queryClient}>
      <SessionGate>{children}</SessionGate>
      <Toaster />
    </QueryClientProvider>
  );
}
