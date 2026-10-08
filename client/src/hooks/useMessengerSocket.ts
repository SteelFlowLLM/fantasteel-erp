// 메신저 실시간 수신 (REQ-MSG-002). 서버 모드에서만 소켓(namespace /messenger)에 연결한다. 가짜 DB 모드는 탭 동기화가 대신한다.
// 받은 이벤트로 화면 데이터를 직접 고치지 않고 메신저 조회를 다시 부른다 (화면 데이터는 TanStack Query 한 곳에만 둔다).
// 연결이 끊겼다 다시 붙으면 그사이 놓친 메시지가 있을 수 있어 메신저 조회를 모두 다시 부른다.
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { io } from 'socket.io-client';
import { MESSENGER_EVENT, MESSENGER_SOCKET_NAMESPACE } from '@fantasteel/shared';
import { isServerDataSource, serverOrigin } from '@/api/http';
import { messengerKeys } from '@/api/messenger';
import { useMe } from '@/hooks/useMe';

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
    // 로그인 쿠키(httpOnly)를 handshake에 실어 보내 서버가 사원을 확인한다
    const socket = io(`${serverOrigin()}${MESSENGER_SOCKET_NAMESPACE}`, { withCredentials: true, transports: ['websocket'] });
    let connectedBefore = false;
    socket.on('connect', () => {
      if (connectedBefore) refreshMessenger(queryClient, true);
      connectedBefore = true;
    });
    socket.on(MESSENGER_EVENT.MESSAGE_NEW, () => refreshMessenger(queryClient, true));
    socket.on(MESSENGER_EVENT.ROOM_READ, () => refreshMessenger(queryClient, false));
    socket.on(MESSENGER_EVENT.ROOM_UPDATED, () => refreshMessenger(queryClient, false));
    // 다른 멤버가 읽으면 메시지별 안 읽은 사람 수가 바뀐다
    socket.on(MESSENGER_EVENT.MEMBER_READ, () => refreshMessenger(queryClient, false));
    return () => {
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [queryClient, employeeId]);
}
