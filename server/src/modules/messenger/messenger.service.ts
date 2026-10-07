import { Injectable } from '@nestjs/common';
import {
  CHAT_ROOM_TYPE,
  MESSAGE_PAGE_SIZE,
  PERMISSION,
  SALES_ORDER_ITEM_STATUS,
  calcWeightTon,
  type AuthUser,
  type ChatMemberView,
  type ChatMessagePage,
  type ChatMessageView,
  type ChatRoomDetail,
  type ChatRoomListItem,
  type ChatRoomType,
  type CreateChatRoomResult,
  type ItemType,
  type SalesOrderItemStatus,
  type WorkRoomSalesOrderState,
  type WorkRoomSalesOrderView,
} from '@fantasteel/shared';
import { hasPermission } from '../../common/auth/auth.guard';
import { AppException } from '../../common/errors/app.exception';
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import type { CreateChatRoomDto, ListMessagesQuery, SendMessageDto } from './dto/messenger.dto';
import { MessengerRepository } from './messenger.repository';

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

function previewOf(message: { content: string | null; attachmentName: string | null }): string {
  if (message.content) return message.content.replace(/\s+/g, ' ').trim();
  return message.attachmentName ? `파일 · ${message.attachmentName}` : '';
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

function toMessageView(message: MessageWithSender, me: number): ChatMessageView {
  return {
    id: message.id,
    chatRoomId: message.chatRoomId,
    senderId: message.senderId,
    senderName: message.sender.employeeName,
    senderDepartmentName: message.sender.department.departmentName,
    senderJobGradeName: message.sender.jobGrade.jobGradeName,
    isMine: message.senderId === me,
    content: message.content,
    attachmentName: message.attachmentName,
    createdAt: message.createdAt.toISOString(),
  };
}

/**
 * 채팅방·메시지 (REQ-MSG-001·002·004, BP-MSG-01). 방 멤버인지는 권한 코드가 아니라 chat_room_member로 확인한다.
 * 첨부·실시간·읽음 갱신·알림은 다음 단계에서 붙인다 (노션 "메신저" PR 순서 2번).
 */
@Injectable()
export class MessengerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: MessengerRepository,
  ) {}

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
          ? { employeeName: counterpart.employeeName, departmentName: counterpart.department.departmentName, jobGradeName: counterpart.jobGrade.jobGradeName }
          : null,
        lastMessage: last
          ? { senderName: lastSender?.employeeName ?? '-', isMine: last.senderId === me, preview: previewOf(last), createdAt: last.createdAt.toISOString() }
          : null,
        unreadCount: stat?.unreadCount ?? 0,
        salesOrder:
          showSalesOrder && salesOrder
            ? { id: salesOrder.id, salesOrderNo: salesOrder.salesOrderNo, customerName: salesOrder.customer.customerName, dueDate: earliestOpenDueDate(salesOrder.salesOrderItems) }
            : null,
        createdAt: room.createdAt.toISOString(),
      };
    });
    const recentAt = (item: ChatRoomListItem) => item.lastMessage?.createdAt ?? item.createdAt;
    return items.sort((a, b) => recentAt(b).localeCompare(recentAt(a)) || b.id - a.id);
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
    };
  }

  /**
   * 채팅방 만들기. 나는 자동으로 멤버가 된다.
   * 1:1은 같은 상대와의 방이 있으면 그 방을, 업무방은 같은 수주의 방이 있으면 그 방을 돌려준다(업무방은 새로 고른 멤버를 더한다).
   */
  createRoom(user: AuthUser, dto: CreateChatRoomDto): Promise<CreateChatRoomResult> {
    const me = user.employeeId;
    const memberIds = [...new Set(dto.memberIds)].filter((id) => id !== me);
    if (dto.chatRoomType === CHAT_ROOM_TYPE.DIRECT && memberIds.length !== 1) throw new AppException('COM-004', '1:1 채팅은 대화 상대 1명을 골라 주세요');
    if (dto.chatRoomType === CHAT_ROOM_TYPE.GROUP && memberIds.length < 1) throw new AppException('COM-004', '그룹 채팅은 멤버를 1명 이상 골라 주세요');
    if (dto.chatRoomType === CHAT_ROOM_TYPE.WORK) {
      if (dto.salesOrderId === undefined || dto.salesOrderId === null) throw new AppException('COM-004', '업무방은 연결할 수주를 골라 주세요');
      if (!canViewSalesOrder(user)) throw new AppException('COM-002', '수주를 볼 수 있는 사원만 업무방을 열 수 있어요');
    }

    return this.prisma.$transaction(async (tx) => {
      await this.requireActiveEmployees(tx, memberIds);

      if (dto.chatRoomType === CHAT_ROOM_TYPE.DIRECT) {
        const existing = await this.repository.findDirectRoomOf(tx, [me, memberIds[0]]);
        if (existing) return { id: existing.id, reused: true };
        return this.insertRoom(tx, { chatRoomType: CHAT_ROOM_TYPE.DIRECT, chatRoomName: null, salesOrderId: null }, [me, ...memberIds]);
      }

      if (dto.chatRoomType === CHAT_ROOM_TYPE.WORK) {
        const salesOrderId = dto.salesOrderId as number;
        const [salesOrder] = await this.repository.findSalesOrderNos(tx, [salesOrderId]);
        if (!salesOrder) throw new AppException('COM-003', '수주를 찾을 수 없어요');
        const existing = await this.repository.findWorkRoomOf(tx, salesOrderId);
        if (existing) {
          await this.addMembers(tx, existing.id, [me, ...memberIds]);
          return { id: existing.id, reused: true };
        }
        const chatRoomName = `${salesOrder.salesOrderNo} ${salesOrder.customer.customerName}`;
        return this.insertRoom(tx, { chatRoomType: CHAT_ROOM_TYPE.WORK, chatRoomName, salesOrderId }, [me, ...memberIds]);
      }

      const chatRoomName = dto.chatRoomName?.trim() || null;
      return this.insertRoom(tx, { chatRoomType: CHAT_ROOM_TYPE.GROUP, chatRoomName, salesOrderId: null }, [me, ...memberIds]);
    });
  }

  /** 최근 메시지부터 limit개 (응답은 오래된 순). before를 주면 그보다 오래된 메시지 */
  async listMessages(user: AuthUser, chatRoomId: number, query: ListMessagesQuery): Promise<ChatMessagePage> {
    await this.requireMember(this.prisma, chatRoomId, user.employeeId);
    const limit = query.limit ?? MESSAGE_PAGE_SIZE;
    const rows = await this.repository.findMessagesBefore(this.prisma, chatRoomId, query.before, limit + 1);
    return {
      items: rows
        .slice(0, limit)
        .reverse()
        .map((m) => toMessageView(m, user.employeeId)),
      hasMore: rows.length > limit,
    };
  }

  /** 메시지 보내기. 보낸 사람의 읽음 위치를 그 메시지로 옮긴다 (내 메시지는 안 읽은 수에 넣지 않는다) */
  sendMessage(user: AuthUser, chatRoomId: number, dto: SendMessageDto): Promise<ChatMessageView> {
    const content = dto.content.trim();
    if (!content) throw new AppException('COM-004', '보낼 메시지를 넣어 주세요');
    return this.prisma.$transaction(async (tx) => {
      await this.requireMember(tx, chatRoomId, user.employeeId);
      const message = await this.repository.createMessage(tx, { chatRoomId, senderId: user.employeeId, content });
      await this.repository.moveLastRead(tx, chatRoomId, user.employeeId, message.id);
      return toMessageView(message, user.employeeId);
    });
  }

  /** 방이 없으면 COM-003, 멤버가 아니면 COM-002 */
  private async requireMember(tx: Tx, chatRoomId: number, employeeId: number): Promise<void> {
    if (!(await this.repository.findRoom(tx, chatRoomId))) throw new AppException('COM-003', '채팅방을 찾을 수 없어요');
    if (!(await this.repository.findMembership(tx, chatRoomId, employeeId))) throw new AppException('COM-002', '채팅방 멤버만 볼 수 있어요');
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
  private async addMembers(tx: Tx, chatRoomId: number, employeeIds: readonly number[]): Promise<void> {
    const existing = new Set((await this.repository.findMemberIds(tx, chatRoomId)).map((m) => m.employeeId));
    const newIds = employeeIds.filter((id) => !existing.has(id));
    if (newIds.length === 0) return;
    const lastMessage = await this.repository.findLastMessageId(tx, chatRoomId);
    await this.repository.createMembers(tx, chatRoomId, newIds, lastMessage?.id ?? null);
  }
}
