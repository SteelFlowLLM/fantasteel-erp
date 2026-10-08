// 메신저 (REQ-MSG-001~006, BP-MSG-01). 메신저 화면, 상단 메신저 드롭다운(SPEC 4장 1번), 레일 배지가 쓴다.
// - 채팅방 유형: 1:1 · 그룹 · 업무방. 메신저에서는 1:1·그룹만 만든다. 업무방은 수주 상세에서 수주에 연결해 연다(REQ-MSG-001).
// - 방 멤버만 방·메시지·첨부를 본다(BP-MSG-01 구현 제안 "방 멤버 권한", "첨부파일에도 방 접근 권한"). 아니면 COM-002.
// - 업무방 상단 수주 요약은 수주 화면을 열 수 있는 사원에게만 보인다("ERP 대상 조회 권한").
// - 실시간(REQ-MSG-002)은 가짜 DB의 탭 동기화(BroadcastChannel)로 흉내 낸다: 다른 탭이 보낸 메시지가 오면 조회가 다시 불린다.
// - 서버 모드(NEXT_PUBLIC_DATA_SOURCE=server)는 api/server/messenger.ts가 서버를 부르고, 실시간은 소켓(hooks/useMessengerSocket.ts)이 조회를 다시 부른다.
// - 메시지·채팅방에 맞는 작업 로그 유형(BUSINESS_EVENT_TYPE)이 없어 작업 로그는 남기지 않는다.
import { DELETED_MESSAGE_TEXT, MESSAGE_ATTACHMENT_MAX_BYTES, MESSAGE_REACTION_EMOJIS, MESSAGE_SEARCH_SIZE, type MessageReactionEmoji } from '@fantasteel/shared';
import { CHAT_ROOM_TYPE, type ChatRoomType, type ProductItemType, type SalesOrderItemStatus } from '@/codes';
import { requireActor, type Actor } from '@/api/actor';
import { ApiError, FieldErrors, InputError, mockMutation, mockQuery } from '@/api/client';
import { isServerDataSource } from '@/api/http';
import { serverMessengerApi } from '@/api/server/messenger';
import { MESSAGE_CONTENT_MAX, memberIdsOf, mentionTargetsOf, postMessage, unreadCountOf, type MentionTarget } from '@/api/messengerRules';
import { optionalText, requireRow } from '@/api/validation';
import { SCREEN, canOpenScreen } from '@/features/shell/screens';
import { findErpNos, findMentions, type ErpLink } from '@/features/messenger/lib/messageText';
import { calcWeightTon } from '@/lib/weight';
import { getMockFile, MockFileStorageFullError, MOCK_FILE_MAX_BYTES, putMockFile } from '@/mock/fileStorage';
import type { ChatRoomRow, MessageRow, MockTables } from '@/mock/schema';
import { SEED_FILES } from '@/mock/seeds/collab';
import { postSystemMessage } from '@/mock/services/workRooms';
import { insertRow, updateRow } from '@/mock/store';

export { MESSAGE_CONTENT_MAX } from '@/api/messengerRules';
/** 서버는 10MB(2026-10-07 결정), 가짜 DB는 브라우저 저장 공간 때문에 더 작다 */
export const MESSAGE_FILE_MAX_BYTES = isServerDataSource() ? MESSAGE_ATTACHMENT_MAX_BYTES : MOCK_FILE_MAX_BYTES;
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
  file: MessageFileView | null;
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
  /** 메시지당 파일 1개 (ERD message, REQ-MSG-003) */
  file?: { name: string; size: number; mimeType: string; dataUrl: string } | null;
  /** 보내기 id. 다시 보낼 때 같은 값을 쓰면 서버가 두 번 저장하지 않는다 (서버 모드만, 가짜 DB는 네트워크 실패가 없어 쓰지 않는다) */
  clientMessageId?: string;
  /** 답글 대상 메시지 */
  parentMessageId?: number | null;
}

// ── 내부 도우미 ─────────────────────────────────────────

function lastMessageOf(tables: Readonly<MockTables>, chatRoomId: number): MessageRow | undefined {
  return tables.message.filter((m) => m.chatRoomId === chatRoomId).reduce<MessageRow | undefined>((latest, m) => (!latest || m.id > latest.id ? m : latest), undefined);
}

function messagePreviewOf(message: MessageRow): string {
  if (message.deletedAt) return DELETED_MESSAGE_TEXT;
  if (message.content) return message.content.replace(/\s+/g, ' ').trim();
  return message.fileName ? `파일 · ${message.fileName}` : '';
}

const employeeOf = (tables: Readonly<MockTables>, id: number | undefined) => tables.employee.find((e) => e.id === id);
const departmentNameOf = (tables: Readonly<MockTables>, id: number | undefined) => tables.department.find((d) => d.id === id)?.departmentName ?? '-';
const jobGradeNameOf = (tables: Readonly<MockTables>, id: number | undefined) => tables.jobGrade.find((g) => g.id === id)?.jobGradeName ?? '-';

/** 방 이름: 1:1 = 상대 이름, 그룹 = 방 이름 또는 멤버 이름, 업무방 = 방 이름 또는 '업무방 · 수주번호' */
function displayNameOf(tables: Readonly<MockTables>, room: ChatRoomRow, employeeId: number): string {
  const others = memberIdsOf(tables, room.id).filter((id) => id !== employeeId);
  if (room.chatRoomType === CHAT_ROOM_TYPE.DIRECT) {
    const name = employeeOf(tables, others[0])?.employeeName;
    if (name) return name;
  }
  if (room.chatRoomName) return room.chatRoomName;
  if (room.chatRoomType === CHAT_ROOM_TYPE.WORK) {
    const salesOrderNo = tables.salesOrder.find((s) => s.id === room.salesOrderId)?.salesOrderNo;
    return salesOrderNo ? `업무방 · ${salesOrderNo}` : '업무방';
  }
  const names = others.map((id) => employeeOf(tables, id)?.employeeName).filter((name): name is string => Boolean(name));
  if (names.length === 0) return '이름 없는 채팅방';
  return names.length > 3 ? `${names.slice(0, 3).join(', ')} 외 ${names.length - 3}명` : names.join(', ');
}

function previewOfRoom(tables: Readonly<MockTables>, room: ChatRoomRow, employeeId: number): ChatRoomPreview {
  const last = lastMessageOf(tables, room.id);
  const membership = tables.chatRoomMember.find((m) => m.chatRoomId === room.id && m.employeeId === employeeId);
  return {
    id: room.id,
    chatRoomType: room.chatRoomType,
    displayName: displayNameOf(tables, room, employeeId),
    lastMessagePreview: last ? messagePreviewOf(last) : null,
    lastMessageAt: last?.createdAt ?? null,
    unreadCount: unreadCountOf(tables, room.id, employeeId),
    muted: membership?.muted ?? false,
    pinnedAt: membership?.pinnedAt ?? null,
  };
}

/** 내가 고정한 방이 먼저, 그 안에서는 최근 대화 순 (서버와 같다) */
const byRecent = (a: ChatRoomPreview & { createdAt?: string }, b: ChatRoomPreview & { createdAt?: string }) =>
  Number(b.pinnedAt !== null) - Number(a.pinnedAt !== null) || (b.lastMessageAt ?? b.createdAt ?? '').localeCompare(a.lastMessageAt ?? a.createdAt ?? '') || b.id - a.id;

const roomIdsOfMember = (tables: Readonly<MockTables>, employeeId: number) =>
  new Set(tables.chatRoomMember.filter((m) => m.employeeId === employeeId).map((m) => m.chatRoomId));

/** 방이 없으면 COM-003, 멤버가 아니면 COM-002 */
function requireMemberRoom(tables: Readonly<MockTables>, actor: Actor, chatRoomId: number): ChatRoomRow {
  const room = requireRow(tables, 'chatRoom', chatRoomId, '채팅방');
  if (!tables.chatRoomMember.some((m) => m.chatRoomId === room.id && m.employeeId === actor.employee.id)) {
    throw new ApiError('COM-002', '채팅방 멤버만 볼 수 있어요');
  }
  return room;
}

const canViewSalesOrders = (actor: Actor) => canOpenScreen(actor, SCREEN.salesOrders.access);

function salesOrderSummaryOf(tables: Readonly<MockTables>, salesOrderId: number): WorkRoomSalesOrderView | null {
  const salesOrder = tables.salesOrder.find((s) => s.id === salesOrderId);
  if (!salesOrder) return null;
  const items = tables.salesOrderItem
    .filter((i) => i.salesOrderId === salesOrder.id)
    .sort((a, b) => a.lineNo - b.lineNo)
    .map((line): WorkRoomSalesOrderItemView => {
      const item = tables.item.find((i) => i.id === line.itemId);
      const steelGradeCode = tables.steelGrade.find((g) => g.id === item?.steelGradeId)?.steelGradeCode ?? null;
      return {
        id: line.id,
        lineNo: line.lineNo,
        itemCode: item?.itemCode ?? '-',
        itemType: item?.itemType === 'COIL' ? 'COIL' : 'SLAB',
        steelGradeCode,
        orderedQty: line.orderedQty,
        shippedQty: line.shippedQty,
        orderedTon: item?.theoreticalWeightTon ? calcWeightTon(line.orderedQty, item.theoreticalWeightTon) : null,
        dueDate: line.dueDate,
        salesOrderItemStatus: line.salesOrderItemStatus,
      };
    });
  const openDueDates = items.filter((i) => i.salesOrderItemStatus !== 'CANCELLED').map((i) => i.dueDate).sort();
  return {
    id: salesOrder.id,
    salesOrderNo: salesOrder.salesOrderNo,
    customerName: tables.customer.find((c) => c.id === salesOrder.customerId)?.customerName ?? '-',
    ownerName: employeeOf(tables, salesOrder.ownerEmployeeId)?.employeeName ?? '-',
    dueDate: openDueDates[0] ?? null,
    cancelledAt: salesOrder.cancelledAt,
    linkPath: `/sales-orders/${salesOrder.id}`,
    items,
  };
}

/** 본문의 업무 번호 중 실제로 있는 것만 링크로 (수주·구매요청·출하요청 상세) */
function erpLinksOf(tables: Readonly<MockTables>, content: string | null): ErpLink[] {
  if (!content) return [];
  return findErpNos(content).flatMap(({ no, kind }): ErpLink[] => {
    if (kind === 'SALES_ORDER') {
      const row = tables.salesOrder.find((s) => s.salesOrderNo === no);
      return row ? [{ text: no, href: `/sales-orders/${row.id}` }] : [];
    }
    if (kind === 'PURCHASE_REQUISITION') {
      const row = tables.purchaseRequisition.find((p) => p.purchaseRequisitionNo === no);
      return row ? [{ text: no, href: `/purchase-requisitions/${row.id}` }] : [];
    }
    const row = tables.shipmentRequest.find((s) => s.shipmentRequestNo === no);
    return row ? [{ text: no, href: `/shipment-requests/${row.id}` }] : [];
  });
}

/** 고정 공지 요약 (서버와 같은 모양) */
function pinnedViewOf(tables: Readonly<MockTables>, room: ChatRoomRow): ChatRoomDetailView['pinnedMessage'] {
  const pinned = room.pinnedMessageId ? tables.message.find((m) => m.id === room.pinnedMessageId) : undefined;
  if (!pinned || pinned.deletedAt) return null;
  const preview = messagePreviewOf(pinned);
  return { id: pinned.id, senderName: employeeOf(tables, pinned.senderId)?.employeeName ?? '시스템', preview: preview.length > 50 ? `${preview.slice(0, 50)}…` : preview, createdAt: pinned.createdAt };
}

/** 답글 원본 요약 (서버와 같은 모양) */
function parentViewOf(tables: Readonly<MockTables>, message: MessageRow): MessageView['parent'] {
  const parent = message.parentMessageId ? tables.message.find((m) => m.id === message.parentMessageId) : undefined;
  if (!parent) return null;
  const deleted = Boolean(parent.deletedAt);
  const preview = deleted ? '' : messagePreviewOf(parent);
  return { id: parent.id, senderName: employeeOf(tables, parent.senderId)?.employeeName ?? '시스템', preview: preview.length > 50 ? `${preview.slice(0, 50)}…` : preview, isDeleted: deleted };
}

function toMessageView(tables: Readonly<MockTables>, message: MessageRow, actor: Actor, myTargets: readonly MentionTarget[]): MessageView {
  const sender = employeeOf(tables, message.senderId);
  const deleted = Boolean(message.deletedAt);
  return {
    id: message.id,
    chatRoomId: message.chatRoomId,
    senderId: message.senderId,
    senderName: sender?.employeeName ?? '시스템',
    senderDepartmentName: sender ? departmentNameOf(tables, sender.departmentId) : null,
    senderJobGradeName: sender ? jobGradeNameOf(tables, sender.jobGradeId) : null,
    isSystem: !sender,
    isMine: message.senderId === actor.employee.id,
    content: deleted ? null : message.content,
    file: !deleted && message.fileName ? { name: message.fileName, size: message.fileSize, mimeType: message.mimeType } : null,
    createdAt: message.createdAt,
    mentionsMe: !deleted && message.senderId !== actor.employee.id && message.content !== null && findMentions(message.content, myTargets).length > 0,
    erpLinks: deleted ? [] : erpLinksOf(tables, message.content),
    editedAt: message.editedAt ?? null,
    isDeleted: deleted,
    parent: parentViewOf(tables, message),
    reactions: deleted
      ? []
      : MESSAGE_REACTION_EMOJIS.flatMap((emoji) => {
          const rows = (message.reactions ?? []).filter((r) => r.emoji === emoji);
          if (rows.length === 0) return [];
          return [{ emoji, count: rows.length, reactedByMe: rows.some((r) => r.employeeId === actor.employee.id), employeeNames: rows.map((r) => employeeOf(tables, r.employeeId)?.employeeName ?? '-') }];
        }),
    unreadMemberCount: tables.chatRoomMember.filter((m) => m.chatRoomId === message.chatRoomId && m.employeeId !== message.senderId && (m.lastReadMessageId ?? 0) < message.id).length,
  };
}

/** 나와 내 부서 (멘션 강조용) */
function myMentionTargets(tables: Readonly<MockTables>, actor: Actor): MentionTarget[] {
  return [
    { kind: 'employee', id: actor.employee.id, name: actor.employee.employeeName },
    { kind: 'department', id: actor.employee.departmentId, name: departmentNameOf(tables, actor.employee.departmentId) },
  ];
}

/** 멤버로 넣을 사원 확인: 없으면 COM-003, 사용 안 함이면 입력칸 오류 */
function requireActiveEmployees(tables: Readonly<MockTables>, ids: readonly number[]): void {
  for (const id of ids) {
    const employee = requireRow(tables, 'employee', id, '사원');
    if (!employee.isActive) throw new InputError('입력한 내용을 확인해 주세요', { memberIds: `${employee.employeeName}님은 사용 중인 사원이 아니에요` });
  }
}

/** 내 일반 메시지만 고치거나 지운다 (방 멤버 확인 포함) */
function requireOwnMessage(tables: Readonly<MockTables>, actor: Actor, messageId: number, allowDeleted = false): MessageRow {
  const message = requireRow(tables, 'message', messageId, '메시지');
  requireMemberRoom(tables, actor, message.chatRoomId);
  if (message.senderId !== actor.employee.id) throw new InputError('내가 보낸 메시지만 고치거나 지울 수 있어요');
  if (message.deletedAt && !allowDeleted) throw new InputError('삭제된 메시지예요');
  return message;
}

const isValidFileName = (name: string) => name.trim().length > 0 && name.length <= 255;

// ── API ────────────────────────────────────────────────

export const messengerApi = {
  /** 안 읽은 메시지 합계 (레일·상단 배지) */
  countUnread: (employeeId: number): Promise<number> =>
    isServerDataSource() ? serverMessengerApi.countUnread() : mockQuery((tables) =>
      tables.chatRoomMember.filter((m) => m.employeeId === employeeId && !m.muted).reduce((sum, m) => sum + unreadCountOf(tables, m.chatRoomId, employeeId), 0),
    ),

  /** 상단 드롭다운의 최근 채팅방 */
  listRecentRooms: (employeeId: number, limit: number = RECENT_CHAT_ROOM_LIMIT): Promise<ChatRoomPreview[]> =>
    isServerDataSource() ? serverMessengerApi.listRecentRooms(limit) : mockQuery((tables) => {
      const roomIds = roomIdsOfMember(tables, employeeId);
      return tables.chatRoom
        .filter((room) => roomIds.has(room.id))
        .map((room) => ({ createdAt: room.createdAt, preview: previewOfRoom(tables, room, employeeId) }))
        .sort((a, b) => byRecent({ ...a.preview, createdAt: a.createdAt }, { ...b.preview, createdAt: b.createdAt }))
        .slice(0, limit)
        .map((entry) => entry.preview);
    }),

  /** 내가 멤버인 채팅방, 최근 대화 순 */
  listRooms: (): Promise<ChatRoomListItem[]> =>
    isServerDataSource() ? serverMessengerApi.listRooms() : mockQuery((tables) => {
      const actor = requireActor(tables);
      const me = actor.employee.id;
      const showSalesOrder = canViewSalesOrders(actor);
      const roomIds = roomIdsOfMember(tables, me);
      return tables.chatRoom
        .filter((room) => roomIds.has(room.id))
        .map((room): ChatRoomListItem => {
          const last = lastMessageOf(tables, room.id);
          const lastSender = last ? employeeOf(tables, last.senderId) : undefined;
          const otherIds = memberIdsOf(tables, room.id).filter((id) => id !== me);
          const counterpartRow = room.chatRoomType === CHAT_ROOM_TYPE.DIRECT ? employeeOf(tables, otherIds[0]) : undefined;
          const summary = room.chatRoomType === CHAT_ROOM_TYPE.WORK && room.salesOrderId !== null && showSalesOrder ? salesOrderSummaryOf(tables, room.salesOrderId) : null;
          return {
            ...previewOfRoom(tables, room, me),
            chatRoomName: room.chatRoomName,
            memberCount: otherIds.length + 1,
            memberNames: otherIds.map((id) => employeeOf(tables, id)?.employeeName ?? '').filter(Boolean),
            counterpart: counterpartRow
              ? { employeeId: counterpartRow.id, employeeName: counterpartRow.employeeName, departmentName: departmentNameOf(tables, counterpartRow.departmentId), jobGradeName: jobGradeNameOf(tables, counterpartRow.jobGradeId) }
              : null,
            lastMessage: last
              ? { senderName: lastSender?.employeeName ?? '시스템', isMine: last.senderId === me, isSystem: !lastSender, preview: messagePreviewOf(last), createdAt: last.createdAt }
              : null,
            salesOrder: summary ? { id: summary.id, salesOrderNo: summary.salesOrderNo, customerName: summary.customerName, dueDate: summary.dueDate } : null,
            createdAt: room.createdAt,
          };
        })
        .sort(byRecent);
    }),

  /** 채팅방 정보: 멤버, 업무방이면 수주 요약 */
  getRoom: (chatRoomId: number): Promise<ChatRoomDetailView> =>
    isServerDataSource() ? serverMessengerApi.getRoom(chatRoomId) : mockQuery((tables) => {
      const actor = requireActor(tables);
      const room = requireMemberRoom(tables, actor, chatRoomId);
      const me = actor.employee.id;
      const memberIds = new Set(memberIdsOf(tables, room.id));
      const headIds = new Set(tables.department.map((d) => d.headEmployeeId).filter((id): id is number => id !== null));
      const members = tables.employee
        .filter((e) => memberIds.has(e.id))
        .map((e) => ({
          id: e.id,
          employeeNo: e.employeeNo,
          employeeName: e.employeeName,
          departmentName: departmentNameOf(tables, e.departmentId),
          jobGradeName: jobGradeNameOf(tables, e.jobGradeId),
          isHead: headIds.has(e.id),
          isMe: e.id === me,
        }))
        .sort((a, b) => Number(b.isMe) - Number(a.isMe) || a.employeeName.localeCompare(b.employeeName, 'ko'));
      let salesOrderState: SalesOrderSummaryState = 'none';
      let salesOrder: WorkRoomSalesOrderView | null = null;
      if (room.chatRoomType === CHAT_ROOM_TYPE.WORK) {
        if (!canViewSalesOrders(actor)) salesOrderState = 'denied';
        else {
          salesOrder = room.salesOrderId === null ? null : salesOrderSummaryOf(tables, room.salesOrderId);
          salesOrderState = salesOrder ? 'ok' : 'missing';
        }
      }
      const membership = tables.chatRoomMember.find((m) => m.chatRoomId === room.id && m.employeeId === me);
      return {
        id: room.id,
        chatRoomType: room.chatRoomType,
        displayName: displayNameOf(tables, room, me),
        chatRoomName: room.chatRoomName,
        createdAt: room.createdAt,
        createdEmployeeName: employeeOf(tables, room.createdEmployeeId)?.employeeName ?? '-',
        members,
        salesOrderId: room.salesOrderId,
        salesOrderState,
        salesOrder,
        unreadCount: unreadCountOf(tables, room.id, me),
        lastReadMessageId: membership?.lastReadMessageId ?? null,
        mentionTargets: mentionTargetsOf(tables, room.id, me),
        canInvite: room.chatRoomType !== CHAT_ROOM_TYPE.DIRECT,
        pinnedMessage: pinnedViewOf(tables, room),
        muted: membership?.muted ?? false,
        pinnedAt: membership?.pinnedAt ?? null,
      };
    }),

  /** 최근 메시지부터 limit개 (화면에는 오래된 것부터). 더 오래된 메시지가 있으면 hasMore */
  listMessages: ({ chatRoomId, limit = MESSAGE_PAGE_SIZE }: { chatRoomId: number; limit?: number }): Promise<MessagePage> =>
    isServerDataSource() ? serverMessengerApi.listMessages({ chatRoomId, limit }) : mockQuery((tables) => {
      const actor = requireActor(tables);
      requireMemberRoom(tables, actor, chatRoomId);
      const all = tables.message.filter((m) => m.chatRoomId === chatRoomId).sort((a, b) => a.id - b.id);
      const myTargets = myMentionTargets(tables, actor);
      return {
        items: all.slice(Math.max(0, all.length - limit)).map((m) => toMessageView(tables, m, actor, myTargets)),
        hasMore: all.length > limit,
      };
    }),

  /** 파일 모아보기: 첨부가 있는 메시지만 최신순으로 limit개 (방 멤버만) */
  listFiles: ({ chatRoomId, limit }: { chatRoomId: number; limit: number }): Promise<MessagePage> =>
    isServerDataSource() ? serverMessengerApi.listFiles({ chatRoomId, limit }) : mockQuery((tables) => {
      const actor = requireActor(tables);
      requireMemberRoom(tables, actor, chatRoomId);
      const files = tables.message.filter((m) => m.chatRoomId === chatRoomId && m.fileName !== null).sort((a, b) => b.id - a.id);
      const myTargets = myMentionTargets(tables, actor);
      return { items: files.slice(0, limit).map((m) => toMessageView(tables, m, actor, myTargets)), hasMore: files.length > limit };
    }),

  /** 방 안 메시지 검색: 본문에 검색어가 든 메시지를 최신순으로 (대소문자 무시, 방 멤버만) */
  searchMessages: ({ chatRoomId, keyword }: { chatRoomId: number; keyword: string }): Promise<MessagePage> =>
    isServerDataSource() ? serverMessengerApi.searchMessages({ chatRoomId, keyword }) : mockQuery((tables) => {
      const actor = requireActor(tables);
      requireMemberRoom(tables, actor, chatRoomId);
      const needle = keyword.trim().toLowerCase();
      if (!needle) throw new InputError('검색어를 넣어 주세요');
      const found = tables.message.filter((m) => m.chatRoomId === chatRoomId && (m.content ?? '').toLowerCase().includes(needle)).sort((a, b) => b.id - a.id);
      const myTargets = myMentionTargets(tables, actor);
      return { items: found.slice(0, MESSAGE_SEARCH_SIZE).map((m) => toMessageView(tables, m, actor, myTargets)), hasMore: found.length > MESSAGE_SEARCH_SIZE };
    }),

  /** 첨부 내려받기 (방 멤버만). 서버는 파일 이름을 응답 헤더로만 주고 다른 origin에서는 읽을 수 없어 화면이 넘긴다 */
  getFile: ({ messageId, fileName }: { messageId: number; fileName: string }): Promise<MessageFileContent> =>
    isServerDataSource() ? serverMessengerApi.getFile({ messageId, fileName }) : mockQuery((tables) => {
      const actor = requireActor(tables);
      const message = requireRow(tables, 'message', messageId, '메시지');
      requireMemberRoom(tables, actor, message.chatRoomId);
      const dataUrl = message.filePath ? getMockFile(message.filePath, SEED_FILES) : null;
      if (!message.fileName || !dataUrl) throw new ApiError('COM-003', '첨부 파일');
      return { name: message.fileName, mimeType: message.mimeType ?? 'application/octet-stream', dataUrl };
    }),

  /** 1:1·그룹 채팅방 만들기. 같은 상대와의 1:1 방이 있으면 그 방을 돌려준다 */
  createRoom: (input: CreateChatRoomInput): Promise<{ id: number; reused: boolean }> =>
    isServerDataSource() ? serverMessengerApi.createRoom(input) : mockMutation((tx) => {
      const actor = requireActor(tx.tables);
      const me = actor.employee.id;
      if (input.chatRoomType === CHAT_ROOM_TYPE.WORK) {
        throw new InputError('업무방은 수주 상세에서 열어요', { chatRoomType: '업무방은 수주 1건에 1개씩 연결되는 방이라 수주 상세에서 열어요' });
      }
      const memberIds = [...new Set(input.memberIds)].filter((id) => id !== me);
      const errors = new FieldErrors();
      const chatRoomName = input.chatRoomType === CHAT_ROOM_TYPE.GROUP ? optionalText(errors, 'chatRoomName', input.chatRoomName, '방 이름', CHAT_ROOM_NAME_MAX) : null;
      if (input.chatRoomType === CHAT_ROOM_TYPE.DIRECT && memberIds.length !== 1) errors.add('memberIds', '대화 상대 1명을 골라 주세요');
      if (input.chatRoomType === CHAT_ROOM_TYPE.GROUP && memberIds.length < 1) errors.add('memberIds', '멤버를 1명 이상 골라 주세요');
      errors.throwIfAny();
      requireActiveEmployees(tx.tables, memberIds);

      if (input.chatRoomType === CHAT_ROOM_TYPE.DIRECT) {
        const pair = new Set([me, memberIds[0]]);
        const existing = tx.tables.chatRoom.find((room) => {
          if (room.chatRoomType !== CHAT_ROOM_TYPE.DIRECT) return false;
          const ids = memberIdsOf(tx.tables, room.id);
          return ids.length === 2 && ids.every((id) => pair.has(id));
        });
        if (existing) return { id: existing.id, reused: true };
      }

      const room = insertRow(tx, 'chatRoom', { chatRoomType: input.chatRoomType, chatRoomName, salesOrderId: null, createdEmployeeId: me });
      for (const employeeId of [me, ...memberIds]) insertRow(tx, 'chatRoomMember', { chatRoomId: room.id, employeeId, lastReadMessageId: null });
      return { id: room.id, reused: false };
    }),

  /** 멤버 초대 (1:1 제외). 새 멤버는 이전 대화를 볼 수 있고, 지금까지의 메시지는 읽은 것으로 시작한다. 초대한 수를 돌려준다 */
  inviteMembers: ({ chatRoomId, memberIds }: { chatRoomId: number; memberIds: number[] }): Promise<number> =>
    isServerDataSource() ? serverMessengerApi.inviteMembers({ chatRoomId, memberIds }) : mockMutation((tx) => {
      const actor = requireActor(tx.tables);
      const room = requireMemberRoom(tx.tables, actor, chatRoomId);
      if (room.chatRoomType === CHAT_ROOM_TYPE.DIRECT) throw new InputError('1:1 채팅방에는 멤버를 추가할 수 없어요. 그룹 채팅방을 새로 만들어 주세요');
      const existing = new Set(memberIdsOf(tx.tables, room.id));
      const newIds = [...new Set(memberIds)].filter((id) => !existing.has(id));
      if (newIds.length === 0) throw new InputError('입력한 내용을 확인해 주세요', { memberIds: '초대할 멤버를 1명 이상 골라 주세요' });
      requireActiveEmployees(tx.tables, newIds);
      const lastId = lastMessageOf(tx.tables, room.id)?.id ?? null;
      for (const employeeId of newIds) insertRow(tx, 'chatRoomMember', { chatRoomId: room.id, employeeId, lastReadMessageId: lastId });
      return newIds.length;
    }),

  /** 그룹방 이름 바꾸기 (방 멤버만). 비우면 이름 없음 → 멤버 이름으로 보인다. 1:1·업무방은 바꾸지 않는다 */
  renameRoom: ({ chatRoomId, chatRoomName }: { chatRoomId: number; chatRoomName: string | null }): Promise<{ id: number; chatRoomName: string | null; displayName: string }> =>
    isServerDataSource() ? serverMessengerApi.renameRoom({ chatRoomId, chatRoomName }) : mockMutation((tx) => {
      const actor = requireActor(tx.tables);
      const room = requireMemberRoom(tx.tables, actor, chatRoomId);
      if (room.chatRoomType !== CHAT_ROOM_TYPE.GROUP) throw new InputError('그룹 채팅방만 이름을 바꿀 수 있어요');
      const errors = new FieldErrors();
      const name = optionalText(errors, 'chatRoomName', chatRoomName, '방 이름', CHAT_ROOM_NAME_MAX);
      errors.throwIfAny();
      const updated = updateRow(tx, 'chatRoom', room.id, { chatRoomName: name }) ?? room;
      return { id: updated.id, chatRoomName: updated.chatRoomName, displayName: displayNameOf(tx.tables, updated, actor.employee.id) };
    }),

  /** 메시지 보내기 (글, 파일 1개, 또는 둘 다). @멘션·업무방 알림은 messengerRules.postMessage가 만든다 */
  sendMessage: (input: SendMessageInput): Promise<MessageView> =>
    isServerDataSource() ? serverMessengerApi.sendMessage(input) : mockMutation((tx) => {
      const actor = requireActor(tx.tables);
      const room = requireMemberRoom(tx.tables, actor, input.chatRoomId);
      const content = (input.content ?? '').trim();
      const file = input.file ?? null;
      const errors = new FieldErrors();
      if (content.length > MESSAGE_CONTENT_MAX) errors.add('content', `메시지는 ${MESSAGE_CONTENT_MAX.toLocaleString('en-US')}자까지 보낼 수 있어요`);
      if (!content && !file) errors.add('content', '보낼 메시지나 파일을 넣어 주세요');
      if (file) {
        if (!isValidFileName(file.name)) errors.add('file', '파일 이름은 255자까지예요');
        if (file.size > MOCK_FILE_MAX_BYTES) errors.add('file', `파일은 ${Math.round(MOCK_FILE_MAX_BYTES / 1024)}KB까지 보낼 수 있어요`);
        if (!file.dataUrl.startsWith('data:')) errors.add('file', '파일을 읽지 못했어요. 다시 골라 주세요');
      }
      errors.throwIfAny();

      const pathOf = (messageId: number) => `chat/${room.id}/${messageId}/${file?.name ?? ''}`;
      if (input.parentMessageId) {
        const parent = tx.tables.message.find((m) => m.id === input.parentMessageId);
        if (!parent || parent.chatRoomId !== room.id) throw new ApiError('COM-003', '답글을 달 메시지');
        if (parent.deletedAt || !employeeOf(tx.tables, parent.senderId)) throw new InputError('삭제된 메시지나 시스템 메시지에는 답글을 달 수 없어요');
      }
      const message = postMessage(tx, room, actor.employee.id, {
        parentMessageId: input.parentMessageId ?? null,
        content: content || null,
        file: file ? { name: file.name, size: file.size, mimeType: (file.mimeType || 'application/octet-stream').slice(0, 100), path: '' } : null,
        pathOf,
      });
      if (file) {
        try {
          putMockFile(pathOf(message.id), file.dataUrl);
        } catch (error) {
          if (error instanceof MockFileStorageFullError) throw new InputError(error.message, { file: error.message });
          throw error;
        }
      }
      return toMessageView(tx.tables, message, actor, myMentionTargets(tx.tables, actor));
    }),

  /** 공지로 고정 (방 멤버 누구나, 이 방의 삭제되지 않은 일반 메시지). 고정·해제는 시스템 메시지로 남긴다 */
  pinMessage: ({ chatRoomId, messageId }: { chatRoomId: number; messageId: number }): Promise<void> =>
    isServerDataSource() ? serverMessengerApi.pinMessage({ chatRoomId, messageId }) : mockMutation((tx) => {
      const actor = requireActor(tx.tables);
      const room = requireMemberRoom(tx.tables, actor, chatRoomId);
      const message = tx.tables.message.find((m) => m.id === messageId);
      if (!message || message.chatRoomId !== room.id) throw new ApiError('COM-003', '메시지');
      if (message.deletedAt || !employeeOf(tx.tables, message.senderId)) throw new InputError('삭제된 메시지나 시스템 메시지는 고정할 수 없어요');
      updateRow(tx, 'chatRoom', room.id, { pinnedMessageId: message.id });
      postSystemMessage(tx, room.id, `${actor.employee.employeeName}님이 메시지를 공지로 고정했어요`);
    }),

  /** 공지 내리기 */
  unpinMessage: (chatRoomId: number): Promise<void> =>
    isServerDataSource() ? serverMessengerApi.unpinMessage(chatRoomId) : mockMutation((tx) => {
      const actor = requireActor(tx.tables);
      const room = requireMemberRoom(tx.tables, actor, chatRoomId);
      if (!room.pinnedMessageId) return;
      updateRow(tx, 'chatRoom', room.id, { pinnedMessageId: null });
      postSystemMessage(tx, room.id, `${actor.employee.employeeName}님이 공지를 내렸어요`);
    }),

  /** 방 나가기 (그룹방·업무방만). 남은 멤버에게 '…님이 나갔어요'를 남긴다. 업무방은 수주 화면에서 다시 열면 돌아온다 */
  leaveRoom: (chatRoomId: number): Promise<void> =>
    isServerDataSource() ? serverMessengerApi.leaveRoom(chatRoomId) : mockMutation((tx) => {
      const actor = requireActor(tx.tables);
      const room = requireMemberRoom(tx.tables, actor, chatRoomId);
      if (room.chatRoomType === CHAT_ROOM_TYPE.DIRECT) throw new InputError('1:1 채팅방은 나갈 수 없어요');
      const rows = tx.tables.chatRoomMember;
      const index = rows.findIndex((m) => m.chatRoomId === room.id && m.employeeId === actor.employee.id);
      if (index >= 0) rows.splice(index, 1);
      postSystemMessage(tx, room.id, `${actor.employee.employeeName}님이 나갔어요`);
    }),

  /** 내 방 설정: 알림 끄기·목록 위 고정 (나에게만). 이미 고정한 방은 처음 고정한 시각을 둔다 */
  updateSettings: ({ chatRoomId, muted, pinned }: ChatRoomSettingsInput): Promise<void> =>
    isServerDataSource() ? serverMessengerApi.updateSettings({ chatRoomId, muted, pinned }) : mockMutation((tx) => {
      const actor = requireActor(tx.tables);
      requireMemberRoom(tx.tables, actor, chatRoomId);
      const membership = tx.tables.chatRoomMember.find((m) => m.chatRoomId === chatRoomId && m.employeeId === actor.employee.id);
      if (!membership) return;
      updateRow(tx, 'chatRoomMember', membership.id, {
        ...(muted === undefined ? {} : { muted }),
        ...(pinned === undefined ? {} : { pinnedAt: pinned ? (membership.pinnedAt ?? tx.nowIso) : null }),
      });
    }),

  /** 이모지 반응 누르기·취소 (방 멤버, 삭제되지 않은 일반 메시지) */
  toggleReaction: ({ messageId, emoji }: { messageId: number; emoji: MessageReactionEmoji }): Promise<MessageView> =>
    isServerDataSource() ? serverMessengerApi.toggleReaction({ messageId, emoji }) : mockMutation((tx) => {
      const actor = requireActor(tx.tables);
      const message = requireRow(tx.tables, 'message', messageId, '메시지');
      requireMemberRoom(tx.tables, actor, message.chatRoomId);
      if (message.deletedAt || !employeeOf(tx.tables, message.senderId)) throw new InputError('삭제된 메시지나 시스템 메시지에는 반응할 수 없어요');
      const reactions = message.reactions ?? [];
      const mine = (r: { employeeId: number; emoji: string }) => r.employeeId === actor.employee.id && r.emoji === emoji;
      const next = reactions.some(mine) ? reactions.filter((r) => !mine(r)) : [...reactions, { employeeId: actor.employee.id, emoji }];
      const updated = updateRow(tx, 'message', message.id, { reactions: next }) ?? message;
      return toMessageView(tx.tables, updated, actor, myMentionTargets(tx.tables, actor));
    }),

  /** 내 메시지 고치기. 본문은 비울 수 없다(첨부가 있으면 비워도 됨). 삭제된 메시지는 못 고친다 */
  editMessage: ({ messageId, content }: { messageId: number; content: string }): Promise<MessageView> =>
    isServerDataSource() ? serverMessengerApi.editMessage({ messageId, content }) : mockMutation((tx) => {
      const actor = requireActor(tx.tables);
      const message = requireOwnMessage(tx.tables, actor, messageId);
      const text = content.trim();
      if (!text && !message.fileName) throw new InputError('입력한 내용을 확인해 주세요', { content: '고칠 메시지를 넣어 주세요' });
      if (text.length > MESSAGE_CONTENT_MAX) throw new InputError('입력한 내용을 확인해 주세요', { content: `메시지는 ${MESSAGE_CONTENT_MAX.toLocaleString('en-US')}자까지 보낼 수 있어요` });
      const updated = updateRow(tx, 'message', message.id, { content: text || null, editedAt: tx.nowIso }) ?? message;
      return toMessageView(tx.tables, updated, actor, myMentionTargets(tx.tables, actor));
    }),

  /** 내 메시지 삭제: 표시만 하고 행은 남긴다 */
  deleteMessage: (messageId: number): Promise<MessageView> =>
    isServerDataSource() ? serverMessengerApi.deleteMessage(messageId) : mockMutation((tx) => {
      const actor = requireActor(tx.tables);
      const message = requireOwnMessage(tx.tables, actor, messageId, true);
      const updated = message.deletedAt ? message : (updateRow(tx, 'message', message.id, { deletedAt: tx.nowIso }) ?? message);
      return toMessageView(tx.tables, updated, actor, myMentionTargets(tx.tables, actor));
    }),

  /** 읽음 위치를 옮긴다 (뒤로 돌아가지 않는다). 남은 안 읽은 수를 돌려준다 */
  markRead: ({ chatRoomId, lastMessageId }: { chatRoomId: number; lastMessageId: number }): Promise<number> =>
    isServerDataSource() ? serverMessengerApi.markRead({ chatRoomId, lastMessageId }) : mockMutation((tx) => {
      const actor = requireActor(tx.tables);
      const room = requireMemberRoom(tx.tables, actor, chatRoomId);
      const message = requireRow(tx.tables, 'message', lastMessageId, '메시지');
      if (message.chatRoomId !== room.id) throw new ApiError('COM-003', '메시지');
      const member = tx.tables.chatRoomMember.find((m) => m.chatRoomId === room.id && m.employeeId === actor.employee.id);
      if (member && (member.lastReadMessageId ?? 0) < message.id) updateRow(tx, 'chatRoomMember', member.id, { lastReadMessageId: message.id });
      return unreadCountOf(tx.tables, room.id, actor.employee.id);
    }),
};
