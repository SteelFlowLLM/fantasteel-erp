import { useEffect, useRef } from 'react';
import { onRealtime } from '@/api/realtime';

/** 소켓 이벤트를 구독한다 (예: 'message', 'notification'). */
export function useRealtimeEvent<T = unknown>(event: string, handler: (payload: T) => void): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => onRealtime(event, (p) => ref.current(p as T)), [event]);
}
