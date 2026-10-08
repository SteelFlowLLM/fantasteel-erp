import type { ChatRoomType, ItemType, SalesOrderItemStatus } from './codes';

/** 삭제된 메시지 자리에 보이는 문구 */
export const DELETED_MESSAGE_TEXT = '삭제된 메시지예요';

/** 메시지 검색어 최대 길이 */
export const MESSAGE_SEARCH_QUERY_MAX = 100;
/** 메시지 검색 결과 기본·최대 개수 */
export const MESSAGE_SEARCH_SIZE = 30;

/** 메시지 본문 최대 길이 (ERD는 text라 제한이 없다. 화면 입력과 같은 4000자로 둔다) */
export const MESSAGE_CONTENT_MAX = 4000;
/** 그룹방 이름 최대 길이 */
export const CHAT_ROOM_NAME_MAX = 100;
/** 메시지 목록 한 번에 불러오는 기본·최대 개수 */
export const MESSAGE_PAGE_SIZE = 50;
export const MESSAGE_PAGE_SIZE_MAX = 100;

/** 채팅방 목록 한 줄 (내가 멤버인 방, 최근 대화 순) */
export interface ChatRoomListItem {
  id: number;
  chatRoomType: ChatRoomType;
  chatRoomName: string | null;
  /** 1:1 = 상대 이름, 그룹 = 방 이름 또는 멤버 이름, 업무방 = 방 이름 또는 '업무방 · 수주번호' */
  displayName: string;
  memberCount: number;
  /** 검색용 멤버 이름 (나 제외) */
  memberNames: string[];
  /** 1:1 상대 */
  counterpart: { employeeId: number; employeeName: string; departmentName: string; jobGradeName: string } | null;
  lastMessage: { senderName: string; isMine: boolean; isSystem: boolean; preview: string; createdAt: string } | null;
  unreadCount: number;
  /** 업무방의 수주 (수주 조회 권한이 있을 때만) */
  salesOrder: { id: number; salesOrderNo: string; customerName: string; dueDate: string | null } | null;
  createdAt: string;
}

export interface ChatMemberView {
  id: number;
  employeeNo: string;
  employeeName: string;
  departmentId: number;
  departmentName: string;
  jobGradeName: string;
  isHead: boolean;
  isMe: boolean;
}

export interface WorkRoomSalesOrderItemView {
  id: number;
  itemCode: string;
  itemType: ItemType;
  steelGradeCode: string | null;
  orderedQty: number;
  /** 수주 매수 × 이론중량 (계산값, 소수 3자리) */
  orderedTon: string | null;
  dueDate: string;
  salesOrderItemStatus: SalesOrderItemStatus;
}

/** 업무방 상단 수주 요약 (REQ-MSG-001) */
export interface WorkRoomSalesOrderView {
  id: number;
  salesOrderNo: string;
  customerName: string;
  ownerName: string;
  /** 취소되지 않은 품목 중 가장 빠른 납기 */
  dueDate: string | null;
  /** 수주 화면 경로 (REQ-MSG-006) */
  linkPath: string;
  items: WorkRoomSalesOrderItemView[];
}

/** none = 업무방이 아님, ok = 요약 있음, missing = 연결된 수주가 없음, denied = 수주 조회 권한 없음 */
export type WorkRoomSalesOrderState = 'none' | 'ok' | 'missing' | 'denied';

export interface ChatRoomDetail {
  id: number;
  chatRoomType: ChatRoomType;
  chatRoomName: string | null;
  displayName: string;
  createdAt: string;
  members: ChatMemberView[];
  salesOrderId: number | null;
  salesOrderState: WorkRoomSalesOrderState;
  salesOrder: WorkRoomSalesOrderView | null;
  unreadCount: number;
  lastReadMessageId: number | null;
}

export interface ChatMessageView {
  id: number;
  chatRoomId: number;
  /** 시스템 메시지(MESSAGE_TYPE SYSTEM)는 null */
  senderId: number | null;
  /** 시스템 메시지는 '시스템' */
  senderName: string;
  senderDepartmentName: string | null;
  senderJobGradeName: string | null;
  isSystem: boolean;
  isMine: boolean;
  content: string | null;
  /** 첨부 파일 이름. 내려받기는 GET attachments/:메시지 id */
  attachmentName: string | null;
  /** 이 메시지를 아직 읽지 않은 멤버 수 (보낸 사람 제외, 읽음 위치로 계산) */
  unreadMemberCount: number;
  /** 본문의 업무 번호 중 실제로 있는 것 → 상세 화면 링크 (REQ-MSG-006). 화면 권한은 화면이 따로 본다 */
  erpLinks: ErpLink[];
  /** 본문을 고친 시각 (고친 적 없으면 null) */
  editedAt: string | null;
  /** 삭제 표시된 메시지. 본문·첨부는 비워서 준다 */
  isDeleted: boolean;
  /** 답글이면 원본 메시지 요약 */
  parent: ChatMessageParentView | null;
  createdAt: string;
}

export interface ChatMessageParentView {
  id: number;
  senderName: string;
  /** 원본 본문 앞부분 (파일만 있으면 '파일 · 이름', 삭제됐으면 빈 값) */
  preview: string;
  isDeleted: boolean;
}

/** 최근 메시지부터 limit개를 오래된 순으로. 더 오래된 메시지가 있으면 hasMore */
export interface ChatMessagePage {
  items: ChatMessageView[];
  hasMore: boolean;
}

/** 채팅방 만들기 결과. 같은 상대의 1:1 방이나 같은 수주의 업무방이 이미 있으면 그 방을 돌려준다 (reused) */
export interface CreateChatRoomResult {
  id: number;
  reused: boolean;
}

/** 첨부 파일 최대 크기 (REQ-MSG-003 "구현 단계에서 정함" → 2026-10-07 결정 10MB) */
export const MESSAGE_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
/** 첨부를 막는 확장자: 실행 파일만 (2026-10-07 결정) */
export const BLOCKED_ATTACHMENT_EXTENSIONS = ['exe', 'msi', 'bat', 'cmd', 'com', 'scr', 'ps1', 'vbs', 'js', 'jar', 'sh', 'app', 'dll'] as const;

/** 멤버 초대 결과: 새로 들어온 사원 수 (이미 멤버인 사원은 건너뛴다) */
export interface InviteChatMembersResult {
  chatRoomId: number;
  addedCount: number;
}

/** 방 이름 바꾸기 결과 (그룹방만). 비우면 null → 목록에서는 멤버 이름으로 보인다 */
export interface RenameChatRoomResult {
  id: number;
  chatRoomName: string | null;
  displayName: string;
}

/** 읽음 위치 갱신 결과 */
export interface ChatRoomReadResult {
  chatRoomId: number;
  lastReadMessageId: number | null;
  unreadCount: number;
}

// ── 실시간 (WebSocket, namespace /messenger) ─────────────

export const MESSENGER_SOCKET_NAMESPACE = '/messenger';

export const MESSENGER_EVENT = {
  /** 새 메시지. 페이로드 ChatMessageView (isMine은 받는 사원 기준) */
  MESSAGE_NEW: 'message:new',
  /** 내 읽음 위치가 바뀜 (다른 탭·기기 동기화). 페이로드 ChatRoomReadEvent */
  ROOM_READ: 'room:read',
  /** 방이 생기거나 멤버가 바뀜. 페이로드 ChatRoomUpdatedEvent */
  ROOM_UPDATED: 'room:updated',
  /** 다른 멤버가 읽음 위치를 옮김 (메시지별 안 읽은 사람 수 갱신). 페이로드 ChatMemberReadEvent */
  MEMBER_READ: 'member:read',
  /** 메시지가 고쳐지거나 삭제됨. 페이로드 ChatMessageView (isMine은 받는 사원 기준) */
  MESSAGE_UPDATED: 'message:updated',
  /** 연결 직후 한 번: 지금 접속 중인 사원. 페이로드 PresenceSnapshotEvent */
  PRESENCE_SNAPSHOT: 'presence:snapshot',
  /** 사원이 접속하거나(첫 연결) 나감(마지막 연결 끊김). 페이로드 PresenceChangedEvent */
  PRESENCE_CHANGED: 'presence:changed',
  /** 화면 → 서버: { chatRoomId } (입력 중). 서버 → 다른 멤버: TypingEvent */
  TYPING: 'typing',
} as const;

/** 입력 중 신호를 보내는 최소 간격 (가정값). 계속 입력하면 이 간격마다 다시 보낸다 */
export const TYPING_SEND_INTERVAL_MS = 3000;
/** 마지막 입력 중 신호 뒤 이 시간이 지나면 표시를 지운다 (가정값, 보내는 간격의 2배) */
export const TYPING_SHOW_MS = 6000;

export interface PresenceSnapshotEvent {
  onlineEmployeeIds: number[];
}

export interface PresenceChangedEvent {
  employeeId: number;
  online: boolean;
}

export interface TypingEvent {
  chatRoomId: number;
  employeeId: number;
  employeeName: string;
}

export interface ChatMemberReadEvent {
  chatRoomId: number;
  employeeId: number;
  lastReadMessageId: number | null;
}

export type ChatRoomReadEvent = ChatRoomReadResult;

export interface ChatRoomUpdatedEvent {
  chatRoomId: number;
}

// ── 본문의 업무 번호 → ERP 화면 링크 (REQ-MSG-006) ─────────────

export type ErpNoKind = 'SALES_ORDER' | 'PURCHASE_REQUISITION' | 'SHIPMENT_REQUEST';

/** 수주(SO-)·구매요청(PR-)·출하요청(DR-) 번호 (업무 프로세스 9.1) */
const ERP_NO_PATTERN = /\b(SO-\d{4}-\d{3,}|PR-\d{4}-\d{4,}|DR-\d{4}-\d{4,})\b/g;

const KIND_OF_PREFIX: Record<string, ErpNoKind> = {
  SO: 'SALES_ORDER',
  PR: 'PURCHASE_REQUISITION',
  DR: 'SHIPMENT_REQUEST',
};

/** 본문의 업무 번호 (같은 번호는 한 번만) */
export function findErpNos(content: string): { no: string; kind: ErpNoKind }[] {
  const result: { no: string; kind: ErpNoKind }[] = [];
  for (const match of content.matchAll(ERP_NO_PATTERN)) {
    const no = match[1];
    const kind = KIND_OF_PREFIX[no.slice(0, 2)];
    if (kind && !result.some((r) => r.no === no)) result.push({ no, kind });
  }
  return result;
}

/** 업무 번호 → 상세 화면 경로 */
export const ERP_LINK_PATH: Record<ErpNoKind, (id: number) => string> = {
  SALES_ORDER: (id) => `/sales-orders/${id}`,
  PURCHASE_REQUISITION: (id) => `/purchase-requisitions/${id}`,
  SHIPMENT_REQUEST: (id) => `/shipment-requests/${id}`,
};

/** 본문의 업무 번호 중 실제로 있는 것의 상세 화면 링크 */
export interface ErpLink {
  text: string;
  href: string;
}
