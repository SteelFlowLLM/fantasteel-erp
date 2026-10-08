// 메신저 서버 어댑터: 목록·배지·드롭다운, 방 정보(멘션 후보·초대 막기), 메시지(서버 상한 넘기기·나를 멘션), 보내기(@멘션 → 사원 id, 파일 → multipart),
// 읽음, 업무방 열기·찾기를 서버 응답 → 화면 모양으로 확인한다.
import type { ChatMessageView, ChatRoomDetail, ChatRoomListItem } from '@fantasteel/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { messengerApi } from '@/api/messenger';
import { salesOrderApi } from '@/api/salesOrders';
import { fail, ok, stopFakeServer, useFakeServer } from '@/api/server/serverTestKit';
import { SEED_EMPLOYEE_NO } from '@/test/actors';

const AT = '2026-10-07T00:00:00.000Z';

const listItem = (id: number, unreadCount: number, extra: Partial<ChatRoomListItem> = {}): ChatRoomListItem => ({
  id,
  chatRoomType: 'GROUP',
  chatRoomName: `방 ${id}`,
  displayName: `방 ${id}`,
  memberCount: 3,
  memberNames: ['정다은', '서민지'],
  counterpart: null,
  lastMessage: { senderName: '정다은', isMine: false, isSystem: false, preview: '안녕하세요', createdAt: AT },
  unreadCount,
  salesOrder: null,
  createdAt: AT,
  ...extra,
});

/** 나(박서영·영업부), 정다은(구매부), 서민지(품질부), 오지훈(품질부) */
const detail = (extra: Partial<ChatRoomDetail> = {}): ChatRoomDetail => ({
  id: 7,
  chatRoomType: 'GROUP',
  chatRoomName: '협의',
  displayName: '협의',
  createdAt: AT,
  members: [
    { id: 3, employeeNo: '2103003', employeeName: '박서영', departmentId: 2, departmentName: '영업부', jobGradeName: '대리', isHead: false, isMe: true },
    { id: 5, employeeNo: '2207005', employeeName: '정다은', departmentId: 3, departmentName: '구매부', jobGradeName: '사원', isHead: false, isMe: false },
    { id: 13, employeeNo: '2205013', employeeName: '서민지', departmentId: 9, departmentName: '품질부', jobGradeName: '대리', isHead: false, isMe: false },
    { id: 12, employeeNo: '1802012', employeeName: '오지훈', departmentId: 9, departmentName: '품질부', jobGradeName: '부장', isHead: true, isMe: false },
  ],
  salesOrderId: null,
  salesOrderState: 'none',
  salesOrder: null,
  unreadCount: 2,
  lastReadMessageId: 40,
  ...extra,
});

const message = (id: number, content: string | null, extra: Partial<ChatMessageView> = {}): ChatMessageView => ({
  id,
  chatRoomId: 7,
  senderId: 5,
  senderName: '정다은',
  senderDepartmentName: '구매부',
  senderJobGradeName: '사원',
  isSystem: false,
  isMine: false,
  content,
  attachmentName: null,
  unreadMemberCount: 0,
  erpLinks: [],
  editedAt: null,
  isDeleted: false,
  parent: null,
  createdAt: AT,
  ...extra,
});

afterEach(() => stopFakeServer());

describe('메신저 서버 어댑터 (api/server/messenger.ts)', () => {
  it('목록·드롭다운·배지는 GET /chat-rooms 한 번으로 만든다 (안 읽은 수 합계, 서버 정렬 그대로)', async () => {
    useFakeServer(SEED_EMPLOYEE_NO.sales, (c) => (c.path === '/chat-rooms' ? ok([listItem(2, 3), listItem(1, 1, { lastMessage: null })]) : undefined));
    expect(await messengerApi.countUnread(0)).toBe(4);
    expect(await messengerApi.listRecentRooms(0, 1)).toEqual([{ id: 2, chatRoomType: 'GROUP', displayName: '방 2', lastMessagePreview: '안녕하세요', lastMessageAt: AT, unreadCount: 3 }]);
    const rooms = await messengerApi.listRooms();
    expect(rooms.map((r) => r.id)).toEqual([2, 1]);
    expect(rooms[0].lastMessage).toEqual({ senderName: '정다은', isMine: false, isSystem: false, preview: '안녕하세요', createdAt: AT });
    expect(rooms[1]).toMatchObject({ lastMessage: null, lastMessagePreview: null });
  });

  it('방 정보: 멘션 후보는 나를 뺀 멤버와 멤버 부서, 1:1이 아닌 방은 초대할 수 있다', async () => {
    useFakeServer(SEED_EMPLOYEE_NO.sales, (c) => (c.path === '/chat-rooms/7' ? ok(detail()) : undefined));
    const room = await messengerApi.getRoom(7);
    expect(room).toMatchObject({ id: 7, canInvite: true, createdEmployeeName: '-', salesOrderState: 'none', salesOrder: null, unreadCount: 2, lastReadMessageId: 40 });
    expect(room.mentionTargets).toEqual([
      { kind: 'employee', id: 5, name: '정다은' },
      { kind: 'employee', id: 13, name: '서민지' },
      { kind: 'employee', id: 12, name: '오지훈' },
      { kind: 'department', id: 2, name: '영업부' },
      { kind: 'department', id: 3, name: '구매부' },
      { kind: 'department', id: 9, name: '품질부' },
    ]);
  });

  it('멤버 초대는 POST /chat-rooms/:id/members의 새 멤버 수, 이름 바꾸기는 PATCH /chat-rooms/:id', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.sales, (c) => {
      if (c.path === '/chat-rooms/7/members') return ok({ chatRoomId: 7, addedCount: 2 });
      if (c.path === '/chat-rooms/7' && c.method === 'PATCH') return ok({ id: 7, chatRoomName: null, displayName: '정다은, 서민지' });
      return undefined;
    });
    expect(await messengerApi.inviteMembers({ chatRoomId: 7, memberIds: [5, 13] })).toBe(2);
    expect(await messengerApi.renameRoom({ chatRoomId: 7, chatRoomName: null })).toEqual({ id: 7, chatRoomName: null, displayName: '정다은, 서민지' });
    expect(calls.map((c) => [c.method, c.path, c.body])).toEqual([
      ['POST', '/chat-rooms/7/members', { memberIds: [5, 13] }],
      ['PATCH', '/chat-rooms/7', { chatRoomName: null }],
    ]);
  });

  it('메시지 limit이 서버 상한(100)을 넘으면 before로 이어 읽고, 나·내 부서 멘션을 표시한다', async () => {
    const all = Array.from({ length: 130 }, (_, i) => message(i + 1, i === 129 ? '@박서영 확인 부탁해요' : i === 128 ? '@영업부 공유' : `메시지 ${i + 1}`));
    const calls = useFakeServer(SEED_EMPLOYEE_NO.sales, (c) => {
      if (c.path === '/chat-rooms/7') return ok(detail());
      if (c.path !== '/chat-rooms/7/messages') return undefined;
      const before = c.query.before ? Number(c.query.before) : Infinity;
      const older = all.filter((m) => m.id < before);
      const items = older.slice(Math.max(0, older.length - Number(c.query.limit)));
      return ok({ items, hasMore: older.length > items.length });
    });
    const page = await messengerApi.listMessages({ chatRoomId: 7, limit: 120 });
    expect(page.items).toHaveLength(120);
    expect(page.items[0].id).toBe(11);
    expect(page.hasMore).toBe(true);
    expect(calls.filter((c) => c.path.endsWith('/messages')).map((c) => [c.query.limit, c.query.before])).toEqual([
      ['100', undefined],
      ['20', '31'],
    ]);
    expect(page.items.at(-1)).toMatchObject({ mentionsMe: true, isSystem: false, file: null, erpLinks: [] });
    expect(page.items.at(-2)?.mentionsMe).toBe(true);
    expect(page.items.at(-3)?.mentionsMe).toBe(false);
  });

  it('보내기: 본문의 @사원·@부서를 방 멤버 사원 id로 바꿔 보낸다 (부서 = 그 부서의 방 멤버, 나는 빼고)', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.sales, (c) => {
      if (c.path === '/chat-rooms/7') return ok(detail());
      if (c.path === '/chat-rooms/7/messages' && c.method === 'POST') return ok(message(50, '@정다은 @품질부 확인', { senderId: 3, isMine: true }));
      return undefined;
    });
    const sent = await messengerApi.sendMessage({ chatRoomId: 7, content: ' @정다은 @품질부 @영업부 확인 ' });
    expect(sent).toMatchObject({ id: 50, isMine: true, mentionsMe: false });
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ content: '@정다은 @품질부 @영업부 확인', mentionedEmployeeIds: [5, 13, 12] });
    await messengerApi.sendMessage({ chatRoomId: 7, content: '다시', clientMessageId: 'abc-1' });
    expect((calls.filter((c) => c.method === 'POST').at(-1)?.body as { clientMessageId?: string }).clientMessageId).toBe('abc-1');
  });

  it('파일은 첨부 API로 multipart를 보내고(글은 content), 첨부 이름을 파일로 보여 준다', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.sales, (c) => {
      if (c.path === '/chat-rooms/7') return ok(detail());
      if (c.path === '/chat-rooms/7/attachments') return ok(message(51, '첨부해요', { senderId: 3, isMine: true, attachmentName: '성적서.txt' }));
      return undefined;
    });
    const sent = await messengerApi.sendMessage({
      chatRoomId: 7,
      content: '첨부해요',
      file: { name: '성적서.txt', size: 5, mimeType: 'text/plain', dataUrl: `data:text/plain;base64,${btoa('hello')}` },
    });
    expect(sent.file).toEqual({ name: '성적서.txt', size: null, mimeType: null });
    const form = calls.find((c) => c.path === '/chat-rooms/7/attachments')?.body as FormData;
    expect(form.get('content')).toBe('첨부해요');
    const file = form.get('file') as File;
    expect(file.name).toBe('성적서.txt');
    expect(await file.text()).toBe('hello');
  });

  it('파일 모아보기는 GET …/attachments, 검색은 GET …/messages/search?q=, 안 읽은 멤버 수는 그대로 쓴다', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.sales, (c) => {
      if (c.path === '/chat-rooms/7') return ok(detail());
      if (c.path === '/chat-rooms/7/attachments') return ok({ items: [message(9, null, { attachmentName: 'a.pdf', unreadMemberCount: 1 })], hasMore: true });
      if (c.path === '/chat-rooms/7/messages/search') return ok({ items: [message(8, 'SO 확인')], hasMore: false });
      return undefined;
    });
    const files = await messengerApi.listFiles({ chatRoomId: 7, limit: 5 });
    expect(files).toMatchObject({ hasMore: true, items: [{ id: 9, file: { name: 'a.pdf' }, unreadMemberCount: 1 }] });
    const found = await messengerApi.searchMessages({ chatRoomId: 7, keyword: 'SO' });
    expect(found.items.map((m) => m.content)).toEqual(['SO 확인']);
    expect(calls.filter((c) => c.path !== '/chat-rooms/7').map((c) => [c.path, c.query])).toEqual([
      ['/chat-rooms/7/attachments', { limit: '5' }],
      ['/chat-rooms/7/messages/search', { q: 'SO' }],
    ]);
  });

  it('본문의 업무 번호 링크는 서버가 준 그대로 쓴다', async () => {
    useFakeServer(SEED_EMPLOYEE_NO.sales, (c) => {
      if (c.path === '/chat-rooms/7') return ok(detail());
      if (c.path === '/chat-rooms/7/messages') return ok({ items: [message(1, 'SO-2610-001 확인', { erpLinks: [{ text: 'SO-2610-001', href: '/sales-orders/21' }] })], hasMore: false });
      return undefined;
    });
    const page = await messengerApi.listMessages({ chatRoomId: 7, limit: 10 });
    expect(page.items[0].erpLinks).toEqual([{ text: 'SO-2610-001', href: '/sales-orders/21' }]);
  });

  it('수정은 PATCH /messages/:id, 삭제는 DELETE /messages/:id, 답글은 parentMessageId를 보낸다', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.sales, (c) => {
      if (c.path === '/chat-rooms/7') return ok(detail());
      if (c.path === '/messages/50' && c.method === 'PATCH') return ok(message(50, '고친 글', { isMine: true, editedAt: AT }));
      if (c.path === '/messages/50' && c.method === 'DELETE') return ok(message(50, null, { isMine: true, isDeleted: true }));
      if (c.path === '/chat-rooms/7/messages') return ok(message(51, '답장', { parent: { id: 50, senderName: '정다은', preview: '원본', isDeleted: false } }));
      return undefined;
    });
    expect(await messengerApi.editMessage({ messageId: 50, content: '고친 글' })).toMatchObject({ content: '고친 글', editedAt: AT });
    expect(await messengerApi.deleteMessage(50)).toMatchObject({ isDeleted: true, content: null });
    const reply = await messengerApi.sendMessage({ chatRoomId: 7, content: '답장', parentMessageId: 50 });
    expect(reply.parent).toMatchObject({ id: 50, preview: '원본' });
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ content: '고친 글' });
    expect((calls.find((c) => c.path === '/chat-rooms/7/messages')?.body as { parentMessageId?: number }).parentMessageId).toBe(50);
  });

  it('읽음은 남은 안 읽은 수를, 서버 오류는 화면 오류로 돌려준다', async () => {
    useFakeServer(SEED_EMPLOYEE_NO.sales, (c) =>
      c.path === '/chat-rooms/7/read' ? ok({ chatRoomId: 7, lastReadMessageId: 50, unreadCount: 0 }) : c.path === '/chat-rooms/8/read' ? fail(403, 'COM-002', '채팅방 멤버만 볼 수 있어요') : undefined,
    );
    expect(await messengerApi.markRead({ chatRoomId: 7, lastMessageId: 50 })).toBe(0);
    await expect(messengerApi.markRead({ chatRoomId: 8, lastMessageId: 50 })).rejects.toMatchObject({ code: 'COM-002' });
  });

  it('업무방 열기는 WORK 방 만들기이고, 수주의 업무방은 내 방 목록에서 찾는다', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.sales, (c) => {
      if (c.path === '/chat-rooms' && c.method === 'POST') return ok({ id: 7, reused: true });
      if (c.path === '/chat-rooms') return ok([listItem(7, 0, { chatRoomType: 'WORK', salesOrder: { id: 21, salesOrderNo: 'SO-2610-001', customerName: '한빛', dueDate: null } })]);
      if (c.path === '/chat-rooms/7') return ok(detail({ chatRoomType: 'WORK', chatRoomName: 'SO-2610-001 한빛' }));
      return undefined;
    });
    expect(await salesOrderApi.openWorkRoom({ salesOrderId: 21, memberEmployeeIds: [5] })).toEqual({ chatRoomId: 7, chatRoomName: 'SO-2610-001 한빛', created: false });
    expect(calls[0].body).toEqual({ chatRoomType: 'WORK', memberIds: [5], salesOrderId: 21 });
    expect(await salesOrderApi.workRoom(21)).toEqual({ chatRoomId: 7, chatRoomName: 'SO-2610-001 한빛', memberEmployeeIds: [3, 5, 13, 12] });
    expect(await salesOrderApi.workRoom(99)).toBeNull();
  });
});
