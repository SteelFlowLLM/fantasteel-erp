import { describe, expect, it } from 'vitest';
import { setActingEmployeeForTest } from '@/api/actor';
import { InputError } from '@/api/client';
import { messengerApi } from '@/api/messenger';
import { getMockDb } from '@/mock/db';
import { MOCK_FILE_MAX_BYTES } from '@/mock/fileStorage';
import { insertRow } from '@/mock/store';
import { actAs, departmentIdOf, employeeIdOf, SEED_EMPLOYEE_NO } from '@/test/actors';

const notificationsOf = (employeeId: number) => getMockDb().read((tables) => tables.notification.filter((n) => n.recipientId === employeeId));

/** 영업 박서영 + 김도윤 + 품질 서민지·오지훈 그룹 */
async function createGroup(): Promise<number> {
  actAs(SEED_EMPLOYEE_NO.sales);
  const { id } = await messengerApi.createRoom({
    chatRoomType: 'GROUP',
    chatRoomName: '출하 조율',
    memberIds: [employeeIdOf(SEED_EMPLOYEE_NO.salesHead), employeeIdOf(SEED_EMPLOYEE_NO.quality), employeeIdOf(SEED_EMPLOYEE_NO.qualityHead)],
  });
  return id;
}

/** 수주 1건과 그 업무방 (수주 상세에서 여는 방을 흉내 낸다) */
function createWorkRoom(memberNos: string[]): { roomId: number; salesOrderId: number } {
  return getMockDb().transact((tx) => {
    const customerId = tx.tables.customer[0].id;
    const owner = tx.tables.employee.find((e) => e.employeeNo === SEED_EMPLOYEE_NO.sales);
    const slab = tx.tables.item.find((i) => i.itemType === 'SLAB');
    if (!owner || !slab) throw new Error('시드가 없어요');
    const salesOrder = insertRow(tx, 'salesOrder', { salesOrderNo: 'SO-2610-001', customerId, ownerEmployeeId: owner.id, cancelledAt: null, cancelReason: null });
    insertRow(tx, 'salesOrderItem', { salesOrderId: salesOrder.id, lineNo: 1, itemId: slab.id, orderedQty: 10, shippedQty: 0, dueDate: '2026-10-20', salesOrderItemStatus: 'OPEN' });
    const room = insertRow(tx, 'chatRoom', { chatRoomType: 'WORK', chatRoomName: null, salesOrderId: salesOrder.id, createdEmployeeId: owner.id });
    for (const no of memberNos) {
      const employee = tx.tables.employee.find((e) => e.employeeNo === no);
      if (employee) insertRow(tx, 'chatRoomMember', { chatRoomId: room.id, employeeId: employee.id, lastReadMessageId: null });
    }
    return { roomId: room.id, salesOrderId: salesOrder.id };
  });
}

describe('채팅방 만들기 (REQ-MSG-001)', () => {
  it('1:1은 같은 상대와의 방이 있으면 그 방을 돌려준다', async () => {
    actAs(SEED_EMPLOYEE_NO.purchase);
    const head = employeeIdOf(SEED_EMPLOYEE_NO.purchaseHead);
    const first = await messengerApi.createRoom({ chatRoomType: 'DIRECT', memberIds: [head] });
    expect(first.reused).toBe(false);
    actAs(SEED_EMPLOYEE_NO.purchaseHead);
    const again = await messengerApi.createRoom({ chatRoomType: 'DIRECT', memberIds: [employeeIdOf(SEED_EMPLOYEE_NO.purchase)] });
    expect(again).toEqual({ id: first.id, reused: true });
    const room = await messengerApi.getRoom(first.id);
    expect(room.displayName).toBe('정다은');
    expect(room.canInvite).toBe(false);
    expect(room.members).toHaveLength(2);
  });

  it('그룹은 나를 자동으로 넣고, 업무방은 메신저에서 만들 수 없다', async () => {
    const id = await createGroup();
    const room = await messengerApi.getRoom(id);
    expect(room.members.map((m) => m.isMe).filter(Boolean)).toHaveLength(1);
    expect(room.members).toHaveLength(4);
    expect(room.salesOrderState).toBe('none');
    await expect(messengerApi.createRoom({ chatRoomType: 'WORK', memberIds: [employeeIdOf(SEED_EMPLOYEE_NO.salesHead)] })).rejects.toBeInstanceOf(InputError);
  });

  it('입력 확인: 1:1은 정확히 1명, 그룹은 1명 이상, 없는 사원은 COM-003, 사용 안 함은 입력 오류', async () => {
    actAs(SEED_EMPLOYEE_NO.sales);
    await expect(messengerApi.createRoom({ chatRoomType: 'DIRECT', memberIds: [] })).rejects.toBeInstanceOf(InputError);
    await expect(
      messengerApi.createRoom({ chatRoomType: 'DIRECT', memberIds: [employeeIdOf(SEED_EMPLOYEE_NO.salesHead), employeeIdOf(SEED_EMPLOYEE_NO.quality)] }),
    ).rejects.toBeInstanceOf(InputError);
    await expect(messengerApi.createRoom({ chatRoomType: 'GROUP', memberIds: [] })).rejects.toBeInstanceOf(InputError);
    await expect(messengerApi.createRoom({ chatRoomType: 'GROUP', memberIds: [9999] })).rejects.toMatchObject({ code: 'COM-003' });
    await expect(messengerApi.createRoom({ chatRoomType: 'GROUP', memberIds: [1], chatRoomName: '가'.repeat(101) })).rejects.toBeInstanceOf(InputError);
  });

  it('계정 선택이 없으면 COM-002', async () => {
    setActingEmployeeForTest(null);
    await expect(messengerApi.listRooms()).rejects.toMatchObject({ code: 'COM-002' });
  });
});

describe('메시지 · 읽음 · 멘션 (REQ-MSG-002~005)', () => {
  it('보내면 받는 사람의 안 읽은 수가 늘고, 읽음 처리하면 줄어든다', async () => {
    const roomId = await createGroup();
    const sent = await messengerApi.sendMessage({ chatRoomId: roomId, content: '  이번 주 출하 건 확인해 주세요  ' });
    expect(sent).toMatchObject({ content: '이번 주 출하 건 확인해 주세요', isMine: true, senderName: '박서영', isSystem: false });

    const headId = employeeIdOf(SEED_EMPLOYEE_NO.salesHead);
    expect(await messengerApi.countUnread(headId)).toBe(1);
    expect(await messengerApi.countUnread(employeeIdOf(SEED_EMPLOYEE_NO.sales))).toBe(0);

    actAs(SEED_EMPLOYEE_NO.salesHead);
    const list = await messengerApi.listRooms();
    expect(list[0]).toMatchObject({ id: roomId, unreadCount: 1, lastMessage: { senderName: '박서영', isMine: false } });
    expect(await messengerApi.markRead({ chatRoomId: roomId, lastMessageId: sent.id })).toBe(0);
    expect(await messengerApi.countUnread(headId)).toBe(0);
  });

  it('@이름은 개인 멘션 알림, @부서는 부서 알림. 보낸 사람은 받지 않는다', async () => {
    const roomId = await createGroup();
    await messengerApi.sendMessage({ chatRoomId: roomId, content: '@김도윤 확인 부탁해요. @품질부 검사 일정도요' });
    const head = notificationsOf(employeeIdOf(SEED_EMPLOYEE_NO.salesHead));
    expect(head).toHaveLength(1);
    expect(head[0]).toMatchObject({ notificationType: 'MENTION', departmentId: null, linkPath: `/messenger?room=${roomId}` });
    for (const no of [SEED_EMPLOYEE_NO.quality, SEED_EMPLOYEE_NO.qualityHead]) {
      const rows = notificationsOf(employeeIdOf(no));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ notificationType: 'MENTION', departmentId: departmentIdOf('QC') });
    }
    expect(notificationsOf(employeeIdOf(SEED_EMPLOYEE_NO.sales))).toHaveLength(0);

    actAs(SEED_EMPLOYEE_NO.quality);
    const page = await messengerApi.listMessages({ chatRoomId: roomId });
    expect(page.items[0].mentionsMe).toBe(true);
  });

  it('업무방 새 메시지는 나머지 멤버에게 업무방 메시지 알림, 멘션 받은 사람은 한 번만', async () => {
    const { roomId, salesOrderId } = createWorkRoom([SEED_EMPLOYEE_NO.sales, SEED_EMPLOYEE_NO.productionHead, SEED_EMPLOYEE_NO.logistics]);
    actAs(SEED_EMPLOYEE_NO.sales);
    await messengerApi.sendMessage({ chatRoomId: roomId, content: '@강민석 SO-2610-001 생산 일정 공유해 주세요' });
    const production = notificationsOf(employeeIdOf(SEED_EMPLOYEE_NO.productionHead));
    expect(production.map((n) => n.notificationType)).toEqual(['MENTION']);
    const logistics = notificationsOf(employeeIdOf(SEED_EMPLOYEE_NO.logistics));
    expect(logistics.map((n) => n.notificationType)).toEqual(['WORK_ROOM_MESSAGE']);
    expect(logistics[0].title).toBe('업무방 · SO-2610-001 새 메시지');

    const page = await messengerApi.listMessages({ chatRoomId: roomId });
    expect(page.items[0].erpLinks).toEqual([{ text: 'SO-2610-001', href: `/sales-orders/${salesOrderId}` }]);

    const room = await messengerApi.getRoom(roomId);
    expect(room.salesOrderState).toBe('ok');
    expect(room.salesOrder).toMatchObject({ salesOrderNo: 'SO-2610-001', customerName: '가람중공업', dueDate: '2026-10-20', linkPath: `/sales-orders/${salesOrderId}` });
    expect(room.salesOrder?.items[0]).toMatchObject({ lineNo: 1, orderedQty: 10, orderedTon: '235.500' });

    // 물류는 수주 화면 권한이 없어 요약을 보지 못한다 (BP-MSG-01 ERP 대상 조회 권한)
    actAs(SEED_EMPLOYEE_NO.logistics);
    const denied = await messengerApi.getRoom(roomId);
    expect(denied.salesOrderState).toBe('denied');
    expect(denied.salesOrder).toBeNull();
  });

  it('없는 번호는 링크가 되지 않는다', async () => {
    const roomId = await createGroup();
    await messengerApi.sendMessage({ chatRoomId: roomId, content: 'SO-2610-999 확인' });
    expect((await messengerApi.listMessages({ chatRoomId: roomId })).items[0].erpLinks).toEqual([]);
  });

  it('첨부 1개를 보내고 멤버가 내려받는다. 멤버가 아니면 COM-002', async () => {
    const roomId = await createGroup();
    const dataUrl = `data:text/plain;base64,${btoa('hello')}`;
    const sent = await messengerApi.sendMessage({ chatRoomId: roomId, file: { name: '메모.txt', size: 5, mimeType: 'text/plain', dataUrl } });
    expect(sent.content).toBeNull();
    expect(sent.file).toEqual({ name: '메모.txt', size: 5, mimeType: 'text/plain' });

    actAs(SEED_EMPLOYEE_NO.quality);
    expect(await messengerApi.getFile(sent.id)).toEqual({ name: '메모.txt', mimeType: 'text/plain', dataUrl });
    actAs(SEED_EMPLOYEE_NO.purchase);
    await expect(messengerApi.getFile(sent.id)).rejects.toMatchObject({ code: 'COM-002' });
    expect((await messengerApi.listRooms()).map((r) => r.id)).not.toContain(roomId);
  });

  it('입력 확인: 빈 메시지, 4000자 초과, 512KB 초과 파일', async () => {
    const roomId = await createGroup();
    await expect(messengerApi.sendMessage({ chatRoomId: roomId, content: '   ' })).rejects.toBeInstanceOf(InputError);
    await expect(messengerApi.sendMessage({ chatRoomId: roomId, content: '가'.repeat(4001) })).rejects.toBeInstanceOf(InputError);
    await expect(
      messengerApi.sendMessage({ chatRoomId: roomId, file: { name: 'big.bin', size: MOCK_FILE_MAX_BYTES + 1, mimeType: 'application/octet-stream', dataUrl: 'data:,' } }),
    ).rejects.toBeInstanceOf(InputError);
  });

  it('멤버가 아니면 메시지를 보거나 보낼 수 없고(COM-002), 없는 방은 COM-003', async () => {
    const roomId = await createGroup();
    actAs(SEED_EMPLOYEE_NO.purchase);
    await expect(messengerApi.listMessages({ chatRoomId: roomId })).rejects.toMatchObject({ code: 'COM-002' });
    await expect(messengerApi.sendMessage({ chatRoomId: roomId, content: '안녕하세요' })).rejects.toMatchObject({ code: 'COM-002' });
    await expect(messengerApi.getRoom(9999)).rejects.toMatchObject({ code: 'COM-003' });
  });

  it('초대한 멤버는 이전 대화를 보고, 지금까지는 읽은 것으로 시작한다. 1:1은 초대할 수 없다', async () => {
    const roomId = await createGroup();
    await messengerApi.sendMessage({ chatRoomId: roomId, content: '첫 메시지' });
    const purchase = employeeIdOf(SEED_EMPLOYEE_NO.purchase);
    expect(await messengerApi.inviteMembers({ chatRoomId: roomId, memberIds: [purchase, employeeIdOf(SEED_EMPLOYEE_NO.salesHead)] })).toBe(1);
    expect(await messengerApi.countUnread(purchase)).toBe(0);
    actAs(SEED_EMPLOYEE_NO.purchase);
    expect((await messengerApi.listMessages({ chatRoomId: roomId })).items).toHaveLength(1);
    await expect(messengerApi.inviteMembers({ chatRoomId: roomId, memberIds: [purchase] })).rejects.toBeInstanceOf(InputError);

    const direct = await messengerApi.createRoom({ chatRoomType: 'DIRECT', memberIds: [employeeIdOf(SEED_EMPLOYEE_NO.purchaseHead)] });
    await expect(messengerApi.inviteMembers({ chatRoomId: direct.id, memberIds: [employeeIdOf(SEED_EMPLOYEE_NO.sales)] })).rejects.toBeInstanceOf(InputError);
  });

  it('메시지는 최근 limit개, 더 오래된 것이 있으면 hasMore. 다른 방 메시지로 읽음 처리하면 COM-003', async () => {
    const roomId = await createGroup();
    for (let index = 1; index <= 3; index += 1) await messengerApi.sendMessage({ chatRoomId: roomId, content: `메시지 ${index}` });
    const page = await messengerApi.listMessages({ chatRoomId: roomId, limit: 2 });
    expect(page.items.map((m) => m.content)).toEqual(['메시지 2', '메시지 3']);
    expect(page.hasMore).toBe(true);

    actAs(SEED_EMPLOYEE_NO.purchase);
    const other = await messengerApi.createRoom({ chatRoomType: 'DIRECT', memberIds: [employeeIdOf(SEED_EMPLOYEE_NO.purchaseHead)] });
    const otherMessage = await messengerApi.sendMessage({ chatRoomId: other.id, content: '다른 방' });
    actAs(SEED_EMPLOYEE_NO.sales);
    await expect(messengerApi.markRead({ chatRoomId: roomId, lastMessageId: otherMessage.id })).rejects.toMatchObject({ code: 'COM-003' });
  });
});
