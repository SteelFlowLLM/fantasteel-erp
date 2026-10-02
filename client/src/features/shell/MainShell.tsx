'use client';

// (main) 화면의 입구: 이 탭에서 고른 계정이 없으면 계정 선택 화면으로 보내고, 있으면 사원 정보를 읽어 셸을 그린다.
import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { ApiError } from '@/api/client';
import { Button } from '@/components/Button';
import { FullScreenState } from '@/components/StateView';
import { AppFrame } from '@/features/shell/AppFrame';
import { MeContext } from '@/hooks/useMe';
import { useSessionUser } from '@/hooks/useSessionUser';
import { useSessionStore } from '@/stores/useSessionStore';

function loginHref(): string {
  const next = `${window.location.pathname}${window.location.search}`;
  return `/login?next=${encodeURIComponent(next)}`;
}

export function MainShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const hydrated = useSessionStore((state) => state.hydrated);
  const employeeId = useSessionStore((state) => state.employeeId);
  const signedOut = useSessionStore((state) => state.signedOut);
  const signOut = useSessionStore((state) => state.signOut);
  const session = useSessionUser(employeeId);

  const needsLogin = hydrated && employeeId === null;
  // 사원이 없어졌거나(시드 변경) 사용 중지되면 세션을 비운다
  const sessionRejected = session.error instanceof ApiError;

  useEffect(() => {
    if (sessionRejected) signOut();
  }, [sessionRejected, signOut]);

  useEffect(() => {
    if (needsLogin) router.replace(signedOut ? '/login' : loginHref());
  }, [needsLogin, signedOut, router]);

  if (session.error && !sessionRejected) {
    return (
      <FullScreenState
        kind="error"
        text={session.error instanceof Error ? session.error.message : undefined}
        actions={
          <Button size="sm" onClick={() => void session.refetch()}>
            다시 시도
          </Button>
        }
      />
    );
  }
  if (!session.data || needsLogin) return <FullScreenState kind="loading" title="불러오는 중…" />;

  return (
    <MeContext.Provider value={session.data}>
      <AppFrame>{children}</AppFrame>
    </MeContext.Provider>
  );
}
