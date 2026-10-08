import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  BLOCKED_ATTACHMENT_EXTENSIONS,
  BUSINESS_EVENT_TYPE,
  BUSINESS_EVENT_TYPE_LABEL,
  DELETED_MESSAGE_TEXT,
  MESSAGE_REACTION_EMOJIS,
  MESSAGE_TYPE,
  ERP_LINK_PATH,
  findErpNos,
  CHAT_ROOM_TYPE,
  CHAT_ROOM_TYPE_LABEL,
  MESSAGE_ATTACHMENT_MAX_BYTES,
  MESSAGE_ATTACHMENT_MAX_COUNT,
  MESSAGE_PAGE_SIZE,
  MESSAGE_SEARCH_SIZE,
  NOTIFICATION_TYPE,
  PERMISSION,
  SALES_ORDER_ITEM_STATUS,
  calcWeightTon,
  type AuthUser,
  type BusinessEventType,
  type ChatMemberView,
  type ChatMessagePage,
  type ChatMessageParentView,
  type ChatMessageReactionView,
  type ChatMessageView,
  type ChatRoomDetail,
  type ChatRoomListItem,
  type ErpLink,
  type ErpNoKind,
  type ChatRoomReadResult,
  type ChatRoomSettings,
  type ChatRoomType,
  type CreateChatRoomResult,
  type InviteChatMembersResult,
  type LeaveChatRoomResult,
  type RenameChatRoomResult,
  type ItemType,
  type SalesOrderItemStatus,
  type WorkRoomSalesOrderState,
  type WorkRoomSalesOrderView,
} from '@fantasteel/shared';
import { hasPermission } from '../../common/auth/auth.guard';
import { BusinessEventRecorder, type RecordedBusinessEvent } from '../../common/business-event/business-event.recorder';
import { AppException } from '../../common/errors/app.exception';
import { StorageService } from '../../common/storage/storage.service';
import { Prisma, type ChatRoom } from '../../generated/prisma/client';
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import type { CreateChatRoomDto, EditMessageDto, InviteMembersDto, PinMessageDto, ToggleReactionDto, ListMessagesQuery, MarkReadDto, RenameChatRoomDto, SearchMessagesQuery, SendMessageDto, UpdateChatRoomSettingsDto, UploadAttachmentDto } from './dto/messenger.dto';
import { MessengerGateway } from './messenger.gateway';
import { MessengerRepository } from './messenger.repository';

/** multer가 넘기는 업로드 파일 중 쓰는 값 */
export interface UploadedAttachment {
  originalname: string;
  size: number;
  buffer: Buffer;
}

/** 내려받을 첨부 */
export interface AttachmentContent {
  fileName: string;
  content: Buffer;
}

/** 저장할 새 메시지 (첨부는 저장소에 올린 뒤의 경로) */
interface NewMessage {
  content: string | null;
  attachments?: readonly { filePath: string; fileName: string; fileSize: number }[];
  clientMessageId: string | null;
  parentMessageId: number | null;
}

/** 파일 이름·크기·확장자 확인 (하나라도 걸리면 COM-004) */
function checkedFileName(file: UploadedAttachment): string {
  const fileName = decodeFileName(file.originalname).trim();
  if (!fileName || fileName.length > 255) throw new AppException('COM-004', '파일 이름은 1~255자여야 해요');
  if (file.size > MESSAGE_ATTACHMENT_MAX_BYTES) throw new AppException('COM-004', `파일은 ${MESSAGE_ATTACHMENT_MAX_BYTES / 1024 / 1024}MB까지 보낼 수 있어요 (${fileName})`);
  const extension = fileName.includes('.') ? fileName.split('.').pop()?.toLowerCase() : undefined;
  if (extension && (BLOCKED_ATTACHMENT_EXTENSIONS as readonly string[]).includes(extension)) throw new AppException('COM-004', `실행 파일(.${extension})은 보낼 수 없어요`);
  return fileName;
}

/** 알림 문구에 넣는 메시지 미리보기 길이 (가정값) */
const NOTIFICATION_PREVIEW_MAX = 50;

type RoomWithMembers = NonNullable<Awaited<ReturnType<MessengerRepository['findRoomWithMembers']>>>;
type MessageWithSender = Awaited<ReturnType<MessengerRepository['createMessage']>>;
type MemberEmployee = RoomWithMembers['chatRoomMembers'][number]['employee'];

const dateOnly = (d: Date) => d.toISOString().slice(0, 10);
const salesOrderLinkPath = (id: number) => `/sales-orders/${id}`;

/** 업무방 상단 수주 정보는 수주 화면을 볼 수 있는 사원에게만 ("ERP 대상 조회 권한", messenger.md 3장) */
const canViewSalesOrder = (user: AuthUser) => hasPermission(user, { permission: PERMISSION.SALES_ORDER_CREATE, level: 'VIEW' });

/** 취소되지 않은 품목 중 가장 빠른 납기 */
function earliestOpenDueDate(items: readonly { dueDate: Date; salesOrderItemStatus: string }[]): string | null {
  const dates = items.filter((i) => i.salesOrderItemStatus !== SALES_ORDER_ITEM_STATUS.CANCELLED).map((i) => dateOnly(i.dueDate));
  return dates.sort()[0] ?? null;
}

/** 첨부만 있는 메시지의 미리보기: '파일 · 이름', 여러 개면 '파일 · 이름 외 N개' */
function filePreview(firstName: string | null, count: number): string {
  if (!firstName || count === 0) return '';
  return count > 1 ? `파일 · ${firstName} 외 ${count - 1}개` : `파일 · ${firstName}`;
}

function previewOf(message: { content: string | null; deletedAt?: Date | null; messageAttachments: readonly { fileName: string }[] }): string {
  if (message.deletedAt) return DELETED_MESSAGE_TEXT;
  if (message.content) return message.content.replace(/\s+/g, ' ').trim();
  return filePreview(message.messageAttachments[0]?.fileName ?? null, message.messageAttachments.length);
}

/** 목록 SQL의 마지막 메시지 (첨부는 첫 이름과 개수만 온다) */
function lastPreviewOf(last: { content: string | null; deletedAt: Date | null; firstAttachmentName: string | null; attachmentCount: number }): string {
  if (last.deletedAt) return DELETED_MESSAGE_TEXT;
  if (last.content) return last.content.replace(/\s+/g, ' ').trim();
  return filePreview(last.firstAttachmentName, last.attachmentCount);
}

/** 방 이름: 1:1 = 상대 이름, 그룹 = 방 이름 또는 멤버 이름, 업무방 = 방 이름 또는 '업무방 · 수주번호' */
function displayNameOf(room: { chatRoomType: string; chatRoomName: string | null }, others: readonly MemberEmployee[], salesOrderNo: string | undefined): string {
  if (room.chatRoomType === CHAT_ROOM_TYPE.DIRECT && others[0]) return others[0].employeeName;
  if (room.chatRoomName) return room.chatRoomName;
  if (room.chatRoomType === CHAT_ROOM_TYPE.WORK) return salesOrderNo ? `업무방 · ${salesOrderNo}` : '업무방';
  const names = others.map((e) => e.employeeName);
  if (names.length === 0) return '이름 없는 채팅방';
  return names.length > 3 ? `${names.slice(0, 3).join(', ')} 외 ${names.length - 3}명` : names.join(', ');
}

/** 알림 문구의 방 이름 (1:1은 사람마다 이름이 달라 유형 이름을 쓴다) */
function roomLabelOf(room: Pick<ChatRoom, 'chatRoomType' | 'chatRoomName'>, salesOrderNo: string | undefined): string {
  if (room.chatRoomType === CHAT_ROOM_TYPE.DIRECT) return `${CHAT_ROOM_TYPE_LABEL.DIRECT} 채팅`;
  if (room.chatRoomName) return room.chatRoomName;
  if (room.chatRoomType === CHAT_ROOM_TYPE.WORK) return salesOrderNo ? `${CHAT_ROOM_TYPE_LABEL.WORK} · ${salesOrderNo}` : CHAT_ROOM_TYPE_LABEL.WORK;
  return `${CHAT_ROOM_TYPE_LABEL.GROUP} 채팅`;
}

function shorten(text: string): string {
  return text.length > NOTIFICATION_PREVIEW_MAX ? `${text.slice(0, NOTIFICATION_PREVIEW_MAX)}…` : text;
}

/** multer(busboy)는 파일 이름을 latin1로 읽어서 한글 이름이 깨진다. UTF-8로 다시 읽는다 */
function decodeFileName(name: string): string {
  const decoded = Buffer.from(name, 'latin1').toString('utf8');
  return decoded.includes('\uFFFD') ? name : decoded;
}

/** 메시지를 아직 읽지 않은 멤버 수: 보낸 사람을 빼고 읽음 위치가 이 메시지보다 앞인 멤버 */
function unreadMemberCountOf(message: { id: number; senderId: number | null }, reads: readonly { employeeId: number; lastReadMessageId: number | null }[]): number {
  return reads.filter((r) => r.employeeId !== message.senderId && (r.lastReadMessageId ?? 0) < message.id).length;
}

/**
 * 업무방에 진행 알림(시스템 메시지)을 남길 작업 로그 (수주에 연결된 것만). 수주 타임라인과 같은 근거(작업 로그)를 쓴다.
 * 예약·배정 추천처럼 자주 바뀌는 내부 단계는 넣지 않는다 (2026-10-08, 문서에 없는 추가 기능)
 */
const WORK_ROOM_NOTICE_TYPES: ReadonlySet<BusinessEventType> = new Set<BusinessEventType>([
  BUSINESS_EVENT_TYPE.SALES_ORDER_CANCELLED,
  BUSINESS_EVENT_TYPE.PRODUCTION_PLAN_CREATED,
  BUSINESS_EVENT_TYPE.PRODUCTION_PLAN_CANCELLED,
  BUSINESS_EVENT_TYPE.REPRODUCTION_PLAN_CREATED,
  BUSINESS_EVENT_TYPE.PRODUCTION_STARTED,
  BUSINESS_EVENT_TYPE.PRODUCTION_RESULT_REGISTERED,
  BUSINESS_EVENT_TYPE.SHIPMENT_REQUEST_CREATED,
  BUSINESS_EVENT_TYPE.ALLOCATION_CONFIRMED,
  BUSINESS_EVENT_TYPE.GOODS_ISSUE_CONFIRMED,
  BUSINESS_EVENT_TYPE.MILL_SHEET_ISSUED,
]);

/** 작업 로그의 변경 후 데이터에서 업무 번호(…No로 끝나는 첫 값)를 꺼낸다. 모듈마다 모양이 달라 이름 규칙으로만 찾는다 */
function documentNoOf(after: unknown): string | null {
  if (typeof after !== 'object' || after === null || Array.isArray(after)) return null;
  for (const [key, value] of Object.entries(after)) {
    if (key.endsWith('No') && typeof value === 'string' && value) return value;
  }
  return null;
}

/** 업무방 진행 알림 문구: [출고 확정] DR-2610-0001 · 신현우님 */
function workRoomNoticeOf(event: RecordedBusinessEvent): string {
  const no = documentNoOf(event.after);
  const actor = event.actor === 'SYSTEM' ? '시스템' : `${event.actor.employeeName}님`;
  return `[${BUSINESS_EVENT_TYPE_LABEL[event.type]}]${no ? ` ${no}` : ''} · ${actor}`;
}

/** 커밋을 기다렸다 소켓으로 보낼 때 다시 확인하는 간격(ms). 끝까지 없으면 롤백된 것으로 보고 보내지 않는다 */
const EMIT_RETRY_DELAYS_MS = [100, 300, 1000, 3000];

/** 시스템 메시지(보낸 사원 없음)의 보낸 사람 표시 */
const SYSTEM_SENDER_NAME = '시스템';

/** 업무 번호 → 링크. 메시지 여러 건의 번호를 모아 종류별로 한 번씩만 찾는다 */
type ErpLinkResolver = (content: string | null) => ErpLink[];

/** 이모지별로 묶은 반응 (허용 목록 순서) */
function reactionsOf(message: MessageWithSender, me: number): ChatMessageReactionView[] {
  return MESSAGE_REACTION_EMOJIS.flatMap((emoji) => {
    const rows = message.messageReactions.filter((r) => r.emoji === emoji);
    if (rows.length === 0) return [];
    return [{ emoji, count: rows.length, reactedByMe: rows.some((r) => r.employeeId === me), employeeNames: rows.map((r) => r.employee.employeeName) }];
  });
}

/** 답글의 원본 요약 */
function parentOf(message: MessageWithSender): ChatMessageParentView | null {
  const parent = message.parentMessage;
  if (!parent) return null;
  const deleted = parent.deletedAt !== null;
  return {
    id: parent.id,
    senderName: parent.sender?.employeeName ?? SYSTEM_SENDER_NAME,
    preview: deleted ? '' : shorten(previewOf(parent)),
    isDeleted: deleted,
  };
}

function toMessageView(message: MessageWithSender, me: number, unreadMemberCount: number, erpLinksOf: ErpLinkResolver): ChatMessageView {
  const deleted = message.deletedAt !== null;
  return {
    id: message.id,
    chatRoomId: message.chatRoomId,
    senderId: message.senderId,
    senderName: message.sender?.employeeName ?? SYSTEM_SENDER_NAME,
    senderDepartmentName: message.sender?.department.departmentName ?? null,
    senderJobGradeName: message.sender?.jobGrade.jobGradeName ?? null,
    isSystem: message.senderId === null,
    isMine: message.senderId === me,
    // 삭제된 메시지는 본문·첨부를 내보내지 않는다 (행은 남김)
    content: deleted ? null : message.content,
    attachments: deleted ? [] : message.messageAttachments.map((a) => ({ id: a.id, fileName: a.fileName, fileSize: a.fileSize })),
    unreadMemberCount,
    erpLinks: deleted ? [] : erpLinksOf(message.content),
    editedAt: message.editedAt?.toISOString() ?? null,
    isDeleted: deleted,
    parent: parentOf(message),
    reactions: deleted ? [] : reactionsOf(message, me),
    createdAt: message.createdAt.toISOString(),
  };
}

/**
 * 채팅방·메시지·첨부·읽음·알림 (REQ-MSG-001~006, BP-MSG-01). 방 멤버인지는 권한 코드가 아니라 chat_room_member로 확인한다.
 * 알림은 메시지와 같은 tx에서 만들고, 소켓 발송은 커밋 뒤에 한다 (롤백된 메시지를 보내지 않도록).
 */
@Injectable()
export class MessengerService implements OnModuleInit {
  private readonly logger = new Logger(MessengerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: MessengerRepository,
    private readonly notifications: NotificationService,
    private readonly storage: StorageService,
    private readonly gateway: MessengerGateway,
    private readonly businessEvents: BusinessEventRecorder,
  ) {}

  /** 수주 작업 로그가 기록되면 같은 tx에서 그 수주의 업무방에 진행 알림을 남긴다 (다른 모듈 코드를 고치지 않으려고 기록기에 건다) */
  onModuleInit(): void {
    this.businessEvents.onRecorded((tx, event) => this.postWorkRoomNotice(tx, event));
  }

  private async postWorkRoomNotice(tx: Tx, event: RecordedBusinessEvent): Promise<void> {
    if (event.salesOrderId === null || !WORK_ROOM_NOTICE_TYPES.has(event.type)) return;
    const room = await this.repository.findWorkRoomOf(tx, event.salesOrderId);
    if (!room) return;
    const message = await this.repository.createSystemMessage(tx, room.id, workRoomNoticeOf(event));
    // 본 거래의 tx는 다른 모듈이 열어서 커밋 시점을 알 수 없다 → 커밋된 뒤(행이 보일 때) 보낸다
    this.emitWhenCommitted(message.id);
  }

  /** 커밋된 메시지만 소켓으로 보낸다. 행이 끝까지 안 보이면(롤백) 보내지 않는다 */
  private emitWhenCommitted(messageId: number, attempt = 0): void {
    const timer = setTimeout(() => {
      void (async () => {
        const message = await this.repository.findMessageWithSender(this.prisma, messageId);
        if (!message) {
          if (attempt + 1 < EMIT_RETRY_DELAYS_MS.length) this.emitWhenCommitted(messageId, attempt + 1);
          return;
        }
        await this.emitNewMessage(message);
      })().catch((error: unknown) => this.logger.warn(`시스템 메시지 발송 실패 (메시지 ${messageId}): ${String(error)}`));
    }, EMIT_RETRY_DELAYS_MS[attempt]);
    // 서버 종료(테스트 포함)를 이 타이머가 붙잡지 않게 한다
    timer.unref();
  }

  /** 방 멤버 전원에게 새 메시지를 보낸다 (안 읽은 사람 수·ERP 링크 포함) */
  private async emitNewMessage(message: MessageWithSender): Promise<void> {
    const memberIds = (await this.repository.findMemberIds(this.prisma, message.chatRoomId)).map((m) => m.employeeId);
    const reads = await this.repository.findMemberReads(this.prisma, message.chatRoomId);
    const erpLinksOf = await this.erpLinkResolver([message.content]);
    const unread = unreadMemberCountOf(message, reads);
    this.gateway.emitMessage(memberIds, (employeeId) => toMessageView(message, employeeId, unread, erpLinksOf));
  }

  /** 내가 멤버인 채팅방, 최근 대화 순 */
  async listRooms(user: AuthUser): Promise<ChatRoomListItem[]> {
    const me = user.employeeId;
    const stats = await this.repository.findRoomStats(this.prisma, me);
    if (stats.length === 0) return [];
    const rooms = await this.repository.findRoomsWithMembers(
      this.prisma,
      stats.map((s) => s.chatRoomId),
    );
    const showSalesOrder = canViewSalesOrder(user);
    const salesOrderIds = [...new Set(rooms.map((r) => r.salesOrderId).filter((id): id is number => id !== null))];
    const salesOrders = new Map((await this.repository.findSalesOrderBriefs(this.prisma, salesOrderIds)).map((s) => [s.id, s]));
    const statsByRoom = new Map(stats.map((s) => [s.chatRoomId, s]));

    const items = rooms.map((room): ChatRoomListItem => {
      const stat = statsByRoom.get(room.id);
      const employees = room.chatRoomMembers.map((m) => m.employee);
      const others = employees.filter((e) => e.id !== me);
      const salesOrder = room.salesOrderId === null ? undefined : salesOrders.get(room.salesOrderId);
      const last = stat?.lastMessage ?? null;
      const lastSender = last ? employees.find((e) => e.id === last.senderId) : undefined;
      const counterpart = room.chatRoomType === CHAT_ROOM_TYPE.DIRECT ? others[0] : undefined;
      return {
        id: room.id,
        chatRoomType: room.chatRoomType as ChatRoomType,
        chatRoomName: room.chatRoomName,
        displayName: displayNameOf(room, others, salesOrder?.salesOrderNo),
        memberCount: employees.length,
        memberNames: others.map((e) => e.employeeName),
        counterpart: counterpart
          ? { employeeId: counterpart.id, employeeName: counterpart.employeeName, departmentName: counterpart.department.departmentName, jobGradeName: counterpart.jobGrade.jobGradeName }
          : null,
        lastMessage: last
          ? {
              senderName: last.senderId === null ? SYSTEM_SENDER_NAME : (lastSender?.employeeName ?? '-'),
              isMine: last.senderId === me,
              isSystem: last.senderId === null,
              preview: lastPreviewOf(last),
              createdAt: last.createdAt.toISOString(),
            }
          : null,
        unreadCount: stat?.unreadCount ?? 0,
        salesOrder:
          showSalesOrder && salesOrder
            ? { id: salesOrder.id, salesOrderNo: salesOrder.salesOrderNo, customerName: salesOrder.customer.customerName, dueDate: earliestOpenDueDate(salesOrder.salesOrderItems) }
            : null,
        createdAt: room.createdAt.toISOString(),
        muted: stat?.muted ?? false,
        pinnedAt: stat?.pinnedAt?.toISOString() ?? null,
      };
    });
    // 내가 고정한 방이 먼저, 그 안에서는 최근 대화 순
    const recentAt = (item: ChatRoomListItem) => item.lastMessage?.createdAt ?? item.createdAt;
    return items.sort((a, b) => Number(b.pinnedAt !== null) - Number(a.pinnedAt !== null) || recentAt(b).localeCompare(recentAt(a)) || b.id - a.id);
  }

  /** 채팅방 정보: 멤버, 업무방이면 수주 요약 */
  async getRoom(user: AuthUser, chatRoomId: number): Promise<ChatRoomDetail> {
    const me = user.employeeId;
    const room = await this.repository.findRoomWithMembers(this.prisma, chatRoomId);
    if (!room) throw new AppException('COM-003', '채팅방을 찾을 수 없어요');
    const membership = room.chatRoomMembers.find((m) => m.employeeId === me);
    if (!membership) throw new AppException('COM-002', '채팅방 멤버만 볼 수 있어요');

    const employees = room.chatRoomMembers.map((m) => m.employee);
    const headIds = new Set(
      (await this.repository.findHeadEmployeeIds(
        this.prisma,
        employees.map((e) => e.id),
      )).map((d) => d.headEmployeeId),
    );
    const members = employees
      .map(
        (e): ChatMemberView => ({
          id: e.id,
          employeeNo: e.employeeNo,
          employeeName: e.employeeName,
          departmentId: e.departmentId,
          departmentName: e.department.departmentName,
          jobGradeName: e.jobGrade.jobGradeName,
          isHead: headIds.has(e.id),
          isMe: e.id === me,
        }),
      )
      .sort((a, b) => Number(b.isMe) - Number(a.isMe) || a.employeeName.localeCompare(b.employeeName, 'ko'));

    let salesOrderState: WorkRoomSalesOrderState = 'none';
    let salesOrder: WorkRoomSalesOrderView | null = null;
    let salesOrderNo: string | undefined;
    if (room.chatRoomType === CHAT_ROOM_TYPE.WORK && room.salesOrderId !== null) {
      const found = await this.repository.findSalesOrderSummary(this.prisma, room.salesOrderId);
      salesOrderNo = found?.salesOrderNo;
      if (!canViewSalesOrder(user)) salesOrderState = 'denied';
      else if (!found) salesOrderState = 'missing';
      else {
        salesOrderState = 'ok';
        salesOrder = {
          id: found.id,
          salesOrderNo: found.salesOrderNo,
          customerName: found.customer.customerName,
          ownerName: found.ownerEmployee.employeeName,
          dueDate: earliestOpenDueDate(found.salesOrderItems),
          linkPath: salesOrderLinkPath(found.id),
          items: found.salesOrderItems.map((line) => ({
            id: line.id,
            itemCode: line.item.itemCode,
            itemType: line.item.itemType as ItemType,
            steelGradeCode: line.item.steelGrade?.steelGradeCode ?? null,
            orderedQty: line.orderedQty,
            orderedTon: line.item.theoreticalWeightTon ? calcWeightTon(line.orderedQty, line.item.theoreticalWeightTon.toString()) : null,
            dueDate: dateOnly(line.dueDate),
            salesOrderItemStatus: line.salesOrderItemStatus as SalesOrderItemStatus,
          })),
        };
      }
    }

    return {
      id: room.id,
      chatRoomType: room.chatRoomType as ChatRoomType,
      chatRoomName: room.chatRoomName,
      displayName: displayNameOf(
        room,
        employees.filter((e) => e.id !== me),
        salesOrderNo,
      ),
      createdAt: room.createdAt.toISOString(),
      members,
      salesOrderId: room.salesOrderId,
      salesOrderState,
      salesOrder,
      unreadCount: await this.repository.countUnread(this.prisma, room.id, me, membership.lastReadMessageId),
      lastReadMessageId: membership.lastReadMessageId,
      pinnedMessage:
        room.pinnedMessage && room.pinnedMessage.deletedAt === null
          ? {
              id: room.pinnedMessage.id,
              senderName: room.pinnedMessage.sender?.employeeName ?? SYSTEM_SENDER_NAME,
              preview: shorten(previewOf(room.pinnedMessage)),
              createdAt: room.pinnedMessage.createdAt.toISOString(),
            }
          : null,
      muted: membership.muted,
      pinnedAt: membership.pinnedAt?.toISOString() ?? null,
    };
  }

  /**
   * 방 나가기 (15번, 문서에 없는 추가 기능). 그룹방·업무방만(1:1은 상대 이름으로 보이는 방이라 COM-004).
   * 멤버 행을 지우고 남은 멤버에게 '…님이 나갔어요' 시스템 메시지를 남긴다. 업무방은 수주 화면에서 다시 열거나 초대받으면 돌아온다.
   * 나간 사람에게도 room:updated를 보내 다른 탭의 목록에서 지운다.
   */
  async leaveRoom(user: AuthUser, chatRoomId: number): Promise<LeaveChatRoomResult> {
    const me = user.employeeId;
    const notice = await this.prisma.$transaction(async (tx) => {
      const room = await this.requireMember(tx, chatRoomId, me);
      if (room.chatRoomType === CHAT_ROOM_TYPE.DIRECT) throw new AppException('COM-004', '1:1 채팅방은 나갈 수 없어요');
      await this.repository.deleteMember(tx, chatRoomId, me);
      return this.repository.createSystemMessage(tx, chatRoomId, `${user.employeeName}님이 나갔어요`);
    });
    const memberIds = (await this.repository.findMemberIds(this.prisma, chatRoomId)).map((m) => m.employeeId);
    this.gateway.emitRoomUpdated([...memberIds, me], { chatRoomId });
    await this.emitNewMessage(notice);
    return { chatRoomId };
  }

  /**
   * 내 방 설정 (14번, 문서에 없는 추가 기능): 알림 끄기·목록 위 고정. 나에게만 적용되고 시스템 메시지는 남기지 않는다.
   * 이미 고정한 방을 다시 고정하면 처음 고정한 시각을 그대로 둔다. 내 다른 화면(탭)도 갱신되게 나에게 room:updated를 보낸다.
   */
  async updateSettings(user: AuthUser, chatRoomId: number, dto: UpdateChatRoomSettingsDto): Promise<ChatRoomSettings> {
    const me = user.employeeId;
    const updated = await this.prisma.$transaction(async (tx) => {
      await this.requireMember(tx, chatRoomId, me);
      const membership = await this.repository.findMembership(tx, chatRoomId, me);
      const pinnedAt = dto.pinned === undefined ? undefined : dto.pinned ? (membership?.pinnedAt ?? new Date()) : null;
      return this.repository.updateMemberSettings(tx, chatRoomId, me, { muted: dto.muted, pinnedAt });
    });
    this.gateway.emitRoomUpdated([me], { chatRoomId });
    return { chatRoomId, muted: updated.muted, pinnedAt: updated.pinnedAt?.toISOString() ?? null };
  }

  /**
   * 공지 고정 (12번, 문서에 없는 추가 기능). 방 멤버 누구나 이 방의 삭제되지 않은 일반 메시지를 하나 고정한다(새로 고정하면 바뀐다).
   * 고정·해제는 시스템 메시지로 남기고 멤버에게 room:updated를 보낸다.
   */
  async pinMessage(user: AuthUser, chatRoomId: number, dto: PinMessageDto): Promise<ChatRoomDetail> {
    const notice = await this.prisma.$transaction(async (tx) => {
      await this.requireMember(tx, chatRoomId, user.employeeId);
      await this.requireReplyTarget(tx, chatRoomId, dto.messageId);
      await this.repository.updatePinnedMessage(tx, chatRoomId, dto.messageId);
      return this.repository.createSystemMessage(tx, chatRoomId, `${user.employeeName}님이 메시지를 공지로 고정했어요`);
    });
    await this.emitRoomUpdated(chatRoomId);
    await this.emitNewMessage(notice);
    return this.getRoom(user, chatRoomId);
  }

  /** 공지 내리기. 고정된 공지가 없으면 그대로 돌려준다 */
  async unpinMessage(user: AuthUser, chatRoomId: number): Promise<ChatRoomDetail> {
    const notice = await this.prisma.$transaction(async (tx) => {
      const room = await this.requireMember(tx, chatRoomId, user.employeeId);
      if (room.pinnedMessageId === null) return null;
      await this.repository.updatePinnedMessage(tx, chatRoomId, null);
      return this.repository.createSystemMessage(tx, chatRoomId, `${user.employeeName}님이 공지를 내렸어요`);
    });
    if (notice) {
      await this.emitRoomUpdated(chatRoomId);
      await this.emitNewMessage(notice);
    }
    return this.getRoom(user, chatRoomId);
  }

  /**
   * 채팅방 만들기. 나는 자동으로 멤버가 된다.
   * 1:1은 같은 상대와의 방이 있으면 그 방을, 업무방은 같은 수주의 방이 있으면 그 방을 돌려준다(업무방은 새로 고른 멤버를 더한다).
   */
  async createRoom(user: AuthUser, dto: CreateChatRoomDto): Promise<CreateChatRoomResult> {
    const me = user.employeeId;
    const memberIds = [...new Set(dto.memberIds)].filter((id) => id !== me);
    if (dto.chatRoomType === CHAT_ROOM_TYPE.DIRECT && memberIds.length !== 1) throw new AppException('COM-004', '1:1 채팅은 대화 상대 1명을 골라 주세요');
    if (dto.chatRoomType === CHAT_ROOM_TYPE.GROUP && memberIds.length < 1) throw new AppException('COM-004', '그룹 채팅은 멤버를 1명 이상 골라 주세요');
    if (dto.chatRoomType === CHAT_ROOM_TYPE.WORK) {
      if (dto.salesOrderId === undefined || dto.salesOrderId === null) throw new AppException('COM-004', '업무방은 연결할 수주를 골라 주세요');
      if (!canViewSalesOrder(user)) throw new AppException('COM-002', '수주를 볼 수 있는 사원만 업무방을 열 수 있어요');
    }

    const { result, changed, notices } = await this.prisma.$transaction(async (tx) => {
      await this.requireActiveEmployees(tx, memberIds);
      const notices: MessageWithSender[] = [];

      if (dto.chatRoomType === CHAT_ROOM_TYPE.DIRECT) {
        const existing = await this.repository.findDirectRoomOf(tx, [me, memberIds[0]]);
        if (existing) return { result: { id: existing.id, reused: true }, changed: false, notices };
        return { result: await this.insertRoom(tx, { chatRoomType: CHAT_ROOM_TYPE.DIRECT, chatRoomName: null, salesOrderId: null }, [me, ...memberIds]), changed: true, notices };
      }

      if (dto.chatRoomType === CHAT_ROOM_TYPE.WORK) {
        const salesOrderId = dto.salesOrderId as number;
        const [salesOrder] = await this.repository.findSalesOrderNos(tx, [salesOrderId]);
        if (!salesOrder) throw new AppException('COM-003', '수주를 찾을 수 없어요');
        const existing = await this.repository.findWorkRoomOf(tx, salesOrderId);
        if (existing) {
          const addedIds = await this.addMembers(tx, existing.id, [me, ...memberIds]);
          if (addedIds.length > 0) notices.push(await this.repository.createSystemMessage(tx, existing.id, await this.joinedNotice(tx, user, addedIds)));
          return { result: { id: existing.id, reused: true }, changed: addedIds.length > 0, notices };
        }
        const chatRoomName = `${salesOrder.salesOrderNo} ${salesOrder.customer.customerName}`;
        const created = await this.insertRoom(tx, { chatRoomType: CHAT_ROOM_TYPE.WORK, chatRoomName, salesOrderId }, [me, ...memberIds]);
        notices.push(await this.repository.createSystemMessage(tx, created.id, `${user.employeeName}님이 수주 ${salesOrder.salesOrderNo} 업무방을 열었어요`));
        return { result: created, changed: true, notices };
      }

      const chatRoomName = dto.chatRoomName?.trim() || null;
      return { result: await this.insertRoom(tx, { chatRoomType: CHAT_ROOM_TYPE.GROUP, chatRoomName, salesOrderId: null }, [me, ...memberIds]), changed: true, notices };
    });
    if (changed) await this.emitRoomUpdated(result.id);
    for (const notice of notices) await this.emitNewMessage(notice);
    return result;
  }

  /**
   * 멤버 초대 (방 관리, 문서에 없는 기능: 2026-10-07 단계별 추가 결정). 방 멤버만 초대할 수 있고 1:1 방은 안 된다.
   * 새 멤버는 이전 대화를 볼 수 있고 지금까지의 메시지는 읽은 것으로 시작한다. 이미 멤버인 사원은 건너뛴다.
   */
  async inviteMembers(user: AuthUser, chatRoomId: number, dto: InviteMembersDto): Promise<InviteChatMembersResult> {
    const { addedCount, notice } = await this.prisma.$transaction(async (tx) => {
      const room = await this.requireMember(tx, chatRoomId, user.employeeId);
      if (room.chatRoomType === CHAT_ROOM_TYPE.DIRECT) throw new AppException('COM-004', '1:1 채팅방에는 멤버를 추가할 수 없어요. 그룹 채팅방을 새로 만들어 주세요');
      const existing = new Set((await this.repository.findMemberIds(tx, chatRoomId)).map((m) => m.employeeId));
      const newIds = [...new Set(dto.memberIds)].filter((id) => !existing.has(id));
      if (newIds.length === 0) throw new AppException('COM-004', '초대할 멤버를 1명 이상 골라 주세요');
      await this.requireActiveEmployees(tx, newIds);
      const addedIds = await this.addMembers(tx, chatRoomId, newIds);
      return { addedCount: addedIds.length, notice: await this.repository.createSystemMessage(tx, chatRoomId, await this.joinedNotice(tx, user, addedIds)) };
    });
    await this.emitRoomUpdated(chatRoomId);
    await this.emitNewMessage(notice);
    return { chatRoomId, addedCount };
  }

  /** 그룹방 이름 바꾸기 (방 멤버만). 1:1은 상대 이름, 업무방은 수주로 이름이 정해져 바꾸지 않는다 */
  async renameRoom(user: AuthUser, chatRoomId: number, dto: RenameChatRoomDto): Promise<RenameChatRoomResult> {
    const chatRoomName = dto.chatRoomName?.trim() || null;
    const notice = await this.prisma.$transaction(async (tx) => {
      const room = await this.requireMember(tx, chatRoomId, user.employeeId);
      if (room.chatRoomType !== CHAT_ROOM_TYPE.GROUP) throw new AppException('COM-004', '그룹 채팅방만 이름을 바꿀 수 있어요');
      await this.repository.updateRoomName(tx, chatRoomId, chatRoomName);
      const text = chatRoomName ? `${user.employeeName}님이 방 이름을 '${chatRoomName}'(으)로 바꿨어요` : `${user.employeeName}님이 방 이름을 지웠어요`;
      return this.repository.createSystemMessage(tx, chatRoomId, text);
    });
    await this.emitRoomUpdated(chatRoomId);
    await this.emitNewMessage(notice);
    const detail = await this.getRoom(user, chatRoomId);
    return { id: chatRoomId, chatRoomName: detail.chatRoomName, displayName: detail.displayName };
  }

  /** 최근 메시지부터 limit개 (응답은 오래된 순). before를 주면 그보다 오래된 메시지 */
  async listMessages(user: AuthUser, chatRoomId: number, query: ListMessagesQuery): Promise<ChatMessagePage> {
    await this.requireMember(this.prisma, chatRoomId, user.employeeId);
    const limit = query.limit ?? MESSAGE_PAGE_SIZE;
    const rows = await this.repository.findMessagesBefore(this.prisma, chatRoomId, query.before, limit + 1);
    return this.toPage(chatRoomId, user.employeeId, rows.slice(0, limit).reverse(), rows.length > limit);
  }

  /** 파일 모아보기: 첨부가 있는 메시지만 최신순으로 (before로 더 보기) */
  async listAttachments(user: AuthUser, chatRoomId: number, query: ListMessagesQuery): Promise<ChatMessagePage> {
    await this.requireMember(this.prisma, chatRoomId, user.employeeId);
    const limit = query.limit ?? MESSAGE_PAGE_SIZE;
    const rows = await this.repository.findAttachmentMessagesBefore(this.prisma, chatRoomId, query.before, limit + 1);
    return this.toPage(chatRoomId, user.employeeId, rows.slice(0, limit), rows.length > limit);
  }

  /** 방 안 메시지 검색: 본문에 검색어가 든 메시지를 최신순으로 (대소문자 무시, before로 더 보기) */
  async searchMessages(user: AuthUser, chatRoomId: number, query: SearchMessagesQuery): Promise<ChatMessagePage> {
    const keyword = query.q.trim();
    if (!keyword) throw new AppException('COM-004', '검색어를 넣어 주세요');
    await this.requireMember(this.prisma, chatRoomId, user.employeeId);
    const limit = query.limit ?? MESSAGE_SEARCH_SIZE;
    const rows = await this.repository.searchMessages(this.prisma, chatRoomId, keyword, query.before, limit + 1);
    return this.toPage(chatRoomId, user.employeeId, rows.slice(0, limit), rows.length > limit);
  }

  /** 메시지 목록 응답: 멤버 읽음 위치를 한 번 읽어 메시지마다 안 읽은 사람 수를 붙인다 */
  private async toPage(chatRoomId: number, me: number, rows: readonly MessageWithSender[], hasMore: boolean): Promise<ChatMessagePage> {
    const reads = await this.repository.findMemberReads(this.prisma, chatRoomId);
    const erpLinksOf = await this.erpLinkResolver(rows.map((m) => m.content));
    return { items: rows.map((m) => toMessageView(m, me, unreadMemberCountOf(m, reads), erpLinksOf)), hasMore };
  }

  /** 본문들의 업무 번호를 모아 실제로 있는 문서만 링크로 바꾸는 함수를 만든다 (REQ-MSG-006) */
  private async erpLinkResolver(contents: readonly (string | null)[]): Promise<ErpLinkResolver> {
    const found = contents.flatMap((content) => (content ? findErpNos(content) : []));
    if (found.length === 0) return () => [];
    const numbersOf = (kind: ErpNoKind) => [...new Set(found.filter((f) => f.kind === kind).map((f) => f.no))];
    const documents = await this.repository.findErpDocuments(this.prisma, {
      salesOrderNos: numbersOf('SALES_ORDER'),
      purchaseRequisitionNos: numbersOf('PURCHASE_REQUISITION'),
      shipmentRequestNos: numbersOf('SHIPMENT_REQUEST'),
    });
    const idOf = new Map<string, number>([
      ...documents.salesOrders.map((d) => [`SALES_ORDER:${d.no}`, d.id] as const),
      ...documents.purchaseRequisitions.map((d) => [`PURCHASE_REQUISITION:${d.no}`, d.id] as const),
      ...documents.shipmentRequests.map((d) => [`SHIPMENT_REQUEST:${d.no}`, d.id] as const),
    ]);
    return (content) =>
      (content ? findErpNos(content) : []).flatMap(({ no, kind }) => {
        const id = idOf.get(`${kind}:${no}`);
        return id === undefined ? [] : [{ text: no, href: ERP_LINK_PATH[kind](id) }];
      });
  }

  /** 글 메시지 보내기 (REQ-MSG-002). @멘션 대상은 mentionedEmployeeIds로 받는다 */
  sendMessage(user: AuthUser, chatRoomId: number, dto: SendMessageDto): Promise<ChatMessageView> {
    const content = dto.content.trim();
    if (!content) throw new AppException('COM-004', '보낼 메시지를 넣어 주세요');
    return this.postMessage(user, chatRoomId, { content, clientMessageId: dto.clientMessageId ?? null, parentMessageId: dto.parentMessageId ?? null }, dto.mentionedEmployeeIds ?? []);
  }

  /**
   * 파일 첨부 (REQ-MSG-003). 업로드하면 바로 메시지 1건이 생긴다. 스키마 3차부터 메시지 1건에 파일 여러 개(최대 MESSAGE_ATTACHMENT_MAX_COUNT, 가정값),
   * 파일마다 10MB·실행 파일 거부. 하나라도 걸리면 아무것도 저장하지 않는다. 글은 선택
   */
  async sendAttachments(user: AuthUser, chatRoomId: number, files: readonly UploadedAttachment[], dto: UploadAttachmentDto): Promise<ChatMessageView> {
    if (files.length === 0) throw new AppException('COM-004', '첨부할 파일을 골라 주세요 (files 필드)');
    if (files.length > MESSAGE_ATTACHMENT_MAX_COUNT) throw new AppException('COM-004', `파일은 한 번에 ${MESSAGE_ATTACHMENT_MAX_COUNT}개까지 보낼 수 있어요`);
    const named = files.map((file) => ({ file, fileName: checkedFileName(file) }));
    // 저장소에 먼저 올리면 멤버가 아닌 사람의 파일이 남으므로 멤버 확인을 먼저 한다
    await this.requireMember(this.prisma, chatRoomId, user.employeeId);
    // 재전송이면 파일을 다시 저장하지 않는다
    const clientMessageId = dto.clientMessageId ?? null;
    const duplicate = clientMessageId ? await this.findDuplicate(user.employeeId, chatRoomId, clientMessageId) : null;
    if (duplicate) return duplicate;
    const attachments = [];
    for (const { file, fileName } of named) {
      attachments.push({ filePath: await this.storage.save('messages', fileName, file.buffer), fileName, fileSize: file.size });
    }
    const content = dto.content?.trim() || null;
    return this.postMessage(user, chatRoomId, { content, attachments, clientMessageId, parentMessageId: dto.parentMessageId ?? null }, []);
  }

  /** 같은 보내기 id로 이미 저장한 메시지가 있으면 그 메시지 (다른 방이면 잘못된 재사용이라 COM-004) */
  private async findDuplicate(senderId: number, chatRoomId: number, clientMessageId: string): Promise<ChatMessageView | null> {
    const existing = await this.repository.findMessageByClientId(this.prisma, senderId, clientMessageId);
    if (!existing) return null;
    if (existing.chatRoomId !== chatRoomId) throw new AppException('COM-004', '이미 다른 채팅방에 쓴 보내기 id예요');
    const reads = await this.repository.findMemberReads(this.prisma, chatRoomId);
    const erpLinksOf = await this.erpLinkResolver([existing.content]);
    return toMessageView(existing, senderId, unreadMemberCountOf(existing, reads), erpLinksOf);
  }

  /** 첨부 내려받기. id는 첨부(message_attachment) id (스키마 3차). 방 멤버만, 삭제된 메시지의 첨부는 COM-003 */
  async readAttachment(user: AuthUser, attachmentId: number): Promise<AttachmentContent> {
    const attachment = await this.repository.findAttachment(this.prisma, attachmentId);
    if (!attachment || attachment.message.deletedAt) throw new AppException('COM-003', '첨부 파일을 찾을 수 없어요');
    await this.requireMember(this.prisma, attachment.message.chatRoomId, user.employeeId);
    try {
      return { fileName: attachment.fileName, content: await this.storage.read(attachment.filePath) };
    } catch {
      throw new AppException('COM-003', '첨부 파일을 찾을 수 없어요');
    }
  }

  /**
   * 내 메시지 고치기 (#151, 문서에 없는 추가 기능). 일반 메시지·삭제 안 된 것만. 본문은 비울 수 없고(첨부가 있으면 비워도 됨),
   * 고친 시각을 남긴다. 멘션 알림은 다시 보내지 않는다. 고칠 수 있는 시간 제한은 두지 않는다(팀 결정 전).
   */
  async editMessage(user: AuthUser, messageId: number, dto: EditMessageDto): Promise<ChatMessageView> {
    const content = dto.content.trim() || null;
    const updated = await this.prisma.$transaction(async (tx) => {
      const message = await this.requireOwnMessage(tx, user, messageId);
      if (!content && message._count.messageAttachments === 0) throw new AppException('COM-004', '고칠 메시지를 넣어 주세요');
      return this.repository.updateMessageContent(tx, messageId, content);
    });
    return this.emitUpdated(updated, user.employeeId);
  }

  /** 내 메시지 삭제 (#151). 행·첨부 파일은 남기고 삭제 표시만 한다. 다시 지우면 그대로 돌려준다 */
  async deleteMessage(user: AuthUser, messageId: number): Promise<ChatMessageView> {
    const updated = await this.prisma.$transaction(async (tx) => {
      await this.requireOwnMessage(tx, user, messageId, { allowDeleted: true });
      const current = await this.repository.findMessageWithSender(tx, messageId);
      if (current?.deletedAt) return current;
      return this.repository.markMessageDeleted(tx, messageId);
    });
    return this.emitUpdated(updated, user.employeeId);
  }

  /**
   * 이모지 반응 누르기 (13번, 문서에 없는 추가 기능). 없으면 더하고 있으면 뺀다. 방 멤버가 삭제되지 않은 일반 메시지에만.
   * 알림은 보내지 않고, 멤버에게 message:updated로 다시 보낸다.
   */
  async toggleReaction(user: AuthUser, messageId: number, dto: ToggleReactionDto): Promise<ChatMessageView> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const message = await this.repository.findMessage(tx, messageId);
      if (!message) throw new AppException('COM-003', '메시지를 찾을 수 없어요');
      await this.requireMember(tx, message.chatRoomId, user.employeeId);
      if (message.deletedAt || message.messageType !== MESSAGE_TYPE.USER) throw new AppException('COM-004', '삭제된 메시지나 시스템 메시지에는 반응할 수 없어요');
      const existing = await this.repository.findReaction(tx, messageId, user.employeeId, dto.emoji);
      if (existing) await this.repository.deleteReaction(tx, existing.id);
      else await this.repository.createReaction(tx, messageId, user.employeeId, dto.emoji);
      return this.repository.findMessageWithSender(tx, messageId);
    });
    if (!updated) throw new AppException('COM-003', '메시지를 찾을 수 없어요');
    return this.emitUpdated(updated, user.employeeId);
  }

  /** 고침·삭제를 방 멤버에게 보내고 내 기준 화면 값을 돌려준다 */
  private async emitUpdated(message: MessageWithSender, me: number): Promise<ChatMessageView> {
    const memberIds = (await this.repository.findMemberIds(this.prisma, message.chatRoomId)).map((m) => m.employeeId);
    const reads = await this.repository.findMemberReads(this.prisma, message.chatRoomId);
    const erpLinksOf = await this.erpLinkResolver([message.content]);
    const unread = unreadMemberCountOf(message, reads);
    this.gateway.emitMessageUpdated(memberIds, (employeeId) => toMessageView(message, employeeId, unread, erpLinksOf));
    return toMessageView(message, me, unread, erpLinksOf);
  }

  /** 메시지가 없으면 COM-003, 방 멤버가 아니면 COM-002, 내 일반 메시지가 아니거나 삭제됐으면 COM-004 */
  private async requireOwnMessage(tx: Tx, user: AuthUser, messageId: number, options: { allowDeleted?: boolean } = {}) {
    const message = await this.repository.findMessage(tx, messageId);
    if (!message) throw new AppException('COM-003', '메시지를 찾을 수 없어요');
    await this.requireMember(tx, message.chatRoomId, user.employeeId);
    if (message.messageType !== MESSAGE_TYPE.USER || message.senderId !== user.employeeId) throw new AppException('COM-004', '내가 보낸 메시지만 고치거나 지울 수 있어요');
    if (message.deletedAt && !options.allowDeleted) throw new AppException('COM-004', '삭제된 메시지예요');
    return message;
  }

  /** 답글 대상: 같은 방의 삭제되지 않은 일반 메시지 */
  private async requireReplyTarget(tx: Tx, chatRoomId: number, parentMessageId: number): Promise<void> {
    const parent = await this.repository.findMessage(tx, parentMessageId);
    if (!parent || parent.chatRoomId !== chatRoomId) throw new AppException('COM-003', '답글을 달 메시지를 이 채팅방에서 찾을 수 없어요');
    if (parent.deletedAt || parent.messageType !== MESSAGE_TYPE.USER) throw new AppException('COM-004', '삭제된 메시지나 시스템 메시지에는 답글을 달 수 없어요');
  }

  /** 읽음 위치 갱신 (REQ-MSG-004). 뒤로 돌아가지 않는다. 남은 안 읽은 수를 돌려주고 내 다른 화면에도 알린다 */
  async markRead(user: AuthUser, chatRoomId: number, dto: MarkReadDto): Promise<ChatRoomReadResult> {
    const me = user.employeeId;
    const result = await this.prisma.$transaction(async (tx): Promise<ChatRoomReadResult> => {
      await this.requireMember(tx, chatRoomId, me);
      const message = await this.repository.findMessage(tx, dto.lastMessageId);
      if (!message || message.chatRoomId !== chatRoomId) throw new AppException('COM-003', '이 채팅방의 메시지를 찾을 수 없어요');
      await this.repository.moveLastRead(tx, chatRoomId, me, message.id);
      const membership = await this.repository.findMembership(tx, chatRoomId, me);
      const lastReadMessageId = membership?.lastReadMessageId ?? null;
      return { chatRoomId, lastReadMessageId, unreadCount: await this.repository.countUnread(tx, chatRoomId, me, lastReadMessageId) };
    });
    this.gateway.emitRead(me, result);
    const others = (await this.repository.findMemberIds(this.prisma, chatRoomId)).map((m) => m.employeeId).filter((id) => id !== me);
    this.gateway.emitMemberRead(others, { chatRoomId, employeeId: me, lastReadMessageId: result.lastReadMessageId });
    return result;
  }

  /**
   * 메시지 저장 → 보낸 사람 읽음 위치 이동 → 알림 (같은 tx) → 커밋 뒤 멤버에게 소켓 발송.
   * 알림 (REQ-MSG-005): 멘션된 멤버는 MENTION, 업무방이면 나머지 멤버는 WORK_ROOM_MESSAGE. 한 메시지로 한 사람에게 1건만.
   */
  private async postMessage(
    user: AuthUser,
    chatRoomId: number,
    data: NewMessage,
    mentionedEmployeeIds: readonly number[],
  ): Promise<ChatMessageView> {
    const me = user.employeeId;
    // 재전송 중복 방지 (#151): 이미 저장된 보내기 id면 알림·소켓 없이 처음 메시지를 돌려준다
    if (data.clientMessageId) {
      const duplicate = await this.findDuplicate(me, chatRoomId, data.clientMessageId);
      if (duplicate) return duplicate;
    }
    let saved: { message: MessageWithSender; memberIds: number[] };
    try {
      saved = await this.saveMessage(user, chatRoomId, data, mentionedEmployeeIds);
    } catch (error) {
      // 같은 보내기 id가 거의 동시에 두 번 들어오면 부분 unique에 걸린다 → 먼저 저장된 메시지를 돌려준다
      if (data.clientMessageId && error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const duplicate = await this.findDuplicate(me, chatRoomId, data.clientMessageId);
        if (duplicate) return duplicate;
      }
      throw error;
    }
    const { message, memberIds } = saved;
    // 방금 보낸 메시지는 보낸 사람 말고 아무도 읽지 않았다
    const unreadMemberCount = memberIds.length - 1;
    const erpLinksOf = await this.erpLinkResolver([message.content]);
    this.gateway.emitMessage(memberIds, (employeeId) => toMessageView(message, employeeId, unreadMemberCount, erpLinksOf));
    return toMessageView(message, me, unreadMemberCount, erpLinksOf);
  }

  private saveMessage(
    user: AuthUser,
    chatRoomId: number,
    { attachments, ...data }: NewMessage,
    mentionedEmployeeIds: readonly number[],
  ): Promise<{ message: MessageWithSender; memberIds: number[] }> {
    const me = user.employeeId;
    return this.prisma.$transaction(async (tx) => {
      const room = await this.requireMember(tx, chatRoomId, me);
      if (data.parentMessageId !== null) await this.requireReplyTarget(tx, chatRoomId, data.parentMessageId);
      const created = await this.repository.createMessage(tx, { chatRoomId, senderId: me, ...data }, attachments);
      await this.repository.moveLastRead(tx, chatRoomId, me, created.id);
      const members = (await this.repository.findMemberIds(tx, chatRoomId)).map((m) => m.employeeId);
      await this.notifyForMessage(tx, room, created, members, mentionedEmployeeIds);
      return { message: created, memberIds: members };
    });
  }

  private async notifyForMessage(tx: Tx, room: ChatRoom, message: MessageWithSender, memberIds: readonly number[], mentionedEmployeeIds: readonly number[]): Promise<void> {
    const senderId = message.senderId;
    const others = memberIds.filter((id) => id !== senderId);
    const mentioned = [...new Set(mentionedEmployeeIds)].filter((id) => others.includes(id));
    // 알림을 끈 멤버는 업무방 새 메시지 알림만 빼고 멘션은 받는다 (14번, 가정)
    const muted = room.chatRoomType === CHAT_ROOM_TYPE.WORK ? new Set((await this.repository.findMutedMemberIds(tx, room.id)).map((m) => m.employeeId)) : new Set<number>();
    const workRoomRecipients = room.chatRoomType === CHAT_ROOM_TYPE.WORK ? others.filter((id) => !mentioned.includes(id) && !muted.has(id)) : [];
    if (mentioned.length === 0 && workRoomRecipients.length === 0) return;

    const salesOrderNo = room.salesOrderId === null ? undefined : (await this.repository.findSalesOrderNos(tx, [room.salesOrderId]))[0]?.salesOrderNo;
    const roomLabel = roomLabelOf(room, salesOrderNo);
    const preview = shorten(previewOf(message));
    const senderName = message.sender?.employeeName ?? SYSTEM_SENDER_NAME;
    // 알림을 누르면 그 메시지까지 이동한다
    const linkPath = `/messenger?room=${room.id}&message=${message.id}`;
    await this.notifications.notifyEmployees(tx, mentioned, {
      notificationType: NOTIFICATION_TYPE.MENTION,
      notificationContent: `${senderName}님이 멘션했어요 · ${roomLabel} · ${preview}`,
      linkPath,
      messageId: message.id,
    });
    await this.notifications.notifyEmployees(tx, workRoomRecipients, {
      notificationType: NOTIFICATION_TYPE.WORK_ROOM_MESSAGE,
      notificationContent: `${roomLabel} 새 메시지 · ${senderName}: ${preview}`,
      linkPath,
      messageId: message.id,
    });
  }

  private async emitRoomUpdated(chatRoomId: number): Promise<void> {
    const memberIds = (await this.repository.findMemberIds(this.prisma, chatRoomId)).map((m) => m.employeeId);
    this.gateway.emitRoomUpdated(memberIds, { chatRoomId });
  }

  /** 방이 없으면 COM-003, 멤버가 아니면 COM-002 */
  private async requireMember(tx: Tx, chatRoomId: number, employeeId: number): Promise<ChatRoom> {
    const room = await this.repository.findRoom(tx, chatRoomId);
    if (!room) throw new AppException('COM-003', '채팅방을 찾을 수 없어요');
    if (!(await this.repository.findMembership(tx, chatRoomId, employeeId))) throw new AppException('COM-002', '채팅방 멤버만 볼 수 있어요');
    return room;
  }

  /** 없는 사원은 COM-003, 사용 중이 아닌 사원은 COM-004 */
  private async requireActiveEmployees(tx: Tx, ids: readonly number[]): Promise<void> {
    if (ids.length === 0) return;
    const found = new Map((await this.repository.findEmployees(tx, ids)).map((e) => [e.id, e]));
    for (const id of ids) {
      const employee = found.get(id);
      if (!employee) throw new AppException('COM-003', `사원(id ${id})을 찾을 수 없어요`);
      if (!employee.isActive) throw new AppException('COM-004', `${employee.employeeName}님은 사용 중인 사원이 아니에요`);
    }
  }

  private async insertRoom(
    tx: Tx,
    data: { chatRoomType: ChatRoomType; chatRoomName: string | null; salesOrderId: number | null },
    employeeIds: readonly number[],
  ): Promise<CreateChatRoomResult> {
    const room = await this.repository.createRoom(tx, data);
    await this.repository.createMembers(tx, room.id, employeeIds, null);
    return { id: room.id, reused: false };
  }

  /** 기존 업무방에 새 멤버를 더한다. 새 멤버는 지금까지의 메시지를 읽은 것으로 시작한다 */
  private async addMembers(tx: Tx, chatRoomId: number, employeeIds: readonly number[]): Promise<number[]> {
    const existing = new Set((await this.repository.findMemberIds(tx, chatRoomId)).map((m) => m.employeeId));
    const newIds = employeeIds.filter((id) => !existing.has(id));
    if (newIds.length === 0) return [];
    const lastMessage = await this.repository.findLastMessageId(tx, chatRoomId);
    await this.repository.createMembers(tx, chatRoomId, newIds, lastMessage?.id ?? null);
    return newIds;
  }

  /** 초대 안내: 이현정님이 권예진님, 신현우님을 초대했어요 (스스로 들어온 경우는 '들어왔어요') */
  private async joinedNotice(tx: Tx, user: AuthUser, addedIds: readonly number[]): Promise<string> {
    const names = new Map((await this.repository.findEmployees(tx, addedIds)).map((e) => [e.id, e.employeeName]));
    const others = addedIds.filter((id) => id !== user.employeeId).map((id) => `${names.get(id) ?? '-'}님`);
    if (others.length === 0) return `${user.employeeName}님이 들어왔어요`;
    // 이름마다 '님'이 붙어 받침이 있으므로 '을'
    return `${user.employeeName}님이 ${others.join(', ')}을 초대했어요`;
  }
}
