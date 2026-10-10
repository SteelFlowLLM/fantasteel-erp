import type { ChatRoomType, ItemType, SalesOrderItemStatus } from './codes';

/** 쓸 수 있는 반응 이모지 (가정값, 13번). DB에는 이 글자 그대로 저장한다 */
export const MESSAGE_REACTION_EMOJIS = ['👍', '✅', '👀', '🙏', '❤️', '😂'] as const;
export type MessageReactionEmoji = (typeof MESSAGE_REACTION_EMOJIS)[number];

/** 이모티콘 묶음 (19번, 20번에 행사 추가). 고르기 창의 탭 순서 */
export const MESSAGE_EMOTICON_SETS = [
  { key: 'steelman-work', label: '철강맨 업무' },
  { key: 'steelman-daily', label: '철강맨 일상' },
  { key: 'steelman-event', label: '철강맨 행사' },
] as const;
export type MessageEmoticonSetKey = (typeof MESSAGE_EMOTICON_SETS)[number]['key'];

/**
 * 메신저 이모티콘 (18번~22번, 문서에 없는 추가 기능): 묶음 3개, 116종. key를 message.emoticon_key에 저장한다.
 * 순서가 고르기 창 순서다. 그림은 화면의 /emoticons/<key>.gif(움직임)·.png(멈춘 그림, 64px), 원본은 docs/character/steelman-emoticon/
 */
export const MESSAGE_EMOTICONS = [
  { key: 'steelman-ok', label: '확인', set: 'steelman-work' },
  { key: 'steelman-yes', label: '넵넵', set: 'steelman-work' },
  { key: 'steelman-thanks', label: '감사합니다', set: 'steelman-work' },
  { key: 'steelman-sorry', label: '죄송합니다', set: 'steelman-work' },
  { key: 'steelman-approve', label: '결재 완료', set: 'steelman-work' },
  { key: 'steelman-best', label: '최고', set: 'steelman-work' },
  { key: 'steelman-gasp', label: '헉', set: 'steelman-work' },
  { key: 'steelman-off', label: '퇴근', set: 'steelman-work' },
  { key: 'steelman-checking', label: '확인 중', set: 'steelman-work' },
  { key: 'steelman-review', label: '검토 부탁드려요', set: 'steelman-work' },
  { key: 'steelman-reject', label: '반려', set: 'steelman-work' },
  { key: 'steelman-done', label: '완료', set: 'steelman-work' },
  { key: 'steelman-urgent', label: '긴급', set: 'steelman-work' },
  { key: 'steelman-wait', label: '잠시만요', set: 'steelman-work' },
  { key: 'steelman-fighting', label: '화이팅', set: 'steelman-work' },
  { key: 'steelman-well-done', label: '수고하셨습니다', set: 'steelman-work' },
  { key: 'steelman-hot-rolling', label: '열연 중', set: 'steelman-work' },
  { key: 'steelman-strike', label: '쇠뿔도 단김에', set: 'steelman-work' },
  { key: 'steelman-neat', label: '알잘딱깔센', set: 'steelman-work' },
  { key: 'steelman-decline', label: '정중한 거절', set: 'steelman-work' },
  { key: 'steelman-safety-first', label: '안전제일', set: 'steelman-work' },
  { key: 'steelman-point-check', label: '확인 좋아', set: 'steelman-work' },
  { key: 'steelman-pass', label: '합격', set: 'steelman-work' },
  { key: 'steelman-fail', label: '불합격', set: 'steelman-work' },
  { key: 'steelman-on-time', label: '납기 준수', set: 'steelman-work' },
  { key: 'steelman-lunch', label: '점심 식사', set: 'steelman-work' },
  { key: 'steelman-away', label: '자리 비움', set: 'steelman-work' },
  { key: 'steelman-meeting', label: '회의 중', set: 'steelman-work' },
  { key: 'steelman-outside', label: '외근 중', set: 'steelman-work' },
  { key: 'steelman-nep', label: '넵!', set: 'steelman-work' },
  { key: 'steelman-inspected', label: '점검 완료', set: 'steelman-work' },
  { key: 'steelman-tbm', label: 'TBM 갑니다', set: 'steelman-work' },
  { key: 'steelman-near-miss', label: '아차', set: 'steelman-work' },
  { key: 'steelman-tapping', label: '출선', set: 'steelman-work' },
  { key: 'steelman-praise', label: '칭찬해요', set: 'steelman-work' },
  { key: 'steelman-shipped', label: '출고 확정', set: 'steelman-work' },
  { key: 'steelman-goal', label: '월 목표 달성', set: 'steelman-work' },
  { key: 'steelman-shipping', label: '출하 중', set: 'steelman-work' },
  { key: 'steelman-overtime', label: '야근 중', set: 'steelman-work' },
  { key: 'steelman-panic', label: '멘붕', set: 'steelman-daily' },
  { key: 'steelman-lol', label: 'ㅋㅋㅋ', set: 'steelman-daily' },
  { key: 'steelman-love', label: '사랑해요', set: 'steelman-daily' },
  { key: 'steelman-hungry', label: '배고파', set: 'steelman-daily' },
  { key: 'steelman-coffee', label: '커피 수혈', set: 'steelman-daily' },
  { key: 'steelman-monday', label: '월요일', set: 'steelman-daily' },
  { key: 'steelman-friday', label: '불금', set: 'steelman-daily' },
  { key: 'steelman-sleepy', label: '졸려요', set: 'steelman-daily' },
  { key: 'steelman-cry', label: 'ㅠㅠ', set: 'steelman-daily' },
  { key: 'steelman-angry', label: '부글부글', set: 'steelman-daily' },
  { key: 'steelman-wow', label: '대박', set: 'steelman-daily' },
  { key: 'steelman-morning', label: '굿모닝', set: 'steelman-daily' },
  { key: 'steelman-yummy', label: '군침 싹', set: 'steelman-daily' },
  { key: 'steelman-cold-no', label: '냉정하게 거절', set: 'steelman-daily' },
  { key: 'steelman-rolled', label: '압연 당함', set: 'steelman-daily' },
  { key: 'steelman-quench', label: '담금질 중', set: 'steelman-daily' },
  { key: 'steelman-wall', label: '철벽 방어', set: 'steelman-daily' },
  { key: 'steelman-steel-mind', label: '강철 멘탈', set: 'steelman-daily' },
  { key: 'steelman-melting', label: '멘탈 녹는 중', set: 'steelman-daily' },
  { key: 'steelman-shaka', label: '좋다', set: 'steelman-daily' },
  { key: 'steelman-yar', label: '야르', set: 'steelman-daily' },
  { key: 'steelman-hallelujah', label: '할렐야루', set: 'steelman-daily' },
  { key: 'steelman-sense', label: '감다살', set: 'steelman-daily' },
  { key: 'steelman-no-sense', label: '감다뒤', set: 'steelman-daily' },
  { key: 'steelman-unbroken', label: '중꺾마', set: 'steelman-daily' },
  { key: 'steelman-even-better', label: '오히려 좋아', set: 'steelman-daily' },
  { key: 'steelman-iced', label: '얼죽아', set: 'steelman-daily' },
  { key: 'steelman-ominous', label: '불길하다', set: 'steelman-daily' },
  { key: 'steelman-inner-voice', label: '겉과 속', set: 'steelman-daily' },
  { key: 'steelman-lazy-reply', label: '대충 답장', set: 'steelman-daily' },
  { key: 'steelman-nep-nep', label: '넵병', set: 'steelman-daily' },
  { key: 'steelman-office-ghost', label: '사무실 지박령', set: 'steelman-daily' },
  { key: 'steelman-lunch-menu', label: '점심 뭐 먹지', set: 'steelman-daily' },
  { key: 'steelman-huh', label: '예?', set: 'steelman-daily' },
  { key: 'steelman-um', label: '엄', set: 'steelman-daily' },
  { key: 'steelman-no-no', label: '아뇨아뇨아뇨', set: 'steelman-daily' },
  { key: 'steelman-gg', label: '줴줴이야', set: 'steelman-daily' },
  { key: 'steelman-t-one', label: '티~원', set: 'steelman-daily' },
  { key: 'steelman-yoi', label: '요오오~이', set: 'steelman-daily' },
  { key: 'steelman-nep-soulless', label: '영혼 없는 넵', set: 'steelman-daily' },
  { key: 'steelman-nee', label: '네에', set: 'steelman-daily' },
  { key: 'steelman-neng', label: '넹', set: 'steelman-daily' },
  { key: 'steelman-okay', label: 'ㅇㅋ', set: 'steelman-daily' },
  { key: 'steelman-gogo', label: 'ㄱㄱ', set: 'steelman-daily' },
  { key: 'steelman-heol', label: '헐', set: 'steelman-daily' },
  { key: 'steelman-kingbat', label: '킹받네', set: 'steelman-daily' },
  { key: 'steelman-out-of-mind', label: '정신 나감', set: 'steelman-daily' },
  { key: 'steelman-rusty', label: '녹슬었다', set: 'steelman-daily' },
  { key: 'steelman-error', label: '오류', set: 'steelman-daily' },
  { key: 'steelman-cheers', label: '짠', set: 'steelman-daily' },
  { key: 'steelman-high-five', label: '하이파이브', set: 'steelman-daily' },
  { key: 'steelman-payday', label: '월급날', set: 'steelman-daily' },
  { key: 'steelman-leave-on-time', label: '칼퇴 각', set: 'steelman-daily' },
  { key: 'steelman-weekend-gone', label: '주말 순삭', set: 'steelman-daily' },
  { key: 'steelman-envy', label: '부럽다', set: 'steelman-daily' },
  { key: 'steelman-eh', label: '엥', set: 'steelman-daily' },
  { key: 'steelman-stop-it', label: '그만해', set: 'steelman-daily' },
  { key: 'steelman-reality-check', label: '현타', set: 'steelman-daily' },
  { key: 'steelman-fuss', label: '요들갑', set: 'steelman-daily' },
  { key: 'steelman-serious', label: '진지 모드', set: 'steelman-daily' },
  { key: 'steelman-bobflix', label: '밥플릭스', set: 'steelman-daily' },
  { key: 'steelman-flex', label: '플렉스', set: 'steelman-daily' },
  { key: 'steelman-clap', label: '박수', set: 'steelman-daily' },
  { key: 'steelman-coil-dog', label: '코일이', set: 'steelman-daily' },
  { key: 'steelman-slab-cat', label: '슬래브 냥이', set: 'steelman-daily' },
  { key: 'steelman-new-year', label: '새해 복 많이 받으세요', set: 'steelman-event' },
  { key: 'steelman-seollal', label: '즐거운 설', set: 'steelman-event' },
  { key: 'steelman-chuseok', label: '즐거운 추석', set: 'steelman-event' },
  { key: 'steelman-year-end', label: '올해도 수고했어요', set: 'steelman-event' },
  { key: 'steelman-birthday', label: '생일 축하해요', set: 'steelman-event' },
  { key: 'steelman-welcome', label: '환영합니다', set: 'steelman-event' },
  { key: 'steelman-promotion', label: '승진 축하드려요', set: 'steelman-event' },
  { key: 'steelman-christmas', label: '메리 크리스마스', set: 'steelman-event' },
  { key: 'steelman-hot', label: '더워요', set: 'steelman-event' },
  { key: 'steelman-cold', label: '추워요', set: 'steelman-event' },
  { key: 'steelman-vacation', label: '휴가 갑니다', set: 'steelman-event' },
  { key: 'steelman-congrats', label: '축하해요', set: 'steelman-event' },
] as const satisfies readonly { key: string; label: string; set: MessageEmoticonSetKey }[];
export type MessageEmoticonKey = (typeof MESSAGE_EMOTICONS)[number]['key'];
export const MESSAGE_EMOTICON_KEYS: readonly MessageEmoticonKey[] = MESSAGE_EMOTICONS.map((e) => e.key);

export function isMessageEmoticonKey(key: string): key is MessageEmoticonKey {
  return (MESSAGE_EMOTICON_KEYS as readonly string[]).includes(key);
}

/** 이모티콘만 있는 메시지의 미리보기 (목록·알림·답글·공지). 모르는 키(목록에서 뺀 것)는 '이모티콘' */
export function emoticonPreview(key: string): string {
  const found = MESSAGE_EMOTICONS.find((e) => e.key === key);
  return found ? `이모티콘 · ${found.label}` : '이모티콘';
}

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
  /** 내가 이 방 알림을 껐는지 (14번) */
  muted: boolean;
  /** 내가 목록 위에 고정한 시각 (고정하지 않았으면 null, 14번) */
  pinnedAt: string | null;
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
  /** 방 위에 고정한 공지 (삭제된 메시지면 null) */
  pinnedMessage: ChatPinnedMessageView | null;
  /** 내 방 설정: 알림 끄기·목록 위 고정 (14번) */
  muted: boolean;
  pinnedAt: string | null;
}

/** 공지로 고정한 메시지 요약 */
export interface ChatPinnedMessageView {
  id: number;
  senderName: string;
  preview: string;
  createdAt: string;
}

/** 메시지 첨부 파일 하나 */
export interface ChatMessageAttachmentView {
  id: number;
  fileName: string;
  /** 바이트. 스키마 3차 전에 올린 첨부는 null */
  fileSize: number | null;
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
  /** 첨부 파일 (올린 순서, 스키마 3차). 내려받기는 GET attachments/:첨부 id. 삭제된 메시지는 빈 배열 */
  attachments: ChatMessageAttachmentView[];
  /** 이모티콘 (스키마 4차). 없거나 삭제된 메시지는 null */
  emoticonKey: MessageEmoticonKey | null;
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
  /** 이모지 반응 (MESSAGE_REACTION_EMOJIS 순서, 0명인 것은 뺀다) */
  reactions: ChatMessageReactionView[];
  createdAt: string;
}

export interface ChatMessageReactionView {
  emoji: MessageReactionEmoji;
  count: number;
  reactedByMe: boolean;
  /** 반응한 사람 이름 (마우스를 올리면 보인다) */
  employeeNames: string[];
}

export interface ChatMessageParentView {
  id: number;
  senderName: string;
  /** 원본 본문 앞부분 (파일만 있으면 '파일 · 이름', 이모티콘만 있으면 '이모티콘 · 이름', 삭제됐으면 빈 값) */
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
/** 메시지 1건에 올릴 수 있는 파일 수 (스키마 3차, 가정값) */
export const MESSAGE_ATTACHMENT_MAX_COUNT = 10;
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

/** 내 방 설정 (14번, 사원마다 따로). 알림을 끄면 업무방 새 메시지 알림을 받지 않고 메신저 배지에서 빠진다(멘션은 받는다) */
export interface ChatRoomSettings {
  chatRoomId: number;
  muted: boolean;
  pinnedAt: string | null;
}

/** 방 나가기 결과 (15번). 1:1 방은 나갈 수 없다 */
export interface LeaveChatRoomResult {
  chatRoomId: number;
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
