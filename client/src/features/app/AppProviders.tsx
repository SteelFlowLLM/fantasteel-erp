'use client';

// 앱 전체 공급자: TanStack Query, 가짜 DB 불러오기·탭 동기화, 토스트
import { QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { createQueryClient } from '@/api/queryClient';
import { FullScreenState } from '@/components/StateView';
import { Toaster } from '@/components/Toaster';
import { useMockDataSync } from '@/hooks/useMockDataSync';

function MockDataGate({ children }: { children: ReactNode }) {
  const ready = useMockDataSync();
  if (!ready) return <FullScreenState kind="loading" title="데이터를 준비하는 중…" />;
  return <>{children}</>;
}

export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <MockDataGate>{children}</MockDataGate>
      <Toaster />
    </QueryClientProvider>
  );
}
