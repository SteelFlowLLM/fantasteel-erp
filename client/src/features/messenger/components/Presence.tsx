'use client';

// 접속 상태 점·문구 (서버 모드). 소켓에 연결되지 않았거나 가짜 DB 모드면 아무것도 그리지 않는다 (알 수 없는 상태를 '접속 안 함'으로 보이지 않게).
import { cn } from '@/lib/cn';
import { useMessengerLiveStore } from '@/stores/useMessengerLiveStore';

/** 접속 중이면 true, 아니면 false, 알 수 없으면 null */
export function useIsOnline(employeeId: number | null | undefined): boolean | null {
  return useMessengerLiveStore((state) => (!state.connected || employeeId === null || employeeId === undefined ? null : state.online.has(employeeId)));
}

/** 아바타 오른쪽 아래에 겹치는 점. 부모는 relative여야 한다 */
export function PresenceDot({ employeeId, className }: { employeeId: number | null | undefined; className?: string }) {
  const online = useIsOnline(employeeId);
  if (online === null) return null;
  return (
    <span
      role="img"
      aria-label={online ? '접속 중' : '접속 안 함'}
      title={online ? '접속 중' : '접속 안 함'}
      className={cn('absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-surface', online ? 'bg-ok' : 'bg-ink-disabled', className)}
    />
  );
}
