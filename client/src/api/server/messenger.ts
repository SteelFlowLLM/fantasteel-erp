// 메신저 화면(목록·대화·업무방·상단 드롭다운·레일 배지) ↔ 서버 API (server/src/modules/messenger). 서버 응답을 화면이 쓰는 모양으로 바꾼다.
// - 멘션: 서버는 본문을 해석하지 않고 멘션 대상 사원 id를 따로 받는다. 화면 본문의 @이름을 방 멤버·멤버 부서로 찾아 사원 id로 바꿔 보낸다
//   (부서 멘션 = 그 부서에 속한 방 멤버).
// - 서버에 없는 값: 시스템 메시지, 방 만든 사람, 첨부 크기·형식은 비어 있다. 본문의 업무 번호 링크는 서버가 실제로 있는 문서만 준다.
// - 업무방 상단 수주 요약은 수주 상세 어댑터(serverSalesOrderApi.detail)로 채운다 (출고 매수·취소 여부가 서버 요약에 없다).
import type {
  InviteChatMembersResult,
  RenameChatRoomResult,
  ChatMessagePage as ServerMessagePage,
  ChatMessageView as ServerMessageView,
  ChatRoomDetail as ServerRoomDetail,
  ChatRoomListItem as ServerRoomListItem,
  ChatRoomReadResult,
  CreateChatRoomResult,
} from '@fantasteel/shared';
import { MESSAGE_PAGE_SIZE_MAX, type MessageReactionEmoji } from '@fantasteel/shared';
import { serverDownload, serverRequest, serverUpload } from '@/api/http';
import type {
  ChatRoomDetailView,
  ChatRoomListItem,
  ChatRoomPreview,
  CreateChatRoomInput,
  MessageFileContent,
  MessagePage,
  MessageView,
  SendMessageInput,
  WorkRoomSalesOrderView,
} from '@/api/messenger';
import type { MentionTarget } from '@/api/messengerRules';
import { serverSalesOrderApi } from '@/api/server/salesOrders';
import { imageMimeOf } from '@/features/messenger/lib/attachment';
import { findMentions } from '@/features/messenger/lib/messageText';

const listRaw = () => serverRequest<ServerRoomListItem[]>('GET', '/chat-rooms');
const roomRaw = (chatRoomId: number) => serverRequest<ServerRoomDetail>('GET', `/chat-rooms/${chatRoomId}`);

const previewOf = (room: ServerRoomListItem): ChatRoomPreview => ({
  id: room.id,
  chatRoomType: room.chatRoomType,
  displayName: room.displayName,
  lastMessagePreview: room.lastMessage?.preview ?? null,
  lastMessageAt: room.lastMessage?.createdAt ?? null,
  unreadCount: room.unreadCount,
});

const listItemOf = (room: ServerRoomListItem): ChatRoomListItem => ({
  ...previewOf(room),
  chatRoomName: room.chatRoomName,
  memberCount: room.memberCount,
  memberNames: room.memberNames,
  counterpart: room.counterpart,
  lastMessage: room.lastMessage,
  salesOrder: room.salesOrder,
  createdAt: room.createdAt,
});

/** 멘션 후보: 방 멤버(나 제외)와 멤버들의 부서 */
function mentionTargetsOf(room: ServerRoomDetail): MentionTarget[] {
  const others = room.members.filter((m) => !m.isMe);
  const departments = new Map(room.members.map((m) => [m.departmentId, m.departmentName]));
  return [
    ...others.map((m): MentionTarget => ({ kind: 'employee', id: m.id, name: m.employeeName })),
    ...[...departments].map(([id, name]): MentionTarget => ({ kind: 'department', id, name })),
  ];
}

/** 나와 내 부서 (나를 멘션했는지 강조용) */
function myTargetsOf(room: ServerRoomDetail): MentionTarget[] {
  const me = room.members.find((m) => m.isMe);
  if (!me) return [];
  return [
    { kind: 'employee', id: me.id, name: me.employeeName },
    { kind: 'department', id: me.departmentId, name: me.departmentName },
  ];
}

/** 본문의 @멘션을 서버에 보낼 사원 id로 바꾼다. 부서 멘션은 그 부서의 방 멤버(나 제외) */
export function mentionedEmployeeIdsOf(content: string, room: ServerRoomDetail): number[] {
  const others = room.members.filter((m) => !m.isMe);
  const ids = findMentions(content, mentionTargetsOf(room)).flatMap((target) =>
    target.kind === 'employee' ? [target.id] : others.filter((m) => m.departmentId === target.id).map((m) => m.id),
  );
  return [...new Set(ids)];
}

function toMessageView(message: ServerMessageView, myTargets: readonly MentionTarget[]): MessageView {
  return {
    id: message.id,
    chatRoomId: message.chatRoomId,
    // 화면은 시스템 메시지의 보낸 사람을 가짜 DB와 같이 0으로 본다 (SYSTEM_SENDER_ID)
    senderId: message.senderId ?? 0,
    senderName: message.senderName,
    senderDepartmentName: message.senderDepartmentName,
    senderJobGradeName: message.senderJobGradeName,
    isSystem: message.isSystem,
    isMine: message.isMine,
    content: message.content,
    file: message.attachmentName ? { name: message.attachmentName, size: null, mimeType: null } : null,
    createdAt: message.createdAt,
    mentionsMe: !message.isMine && message.content !== null && findMentions(message.content, myTargets).length > 0,
    erpLinks: message.erpLinks,
    unreadMemberCount: message.unreadMemberCount,
    editedAt: message.editedAt,
    isDeleted: message.isDeleted,
    parent: message.parent,
    reactions: message.reactions,
  };
}

/** 업무방 상단 수주 요약 (수주 조회 권한이 있을 때만 서버가 salesOrder를 준다) */
async function workRoomSalesOrderOf(room: ServerRoomDetail): Promise<WorkRoomSalesOrderView | null> {
  if (!room.salesOrder) return null;
  const detail = await serverSalesOrderApi.detail(room.salesOrder.id);
  return {
    id: detail.id,
    salesOrderNo: detail.salesOrderNo,
    customerName: detail.customerName,
    ownerName: detail.ownerName ?? '-',
    dueDate: detail.earliestDueDate,
    cancelledAt: detail.cancelledAt,
    linkPath: room.salesOrder.linkPath,
    items: detail.items.map((item) => ({
      id: item.salesOrderItemId,
      lineNo: item.lineNo,
      itemCode: item.itemCode,
      itemType: item.itemType,
      steelGradeCode: room.salesOrder?.items.find((i) => i.id === item.salesOrderItemId)?.steelGradeCode ?? null,
      orderedQty: item.orderedQty,
      shippedQty: item.shippedQty,
      orderedTon: item.orderedTon,
      dueDate: item.dueDate,
      salesOrderItemStatus: item.salesOrderItemStatus,
    })),
  };
}

/** data URL → 파일 (Composer가 고른 파일을 data URL로 넘긴다) */
function blobOf(dataUrl: string): Blob {
  const [header, data = ''] = dataUrl.split(',', 2);
  const mimeType = /^data:([^;,]*)/.exec(header)?.[1] || 'application/octet-stream';
  const bytes = header.endsWith(';base64') ? Uint8Array.from(atob(data), (c) => c.charCodeAt(0)) : new TextEncoder().encode(decodeURIComponent(data));
  return new Blob([bytes], { type: mimeType });
}

function dataUrlOf(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('파일을 읽지 못했어요'));
    reader.readAsDataURL(blob);
  });
}

export const serverMessengerApi = {
  countUnread: async (): Promise<number> => (await listRaw()).reduce((sum, room) => sum + room.unreadCount, 0),

  listRecentRooms: async (limit: number): Promise<ChatRoomPreview[]> => (await listRaw()).slice(0, limit).map(previewOf),

  listRooms: async (): Promise<ChatRoomListItem[]> => (await listRaw()).map(listItemOf),

  getRoom: async (chatRoomId: number): Promise<ChatRoomDetailView> => {
    const room = await roomRaw(chatRoomId);
    return {
      id: room.id,
      chatRoomType: room.chatRoomType,
      displayName: room.displayName,
      chatRoomName: room.chatRoomName,
      createdAt: room.createdAt,
      createdEmployeeName: '-',
      members: room.members.map(({ departmentId: _departmentId, ...member }) => member),
      salesOrderId: room.salesOrderId,
      salesOrderState: room.salesOrderState,
      salesOrder: await workRoomSalesOrderOf(room),
      unreadCount: room.unreadCount,
      lastReadMessageId: room.lastReadMessageId,
      mentionTargets: mentionTargetsOf(room),
      canInvite: room.chatRoomType !== 'DIRECT',
      pinnedMessage: room.pinnedMessage,
    };
  },

  /** 최근 메시지부터 limit개. 서버 한 번 상한(100)을 넘으면 before로 이어서 읽는다 */
  listMessages: async ({ chatRoomId, limit }: { chatRoomId: number; limit: number }): Promise<MessagePage> => {
    const room = await roomRaw(chatRoomId);
    const items: ServerMessageView[] = [];
    let before: number | undefined;
    let hasMore = true;
    while (items.length < limit && hasMore) {
      const page = await serverRequest<ServerMessagePage>('GET', `/chat-rooms/${chatRoomId}/messages`, {
        query: { limit: Math.min(limit - items.length, MESSAGE_PAGE_SIZE_MAX), before },
      });
      items.unshift(...page.items);
      hasMore = page.hasMore;
      before = page.items[0]?.id;
      if (before === undefined) break;
    }
    const myTargets = myTargetsOf(room);
    return { items: items.map((m) => toMessageView(m, myTargets)), hasMore };
  },

  listFiles: async ({ chatRoomId, limit }: { chatRoomId: number; limit: number }): Promise<MessagePage> => {
    const [room, page] = await Promise.all([
      roomRaw(chatRoomId),
      serverRequest<ServerMessagePage>('GET', `/chat-rooms/${chatRoomId}/attachments`, { query: { limit: Math.min(limit, MESSAGE_PAGE_SIZE_MAX) } }),
    ]);
    const myTargets = myTargetsOf(room);
    return { items: page.items.map((m) => toMessageView(m, myTargets)), hasMore: page.hasMore };
  },

  searchMessages: async ({ chatRoomId, keyword }: { chatRoomId: number; keyword: string }): Promise<MessagePage> => {
    const [room, page] = await Promise.all([roomRaw(chatRoomId), serverRequest<ServerMessagePage>('GET', `/chat-rooms/${chatRoomId}/messages/search`, { query: { q: keyword } })]);
    const myTargets = myTargetsOf(room);
    return { items: page.items.map((m) => toMessageView(m, myTargets)), hasMore: page.hasMore };
  },

  getFile: async ({ messageId, fileName }: { messageId: number; fileName: string }): Promise<MessageFileContent> => {
    const downloaded = await serverDownload(`/attachments/${messageId}`);
    // 서버는 형식 컬럼이 없어 늘 octet-stream으로 보낸다. 그림은 확장자로 형식을 붙여 화면에서 미리볼 수 있게 한다
    const imageMime = imageMimeOf(fileName);
    const blob = imageMime ? new Blob([downloaded], { type: imageMime }) : downloaded;
    return { name: fileName, mimeType: blob.type || 'application/octet-stream', dataUrl: await dataUrlOf(blob) };
  },

  createRoom: async (input: CreateChatRoomInput): Promise<CreateChatRoomResult> =>
    serverRequest<CreateChatRoomResult>('POST', '/chat-rooms', {
      body: { chatRoomType: input.chatRoomType, memberIds: input.memberIds, chatRoomName: input.chatRoomName ?? null },
    }),

  /** 글은 메시지 API, 파일은 첨부 API(글을 함께 보내면 파일 메시지의 글이 된다). 멘션은 글 메시지에만 붙는다 */
  sendMessage: async (input: SendMessageInput): Promise<MessageView> => {
    const content = (input.content ?? '').trim();
    const room = await roomRaw(input.chatRoomId);
    const myTargets = myTargetsOf(room);
    if (input.file) {
      const form = new FormData();
      form.append('file', blobOf(input.file.dataUrl), input.file.name);
      if (content) form.append('content', content);
      if (input.clientMessageId) form.append('clientMessageId', input.clientMessageId);
      if (input.parentMessageId) form.append('parentMessageId', String(input.parentMessageId));
      return toMessageView(await serverUpload<ServerMessageView>(`/chat-rooms/${input.chatRoomId}/attachments`, form), myTargets);
    }
    const sent = await serverRequest<ServerMessageView>('POST', `/chat-rooms/${input.chatRoomId}/messages`, {
      body: { content, mentionedEmployeeIds: mentionedEmployeeIdsOf(content, room), clientMessageId: input.clientMessageId, parentMessageId: input.parentMessageId ?? undefined },
    });
    return toMessageView(sent, myTargets);
  },

  inviteMembers: async ({ chatRoomId, memberIds }: { chatRoomId: number; memberIds: number[] }): Promise<number> =>
    (await serverRequest<InviteChatMembersResult>('POST', `/chat-rooms/${chatRoomId}/members`, { body: { memberIds } })).addedCount,

  renameRoom: async ({ chatRoomId, chatRoomName }: { chatRoomId: number; chatRoomName: string | null }): Promise<RenameChatRoomResult> =>
    serverRequest<RenameChatRoomResult>('PATCH', `/chat-rooms/${chatRoomId}`, { body: { chatRoomName } }),

  pinMessage: async ({ chatRoomId, messageId }: { chatRoomId: number; messageId: number }): Promise<void> => {
    await serverRequest<ServerRoomDetail>('POST', `/chat-rooms/${chatRoomId}/pin`, { body: { messageId } });
  },

  unpinMessage: async (chatRoomId: number): Promise<void> => {
    await serverRequest<ServerRoomDetail>('POST', `/chat-rooms/${chatRoomId}/unpin`);
  },

  toggleReaction: async ({ messageId, emoji }: { messageId: number; emoji: MessageReactionEmoji }): Promise<MessageView> => {
    const updated = await serverRequest<ServerMessageView>('POST', `/messages/${messageId}/reactions`, { body: { emoji } });
    return toMessageView(updated, myTargetsOf(await roomRaw(updated.chatRoomId)));
  },

  editMessage: async ({ messageId, content }: { messageId: number; content: string }): Promise<MessageView> => {
    const updated = await serverRequest<ServerMessageView>('PATCH', `/messages/${messageId}`, { body: { content } });
    return toMessageView(updated, myTargetsOf(await roomRaw(updated.chatRoomId)));
  },

  deleteMessage: async (messageId: number): Promise<MessageView> => {
    const updated = await serverRequest<ServerMessageView>('DELETE', `/messages/${messageId}`);
    return toMessageView(updated, myTargetsOf(await roomRaw(updated.chatRoomId)));
  },

  markRead: async ({ chatRoomId, lastMessageId }: { chatRoomId: number; lastMessageId: number }): Promise<number> =>
    (await serverRequest<ChatRoomReadResult>('POST', `/chat-rooms/${chatRoomId}/read`, { body: { lastMessageId } })).unreadCount,

  /** 업무방 열기: 수주당 1개, 이미 있으면 그 방에 새 멤버만 더한다 */
  openWorkRoom: async (input: { salesOrderId: number; memberEmployeeIds: readonly number[] }): Promise<{ chatRoomId: number; chatRoomName: string | null; created: boolean }> => {
    const result = await serverRequest<CreateChatRoomResult>('POST', '/chat-rooms', {
      body: { chatRoomType: 'WORK', memberIds: [...input.memberEmployeeIds], salesOrderId: input.salesOrderId },
    });
    const room = await roomRaw(result.id);
    return { chatRoomId: result.id, chatRoomName: room.chatRoomName, created: !result.reused };
  },

  /** 이 수주의 업무방: 내가 멤버인 방에서 찾는다 (멤버가 아니면 서버가 알려 주지 않아 null) */
  workRoomOf: async (salesOrderId: number): Promise<{ chatRoomId: number; chatRoomName: string | null; memberEmployeeIds: number[] } | null> => {
    const found = (await listRaw()).find((room) => room.chatRoomType === 'WORK' && room.salesOrder?.id === salesOrderId);
    if (!found) return null;
    const room = await roomRaw(found.id);
    return { chatRoomId: room.id, chatRoomName: room.chatRoomName, memberEmployeeIds: room.members.map((m) => m.id) };
  },
};
