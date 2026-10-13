// 메신저 (REQ-MSG-001~006, BP-MSG-01). 메신저 화면, 상단 메신저 드롭다운(SPEC 4장 1번), 레일 배지가 쓴다.
// - 채팅방 유형: 1:1 · 그룹 · 업무방. 메신저에서는 1:1·그룹만 만든다. 업무방은 수주 상세에서 수주에 연결해 연다(REQ-MSG-001).
// - 방 멤버만 방·메시지·첨부를 본다(BP-MSG-01 구현 제안 "방 멤버 권한", "첨부파일에도 방 접근 권한"). 아니면 COM-002.
// - 업무방 상단 수주 요약은 수주 화면을 열 수 있는 사원에게만 보인다("ERP 대상 조회 권한").
// - api/server/messenger.ts가 서버를 부르고, 실시간(REQ-MSG-002)은 소켓(hooks/useMessengerSocket.ts)이 조회를 다시 부른다.
// - 메시지·채팅방에 맞는 작업 로그 유형(BUSINESS_EVENT_TYPE)이 없어 작업 로그는 남기지 않는다.
import {
  MESSAGE_ATTACHMENT_MAX_BYTES,
  type MessageEmoticonKey,
  type MessageReactionEmoji,
} from '@fantasteel/shared';
import { type ChatRoomType, type ProductItemType, type SalesOrderItemStatus } from '@/codes';
import { serverMessengerApi } from '@/api/server/messenger';
import { type MentionTarget } from '@/api/messengerRules';
import { type ErpLink } from '@/features/messenger/lib/messageText';

export { MESSAGE_CONTENT_MAX } from '@/api/messengerRules';
/** 첨부 한 개 최대 크기: 서버와 같은 10MB (2026-10-07 결정) */
export const MESSAGE_FILE_MAX_BYTES = MESSAGE_ATTACHMENT_MAX_BYTES;
export const CHAT_ROOM_NAME_MAX = 100;
export const MESSAGE_PAGE_SIZE = 50;
export const RECENT_CHAT_ROOM_LIMIT = 8;

export const messengerKeys = {
  all: ['chat-rooms'] as const,
  rooms: (employeeId: number) => ['chat-rooms', 'list', employeeId] as const,
  room: (employeeId: number, chatRoomId: number) => ['chat-rooms', 'detail', employeeId, chatRoomId] as const,
  messages: (employeeId: number, chatRoomId: number, limit: number) => ['chat-rooms', 'messages', employeeId, chatRoomId, limit] as const,
  files: (employeeId: number, chatRoomId: number, limit: number) => ['chat-rooms', 'files', employeeId, chatRoomId, limit] as const,
  search: (employeeId: number, chatRoomId: number, keyword: string) => ['chat-rooms', 'search', employeeId, chatRoomId, keyword] as const,
};

// ── 화면에 내보내는 모양 ─────────────────────────────────

/** 상단 드롭다운의 최근 채팅방 */
export interface ChatRoomPreview {
  id: number;
  chatRoomType: ChatRoomType;
  displayName: string;
  /** 마지막 메시지 내용. 파일만 보냈으면 '파일 · 파일명' */
  lastMessagePreview: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
  /** 내가 이 방 알림을 껐는지 (배지 합계에서 빠진다) */
  muted: boolean;
  /** 내가 목록 위에 고정한 시각 */
  pinnedAt: string | null;
}

export interface ChatRoomListItem extends ChatRoomPreview {
  chatRoomName: string | null;
  memberCount: number;
  /** 검색용 멤버 이름 (나 제외) */
  memberNames: string[];
  /** 1:1 상대 */
  counterpart: { employeeId: number; employeeName: string; departmentName: string; jobGradeName: string } | null;
  lastMessage: { senderName: string; isMine: boolean; isSystem: boolean; preview: string; createdAt: string } | null;
  /** 업무방의 수주 (수주 화면을 열 수 있을 때만) */
  salesOrder: { id: number; salesOrderNo: string; customerName: string; dueDate: string | null } | null;
  createdAt: string;
}

export interface ChatMemberView {
  id: number;
  employeeNo: string;
  employeeName: string;
  departmentName: string;
  jobGradeName: string;
  isHead: boolean;
  isMe: boolean;
}

export interface WorkRoomSalesOrderItemView {
  id: number;
  lineNo: number;
  itemCode: string;
  /** 수주 품목은 제품(슬래브·코일)만 */
  itemType: ProductItemType;
  steelGradeCode: string | null;
  orderedQty: number;
  shippedQty: number;
  /** 수주 매수 × 이론중량 (계산값) */
  orderedTon: string | null;
  dueDate: string;
  salesOrderItemStatus: SalesOrderItemStatus;
}

export interface WorkRoomSalesOrderView {
  id: number;
  salesOrderNo: string;
  customerName: string;
  ownerName: string;
  /** 취소되지 않은 품목 중 가장 빠른 납기 */
  dueDate: string | null;
  cancelledAt: string | null;
  linkPath: string;
  items: WorkRoomSalesOrderItemView[];
}

/** none = 업무방이 아님, ok = 요약 있음, missing = 연결된 수주가 없음, denied = 수주 조회 권한 없음 */
export type SalesOrderSummaryState = 'none' | 'ok' | 'missing' | 'denied';

export interface ChatRoomDetailView {
  id: number;
  chatRoomType: ChatRoomType;
  displayName: string;
  chatRoomName: string | null;
  createdAt: string;
  createdEmployeeName: string;
  members: ChatMemberView[];
  salesOrderId: number | null;
  salesOrderState: SalesOrderSummaryState;
  salesOrder: WorkRoomSalesOrderView | null;
  unreadCount: number;
  lastReadMessageId: number | null;
  /** 멘션 후보: 방 멤버(나 제외)와 부서 */
  mentionTargets: MentionTarget[];
  /** 멤버를 초대할 수 있는지 (1:1 제외) */
  canInvite: boolean;
  /** 방 위에 고정한 공지 (삭제된 메시지면 null) */
  pinnedMessage: { id: number; senderName: string; preview: string; createdAt: string } | null;
  /** 내 방 설정: 알림 끄기·목록 위 고정 */
  muted: boolean;
  pinnedAt: string | null;
}

export interface ChatRoomSettingsInput {
  chatRoomId: number;
  muted?: boolean;
  pinned?: boolean;
}

export interface MessageFileView {
  /** 첨부 id (message_attachment id). 내려받기에 쓴다 */
  id: number;
  name: string;
  size: number | null;
  mimeType: string | null;
}

export interface MessageView {
  id: number;
  chatRoomId: number;
  senderId: number;
  /** 보낸 사원이 없으면 '시스템' (PLAN 7장: SYSTEM 메시지는 '시스템'으로 표시) */
  senderName: string;
  senderDepartmentName: string | null;
  senderJobGradeName: string | null;
  isSystem: boolean;
  isMine: boolean;
  content: string | null;
  /** 첨부 (올린 순서, 여러 개 = 스키마 3차) */
  files: MessageFileView[];
  /** 이모티콘 (스키마 4차, 18번). 없거나 삭제된 메시지는 null */
  emoticonKey: MessageEmoticonKey | null;
  createdAt: string;
  /** 나(또는 내 부서)를 멘션했는지 */
  mentionsMe: boolean;
  /** 본문의 업무 번호 중 실제로 있는 것 → 상세 화면 링크 (REQ-MSG-006) */
  erpLinks: ErpLink[];
  /** 아직 안 읽은 멤버 수 (보낸 사람 제외). 0이면 모두 읽음 */
  unreadMemberCount: number;
  /** 본문을 고친 시각 (고친 적 없으면 null) */
  editedAt: string | null;
  /** 삭제 표시된 메시지 (본문·첨부는 비어 있다) */
  isDeleted: boolean;
  /** 답글이면 원본 요약 */
  parent: { id: number; senderName: string; preview: string; isDeleted: boolean } | null;
  /** 이모지 반응 (허용 목록 순서, 0명인 것은 없음) */
  reactions: { emoji: MessageReactionEmoji; count: number; reactedByMe: boolean; employeeNames: string[] }[];
}

export interface MessagePage {
  items: MessageView[];
  hasMore: boolean;
}

export interface MessageFileContent {
  name: string;
  mimeType: string;
  dataUrl: string;
}

// ── 입력 ────────────────────────────────────────────────

export interface CreateChatRoomInput {
  /** 메신저에서는 1:1·그룹만 만든다 */
  chatRoomType: ChatRoomType;
  /** 나를 뺀 멤버. 나는 자동으로 들어간다 */
  memberIds: number[];
  chatRoomName?: string | null;
}

export interface SendMessageInput {
  chatRoomId: number;
  content?: string | null;
  /** 첨부 (REQ-MSG-003). 스키마 3차부터 메시지 1건에 MESSAGE_ATTACHMENT_MAX_COUNT개까지 */
  files?: { name: string; size: number; mimeType: string; dataUrl: string }[];
  /** 이모티콘 (18번). 글과 함께 보낼 수 있고, 파일과는 함께 보내지 않는다 (서버 첨부 API가 받지 않음) */
  emoticonKey?: MessageEmoticonKey | null;
  /** 보내기 id. 다시 보낼 때 같은 값을 쓰면 서버가 두 번 저장하지 않는다 */
  clientMessageId?: string;
  /** 답글 대상 메시지 */
  parentMessageId?: number | null;
}

// ── API ────────────────────────────────────────────────

export const messengerApi = {
  /** 안 읽은 메시지 합계 (레일·상단 배지) */
  countUnread: (employeeId: number): Promise<number> => serverMessengerApi.countUnread(),

  /** 상단 드롭다운의 최근 채팅방 */
  listRecentRooms: (employeeId: number, limit: number = RECENT_CHAT_ROOM_LIMIT): Promise<ChatRoomPreview[]> => serverMessengerApi.listRecentRooms(limit),

  /** 내가 멤버인 채팅방, 최근 대화 순 */
  listRooms: (): Promise<ChatRoomListItem[]> => serverMessengerApi.listRooms(),

  /** 채팅방 정보: 멤버, 업무방이면 수주 요약 */
  getRoom: (chatRoomId: number): Promise<ChatRoomDetailView> => serverMessengerApi.getRoom(chatRoomId),

  /** 최근 메시지부터 limit개 (화면에는 오래된 것부터). 더 오래된 메시지가 있으면 hasMore */
  listMessages: ({ chatRoomId, limit = MESSAGE_PAGE_SIZE }: { chatRoomId: number; limit?: number }): Promise<MessagePage> => serverMessengerApi.listMessages({ chatRoomId, limit }),

  /** 파일 모아보기: 첨부가 있는 메시지만 최신순으로 limit개 (방 멤버만) */
  listFiles: ({ chatRoomId, limit }: { chatRoomId: number; limit: number }): Promise<MessagePage> => serverMessengerApi.listFiles({ chatRoomId, limit }),

  /** 방 안 메시지 검색: 본문에 검색어가 든 메시지를 최신순으로 (대소문자 무시, 방 멤버만) */
  searchMessages: ({ chatRoomId, keyword }: { chatRoomId: number; keyword: string }): Promise<MessagePage> => serverMessengerApi.searchMessages({ chatRoomId, keyword }),

  /** 첨부 내려받기 (방 멤버만). 서버는 파일 이름을 응답 헤더로만 주고 다른 origin에서는 읽을 수 없어 화면이 넘긴다 */
  getFile: ({ messageId, fileId, fileName }: { messageId: number; fileId: number; fileName: string }): Promise<MessageFileContent> =>
    serverMessengerApi.getFile({ fileId, fileName }),

  /** 1:1·그룹 채팅방 만들기. 같은 상대와의 1:1 방이 있으면 그 방을 돌려준다 */
  createRoom: (input: CreateChatRoomInput): Promise<{ id: number; reused: boolean }> => serverMessengerApi.createRoom(input),

  /** 멤버 초대 (1:1 제외). 새 멤버는 이전 대화를 볼 수 있고, 지금까지의 메시지는 읽은 것으로 시작한다. 초대한 수를 돌려준다 */
  inviteMembers: ({ chatRoomId, memberIds }: { chatRoomId: number; memberIds: number[] }): Promise<number> => serverMessengerApi.inviteMembers({ chatRoomId, memberIds }),

  /** 그룹방 이름 바꾸기 (방 멤버만). 비우면 이름 없음 → 멤버 이름으로 보인다. 1:1·업무방은 바꾸지 않는다 */
  renameRoom: ({ chatRoomId, chatRoomName }: { chatRoomId: number; chatRoomName: string | null }): Promise<{ id: number; chatRoomName: string | null; displayName: string }> =>
    serverMessengerApi.renameRoom({ chatRoomId, chatRoomName }),

  /** 메시지 보내기 (글, 파일 여러 개, 또는 둘 다). @멘션·업무방 알림은 messengerRules.postMessage가 만든다 */
  sendMessage: (input: SendMessageInput): Promise<MessageView> => serverMessengerApi.sendMessage(input),

  /** 공지로 고정 (방 멤버 누구나, 이 방의 삭제되지 않은 일반 메시지). 고정·해제는 시스템 메시지로 남긴다 */
  pinMessage: ({ chatRoomId, messageId }: { chatRoomId: number; messageId: number }): Promise<void> => serverMessengerApi.pinMessage({ chatRoomId, messageId }),

  /** 공지 내리기 */
  unpinMessage: (chatRoomId: number): Promise<void> => serverMessengerApi.unpinMessage(chatRoomId),

  /** 방 나가기 (그룹방·업무방만). 남은 멤버에게 '…님이 나갔어요'를 남긴다. 업무방은 수주 화면에서 다시 열면 돌아온다 */
  leaveRoom: (chatRoomId: number): Promise<void> => serverMessengerApi.leaveRoom(chatRoomId),

  /** 내 방 설정: 알림 끄기·목록 위 고정 (나에게만). 이미 고정한 방은 처음 고정한 시각을 둔다 */
  updateSettings: ({ chatRoomId, muted, pinned }: ChatRoomSettingsInput): Promise<void> => serverMessengerApi.updateSettings({ chatRoomId, muted, pinned }),

  /** 이모지 반응 누르기·취소 (방 멤버, 삭제되지 않은 일반 메시지) */
  toggleReaction: ({ messageId, emoji }: { messageId: number; emoji: MessageReactionEmoji }): Promise<MessageView> => serverMessengerApi.toggleReaction({ messageId, emoji }),

  /** 내 메시지 고치기. 본문은 비울 수 없다(첨부가 있으면 비워도 됨). 삭제된 메시지는 못 고친다 */
  editMessage: ({ messageId, content }: { messageId: number; content: string }): Promise<MessageView> => serverMessengerApi.editMessage({ messageId, content }),

  /** 내 메시지 삭제: 표시만 하고 행은 남긴다 */
  deleteMessage: (messageId: number): Promise<MessageView> => serverMessengerApi.deleteMessage(messageId),

  /** 읽음 위치를 옮긴다 (뒤로 돌아가지 않는다). 남은 안 읽은 수를 돌려준다 */
  markRead: ({ chatRoomId, lastMessageId }: { chatRoomId: number; lastMessageId: number }): Promise<number> => serverMessengerApi.markRead({ chatRoomId, lastMessageId }),
};
