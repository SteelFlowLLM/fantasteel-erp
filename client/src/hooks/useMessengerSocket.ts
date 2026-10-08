// 메신저 실시간 수신 (REQ-MSG-002). 서버 모드에서만 소켓(namespace /messenger)에 연결한다. 가짜 DB 모드는 탭 동기화가 대신한다.
// 받은 메시지·읽음 이벤트로 화면 데이터를 직접 고치지 않고 메신저 조회를 다시 부른다 (화면 데이터는 TanStack Query 한 곳에만 둔다).
// 연결이 끊겼다 다시 붙으면 그사이 놓친 메시지가 있을 수 있어 메신저 조회를 모두 다시 부른다.
// 접속 상태·입력 중은 저장하지 않는 잠깐의 상태라 useMessengerLiveStore에 둔다.
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { io } from 'socket.io-client';
import { MESSENGER_EVENT, MESSENGER_SOCKET_NAMESPACE, TYPING_SEND_INTERVAL_MS, type PresenceChangedEvent, type PresenceSnapshotEvent, type TypingEvent } from '@fantasteel/shared';
import { isServerDataSource, serverOrigin } from '@/api/http';
import { messengerKeys } from '@/api/messenger';
import { useMe } from '@/hooks/useMe';
import { useMessengerLiveStore } from '@/stores/useMessengerLiveStore';

/** 입력 중 표시가 사라졌는지 살피는 간격 */
const TYPING_PRUNE_MS = 1000;

/** 새 메시지는 멘션·업무방 알림도 함께 만들어서 알림 조회도 다시 부른다 */
function refreshMessenger(queryClient: QueryClient, withNotifications: boolean): void {
  void queryClient.invalidateQueries({ queryKey: messengerKeys.all });
  if (withNotifications) void queryClient.invalidateQueries({ queryKey: ['notifications'] });
}

export function useMessengerSocket(): void {
  const queryClient = useQueryClient();
  const { employeeId } = useMe();

  useEffect(() => {
    if (!isServerDataSource()) return;
    const live = useMessengerLiveStore.getState();
    // 로그인 쿠키(httpOnly)를 handshake에 실어 보내 서버가 사원을 확인한다
    const socket = io(`${serverOrigin()}${MESSENGER_SOCKET_NAMESPACE}`, { withCredentials: true, transports: ['websocket'] });
    let connectedBefore = false;
    socket.on('connect', () => {
      live.setConnected(true);
      if (connectedBefore) refreshMessenger(queryClient, true);
      connectedBefore = true;
    });
    socket.on('disconnect', () => live.setConnected(false));
    socket.on(MESSENGER_EVENT.MESSAGE_NEW, (message: { chatRoomId: number; senderId: number }) => {
      // 메시지가 오면 그 사람의 입력 중 표시는 끝난 것이다
      live.clearTyping(message.chatRoomId, message.senderId);
      refreshMessenger(queryClient, true);
    });
    socket.on(MESSENGER_EVENT.ROOM_READ, () => refreshMessenger(queryClient, false));
    socket.on(MESSENGER_EVENT.ROOM_UPDATED, () => refreshMessenger(queryClient, false));
    // 다른 멤버가 읽으면 메시지별 안 읽은 사람 수가 바뀐다
    socket.on(MESSENGER_EVENT.MEMBER_READ, () => refreshMessenger(queryClient, false));
    socket.on(MESSENGER_EVENT.PRESENCE_SNAPSHOT, (event: PresenceSnapshotEvent) => live.setOnline(event.onlineEmployeeIds));
    socket.on(MESSENGER_EVENT.PRESENCE_CHANGED, (event: PresenceChangedEvent) => live.setPresence(event.employeeId, event.online));
    socket.on(MESSENGER_EVENT.TYPING, (event: TypingEvent) => live.addTyping(event.chatRoomId, event));

    // 계속 입력해도 방마다 TYPING_SEND_INTERVAL_MS에 한 번만 보낸다
    const lastSent = new Map<number, number>();
    live.setSendTyping((chatRoomId) => {
      const now = Date.now();
      if (!socket.connected || now - (lastSent.get(chatRoomId) ?? 0) < TYPING_SEND_INTERVAL_MS) return;
      lastSent.set(chatRoomId, now);
      socket.emit(MESSENGER_EVENT.TYPING, { chatRoomId });
    });
    const prune = window.setInterval(() => useMessengerLiveStore.getState().pruneTyping(), TYPING_PRUNE_MS);

    return () => {
      window.clearInterval(prune);
      socket.removeAllListeners();
      socket.disconnect();
      useMessengerLiveStore.getState().reset();
    };
  }, [queryClient, employeeId]);
}
