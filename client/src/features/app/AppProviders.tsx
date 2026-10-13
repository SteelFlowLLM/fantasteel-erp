'use client';

// 앱 전체 공급자: TanStack Query, 이 탭의 세션 불러오기, 토스트
import { QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { createQueryClient } from '@/api/queryClient';
import { FullScreenState } from '@/components/StateView';
import { Toaster } from '@/components/Toaster';
import { useSessionHydration } from '@/hooks/useSessionHydration';

function SessionGate({ children }: { children: ReactNode }) {
  const ready = useSessionHydration();
  if (!ready) return <FullScreenState kind="loading" title="데이터를 준비하는 중…" />;
  return <>{children}</>;
}

export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <SessionGate>{children}</SessionGate>
      <Toaster />
    </QueryClientProvider>
  );
}
