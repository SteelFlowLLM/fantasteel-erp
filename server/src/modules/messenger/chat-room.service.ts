import { Injectable } from '@nestjs/common';
import { CHAT_ROOM_TYPE, MESSAGE_TYPE, PERMISSION, type AuthUser, type Permission } from '@fantasteel/shared';
import { lockRow } from '../../common/concurrency/locks';
import { badInput, forbidden, invalidState, notFound } from '../../common/errors/app.exception';
import { NumberingService } from '../../common/numbering/numbering.service';
import { RealtimeService } from '../../common/realtime/realtime.service';
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import type { AddChatRoomMembersDto } from './dto/add-chat-room-members.dto';
import type { CreateChatRoomDto } from './dto/create-chat-room.dto';
import type { MarkReadDto } from './dto/mark-read.dto';
import { MessagePublisher, SOCKET_EVENT_CHAT_READ } from './message.publisher';
import { MessengerRepository, type ChatRoomRow } from './messenger.repository';
import { chatRoomLinkPath, toChatRoomView, type ChatRoomView } from './messenger.views';

/** 수주를 볼 수 있는 권한 (어느 하나라도 VIEW 이상). 업무방은 수주 요약을 보여 주므로 같은 기준을 쓴다. */
export const SALES_ORDER_VIEW_PERMISSIONS: Permission[] = [
  PERMISSION.ORDER_CREATE, PERMISSION.PLAN_CONFIRM, PERMISSION.SHIPMENT_REQUEST,
  PERMISSION.GOODS_ISSUE_CONFIRM, PERMISSION.PURCHASE_REQUISITION_CREATE, PERMISSION.INSPECTION_REGISTER,
];

export interface ReadStateView {
  chatRoomId: number;
  lastReadMessageId: number | null;
  /** 이 방에 남은 안 읽은 수 */
  unreadCount: number;
  /** 내 모든 방의 안 읽은 수 합 */
  totalUnreadCount: number;
}

@Injectable()
export class ChatRoomService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: MessengerRepository,
    private readonly publisher: MessagePublisher,
    private readonly realtime: RealtimeService,
    private readonly numbering: NumberingService,
  ) {}

  /** 방이 있고 내가 멤버인지 확인한다. 메신저의 모든 조회·변경이 이 검사를 지난다. */
  async requireMember(tx: Tx, chatRoomId: number, employeeId: number): Promise<{ room: ChatRoomRow; lastReadMessageId: number | null }> {
    const room = await this.repo.findRoom(tx, chatRoomId);
    if (!room) throw notFound('채팅방');
    const me = room.members.find((m) => m.employeeId === employeeId);
    if (!me) throw forbidden('채팅방 멤버만 이용할 수 있습니다');
    return { room, lastReadMessageId: me.lastReadMessageId };
  }

  /** 채팅방 만들기 (REQ-MSG-001). 1:1과 업무방은 이미 있으면 그 방을 돌려준다. */
  async create(dto: CreateChatRoomDto, user: AuthUser): Promise<ChatRoomView> {
    const chatRoomId = await this.prisma.tx(async (tx) => {
      const invitees = await this.resolveInvitees(tx, dto.memberIds ?? [], user.employeeId);
      if (dto.chatRoomType === CHAT_ROOM_TYPE.DIRECT) {
        if (invitees.length !== 1) throw badInput('1:1 대화는 상대 한 명을 선택해 주세요');
        return this.ensureDirectRoom(tx, user.employeeId, invitees[0].id);
      }
      if (dto.chatRoomType === CHAT_ROOM_TYPE.WORK) {
        if (!dto.salesOrderId) throw badInput('업무방은 연결할 수주를 선택해 주세요');
        if (!this.canViewSalesOrders(user)) throw forbidden('수주를 볼 수 있는 사원만 업무방을 열 수 있습니다');
        return this.ensureWorkRoom(tx, dto.salesOrderId, user, invitees);
      }
      if (invitees.length < 1) throw badInput('그룹 대화에 초대할 사원을 선택해 주세요');
      const room = await this.repo.createRoom(tx, {
        chatRoomType: CHAT_ROOM_TYPE.GROUP, chatRoomName: dto.chatRoomName?.trim() || null, salesOrderId: null, createdEmployeeId: user.employeeId,
      });
      const memberIds = [user.employeeId, ...invitees.map((e) => e.id)];
      await this.repo.addMembers(tx, room.id, memberIds, null);
      this.roomsChanged(memberIds);
      return room.id;
    });
    return this.detail(chatRoomId, user);
  }

  /** "업무방" 버튼: 수주의 업무방을 찾거나 만들고 나를 멤버로 넣는다. 권한은 컨트롤러에서 확인한다. */
  async openWorkRoom(salesOrderId: number, user: AuthUser): Promise<ChatRoomView> {
    const chatRoomId = await this.prisma.tx((tx) => this.ensureWorkRoom(tx, salesOrderId, user, []));
    return this.detail(chatRoomId, user);
  }

  /** 내 채팅방 목록: 최근 대화 순. 마지막 메시지·안 읽은 수·멤버·(업무방) 수주 요약. */
  async list(user: AuthUser): Promise<ChatRoomView[]> {
    const rooms = await this.repo.findRoomsOfEmployee(this.prisma, user.employeeId);
    const views = await Promise.all(rooms.map((room) => this.toView(this.prisma, room, user.employeeId)));
    const activityAt = (v: ChatRoomView) => (v.lastMessage?.createdAt ?? v.createdAt).getTime();
    return views.sort((a, b) => activityAt(b) - activityAt(a));
  }

  async detail(chatRoomId: number, user: AuthUser): Promise<ChatRoomView> {
    const { room } = await this.requireMember(this.prisma, chatRoomId, user.employeeId);
    return this.toView(this.prisma, room, user.employeeId);
  }

  /** 멤버 초대. 방 멤버면 누구나 할 수 있다. 1:1 방은 두 사람으로 고정이다. */
  async addMembers(chatRoomId: number, dto: AddChatRoomMembersDto, user: AuthUser): Promise<ChatRoomView> {
    await this.prisma.tx(async (tx) => {
      const { room } = await this.requireMember(tx, chatRoomId, user.employeeId);
      if (room.chatRoomType === CHAT_ROOM_TYPE.DIRECT) throw invalidState('1:1 대화에는 멤버를 추가할 수 없습니다. 그룹 대화를 새로 만들어 주세요');
      const invitees = await this.resolveInvitees(tx, dto.memberIds, user.employeeId);
      const joined = await this.join(tx, chatRoomId, invitees.map((e) => e.id));
      if (!joined.length) return;
      const names = invitees.filter((e) => joined.includes(e.id)).map((e) => `${e.employeeName}님`).join(', ');
      await this.publisher.publish(tx, { chatRoomId, senderId: null, messageType: MESSAGE_TYPE.SYSTEM, content: `${user.employeeName}님이 ${names}을 초대했습니다` });
      this.roomsChanged([...room.members.map((m) => m.employeeId), ...joined]);
    });
    return this.detail(chatRoomId, user);
  }

  /** 방 나가기. 그룹만 된다 — 1:1은 두 사람이 곧 방이고, 업무방은 수주에 묶인 기록이라 남긴다. */
  async leave(chatRoomId: number, user: AuthUser): Promise<{ chatRoomId: number; left: true }> {
    await this.prisma.tx(async (tx) => {
      const { room } = await this.requireMember(tx, chatRoomId, user.employeeId);
      if (room.chatRoomType !== CHAT_ROOM_TYPE.GROUP) throw invalidState('그룹 대화에서만 나갈 수 있습니다');
      await this.repo.removeMember(tx, chatRoomId, user.employeeId);
      await this.publisher.publish(tx, { chatRoomId, senderId: null, messageType: MESSAGE_TYPE.SYSTEM, content: `${user.employeeName}님이 나갔습니다` });
      this.roomsChanged(room.members.map((m) => m.employeeId));
    });
    return { chatRoomId, left: true };
  }

  /** 읽음 위치 갱신 (REQ-MSG-004). 뒤로는 가지 않는다. */
  async markRead(chatRoomId: number, dto: MarkReadDto | undefined, user: AuthUser): Promise<ReadStateView> {
    return this.prisma.tx(async (tx) => {
      await this.requireMember(tx, chatRoomId, user.employeeId);
      const latestId = await this.repo.findLatestMessageId(tx, chatRoomId);
      // 방에 없는 앞선 id를 보내도 최신 메시지까지만 간다 (아직 오지 않은 메시지를 읽은 것으로 만들지 않는다)
      const target = latestId === null ? null : Math.min(dto?.lastReadMessageId ?? latestId, latestId);
      if (target !== null) await this.repo.advanceReadCursor(tx, chatRoomId, user.employeeId, target);

      const lastReadMessageId = (await this.repo.findMember(tx, chatRoomId, user.employeeId))?.lastReadMessageId ?? null;
      const unreadCount = await this.repo.countUnread(tx, chatRoomId, user.employeeId, lastReadMessageId);
      if (unreadCount === 0) {
        // 방을 다 읽었으면 이 방의 멘션·업무방 알림도 읽음으로 — 그래야 다음 업무방 메시지에 다시 알림이 간다
        const cleared = await this.repo.markRoomNotificationsRead(tx, user.employeeId, chatRoomLinkPath(chatRoomId));
        if (cleared > 0) this.realtime.toEmployees([user.employeeId], 'changed', { topics: ['notifications'] });
      }
      const state: ReadStateView = { chatRoomId, lastReadMessageId, unreadCount, totalUnreadCount: await this.totalUnread(tx, user.employeeId) };
      // 같은 사원의 다른 창·기기가 배지를 맞추도록 본인 채널로만 보낸다
      this.realtime.toEmployees([user.employeeId], SOCKET_EVENT_CHAT_READ, state);
      return state;
    });
  }

  async unreadCount(user: AuthUser): Promise<{ totalUnreadCount: number }> {
    return { totalUnreadCount: await this.totalUnread(this.prisma, user.employeeId) };
  }

  canViewSalesOrders(user: AuthUser): boolean {
    return SALES_ORDER_VIEW_PERMISSIONS.some((code) => !!user.permissions[code]);
  }

  // ───────── 내부 ─────────

  private async totalUnread(tx: Tx, employeeId: number): Promise<number> {
    const memberships = await this.repo.findMemberships(tx, employeeId);
    let total = 0;
    for (const m of memberships) total += await this.repo.countUnread(tx, m.chatRoomId, employeeId, m.lastReadMessageId);
    return total;
  }

  private async toView(tx: Tx, room: ChatRoomRow, employeeId: number): Promise<ChatRoomView> {
    const lastRead = room.members.find((m) => m.employeeId === employeeId)?.lastReadMessageId ?? null;
    const [lastMessage, unreadCount] = await Promise.all([
      this.repo.findLatestMessage(tx, room.id),
      this.repo.countUnread(tx, room.id, employeeId, lastRead),
    ]);
    return toChatRoomView(room, employeeId, lastMessage, unreadCount);
  }

  /** 초대 대상은 조직의 재직(ACTIVE) 사원이어야 한다 (REQ-ORG-004). 나 자신은 뺀다. */
  private async resolveInvitees(tx: Tx, memberIds: number[], myEmployeeId: number) {
    const ids = [...new Set(memberIds)].filter((id) => id !== myEmployeeId);
    if (!ids.length) return [];
    const employees = await this.repo.findActiveEmployees(tx, ids);
    if (employees.length !== ids.length) throw badInput('재직 중인 사원만 초대할 수 있습니다');
    return employees;
  }

  private async ensureDirectRoom(tx: Tx, myEmployeeId: number, otherEmployeeId: number): Promise<number> {
    const [low, high] = [myEmployeeId, otherEmployeeId].sort((a, b) => a - b);
    // 두 사람이 동시에 서로에게 말을 걸어도 방이 하나만 생기도록, 채번 카운터 행을 이 쌍의 잠금으로 쓴다
    // (chat_room에는 쌍을 막을 unique가 없고 $queryRaw는 쓸 수 없다)
    await this.numbering.next(tx, `CHAT-DIRECT-${low}-${high}`);
    const existing = await this.repo.findDirectRoom(tx, low, high);
    if (existing) return existing.id;
    const room = await this.repo.createRoom(tx, { chatRoomType: CHAT_ROOM_TYPE.DIRECT, chatRoomName: null, salesOrderId: null, createdEmployeeId: myEmployeeId });
    await this.repo.addMembers(tx, room.id, [low, high], null);
    this.roomsChanged([low, high]);
    return room.id;
  }

  /** 수주 1건에 업무방 1개. 수주 행을 잠근 뒤 찾고, 없을 때만 만든다 (수주 모듈이 먼저 만들어 둔 방도 그대로 쓴다). */
  private async ensureWorkRoom(tx: Tx, salesOrderId: number, user: AuthUser, invitees: { id: number; employeeName: string }[]): Promise<number> {
    const salesOrder = await this.repo.findSalesOrder(tx, salesOrderId);
    if (!salesOrder) throw notFound('수주');
    await lockRow(tx, 'sales_order', salesOrderId);
    const existing = await this.repo.findWorkRoom(tx, salesOrderId);
    const room = existing ?? (await this.repo.createRoom(tx, {
      chatRoomType: CHAT_ROOM_TYPE.WORK, chatRoomName: `#${salesOrder.salesOrderNo}`, salesOrderId, createdEmployeeId: user.employeeId,
    }));
    const joined = await this.join(tx, room.id, [user.employeeId, ...invitees.map((e) => e.id)]);
    if (joined.length) {
      if (existing) {
        const iJoined = joined.includes(user.employeeId);
        const invitedNames = invitees.filter((e) => joined.includes(e.id)).map((e) => `${e.employeeName}님`).join(', ');
        const content = invitedNames
          ? `${user.employeeName}님이 ${invitedNames}을 초대했습니다`
          : `${user.employeeName}님이 들어왔습니다`;
        const message = await this.publisher.publish(tx, { chatRoomId: room.id, senderId: null, messageType: MESSAGE_TYPE.SYSTEM, content });
        // 내가 들어왔다는 안내가 나에게 안 읽은 메시지로 남지 않게 한다
        if (iJoined) await this.repo.advanceReadCursor(tx, room.id, user.employeeId, message.id);
      }
      this.roomsChanged(await this.repo.findMemberIds(tx, room.id));
    }
    return room.id;
  }

  /** 새 멤버만 넣고 넣은 사원 id를 돌려준다. 들어오기 전 대화는 볼 수 있지만 안 읽은 수로 세지 않는다. */
  private async join(tx: Tx, chatRoomId: number, employeeIds: number[]): Promise<number[]> {
    const current = new Set(await this.repo.findMemberIds(tx, chatRoomId));
    const fresh = [...new Set(employeeIds)].filter((id) => !current.has(id));
    if (!fresh.length) return [];
    await this.repo.addMembers(tx, chatRoomId, fresh, await this.repo.findLatestMessageId(tx, chatRoomId));
    return fresh;
  }

  /** 방 목록이 달라진 사람에게만 갱신 신호를 보낸다 (전체 방송 대신 — 다른 사람의 방 활동이 새지 않게). */
  private roomsChanged(employeeIds: number[]): void {
    this.realtime.toEmployees(employeeIds, 'changed', { topics: ['chat-rooms'] });
  }
}
