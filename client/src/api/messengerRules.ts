// 메신저 업무 규칙 (BP-MSG-01). 가짜 서버의 ChatRoomService·MessageService 자리.
// api/messenger.ts(화면 요청)와 mock/seeds/collab.ts(시드)가 함께 쓴다. 시드가 부를 수 있게 api/client를 가져오지 않는다.
// - 안 읽은 수 = 마지막 읽은 메시지(chat_room_member.last_read_message_id) 뒤에 남이 보낸 메시지 수 (REQ-MSG-004)
// - 메시지를 보내면 보낸 사람의 읽음 위치를 그 메시지로 옮긴다
// - @멘션 → MENTION 알림(사원 멘션은 개인, 부서 멘션은 부서 알림), 업무방 새 메시지 → 나머지 멤버에게 WORK_ROOM_MESSAGE 알림 (REQ-MSG-005)
//   같은 메시지로 한 사람에게 알림이 두 번 가지 않게, 멘션 알림을 받은 사람은 업무방 알림에서 뺀다
import { CHAT_ROOM_TYPE, CHAT_ROOM_TYPE_LABEL, NOTIFICATION_TYPE } from '@/codes';
import { findMentions, previewText } from '@/features/messenger/lib/messageText';
import type { ChatRoomRow, MessageRow, MockTables } from '@/mock/schema';
import { withEulReul } from '@/lib/josa';
import { createNotifications } from '@/mock/services/notifications';
import { insertRow, updateRow, type MockTx } from '@/mock/store';

/** 메시지 본문 최대 길이 (가정값: ERD text라 제한이 없어 화면 입력을 4000자로 둔다) */
export const MESSAGE_CONTENT_MAX = 4000;

export function unreadCountOf(tables: Readonly<MockTables>, chatRoomId: number, employeeId: number): number {
  const member = tables.chatRoomMember.find((m) => m.chatRoomId === chatRoomId && m.employeeId === employeeId);
  if (!member) return 0;
  const lastRead = member.lastReadMessageId ?? 0;
  // 삭제된 메시지는 세지 않는다 (서버와 같음)
  return tables.message.filter((m) => m.chatRoomId === chatRoomId && m.id > lastRead && m.senderId !== employeeId && !m.deletedAt).length;
}

export function memberIdsOf(tables: Readonly<MockTables>, chatRoomId: number): number[] {
  return tables.chatRoomMember.filter((m) => m.chatRoomId === chatRoomId).map((m) => m.employeeId);
}

/** 알림 문구에 쓰는 방 이름 (1:1은 사람마다 이름이 달라 유형 이름을 쓴다) */
export function roomLabelOf(tables: Readonly<MockTables>, room: ChatRoomRow): string {
  if (room.chatRoomType === CHAT_ROOM_TYPE.DIRECT) return `${CHAT_ROOM_TYPE_LABEL.DIRECT} 채팅`;
  if (room.chatRoomName) return room.chatRoomName;
  if (room.chatRoomType === CHAT_ROOM_TYPE.WORK) {
    const salesOrderNo = tables.salesOrder.find((s) => s.id === room.salesOrderId)?.salesOrderNo;
    return salesOrderNo ? `${CHAT_ROOM_TYPE_LABEL.WORK} · ${salesOrderNo}` : CHAT_ROOM_TYPE_LABEL.WORK;
  }
  return `${CHAT_ROOM_TYPE_LABEL.GROUP} 채팅`;
}

export interface MentionTarget {
  kind: 'employee' | 'department';
  id: number;
  name: string;
}

/** @로 부를 수 있는 대상: 방 멤버(보내는 사람 제외)와 부서 (BP-MSG-01 "멘션을 개인·부서 알림으로 전달") */
export function mentionTargetsOf(tables: Readonly<MockTables>, chatRoomId: number, senderId: number): MentionTarget[] {
  const memberIds = new Set(memberIdsOf(tables, chatRoomId));
  const employees: MentionTarget[] = tables.employee
    .filter((e) => memberIds.has(e.id) && e.id !== senderId)
    .map((e) => ({ kind: 'employee', id: e.id, name: e.employeeName }));
  const departments: MentionTarget[] = tables.department.map((d) => ({ kind: 'department', id: d.id, name: d.departmentName }));
  return [...employees, ...departments];
}

export interface MessageFileValues {
  name: string;
  size: number;
  mimeType: string;
  path: string;
}

export interface PostMessageValues {
  content: string | null;
  file: MessageFileValues | null;
  /** 답글 대상 (같은 방 메시지인지는 부르는 쪽이 확인) */
  parentMessageId?: number | null;
}

/**
 * 메시지를 저장하고 읽음 위치·알림을 처리한다. 입력 확인과 방 멤버 확인은 부르는 쪽에서 한다.
 * file.path는 저장소 경로(chat/{방}/{메시지}/{파일명}). 메시지 id가 필요하면 pathOf로 만든다.
 */
export function postMessage(
  tx: MockTx,
  room: ChatRoomRow,
  senderId: number,
  values: PostMessageValues & { pathOf?: (messageId: number) => string },
): MessageRow {
  const inserted = insertRow(tx, 'message', {
    chatRoomId: room.id,
    senderId,
    content: values.content,
    fileName: values.file?.name ?? null,
    filePath: values.file?.path ?? null,
    fileSize: values.file?.size ?? null,
    mimeType: values.file?.mimeType ?? null,
    parentMessageId: values.parentMessageId ?? null,
  });
  const message = values.file && values.pathOf ? (updateRow(tx, 'message', inserted.id, { filePath: values.pathOf(inserted.id) }) ?? inserted) : inserted;

  const own = tx.tables.chatRoomMember.find((m) => m.chatRoomId === room.id && m.employeeId === senderId);
  if (own) updateRow(tx, 'chatRoomMember', own.id, { lastReadMessageId: message.id });

  notifyForMessage(tx, room, senderId, message);
  return message;
}

function notifyForMessage(tx: MockTx, room: ChatRoomRow, senderId: number, message: MessageRow): void {
  const sender = tx.tables.employee.find((e) => e.id === senderId);
  const senderName = sender?.employeeName ?? '시스템';
  const roomLabel = roomLabelOf(tx.tables, room);
  const preview = message.content ? previewText(message.content) : `파일 · ${message.fileName ?? ''}`;
  // 알림을 누르면 그 메시지까지 이동한다 (서버와 같은 경로)
  const linkPath = `/messenger?room=${room.id}&message=${message.id}`;
  const notified = new Set<number>([senderId]);

  if (message.content) {
    for (const target of findMentions(message.content, mentionTargetsOf(tx.tables, room.id, senderId))) {
      const created = createNotifications(tx, {
        notificationType: NOTIFICATION_TYPE.MENTION,
        title: `${senderName}님이 ${target.kind === 'department' ? `${withEulReul(target.name)} ` : ''}멘션했어요`,
        body: `${roomLabel} · ${preview}`,
        linkPath,
        recipientEmployeeIds: target.kind === 'employee' ? [target.id] : [],
        departmentId: target.kind === 'department' ? target.id : null,
        excludeEmployeeIds: [...notified],
      });
      for (const row of created) notified.add(row.recipientId);
    }
  }

  if (room.chatRoomType === CHAT_ROOM_TYPE.WORK) {
    createNotifications(tx, {
      notificationType: NOTIFICATION_TYPE.WORK_ROOM_MESSAGE,
      title: `${roomLabel} 새 메시지`,
      body: `${senderName}: ${preview}`,
      linkPath,
      recipientEmployeeIds: memberIdsOf(tx.tables, room.id),
      excludeEmployeeIds: [...notified],
    });
  }
}
