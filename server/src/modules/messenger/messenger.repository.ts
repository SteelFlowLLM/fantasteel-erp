import { Injectable } from '@nestjs/common';
import { CHAT_ROOM_TYPE, NOTIFICATION_TYPE, type ChatRoomType, type MessageType } from '@fantasteel/shared';
import { Prisma } from '../../generated/prisma/client';
import type { Tx } from '../../prisma/prisma.service';

const MEMBER_INCLUDE = {
  employee: { select: { id: true, employeeNo: true, employeeName: true, jobGrade: true, employeeStatus: true, departmentId: true, department: { select: { departmentName: true } } } },
} satisfies Prisma.ChatRoomMemberInclude;

const ROOM_INCLUDE = {
  members: { include: MEMBER_INCLUDE, orderBy: { id: 'asc' } },
  salesOrder: {
    include: {
      customer: { select: { customerName: true } },
      items: { include: { productSpec: { include: { steelGrade: { select: { steelGradeCode: true } }, item: { select: { itemType: true, itemName: true } } } } }, orderBy: { lineNo: 'asc' } },
    },
  },
} satisfies Prisma.ChatRoomInclude;

const MESSAGE_INCLUDE = { sender: { select: { employeeName: true } } } satisfies Prisma.MessageInclude;

export type ChatRoomRow = Prisma.ChatRoomGetPayload<{ include: typeof ROOM_INCLUDE }>;
export type ChatRoomMemberRow = ChatRoomRow['members'][number];
export type MessageRow = Prisma.MessageGetPayload<{ include: typeof MESSAGE_INCLUDE }>;

export interface NewMessage {
  chatRoomId: number;
  senderId: number | null;
  messageType: MessageType;
  content: string;
  mentionEmployeeIds?: number[];
  fileName?: string;
  filePath?: string;
  fileSize?: number;
  mimeType?: string;
}

/** 메신저 테이블 접근. 트랜잭션 밖 조회에는 PrismaService를 그대로 넘긴다. */
@Injectable()
export class MessengerRepository {
  findRoom(tx: Tx, chatRoomId: number): Promise<ChatRoomRow | null> {
    return tx.chatRoom.findUnique({ where: { id: chatRoomId }, include: ROOM_INCLUDE });
  }

  findRoomsOfEmployee(tx: Tx, employeeId: number): Promise<ChatRoomRow[]> {
    return tx.chatRoom.findMany({ where: { members: { some: { employeeId } } }, include: ROOM_INCLUDE });
  }

  findMember(tx: Tx, chatRoomId: number, employeeId: number) {
    return tx.chatRoomMember.findUnique({ where: { chatRoomId_employeeId: { chatRoomId, employeeId } } });
  }

  findMemberships(tx: Tx, employeeId: number) {
    return tx.chatRoomMember.findMany({ where: { employeeId }, select: { chatRoomId: true, lastReadMessageId: true } });
  }

  async findMemberIds(tx: Tx, chatRoomId: number): Promise<number[]> {
    const rows = await tx.chatRoomMember.findMany({ where: { chatRoomId }, select: { employeeId: true } });
    return rows.map((r) => r.employeeId);
  }

  /** 두 사람만 들어 있는 1:1 방. */
  findDirectRoom(tx: Tx, employeeIdA: number, employeeIdB: number) {
    return tx.chatRoom.findFirst({
      where: {
        chatRoomType: CHAT_ROOM_TYPE.DIRECT,
        AND: [{ members: { some: { employeeId: employeeIdA } } }, { members: { some: { employeeId: employeeIdB } } }],
      },
      orderBy: { id: 'asc' },
      select: { id: true },
    });
  }

  /** 수주의 업무방. 스키마에 unique가 없으므로 여러 개라면 가장 먼저 만든 것을 쓴다. */
  findWorkRoom(tx: Tx, salesOrderId: number) {
    return tx.chatRoom.findFirst({ where: { chatRoomType: CHAT_ROOM_TYPE.WORK, salesOrderId }, orderBy: { id: 'asc' }, select: { id: true } });
  }

  createRoom(tx: Tx, data: { chatRoomType: ChatRoomType; chatRoomName: string | null; salesOrderId: number | null; createdEmployeeId: number }) {
    return tx.chatRoom.create({ data, select: { id: true } });
  }

  /** 이미 멤버인 사람은 건너뛴다. */
  async addMembers(tx: Tx, chatRoomId: number, employeeIds: number[], lastReadMessageId: number | null): Promise<void> {
    if (!employeeIds.length) return;
    await tx.chatRoomMember.createMany({ data: employeeIds.map((employeeId) => ({ chatRoomId, employeeId, lastReadMessageId })), skipDuplicates: true });
  }

  async removeMember(tx: Tx, chatRoomId: number, employeeId: number): Promise<void> {
    await tx.chatRoomMember.deleteMany({ where: { chatRoomId, employeeId } });
  }

  findActiveEmployees(tx: Tx, employeeIds: number[]) {
    return tx.employee.findMany({ where: { id: { in: employeeIds }, employeeStatus: 'ACTIVE' }, select: { id: true, employeeName: true } });
  }

  findSalesOrder(tx: Tx, salesOrderId: number) {
    return tx.salesOrder.findUnique({ where: { id: salesOrderId }, select: { id: true, salesOrderNo: true } });
  }

  // ───────── 메시지 ─────────

  createMessage(tx: Tx, data: NewMessage): Promise<MessageRow> {
    return tx.message.create({ data: { ...data, mentionEmployeeIds: data.mentionEmployeeIds ?? [] }, include: MESSAGE_INCLUDE });
  }

  findMessage(tx: Tx, messageId: number): Promise<MessageRow | null> {
    return tx.message.findUnique({ where: { id: messageId }, include: MESSAGE_INCLUDE });
  }

  /** 최신 쪽부터 take개 (id 내림차순). */
  listMessages(tx: Tx, chatRoomId: number, beforeId: number | undefined, take: number): Promise<MessageRow[]> {
    return tx.message.findMany({ where: { chatRoomId, ...(beforeId ? { id: { lt: beforeId } } : {}) }, orderBy: { id: 'desc' }, take, include: MESSAGE_INCLUDE });
  }

  findLatestMessage(tx: Tx, chatRoomId: number): Promise<MessageRow | null> {
    return tx.message.findFirst({ where: { chatRoomId }, orderBy: { id: 'desc' }, include: MESSAGE_INCLUDE });
  }

  async findLatestMessageId(tx: Tx, chatRoomId: number): Promise<number | null> {
    const row = await tx.message.findFirst({ where: { chatRoomId }, orderBy: { id: 'desc' }, select: { id: true } });
    return row?.id ?? null;
  }

  // ───────── 읽음 ─────────

  /** 안 읽은 수 = 읽음 위치 뒤의 메시지 중 내가 보내지 않은 것 (시스템 메시지 포함). */
  countUnread(tx: Tx, chatRoomId: number, employeeId: number, lastReadMessageId: number | null): Promise<number> {
    return tx.message.count({
      where: { chatRoomId, id: { gt: lastReadMessageId ?? 0 }, OR: [{ senderId: null }, { senderId: { not: employeeId } }] },
    });
  }

  /** 읽음 위치는 앞으로만 간다. 조건을 UPDATE에 넣어 동시에 두 창에서 불러도 뒤로 가지 않는다. */
  async advanceReadCursor(tx: Tx, chatRoomId: number, employeeId: number, messageId: number): Promise<void> {
    await tx.chatRoomMember.updateMany({
      where: { chatRoomId, employeeId, OR: [{ lastReadMessageId: null }, { lastReadMessageId: { lt: messageId } }] },
      data: { lastReadMessageId: messageId },
    });
  }

  // ───────── 알림 (발송은 NotificationSender, 여기는 메신저 규칙에 필요한 조회·읽음 처리만) ─────────

  /** 이 방의 업무방 알림을 아직 읽지 않은 사람. */
  async findRecipientsWithUnreadWorkRoomNotification(tx: Tx, employeeIds: number[], linkPath: string): Promise<number[]> {
    if (!employeeIds.length) return [];
    const rows = await tx.notification.findMany({
      where: { recipientId: { in: employeeIds }, notificationType: NOTIFICATION_TYPE.WORK_ROOM_MESSAGE, linkPath, isRead: false },
      select: { recipientId: true },
      distinct: ['recipientId'],
    });
    return rows.map((r) => r.recipientId);
  }

  /** 방을 끝까지 읽으면 그 방의 멘션·업무방 알림도 읽은 것으로 한다. */
  async markRoomNotificationsRead(tx: Tx, employeeId: number, linkPath: string): Promise<number> {
    const { count } = await tx.notification.updateMany({
      where: { recipientId: employeeId, isRead: false, linkPath, notificationType: { in: [NOTIFICATION_TYPE.MENTION, NOTIFICATION_TYPE.WORK_ROOM_MESSAGE] } },
      data: { isRead: true, readAt: new Date() },
    });
    return count;
  }

  // ───────── ERP 참조 ─────────

  findSalesOrdersByNo(tx: Tx, salesOrderNos: string[]) {
    return tx.salesOrder.findMany({ where: { salesOrderNo: { in: salesOrderNos } }, select: { id: true, salesOrderNo: true } });
  }

  findPurchaseRequisitionsByNo(tx: Tx, purchaseRequisitionNos: string[]) {
    return tx.purchaseRequisition.findMany({ where: { purchaseRequisitionNo: { in: purchaseRequisitionNos } }, select: { id: true, purchaseRequisitionNo: true } });
  }

  findLotsByNo(tx: Tx, lotNos: string[]) {
    return tx.lot.findMany({ where: { lotNo: { in: lotNos } }, select: { lotNo: true } });
  }
}
