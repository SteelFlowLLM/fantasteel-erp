import { Injectable } from '@nestjs/common';
import { CHAT_ROOM_TYPE, MESSAGE_TYPE } from '@fantasteel/shared';
import { getChatRoomListStats } from '../../generated/prisma/sql';
import type { Tx } from '../../prisma/prisma.service';

/** 채팅방별 안 읽은 수와 마지막 메시지. 메시지가 없는 방은 last* 가 null이다 */
export interface ChatRoomStatsRow {
  chatRoomId: number;
  unreadCount: number;
  lastMessage: { id: number; senderId: number | null; content: string | null; attachmentName: string | null; createdAt: Date; deletedAt: Date | null } | null;
}

const employeeInclude = { department: true, jobGrade: true } as const;
/** 메시지와 보낸 사람, 답글이면 원본 메시지(보낸 사람 이름) */
const messageInclude = {
  sender: { include: employeeInclude },
  parentMessage: { include: { sender: { select: { employeeName: true } } } },
} as const;

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
      include: {
        chatRoomMembers: { include: { employee: { include: employeeInclude } } },
        pinnedMessage: { include: { sender: { select: { employeeName: true } } } },
      },
    });
  }

  /** 공지 고정·해제 (null이면 해제) */
  updatePinnedMessage(tx: Tx, chatRoomId: number, messageId: number | null) {
    return tx.chatRoom.update({ where: { id: chatRoomId }, data: { pinnedMessageId: messageId } });
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
            : {
                id: lastMessageId,
                senderId: row.last_sender_id,
                content: row.last_content,
                attachmentName: row.last_attachment_name,
                createdAt: row.last_created_at,
                deletedAt: row.last_deleted_at,
              },
      };
    });
  }

  countUnread(tx: Tx, chatRoomId: number, employeeId: number, lastReadMessageId: number | null) {
    return tx.message.count({ where: { chatRoomId, id: { gt: lastReadMessageId ?? 0 }, senderId: { not: employeeId }, deletedAt: null } });
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
      include: messageInclude,
    });
  }

  /** 첨부가 있는 메시지만, before보다 오래된 것을 최신순으로 take개 (파일 모아보기) */
  findAttachmentMessagesBefore(tx: Tx, chatRoomId: number, before: number | undefined, take: number) {
    return tx.message.findMany({
      where: { chatRoomId, attachmentPath: { not: null }, deletedAt: null, id: before === undefined ? undefined : { lt: before } },
      orderBy: { id: 'desc' },
      take,
      include: messageInclude,
    });
  }

  /** 본문에 검색어가 든 메시지를 최신순으로 (대소문자 무시) */
  searchMessages(tx: Tx, chatRoomId: number, keyword: string, before: number | undefined, take: number) {
    return tx.message.findMany({
      where: { chatRoomId, content: { contains: keyword, mode: 'insensitive' }, deletedAt: null, id: before === undefined ? undefined : { lt: before } },
      orderBy: { id: 'desc' },
      take,
      include: messageInclude,
    });
  }

  /** 본문에 나온 업무 번호 중 실제로 있는 것 (ERP 링크) */
  async findErpDocuments(tx: Tx, numbers: { salesOrderNos: string[]; purchaseRequisitionNos: string[]; shipmentRequestNos: string[] }) {
    const [salesOrders, purchaseRequisitions, shipmentRequests] = await Promise.all([
      numbers.salesOrderNos.length ? tx.salesOrder.findMany({ where: { salesOrderNo: { in: numbers.salesOrderNos } }, select: { id: true, salesOrderNo: true } }) : [],
      numbers.purchaseRequisitionNos.length
        ? tx.purchaseRequisition.findMany({ where: { purchaseRequisitionNo: { in: numbers.purchaseRequisitionNos } }, select: { id: true, purchaseRequisitionNo: true } })
        : [],
      numbers.shipmentRequestNos.length ? tx.shipmentRequest.findMany({ where: { shipmentRequestNo: { in: numbers.shipmentRequestNos } }, select: { id: true, shipmentRequestNo: true } }) : [],
    ]);
    return {
      salesOrders: salesOrders.map((r) => ({ id: r.id, no: r.salesOrderNo })),
      purchaseRequisitions: purchaseRequisitions.map((r) => ({ id: r.id, no: r.purchaseRequisitionNo })),
      shipmentRequests: shipmentRequests.map((r) => ({ id: r.id, no: r.shipmentRequestNo })),
    };
  }

  findMemberReads(tx: Tx, chatRoomId: number) {
    return tx.chatRoomMember.findMany({ where: { chatRoomId }, select: { employeeId: true, lastReadMessageId: true } });
  }

  /** 시스템 메시지(보낸 사원 없음): 입장·초대·이름 변경 안내, 수주 업무 진행 알림 */
  createSystemMessage(tx: Tx, chatRoomId: number, content: string) {
    return tx.message.create({ data: { chatRoomId, messageType: MESSAGE_TYPE.SYSTEM, senderId: null, content }, include: messageInclude });
  }

  /** 재전송 중복 확인: 같은 사람이 같은 보내기 id로 이미 저장한 메시지 */
  findMessageByClientId(tx: Tx, senderId: number, clientMessageId: string) {
    return tx.message.findFirst({ where: { senderId, clientMessageId }, include: messageInclude });
  }

  findMessageWithSender(tx: Tx, id: number) {
    return tx.message.findUnique({ where: { id }, include: messageInclude });
  }

  /** 본문 고치기: 고친 시각을 남긴다 */
  updateMessageContent(tx: Tx, id: number, content: string | null) {
    return tx.message.update({ where: { id }, data: { content, editedAt: new Date() }, include: messageInclude });
  }

  /** 삭제는 표시만 한다 (행·첨부 파일은 남김, #151) */
  markMessageDeleted(tx: Tx, id: number) {
    return tx.message.update({ where: { id }, data: { deletedAt: new Date() }, include: messageInclude });
  }

  createMessage(tx: Tx, data: { chatRoomId: number; senderId: number; content: string | null; attachmentPath?: string | null; attachmentName?: string | null; clientMessageId?: string | null; parentMessageId?: number | null }) {
    return tx.message.create({ data, include: messageInclude });
  }

  findMessage(tx: Tx, id: number) {
    return tx.message.findUnique({ where: { id }, select: { id: true, chatRoomId: true, attachmentPath: true, attachmentName: true, senderId: true, messageType: true, deletedAt: true } });
  }

  /** 읽음 위치는 앞으로만 옮긴다 */
  moveLastRead(tx: Tx, chatRoomId: number, employeeId: number, messageId: number) {
    return tx.chatRoomMember.updateMany({
      where: { chatRoomId, employeeId, OR: [{ lastReadMessageId: null }, { lastReadMessageId: { lt: messageId } }] },
      data: { lastReadMessageId: messageId },
    });
  }
}
