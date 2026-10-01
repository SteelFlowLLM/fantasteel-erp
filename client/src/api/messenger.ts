// 메신저 조회 (상단 메신저 드롭다운, SPEC 4장 1번). 메신저 화면은 2단계에서 만든다.
// 안 읽은 수는 chat_room_member.last_read_message_id 이후의 남이 보낸 메시지 수다 (REQ-MSG-004).
import type { ChatRoomType } from '@/codes';
import { mockQuery } from '@/api/client';
import type { ChatRoomRow, MessageRow, MockTables } from '@/mock/schema';

export interface ChatRoomPreview {
  id: number;
  chatRoomType: ChatRoomType;
  displayName: string;
  /** 마지막 메시지 내용. 파일만 보냈으면 '파일 · 파일명' */
  lastMessagePreview: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
}

export const RECENT_CHAT_ROOM_LIMIT = 8;

function unreadCountOf(tables: Readonly<MockTables>, chatRoomId: number, employeeId: number): number {
  const member = tables.chatRoomMember.find((m) => m.chatRoomId === chatRoomId && m.employeeId === employeeId);
  if (!member) return 0;
  const lastRead = member.lastReadMessageId ?? 0;
  return tables.message.filter((m) => m.chatRoomId === chatRoomId && m.id > lastRead && m.senderId !== employeeId).length;
}

function displayNameOf(tables: Readonly<MockTables>, room: ChatRoomRow, employeeId: number): string {
  if (room.chatRoomType === 'DIRECT') {
    const other = tables.chatRoomMember.find((m) => m.chatRoomId === room.id && m.employeeId !== employeeId);
    const name = tables.employee.find((e) => e.id === other?.employeeId)?.employeeName;
    if (name) return name;
  }
  return room.chatRoomName ?? '이름 없는 채팅방';
}

const previewOf = (message: MessageRow | undefined): string | null => {
  if (!message) return null;
  if (message.content) return message.content;
  return message.fileName ? `파일 · ${message.fileName}` : null;
};

export const messengerApi = {
  countUnread: (employeeId: number): Promise<number> =>
    mockQuery((tables) =>
      tables.chatRoomMember.filter((m) => m.employeeId === employeeId).reduce((sum, m) => sum + unreadCountOf(tables, m.chatRoomId, employeeId), 0),
    ),

  listRecentRooms: (employeeId: number, limit: number = RECENT_CHAT_ROOM_LIMIT): Promise<ChatRoomPreview[]> =>
    mockQuery((tables) => {
      const roomIds = new Set(tables.chatRoomMember.filter((m) => m.employeeId === employeeId).map((m) => m.chatRoomId));
      return tables.chatRoom
        .filter((room) => roomIds.has(room.id))
        .map((room) => {
          const last = tables.message.filter((m) => m.chatRoomId === room.id).reduce<MessageRow | undefined>((latest, m) => (!latest || m.id > latest.id ? m : latest), undefined);
          return {
            id: room.id,
            chatRoomType: room.chatRoomType,
            displayName: displayNameOf(tables, room, employeeId),
            lastMessagePreview: previewOf(last),
            lastMessageAt: last?.createdAt ?? null,
            unreadCount: unreadCountOf(tables, room.id, employeeId),
          };
        })
        .sort((a, b) => (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? '') || b.id - a.id)
        .slice(0, limit);
    }),
};
