// 업무 메신저 API — docs/api/messenger.md 의 모양 그대로.
// Message → ERP 초안 만들기(POST /messages/:id/action-drafts)도 메시지에서 시작하므로 여기에 둔다 (SERVER-GUIDE 6·7장).
import type { ActionType, ChatRoomType, DraftStatus, MessageType, SalesOrderStatus } from '@fantasteel/shared';
import { api } from './client';

export interface ChatRoomMemberView {
  employeeId: number;
  employeeNo: string;
  employeeName: string;
  jobGrade: string;
  departmentId: number;
  departmentName: string;
  /** 그 멤버의 읽음 위치 */
  lastReadMessageId: number | null;
}

export interface SalesOrderSummaryItem {
  salesOrderItemId: number;
  lineNo: number;
  specCode: string;
  itemType: string;
  steelGradeCode: string;
  thicknessMm: string;
  widthMm: string;
  lengthMm: string;
  orderedQty: number;
  shippedQty: number;
  weightTon: string;
  salesOrderItemStatus: SalesOrderStatus;
}

export interface SalesOrderSummaryView {
  salesOrderId: number;
  salesOrderNo: string;
  customerName: string;
  dueDate: string;
  salesOrderStatus: SalesOrderStatus;
  linkPath: string;
  items: SalesOrderSummaryItem[];
}

export interface LastMessageView {
  id: number;
  senderId: number | null;
  senderName: string | null;
  messageType: MessageType;
  preview: string;
  createdAt: string;
}

export interface ChatRoomView {
  id: number;
  chatRoomType: ChatRoomType;
  chatRoomName: string | null;
  /** 목록에 보여 줄 이름. DIRECT = 상대 이름 */
  displayName: string;
  salesOrderId: number | null;
  salesOrder: SalesOrderSummaryView | null;
  members: ChatRoomMemberView[];
  memberCount: number;
  lastMessage: LastMessageView | null;
  unreadCount: number;
  myLastReadMessageId: number | null;
  createdAt: string;
}

export interface MessageFile { fileName: string; fileSize: number; mimeType: string; downloadPath: string }
export interface MessageLink { label: string; linkPath: string }

export interface MessageView {
  id: number;
  chatRoomId: number;
  /** null = 시스템 메시지 */
  senderId: number | null;
  senderName: string | null;
  messageType: MessageType;
  content: string;
  mentionEmployeeIds: number[];
  file: MessageFile | null;
  links: MessageLink[];
  createdAt: string;
}

export interface MessagePage { items: MessageView[]; hasMore: boolean }

export interface ReadStateView {
  chatRoomId: number;
  lastReadMessageId: number | null;
  unreadCount: number;
  totalUnreadCount: number;
}

export interface CreateChatRoomBody {
  chatRoomType: ChatRoomType;
  memberIds?: number[];
  chatRoomName?: string;
  salesOrderId?: number;
}

export interface PostMessageBody { content: string; mentionEmployeeIds?: number[] }

export const MESSAGE_PAGE_SIZE = 50;

export const messengerApi = {
  rooms: () => api.get<ChatRoomView[]>('/chat-rooms'),
  room: (id: number) => api.get<ChatRoomView>(`/chat-rooms/${id}`),
  createRoom: (dto: CreateChatRoomBody) => api.post<ChatRoomView>('/chat-rooms', dto),
  invite: ({ id, memberIds }: { id: number; memberIds: number[] }) => api.post<ChatRoomView>(`/chat-rooms/${id}/members`, { memberIds }),
  leave: (id: number) => api.delete<{ chatRoomId: number; left: true }>(`/chat-rooms/${id}/members/me`),
  messages: (id: number, beforeId?: number) => api.get<MessagePage>(`/chat-rooms/${id}/messages`, { beforeId, limit: MESSAGE_PAGE_SIZE }),
  send: ({ id, ...dto }: PostMessageBody & { id: number }) => api.post<MessageView>(`/chat-rooms/${id}/messages`, dto),
  sendFile: ({ id, file, content }: { id: number; file: File; content?: string }) => {
    const form = new FormData();
    form.append('file', file);
    if (content) form.append('content', content);
    return api.upload<MessageView>(`/chat-rooms/${id}/files`, form);
  },
  markRead: ({ id, lastReadMessageId }: { id: number; lastReadMessageId?: number }) =>
    api.put<ReadStateView>(`/chat-rooms/${id}/read`, lastReadMessageId ? { lastReadMessageId } : {}),
  unreadCount: () => api.get<{ totalUnreadCount: number }>('/chat-rooms/unread-count'),
};

/**
 * Message → ERP 초안 (SPEC 9장 #2). docs/api/message-action.md 가 아직 없어 SERVER-GUIDE 6·7장과
 * 서버 모듈(message-action)의 응답에서 화면이 쓰는 필드만 적었다. 초안 화면(/action-drafts/:id)은 다른 화면이 맡는다.
 */
export interface ActionDraftBrief {
  id: number;
  actionType: ActionType;
  draftStatus: DraftStatus;
  requesterId: number;
  /** 원본 메시지 */
  messageId: number | null;
}

export const messageActionApi = {
  /** 같은 메시지에 미처리 초안이 있으면 새로 만들지 않고 그것을 돌려준다. */
  createDraft: ({ messageId, actionType }: { messageId: number; actionType: ActionType }) =>
    api.post<ActionDraftBrief>(`/messages/${messageId}/action-drafts`, { actionType }),
  /** 내가 요청자이거나 내가 멤버인 방의 메시지에서 만든 초안 */
  drafts: () => api.get<ActionDraftBrief[]>('/action-drafts'),
};
