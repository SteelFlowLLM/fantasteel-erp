// 메신저 조회 키와, 소켓 이벤트(message · chat-read)를 조회 캐시에 반영하는 함수.
// 셸(배지·드롭다운)과 메신저 화면이 같은 캐시를 본다. 서버 데이터를 따로 스토어에 복사하지 않는다.
import type { InfiniteData } from '@tanstack/react-query';
import { queryClient } from '@/api/queryClient';
import type { ChatRoomView, MessagePage, MessageView, ReadStateView } from '@/api/messenger';

// 첫 요소는 실시간 주제 'chat-rooms' — 방 생성·초대·나가기(changed)가 오면 전부 다시 불린다.
export const chatKeys = {
  rooms: ['chat-rooms', 'list'] as const,
  unread: ['chat-rooms', 'unread-count'] as const,
  room: (id: number) => ['chat-rooms', id, 'detail'] as const,
  messages: (id: number) => ['chat-rooms', id, 'messages'] as const,
};

/** 메시지 조회 캐시: pages[0]이 최신 쪽 페이지, 뒤로 갈수록 오래된 페이지. */
export type MessagePages = InfiniteData<MessagePage, number | undefined>;

/**
 * 지금 이 방의 새 메시지를 바로 읽고 있는지 (방이 열려 있고 · 창에 포커스가 있고 · 맨 아래를 보고 있음).
 * 메신저 화면이 등록한다. 읽고 있는 방은 안 읽은 수를 올리지 않는다.
 */
let activeReader: ((chatRoomId: number) => boolean) | null = null;
export function setActiveChatReader(fn: ((chatRoomId: number) => boolean) | null): void {
  activeReader = fn;
}
export const isReadingRoom = (chatRoomId: number) => activeReader?.(chatRoomId) ?? false;

/** 열어 본 적 있는 방의 메시지 목록에 새 메시지를 붙인다 (id로 중복 제거 — 보낸 사람도 자기 메시지를 소켓으로 받는다). */
export function appendMessageToCache(message: MessageView): void {
  const key = chatKeys.messages(message.chatRoomId);
  // 아직 첫 조회가 끝나지 않은 방이면 그 조회를 다시 불러 이 메시지를 놓치지 않게 한다
  if (!queryClient.getQueryData<MessagePages>(key)?.pages.length) {
    void queryClient.invalidateQueries({ queryKey: key });
    return;
  }
  queryClient.setQueryData<MessagePages>(key, (old) => {
    if (!old?.pages.length) return old;
    if (old.pages.some((p) => p.items.some((m) => m.id === message.id))) return old;
    const [latest, ...older] = old.pages;
    const items = [...latest.items, message].sort((a, b) => a.id - b.id);
    return { ...old, pages: [{ ...latest, items }, ...older] };
  });
}

/** 방 목록의 마지막 메시지·안 읽은 수를 고치고 그 방을 맨 위로 올린다. 목록에 없는 방이면 목록을 다시 부른다. */
export function applyMessageToRooms(message: MessageView, myEmployeeId: number): void {
  const rooms = queryClient.getQueryData<ChatRoomView[]>(chatKeys.rooms);
  const fromOther = message.senderId !== myEmployeeId;
  const countsUnread = fromOther && !isReadingRoom(message.chatRoomId);
  if (rooms) {
    const room = rooms.find((r) => r.id === message.chatRoomId);
    if (!room) {
      void queryClient.invalidateQueries({ queryKey: chatKeys.rooms });
    } else if (!room.lastMessage || room.lastMessage.id < message.id) {
      const next: ChatRoomView = {
        ...room,
        lastMessage: {
          id: message.id,
          senderId: message.senderId,
          senderName: message.senderName,
          messageType: message.messageType,
          preview: (message.file && message.content === message.file.fileName ? message.file.fileName : message.content).replace(/\s+/g, ' ').slice(0, 80),
          createdAt: message.createdAt,
        },
        unreadCount: room.unreadCount + (countsUnread ? 1 : 0),
      };
      queryClient.setQueryData<ChatRoomView[]>(chatKeys.rooms, [next, ...rooms.filter((r) => r.id !== room.id)]);
    }
  }
  // 전체 안 읽은 수(배지)는 서버 값으로 맞춘다
  if (fromOther) void queryClient.invalidateQueries({ queryKey: chatKeys.unread });
}

/** 읽음 처리 결과(PUT 응답 · 소켓 chat-read)를 방 목록과 배지에 반영한다. */
export function applyReadState(state: ReadStateView): void {
  queryClient.setQueryData<ChatRoomView[]>(chatKeys.rooms, (old) =>
    old?.map((r) => (r.id === state.chatRoomId ? { ...r, unreadCount: state.unreadCount, myLastReadMessageId: state.lastReadMessageId } : r)),
  );
  queryClient.setQueryData<ChatRoomView>(chatKeys.room(state.chatRoomId), (old) =>
    old ? { ...old, unreadCount: state.unreadCount, myLastReadMessageId: state.lastReadMessageId } : old,
  );
  queryClient.setQueryData<{ totalUnreadCount: number }>(chatKeys.unread, { totalUnreadCount: state.totalUnreadCount });
}

/** 방 하나의 최신 모양(생성·초대 응답)을 목록에 넣는다. */
export function upsertRoom(room: ChatRoomView): void {
  queryClient.setQueryData<ChatRoomView[]>(chatKeys.rooms, (old) => (old ? [room, ...old.filter((r) => r.id !== room.id)] : old));
  queryClient.setQueryData<ChatRoomView>(chatKeys.room(room.id), room);
}
