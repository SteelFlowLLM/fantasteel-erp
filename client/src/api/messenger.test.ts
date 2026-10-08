import { beforeEach, describe, expect, it } from 'vitest';
import { MESSAGE_ATTACHMENT_MAX_COUNT } from '@fantasteel/shared';
import { setActingEmployeeForTest } from '@/api/actor';
import { InputError } from '@/api/client';
import { messengerApi } from '@/api/messenger';
import { getMockDb } from '@/mock/db';
import { MOCK_FILE_MAX_BYTES } from '@/mock/fileStorage';
import { insertRow } from '@/mock/store';
import { actAs, departmentIdOf, employeeIdOf, SEED_EMPLOYEE_NO } from '@/test/actors';
import { resetToMasterSeed } from '@/test/masterSeed';

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

// 이 시험은 협업 시드가 없는 상태(조직·기준정보만)를 전제로 쓰였다
beforeEach(resetToMasterSeed);

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
    const sent = await messengerApi.sendMessage({ chatRoomId: roomId, content: '@김도윤 확인 부탁해요. @품질부 검사 일정도요' });
    const head = notificationsOf(employeeIdOf(SEED_EMPLOYEE_NO.salesHead));
    expect(head).toHaveLength(1);
    // 알림을 누르면 그 메시지까지 이동한다
    expect(head[0]).toMatchObject({ notificationType: 'MENTION', departmentId: null, linkPath: `/messenger?room=${roomId}&message=${sent.id}` });
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
    const sent = await messengerApi.sendMessage({ chatRoomId: roomId, files: [{ name: '메모.txt', size: 5, mimeType: 'text/plain', dataUrl }] });
    expect(sent.content).toBeNull();
    expect(sent.files).toEqual([{ id: 1, name: '메모.txt', size: 5, mimeType: 'text/plain' }]);

    actAs(SEED_EMPLOYEE_NO.quality);
    expect(await messengerApi.getFile({ messageId: sent.id, fileId: 1, fileName: '' })).toEqual({ name: '메모.txt', mimeType: 'text/plain', dataUrl });
    actAs(SEED_EMPLOYEE_NO.purchase);
    await expect(messengerApi.getFile({ messageId: sent.id, fileId: 1, fileName: '' })).rejects.toMatchObject({ code: 'COM-002' });
    expect((await messengerApi.listRooms()).map((r) => r.id)).not.toContain(roomId);
  });

  it('여러 파일을 한 메시지로 보내면 올린 순서대로 보이고 각각 내려받는다. 미리보기는 "파일 · 첫 이름 외 N개"', async () => {
    const roomId = await createGroup();
    const fileOf = (name: string, text: string) => ({ name, size: text.length, mimeType: 'text/plain', dataUrl: `data:text/plain;base64,${btoa(text)}` });
    const sent = await messengerApi.sendMessage({ chatRoomId: roomId, files: [fileOf('a.txt', 'aa'), fileOf('b.txt', 'bbb')] });
    expect(sent.files.map((f) => [f.id, f.name])).toEqual([
      [1, 'a.txt'],
      [2, 'b.txt'],
    ]);
    expect((await messengerApi.getFile({ messageId: sent.id, fileId: 2, fileName: '' })).dataUrl).toBe(fileOf('b.txt', 'bbb').dataUrl);
    expect((await messengerApi.listRooms()).find((r) => r.id === roomId)?.lastMessagePreview).toBe('파일 · a.txt 외 1개');
    const tooMany = Array.from({ length: MESSAGE_ATTACHMENT_MAX_COUNT + 1 }, (_, i) => fileOf(`${i}.txt`, 'x'));
    await expect(messengerApi.sendMessage({ chatRoomId: roomId, files: tooMany })).rejects.toBeInstanceOf(InputError);
  });

  it('입력 확인: 빈 메시지, 4000자 초과, 512KB 초과 파일', async () => {
    const roomId = await createGroup();
    await expect(messengerApi.sendMessage({ chatRoomId: roomId, content: '   ' })).rejects.toBeInstanceOf(InputError);
    await expect(messengerApi.sendMessage({ chatRoomId: roomId, content: '가'.repeat(4001) })).rejects.toBeInstanceOf(InputError);
    await expect(
      messengerApi.sendMessage({ chatRoomId: roomId, files: [{ name: 'big.bin', size: MOCK_FILE_MAX_BYTES + 1, mimeType: 'application/octet-stream', dataUrl: 'data:,' }] }),
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

  it('메시지마다 안 읽은 멤버 수, 파일 모아보기(첨부만 최신순), 대화 검색(대소문자 무시, 최신순)', async () => {
    const roomId = await createGroup();
    const sent = await messengerApi.sendMessage({ chatRoomId: roomId, content: 'SO-2610-001 출하 확인' });
    expect(sent.unreadMemberCount).toBe(3);
    await messengerApi.sendMessage({ chatRoomId: roomId, content: '자료', files: [{ name: '일정.txt', size: 4, mimeType: 'text/plain', dataUrl: 'data:text/plain;base64,dGVzdA==' }] });
    await messengerApi.sendMessage({ chatRoomId: roomId, content: 'so-2610-001 납기 변경' });

    actAs(SEED_EMPLOYEE_NO.quality);
    await messengerApi.markRead({ chatRoomId: roomId, lastMessageId: sent.id });
    const page = await messengerApi.listMessages({ chatRoomId: roomId });
    expect(page.items.map((m) => m.unreadMemberCount)).toEqual([2, 3, 3]);

    const files = await messengerApi.listFiles({ chatRoomId: roomId, limit: 5 });
    expect(files.items.map((m) => m.files.map((f) => f.name))).toEqual([['일정.txt']]);
    const found = await messengerApi.searchMessages({ chatRoomId: roomId, keyword: 'So-2610' });
    expect(found.items.map((m) => m.content)).toEqual(['so-2610-001 납기 변경', 'SO-2610-001 출하 확인']);
    await expect(messengerApi.searchMessages({ chatRoomId: roomId, keyword: '  ' })).rejects.toBeInstanceOf(InputError);
  });

  it('메시지 수정·삭제(내 것만, 삭제는 표시만)와 답글(원본 요약, 원본 삭제 시 비움)', async () => {
    const roomId = await createGroup();
    const mine = await messengerApi.sendMessage({ chatRoomId: roomId, content: '처음 글' });
    const edited = await messengerApi.editMessage({ messageId: mine.id, content: ' 고친 글 ' });
    expect(edited).toMatchObject({ content: '고친 글', isDeleted: false });
    expect(edited.editedAt).not.toBeNull();
    await expect(messengerApi.editMessage({ messageId: mine.id, content: '  ' })).rejects.toBeInstanceOf(InputError);

    actAs(SEED_EMPLOYEE_NO.quality);
    await expect(messengerApi.editMessage({ messageId: mine.id, content: '남의 글' })).rejects.toBeInstanceOf(InputError);
    const reply = await messengerApi.sendMessage({ chatRoomId: roomId, content: '확인했어요', parentMessageId: mine.id });
    expect(reply.parent).toEqual({ id: mine.id, senderName: '박서영', preview: '고친 글', isDeleted: false });

    actAs(SEED_EMPLOYEE_NO.sales);
    expect(await messengerApi.deleteMessage(mine.id)).toMatchObject({ isDeleted: true, content: null });
    const page = await messengerApi.listMessages({ chatRoomId: roomId });
    expect(page.items.find((m) => m.id === reply.id)?.parent).toMatchObject({ isDeleted: true, preview: '' });
    await expect(messengerApi.sendMessage({ chatRoomId: roomId, content: 'x', parentMessageId: mine.id })).rejects.toBeInstanceOf(InputError);
  });

  it('공지 고정·내리기: 방 정보에 보이고 시스템 메시지가 남으며, 지운 메시지는 공지에서 빠진다', async () => {
    const roomId = await createGroup();
    const notice = await messengerApi.sendMessage({ chatRoomId: roomId, content: '내일 9시 회의' });
    await messengerApi.pinMessage({ chatRoomId: roomId, messageId: notice.id });
    expect((await messengerApi.getRoom(roomId)).pinnedMessage).toMatchObject({ id: notice.id, preview: '내일 9시 회의', senderName: '박서영' });
    await messengerApi.unpinMessage(roomId);
    expect((await messengerApi.getRoom(roomId)).pinnedMessage).toBeNull();
    const system = (await messengerApi.listMessages({ chatRoomId: roomId })).items.filter((m) => m.isSystem).map((m) => m.content);
    expect(system).toEqual(['박서영님이 메시지를 공지로 고정했어요', '박서영님이 공지를 내렸어요']);

    await messengerApi.pinMessage({ chatRoomId: roomId, messageId: notice.id });
    await messengerApi.deleteMessage(notice.id);
    expect((await messengerApi.getRoom(roomId)).pinnedMessage).toBeNull();
  });

  it('방 알림 끄기: 업무방 새 메시지 알림·배지 합계에서 빠지고 멘션은 받는다. 고정한 방은 목록 맨 위에 온다', async () => {
    const { roomId } = createWorkRoom([SEED_EMPLOYEE_NO.sales, SEED_EMPLOYEE_NO.productionHead, SEED_EMPLOYEE_NO.logistics]);
    actAs(SEED_EMPLOYEE_NO.logistics);
    const logisticsId = employeeIdOf(SEED_EMPLOYEE_NO.logistics);
    const before = await messengerApi.countUnread(logisticsId);
    await messengerApi.updateSettings({ chatRoomId: roomId, muted: true, pinned: true });

    actAs(SEED_EMPLOYEE_NO.sales);
    await messengerApi.sendMessage({ chatRoomId: roomId, content: '진행 공유' });
    await messengerApi.sendMessage({ chatRoomId: roomId, content: '@권예진 출하 확인' });
    expect(notificationsOf(logisticsId).map((n) => n.notificationType)).toEqual(['MENTION']);

    actAs(SEED_EMPLOYEE_NO.logistics);
    expect(await messengerApi.countUnread(logisticsId)).toBe(before);
    const rooms = await messengerApi.listRooms();
    expect(rooms[0]).toMatchObject({ id: roomId, muted: true, unreadCount: 2 });
    expect(rooms[0].pinnedAt).not.toBeNull();
    expect(await messengerApi.getRoom(roomId)).toMatchObject({ muted: true });

    await messengerApi.updateSettings({ chatRoomId: roomId, muted: false, pinned: false });
    expect(await messengerApi.countUnread(logisticsId)).toBe(before + 2);
    expect((await messengerApi.getRoom(roomId)).pinnedAt).toBeNull();
  });

  it('방 나가기: 목록에서 사라지고 볼 수 없으며 남은 멤버에게 시스템 메시지를 남긴다. 1:1은 나갈 수 없다', async () => {
    const roomId = await createGroup();
    actAs(SEED_EMPLOYEE_NO.quality);
    await messengerApi.leaveRoom(roomId);
    expect((await messengerApi.listRooms()).some((r) => r.id === roomId)).toBe(false);
    await expect(messengerApi.listMessages({ chatRoomId: roomId })).rejects.toThrow();

    actAs(SEED_EMPLOYEE_NO.sales);
    const page = await messengerApi.listMessages({ chatRoomId: roomId });
    expect(page.items.at(-1)).toMatchObject({ isSystem: true, content: '서민지님이 나갔어요' });
    expect((await messengerApi.getRoom(roomId)).members.map((m) => m.employeeName)).not.toContain('서민지');

    const direct = await messengerApi.createRoom({ chatRoomType: 'DIRECT', memberIds: [employeeIdOf(SEED_EMPLOYEE_NO.quality)] });
    await expect(messengerApi.leaveRoom(direct.id)).rejects.toBeInstanceOf(InputError);
  });

  it('이모지 반응: 누르면 더하고 다시 누르면 빼며, 이모지별 인원·내 반응을 보여 준다', async () => {
    const roomId = await createGroup();
    const message = await messengerApi.sendMessage({ chatRoomId: roomId, content: '검사 끝' });
    await messengerApi.toggleReaction({ messageId: message.id, emoji: '👍' });
    actAs(SEED_EMPLOYEE_NO.quality);
    const both = await messengerApi.toggleReaction({ messageId: message.id, emoji: '👍' });
    expect(both.reactions).toEqual([{ emoji: '👍', count: 2, reactedByMe: true, employeeNames: ['박서영', '서민지'] }]);
    const undone = await messengerApi.toggleReaction({ messageId: message.id, emoji: '👍' });
    expect(undone.reactions).toEqual([{ emoji: '👍', count: 1, reactedByMe: false, employeeNames: ['박서영'] }]);
  });

  it('그룹방 이름 바꾸기: 비우면 멤버 이름으로 보이고, 1:1은 입력 오류, 멤버가 아니면 COM-002', async () => {
    const roomId = await createGroup();
    expect(await messengerApi.renameRoom({ chatRoomId: roomId, chatRoomName: '  납기 대응  ' })).toMatchObject({ chatRoomName: '납기 대응', displayName: '납기 대응' });
    const cleared = await messengerApi.renameRoom({ chatRoomId: roomId, chatRoomName: null });
    expect(cleared.chatRoomName).toBeNull();
    expect(cleared.displayName).toContain('김도윤');

    const direct = await messengerApi.createRoom({ chatRoomType: 'DIRECT', memberIds: [employeeIdOf(SEED_EMPLOYEE_NO.purchaseHead)] });
    await expect(messengerApi.renameRoom({ chatRoomId: direct.id, chatRoomName: '안 됨' })).rejects.toBeInstanceOf(InputError);
    actAs(SEED_EMPLOYEE_NO.purchase);
    await expect(messengerApi.renameRoom({ chatRoomId: roomId, chatRoomName: '남의 방' })).rejects.toMatchObject({ code: 'COM-002' });
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

describe('이모티콘 (18번)', () => {
  it('이모티콘만 보내면 글 없이 저장되고, 목록·업무방 알림·답글 미리보기는 "이모티콘 · 이름"이다', async () => {
    const { roomId } = createWorkRoom([SEED_EMPLOYEE_NO.sales, SEED_EMPLOYEE_NO.quality]);
    actAs(SEED_EMPLOYEE_NO.sales);
    const sent = await messengerApi.sendMessage({ chatRoomId: roomId, emoticonKey: 'steelman-approve' });
    expect(sent).toMatchObject({ content: null, emoticonKey: 'steelman-approve', files: [] });
    expect((await messengerApi.listRooms()).find((r) => r.id === roomId)?.lastMessagePreview).toBe('이모티콘 · 결재 완료');
    expect(notificationsOf(employeeIdOf(SEED_EMPLOYEE_NO.quality)).at(-1)?.body).toContain('이모티콘 · 결재 완료');
    actAs(SEED_EMPLOYEE_NO.quality);
    const reply = await messengerApi.sendMessage({ chatRoomId: roomId, content: '확인했어요', parentMessageId: sent.id });
    expect(reply.parent?.preview).toBe('이모티콘 · 결재 완료');
  });

  it('글과 함께 보낼 수 있고 글을 비우는 수정도 된다. 삭제하면 비우고, 파일과 함께·없는 키는 입력 오류', async () => {
    const roomId = await createGroup();
    const sent = await messengerApi.sendMessage({ chatRoomId: roomId, content: '오늘 고생했어요', emoticonKey: 'steelman-off' });
    expect((await messengerApi.listRooms()).find((r) => r.id === roomId)?.lastMessagePreview).toBe('오늘 고생했어요');
    expect(await messengerApi.editMessage({ messageId: sent.id, content: '' })).toMatchObject({ content: null, emoticonKey: 'steelman-off' });
    expect(await messengerApi.deleteMessage(sent.id)).toMatchObject({ isDeleted: true, emoticonKey: null });
    const file = { name: 'a.txt', size: 1, mimeType: 'text/plain', dataUrl: 'data:text/plain;base64,YQ==' };
    await expect(messengerApi.sendMessage({ chatRoomId: roomId, emoticonKey: 'steelman-ok', files: [file] })).rejects.toBeInstanceOf(InputError);
    // @ts-expect-error 목록에 없는 키
    await expect(messengerApi.sendMessage({ chatRoomId: roomId, emoticonKey: 'steelman-none' })).rejects.toBeInstanceOf(InputError);
  });
});
