// 업무방 (REQ-MSG-001, BP-MSG-01): 수주 1건당 WORK 채팅방 1개 (ERD chat_room.sales_order_id unique).
// 멤버는 조직도에서 고른다. 방을 열면 '시스템' 메시지로 알린다 (sender_id = SYSTEM_SENDER_ID, 가정값).
// DIRECT·GROUP 방과 채팅 화면은 메신저 영역이 만든다.
import type { ChatRoomRow, MessageRow, MockTables } from '@/mock/schema';
import { insertRow, updateRow, type MockTx } from '@/mock/store';
import { ApiError, findById, mustGet, SYSTEM_SENDER_ID, type PersonActor } from '@/mock/services/context';

type Tables = Readonly<MockTables>;

/** 시스템 메시지를 방에 남긴다 (보낸 사람 '시스템') */
export function postSystemMessage(tx: MockTx, chatRoomId: number, content: string): MessageRow {
  mustGet(tx.tables, 'chatRoom', chatRoomId, '채팅방');
  const message = insertRow(tx, 'message', { chatRoomId, senderId: SYSTEM_SENDER_ID, content, fileName: null, filePath: null, fileSize: null, mimeType: null });
  updateRow(tx, 'chatRoom', chatRoomId, {});
  return message;
}

export const workRoomOfSalesOrder = (tables: Tables, salesOrderId: number): ChatRoomRow | undefined =>
  tables.chatRoom.find((r) => r.chatRoomType === 'WORK' && r.salesOrderId === salesOrderId);

/**
 * 수주의 업무방을 연다. 이미 있으면 그 방을 돌려준다(새로 고른 멤버는 더한다).
 * 멤버 = 연 사람 + 고른 사원(사용 중). 없는 사원은 COM-003.
 */
export function openWorkRoom(tx: MockTx, actor: PersonActor, input: { salesOrderId: number; memberEmployeeIds: readonly number[] }): { chatRoom: ChatRoomRow; created: boolean } {
  const so = mustGet(tx.tables, 'salesOrder', input.salesOrderId, '수주');
  const memberIds = [...new Set([actor.employeeId, ...input.memberEmployeeIds])];
  for (const id of memberIds) {
    const employee = findById(tx.tables, 'employee', id);
    if (!employee) throw new ApiError('COM-003', `사원 ${id}`);
  }
  const activeIds = memberIds.filter((id) => findById(tx.tables, 'employee', id)?.isActive);
  const existing = workRoomOfSalesOrder(tx.tables, so.id);
  if (existing) {
    for (const employeeId of activeIds) {
      if (!tx.tables.chatRoomMember.some((m) => m.chatRoomId === existing.id && m.employeeId === employeeId)) {
        insertRow(tx, 'chatRoomMember', { chatRoomId: existing.id, employeeId, lastReadMessageId: null });
      }
    }
    return { chatRoom: existing, created: false };
  }
  const customer = findById(tx.tables, 'customer', so.customerId);
  const chatRoom = insertRow(tx, 'chatRoom', {
    chatRoomType: 'WORK',
    chatRoomName: `${so.salesOrderNo} ${customer?.customerName ?? ''}`.trim(),
    salesOrderId: so.id,
    createdEmployeeId: actor.employeeId,
  });
  for (const employeeId of activeIds) insertRow(tx, 'chatRoomMember', { chatRoomId: chatRoom.id, employeeId, lastReadMessageId: null });
  const opener = findById(tx.tables, 'employee', actor.employeeId)?.employeeName ?? '';
  const message = postSystemMessage(tx, chatRoom.id, `${opener}님이 수주 ${so.salesOrderNo} 업무방을 열었어요`);
  const mine = tx.tables.chatRoomMember.find((m) => m.chatRoomId === chatRoom.id && m.employeeId === actor.employeeId);
  if (mine) updateRow(tx, 'chatRoomMember', mine.id, { lastReadMessageId: message.id });
  return { chatRoom, created: true };
}
