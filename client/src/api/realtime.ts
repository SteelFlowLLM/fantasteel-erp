import { io, type Socket } from 'socket.io-client';
import { invalidateTopics, queryClient } from './queryClient';

let socket: Socket | null = null;
type Handler = (payload: unknown) => void;
const handlers = new Map<string, Set<Handler>>();

/** 로그인 후 한 번 연결한다. 연결 시 access token을 보낸다. */
export function connectRealtime(token: string): void {
  disconnectRealtime();
  socket = io({ path: '/ws', auth: { token }, transports: ['websocket', 'polling'] });
  socket.on('changed', (p: { topics: string[] }) => invalidateTopics(p.topics));
  socket.onAny((event: string, payload: unknown) => {
    for (const h of handlers.get(event) ?? []) h(payload);
  });
  // 끊겼다 다시 붙으면 그 사이 놓친 변경이 있을 수 있어 전부 새로 불러온다
  socket.io.on('reconnect', () => void queryClient.invalidateQueries());
}

export function disconnectRealtime(): void {
  socket?.disconnect();
  socket = null;
}

/** 소켓 이벤트 구독. 해제 함수를 돌려준다. */
export function onRealtime(event: string, handler: Handler): () => void {
  if (!handlers.has(event)) handlers.set(event, new Set());
  handlers.get(event)!.add(handler);
  return () => handlers.get(event)?.delete(handler);
}
