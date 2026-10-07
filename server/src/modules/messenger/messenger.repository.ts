import { Injectable } from '@nestjs/common';
import { CHAT_ROOM_TYPE } from '@fantasteel/shared';
import { getChatRoomListStats } from '../../generated/prisma/sql';
import type { Tx } from '../../prisma/prisma.service';

/** 채팅방별 안 읽은 수와 마지막 메시지. 메시지가 없는 방은 last* 가 null이다 */
export interface ChatRoomStatsRow {
  chatRoomId: number;
  unreadCount: number;
  lastMessage: { id: number; senderId: number; content: string | null; attachmentName: string | null; createdAt: Date } | null;
}

const employeeInclude = { department: true, jobGrade: true } as const;

/**
 * DB 접근은 여기서만 한다. 함수의 첫 인자는 tx (컨벤션 8장).
 */
@Injectable()
export class MessengerRepository {
  findRoomIdsOfMember(tx: Tx, employeeId: number) {
    return tx.chatRoomMember.findMany({ where: { employeeId }, select: { chatRoomId: true } });
  }

  findRoomsWithMembers(tx: Tx, chatRoomIds: readonly number[]) {
    return tx.chatRoom.findMany({
      where: { id: { in: [...chatRoomIds] } },
      include: { chatRoomMembers: { include: { employee: { include: employeeInclude } } } },
    });
  }

  findRoomWithMembers(tx: Tx, id: number) {
    return tx.chatRoom.findUnique({
      where: { id },
      include: { chatRoomMembers: { include: { employee: { include: employeeInclude } } } },
    });
  }

  findRoom(tx: Tx, id: number) {
    return tx.chatRoom.findUnique({ where: { id } });
  }

  findMembership(tx: Tx, chatRoomId: number, employeeId: number) {
    return tx.chatRoomMember.findUnique({ where: { chatRoomId_employeeId: { chatRoomId, employeeId } } });
  }

  /** TypedSQL은 LEFT JOIN LATERAL 컬럼을 not null로 추론해서, 메시지 없는 방의 null을 여기서 바로잡는다 */
  async findRoomStats(tx: Tx, employeeId: number): Promise<ChatRoomStatsRow[]> {
    const rows = await tx.$queryRawTyped(getChatRoomListStats(employeeId));
    return rows.map((row) => {
      const lastMessageId: number | null = row.last_message_id;
      return {
        chatRoomId: row.chat_room_id,
        unreadCount: row.unread_count ?? 0,
        lastMessage:
          lastMessageId === null
            ? null
            : { id: lastMessageId, senderId: row.last_sender_id, content: row.last_content, attachmentName: row.last_attachment_name, createdAt: row.last_created_at },
      };
    });
  }

  countUnread(tx: Tx, chatRoomId: number, employeeId: number, lastReadMessageId: number | null) {
    return tx.message.count({ where: { chatRoomId, id: { gt: lastReadMessageId ?? 0 }, senderId: { not: employeeId } } });
  }

  /** 두 사람만 멤버인 1:1 방 (같은 상대와의 방을 다시 만들지 않으려고) */
  findDirectRoomOf(tx: Tx, employeeIds: readonly [number, number]) {
    return tx.chatRoom.findFirst({
      where: {
        chatRoomType: CHAT_ROOM_TYPE.DIRECT,
        AND: employeeIds.map((employeeId) => ({ chatRoomMembers: { some: { employeeId } } })),
        chatRoomMembers: { every: { employeeId: { in: [...employeeIds] } } },
      },
      orderBy: { id: 'asc' },
    });
  }

  findWorkRoomOf(tx: Tx, salesOrderId: number) {
    return tx.chatRoom.findFirst({ where: { chatRoomType: CHAT_ROOM_TYPE.WORK, salesOrderId }, orderBy: { id: 'asc' } });
  }

  findMemberIds(tx: Tx, chatRoomId: number) {
    return tx.chatRoomMember.findMany({ where: { chatRoomId }, select: { employeeId: true } });
  }

  createRoom(tx: Tx, data: { chatRoomType: string; chatRoomName: string | null; salesOrderId: number | null }) {
    return tx.chatRoom.create({ data });
  }

  createMembers(tx: Tx, chatRoomId: number, employeeIds: readonly number[], lastReadMessageId: number | null) {
    return tx.chatRoomMember.createMany({ data: employeeIds.map((employeeId) => ({ chatRoomId, employeeId, lastReadMessageId })), skipDuplicates: true });
  }

  updateRoomName(tx: Tx, id: number, chatRoomName: string | null) {
    return tx.chatRoom.update({ where: { id }, data: { chatRoomName } });
  }

  findLastMessageId(tx: Tx, chatRoomId: number) {
    return tx.message.findFirst({ where: { chatRoomId }, orderBy: { id: 'desc' }, select: { id: true } });
  }

  findEmployees(tx: Tx, ids: readonly number[]) {
    return tx.employee.findMany({ where: { id: { in: [...ids] } }, select: { id: true, employeeName: true, isActive: true } });
  }

  findHeadEmployeeIds(tx: Tx, employeeIds: readonly number[]) {
    return tx.department.findMany({ where: { headEmployeeId: { in: [...employeeIds] } }, select: { headEmployeeId: true } });
  }

  /** 업무방 상단 요약용 수주 (고객사·담당자·품목) */
  findSalesOrderSummary(tx: Tx, id: number) {
    return tx.salesOrder.findUnique({
      where: { id },
      include: {
        customer: { select: { customerName: true } },
        ownerEmployee: { select: { employeeName: true } },
        salesOrderItems: { include: { item: { include: { steelGrade: { select: { steelGradeCode: true } } } } }, orderBy: { id: 'asc' } },
      },
    });
  }

  findSalesOrderBriefs(tx: Tx, ids: readonly number[]) {
    return tx.salesOrder.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, salesOrderNo: true, customer: { select: { customerName: true } }, salesOrderItems: { select: { dueDate: true, salesOrderItemStatus: true } } },
    });
  }

  findSalesOrderNos(tx: Tx, ids: readonly number[]) {
    return tx.salesOrder.findMany({ where: { id: { in: [...ids] } }, select: { id: true, salesOrderNo: true, customer: { select: { customerName: true } } } });
  }

  /** before보다 오래된 메시지를 최신순으로 take개 */
  findMessagesBefore(tx: Tx, chatRoomId: number, before: number | undefined, take: number) {
    return tx.message.findMany({
      where: { chatRoomId, id: before === undefined ? undefined : { lt: before } },
      orderBy: { id: 'desc' },
      take,
      include: { sender: { include: employeeInclude } },
    });
  }

  createMessage(tx: Tx, data: { chatRoomId: number; senderId: number; content: string | null; attachmentPath?: string | null; attachmentName?: string | null }) {
    return tx.message.create({ data, include: { sender: { include: employeeInclude } } });
  }

  findMessage(tx: Tx, id: number) {
    return tx.message.findUnique({ where: { id }, select: { id: true, chatRoomId: true, attachmentPath: true, attachmentName: true } });
  }

  /** 읽음 위치는 앞으로만 옮긴다 */
  moveLastRead(tx: Tx, chatRoomId: number, employeeId: number, messageId: number) {
    return tx.chatRoomMember.updateMany({
      where: { chatRoomId, employeeId, OR: [{ lastReadMessageId: null }, { lastReadMessageId: { lt: messageId } }] },
      data: { lastReadMessageId: messageId },
    });
  }
}
