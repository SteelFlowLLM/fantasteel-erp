// 실제 DB(기본 fs_msg)에 붙어 도는 테스트. 테스트마다 자기 데이터를 만들고 끝나면 지운다.
process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:54322/fs_msg';

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const storageDir = mkdtempSync(join(tmpdir(), 'fs-msg-test-'));
process.env.STORAGE_DIR = storageDir;

import type { AuthUser } from '@fantasteel/shared';
import { NumberingService } from '../../common/numbering/numbering.service';
import type { RealtimeGateway } from '../../common/realtime/realtime.gateway';
import { RealtimeService } from '../../common/realtime/realtime.service';
import { StorageService } from '../../common/storage/storage.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationSender } from '../notification/notification.sender';
import { ChatRoomService } from './chat-room.service';
import { ChatSystemMessenger } from './chat-system-messenger';
import { ErpReferenceResolver, extractErpReferences } from './erp-reference.resolver';
import { parseMentions } from './mention.parser';
import { MessagePublisher } from './message.publisher';
import { ATTACHMENT_MAX_BYTES, MessageService } from './message.service';
import { MessengerRepository } from './messenger.repository';

interface Emitted { channel: string; event: string; payload: unknown }

describe('messenger', () => {
  const prisma = new PrismaService();
  const emitted: Emitted[] = [];
  const gateway = {
    server: {
      to: (channel: string) => ({ emit: (event: string, payload: unknown) => void emitted.push({ channel, event, payload }) }),
      emit: (event: string, payload: unknown) => void emitted.push({ channel: '*', event, payload }),
    },
  } as unknown as RealtimeGateway;
  const realtime = new RealtimeService(gateway);
  const repo = new MessengerRepository();
  const links = new ErpReferenceResolver(repo);
  const publisher = new MessagePublisher(repo, links, realtime);
  const rooms = new ChatRoomService(prisma, repo, publisher, realtime, new NumberingService());
  const messages = new MessageService(prisma, repo, rooms, publisher, links, new NotificationSender(realtime), new StorageService());
  const systemMessenger = new ChatSystemMessenger(repo, publisher);

  const run = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
  const employeeIds: number[] = [];
  const salesOrderIds: number[] = [];
  const lotNos: string[] = [];
  const requisitionIds: number[] = [];
  let seq = 0;
  let departmentId: number;
  let roleId: number;

  const asUser = (e: { id: number; employeeNo: string; employeeName: string }, permissions: AuthUser['permissions'] = { ORDER_CREATE: 'VIEW' }): AuthUser => ({
    employeeId: e.id, employeeNo: e.employeeNo, employeeName: e.employeeName, roleCode: 'SALES', departmentId, departmentName: '테스트',
    jobGrade: '사원', headDepartmentIds: [], permissions,
  });

  /** 이름이 서로 겹치지 않는 테스트 사원 */
  async function newUser(name?: string, status = 'ACTIVE'): Promise<AuthUser> {
    const n = ++seq;
    const e = await prisma.employee.create({
      data: { employeeNo: `T${run}${n}`, employeeName: name ?? `시험${run}${n}`, passwordHash: 'x', departmentId, roleId, jobGrade: '사원', employeeStatus: status },
    });
    employeeIds.push(e.id);
    return asUser(e);
  }

  async function newSalesOrder(owner: AuthUser) {
    const customer = await prisma.customer.findFirstOrThrow();
    const spec = await prisma.productSpec.findFirstOrThrow();
    const so = await prisma.salesOrder.create({
      data: {
        salesOrderNo: `SO-2099${String(Math.floor(Math.random() * 1e4)).padStart(4, '0')}-${String(Math.floor(Math.random() * 1e4)).padStart(4, '0')}`,
        customerId: customer.id, dueDate: new Date('2099-12-31'), ownerEmployeeId: owner.employeeId,
        items: { create: [{ lineNo: 1, productSpecId: spec.id, orderedQty: 3, salesOrderItemStatus: 'IN_PROGRESS' }, { lineNo: 2, productSpecId: spec.id, orderedQty: 2 }] },
      },
    });
    salesOrderIds.push(so.id);
    return so;
  }

  const notificationsOf = (employeeId: number) => prisma.notification.findMany({ where: { recipientId: employeeId }, orderBy: { id: 'asc' } });
  const eventsFor = (employeeId: number, event: string) => emitted.filter((e) => e.channel === `employee:${employeeId}` && e.event === event);

  beforeAll(async () => {
    await prisma.$connect();
    departmentId = (await prisma.department.findFirstOrThrow()).id;
    roleId = (await prisma.role.findFirstOrThrow()).id;
  });

  beforeEach(() => {
    emitted.length = 0;
  });

  afterAll(async () => {
    const roomIds = (await prisma.chatRoom.findMany({
      where: { OR: [{ members: { some: { employeeId: { in: employeeIds } } } }, { createdEmployeeId: { in: employeeIds } }, { salesOrderId: { in: salesOrderIds } }] },
      select: { id: true },
    })).map((r) => r.id);
    await prisma.notification.deleteMany({ where: { recipientId: { in: employeeIds } } });
    await prisma.message.deleteMany({ where: { chatRoomId: { in: roomIds } } });
    await prisma.chatRoomMember.deleteMany({ where: { chatRoomId: { in: roomIds } } });
    await prisma.chatRoom.deleteMany({ where: { id: { in: roomIds } } });
    await prisma.lot.deleteMany({ where: { lotNo: { in: lotNos } } });
    await prisma.purchaseRequisition.deleteMany({ where: { id: { in: requisitionIds } } });
    await prisma.salesOrderItem.deleteMany({ where: { salesOrderId: { in: salesOrderIds } } });
    await prisma.salesOrder.deleteMany({ where: { id: { in: salesOrderIds } } });
    await prisma.numberSequence.deleteMany({ where: { OR: employeeIds.flatMap((id) => [{ sequenceKey: { startsWith: `CHAT-DIRECT-${id}-` } }, { sequenceKey: { endsWith: `-${id}` }, AND: { sequenceKey: { startsWith: 'CHAT-DIRECT-' } } }]) } });
    await prisma.employee.deleteMany({ where: { id: { in: employeeIds } } });
    await prisma.$disconnect();
    rmSync(storageDir, { recursive: true, force: true });
  });

  describe('방 만들기', () => {
    it('1:1 방은 두 사람 사이에 하나만 생긴다 (누가 만들어도 같은 방)', async () => {
      const [a, b] = [await newUser(), await newUser()];
      const first = await rooms.create({ chatRoomType: 'DIRECT', memberIds: [b.employeeId] }, a);
      const again = await rooms.create({ chatRoomType: 'DIRECT', memberIds: [b.employeeId, a.employeeId] }, a);
      const reverse = await rooms.create({ chatRoomType: 'DIRECT', memberIds: [a.employeeId] }, b);
      expect(again.id).toBe(first.id);
      expect(reverse.id).toBe(first.id);
      expect(first.members.map((m) => m.employeeId).sort()).toEqual([a.employeeId, b.employeeId].sort());
      expect(first.displayName).toBe(b.employeeName);
      expect(reverse.displayName).toBe(a.employeeName);
    });

    it('1:1 방을 양쪽에서 동시에 만들어도 하나만 생긴다', async () => {
      const [a, b] = [await newUser(), await newUser()];
      const created = await Promise.all([
        ...Array.from({ length: 4 }, () => rooms.create({ chatRoomType: 'DIRECT', memberIds: [b.employeeId] }, a)),
        ...Array.from({ length: 4 }, () => rooms.create({ chatRoomType: 'DIRECT', memberIds: [a.employeeId] }, b)),
      ]);
      expect(new Set(created.map((r) => r.id)).size).toBe(1);
      const count = await prisma.chatRoom.count({ where: { chatRoomType: 'DIRECT', members: { some: { employeeId: a.employeeId } } } });
      expect(count).toBe(1);
    });

    it('1:1은 상대가 정확히 한 명이어야 하고, 재직 중이 아닌 사원은 초대할 수 없다', async () => {
      const [a, b, c] = [await newUser(), await newUser(), await newUser()];
      const inactive = await newUser(undefined, 'INACTIVE');
      await expect(rooms.create({ chatRoomType: 'DIRECT', memberIds: [b.employeeId, c.employeeId] }, a)).rejects.toMatchObject({ code: 'COM-003' });
      await expect(rooms.create({ chatRoomType: 'DIRECT', memberIds: [a.employeeId] }, a)).rejects.toMatchObject({ code: 'COM-003' });
      await expect(rooms.create({ chatRoomType: 'GROUP', memberIds: [b.employeeId, inactive.employeeId] }, a)).rejects.toMatchObject({ code: 'COM-003' });
      await expect(rooms.create({ chatRoomType: 'GROUP', memberIds: [b.employeeId, 987654321] }, a)).rejects.toMatchObject({ code: 'COM-003' });
    });

    it('그룹은 만든 사람이 항상 들어가고, 멤버가 초대하고, 나갈 수 있다 (1:1은 나갈 수 없다)', async () => {
      const [a, b, c, outsider] = [await newUser(), await newUser(), await newUser(), await newUser()];
      const group = await rooms.create({ chatRoomType: 'GROUP', memberIds: [b.employeeId], chatRoomName: ' 출하 조율 ' }, a);
      expect(group.chatRoomName).toBe('출하 조율');
      expect(group.members.map((m) => m.employeeId)).toEqual(expect.arrayContaining([a.employeeId, b.employeeId]));
      expect(eventsFor(b.employeeId, 'changed')).toEqual([expect.objectContaining({ payload: { topics: ['chat-rooms'] } })]);

      await expect(rooms.addMembers(group.id, { memberIds: [c.employeeId] }, outsider)).rejects.toMatchObject({ code: 'COM-002' });
      const after = await rooms.addMembers(group.id, { memberIds: [c.employeeId, b.employeeId] }, b);
      expect(after.memberCount).toBe(3);
      expect(after.lastMessage).toMatchObject({ messageType: 'SYSTEM', senderId: null });

      await rooms.leave(group.id, b);
      await expect(rooms.detail(group.id, b)).rejects.toMatchObject({ code: 'COM-002' });
      expect((await rooms.detail(group.id, a)).memberCount).toBe(2);

      const direct = await rooms.create({ chatRoomType: 'DIRECT', memberIds: [b.employeeId] }, a);
      await expect(rooms.leave(direct.id, a)).rejects.toMatchObject({ code: 'COM-005' });
      await expect(rooms.addMembers(direct.id, { memberIds: [c.employeeId] }, a)).rejects.toMatchObject({ code: 'COM-005' });
    });
  });

  describe('업무방', () => {
    it('수주 1건에 업무방은 하나 — 여러 사람이 동시에 열어도 방은 하나이고 모두 멤버가 된다', async () => {
      const users = await Promise.all(Array.from({ length: 8 }, () => newUser()));
      const so = await newSalesOrder(users[0]);
      const opened = await Promise.all(users.map((u) => rooms.openWorkRoom(so.id, u)));
      expect(new Set(opened.map((r) => r.id)).size).toBe(1);
      expect(await prisma.chatRoom.count({ where: { salesOrderId: so.id } })).toBe(1);
      const room = await rooms.detail(opened[0].id, users[0]);
      expect(room.memberCount).toBe(8);
      expect(room.chatRoomName).toBe(`#${so.salesOrderNo}`);
      // 들어왔다는 안내가 본인에게 안 읽은 메시지로 남지 않는다
      for (const u of users) expect((await rooms.detail(room.id, u)).unreadCount).toBeLessThan(8);
      const again = await rooms.openWorkRoom(so.id, users[3]);
      expect(again.id).toBe(room.id);
      expect(again.memberCount).toBe(8);
    });

    it('수주 모듈이 먼저 만들어 둔 방을 그대로 쓰고, 상단 수주 요약을 준다', async () => {
      const [owner, viewer] = [await newUser(), await newUser()];
      const so = await newSalesOrder(owner);
      const pre = await prisma.chatRoom.create({
        data: { chatRoomType: 'WORK', chatRoomName: `#${so.salesOrderNo}`, salesOrderId: so.id, createdEmployeeId: owner.employeeId, members: { create: [{ employeeId: owner.employeeId }] } },
      });
      const viaPost = await rooms.create({ chatRoomType: 'WORK', salesOrderId: so.id }, viewer);
      expect(viaPost.id).toBe(pre.id);
      expect(viaPost.members.map((m) => m.employeeId).sort()).toEqual([owner.employeeId, viewer.employeeId].sort());
      expect(viaPost.salesOrder).toMatchObject({
        salesOrderId: so.id, salesOrderNo: so.salesOrderNo, dueDate: '2099-12-31', salesOrderStatus: 'IN_PROGRESS', linkPath: `/sales-orders/${so.id}`,
      });
      expect(viaPost.salesOrder?.items).toHaveLength(2);
      expect(viaPost.salesOrder?.items[0]).toMatchObject({ lineNo: 1, orderedQty: 3, shippedQty: 0, salesOrderItemStatus: 'IN_PROGRESS' });
      expect(viaPost.salesOrder?.items[0].weightTon).toMatch(/^\d+\.\d{3}$/);
      expect((await rooms.list(owner)).find((r) => r.id === pre.id)?.salesOrder?.salesOrderNo).toBe(so.salesOrderNo);
    });

    it('수주를 볼 권한이 없으면 업무방을 만들 수 없고, 없는 수주는 404', async () => {
      const a = await newUser();
      const so = await newSalesOrder(a);
      await expect(rooms.create({ chatRoomType: 'WORK', salesOrderId: so.id }, { ...a, permissions: { MASTER_MANAGE: 'USE' } })).rejects.toMatchObject({ code: 'COM-002' });
      await expect(rooms.create({ chatRoomType: 'WORK' }, a)).rejects.toMatchObject({ code: 'COM-003' });
      await expect(rooms.openWorkRoom(987654321, a)).rejects.toMatchObject({ code: 'COM-004' });
    });

    it('ChatSystemMessenger: 업무방이 있으면 시스템 메시지를 남기고 전달하며, 없으면 아무것도 하지 않는다', async () => {
      const [a, b] = [await newUser(), await newUser()];
      const so = await newSalesOrder(a);
      expect(await prisma.tx((tx) => systemMessenger.post(tx, { salesOrderId: so.id, content: '방 없음' }))).toBeNull();
      const room = await rooms.create({ chatRoomType: 'WORK', salesOrderId: so.id, memberIds: [b.employeeId] }, a);
      emitted.length = 0;
      const id = await prisma.tx((tx) => systemMessenger.post(tx, { salesOrderId: so.id, content: `${so.salesOrderNo} 생산계획 편성 확정` }));
      expect(id).toEqual(expect.any(Number));
      const delivered = eventsFor(b.employeeId, 'message');
      expect(delivered).toHaveLength(1);
      expect(delivered[0].payload).toMatchObject({ id, chatRoomId: room.id, senderId: null, senderName: null, messageType: 'SYSTEM', links: [{ label: so.salesOrderNo, linkPath: `/sales-orders/${so.id}` }] });
      expect((await rooms.detail(room.id, b)).unreadCount).toBe(1);
      expect(await notificationsOf(b.employeeId)).toHaveLength(0);
      // 롤백되면 메시지도 전달도 없다
      emitted.length = 0;
      await expect(prisma.tx(async (tx) => {
        await systemMessenger.post(tx, { salesOrderId: so.id, content: '롤백될 메시지' });
        throw new Error('rollback');
      })).rejects.toThrow('rollback');
      expect(emitted).toHaveLength(0);
      expect(await prisma.message.count({ where: { chatRoomId: room.id, content: '롤백될 메시지' } })).toBe(0);
    });
  });

  describe('멤버만 이용', () => {
    it('멤버가 아니면 방 조회·메시지 조회·보내기·읽음·첨부·다운로드가 모두 막힌다', async () => {
      const [a, b, outsider] = [await newUser(), await newUser(), await newUser()];
      const room = await rooms.create({ chatRoomType: 'GROUP', memberIds: [b.employeeId] }, a);
      const file = { originalname: '성적서.txt', mimetype: 'text/plain', size: 5, buffer: Buffer.from('hello') };
      const fileMessage = await messages.postFile(room.id, file, undefined, a);
      emitted.length = 0;

      const denied = { code: 'COM-002' };
      await expect(rooms.detail(room.id, outsider)).rejects.toMatchObject(denied);
      await expect(messages.list(room.id, {}, outsider)).rejects.toMatchObject(denied);
      await expect(messages.post(room.id, { content: '끼어들기' }, outsider)).rejects.toMatchObject(denied);
      await expect(messages.postFile(room.id, file, undefined, outsider)).rejects.toMatchObject(denied);
      await expect(rooms.markRead(room.id, {}, outsider)).rejects.toMatchObject(denied);
      await expect(messages.openFile(fileMessage.id, outsider)).rejects.toMatchObject(denied);
      expect((await rooms.list(outsider)).some((r) => r.id === room.id)).toBe(false);
      expect(await prisma.message.count({ where: { chatRoomId: room.id } })).toBe(1);
      expect(emitted).toHaveLength(0);

      await expect(rooms.detail(987654321, a)).rejects.toMatchObject({ code: 'COM-004' });
      await expect(messages.openFile(987654321, a)).rejects.toMatchObject({ code: 'COM-004' });
      // 멤버는 받을 수 있다
      expect(fileMessage.file).toEqual({ fileName: '성적서.txt', fileSize: 5, mimeType: 'text/plain', downloadPath: `/api/v1/messages/${fileMessage.id}/file` });
      const stream = await messages.openFile(fileMessage.id, b);
      const chunks: Buffer[] = [];
      for await (const chunk of stream.getStream()) chunks.push(chunk as Buffer);
      expect(Buffer.concat(chunks).toString()).toBe('hello');
    });

    it('메시지는 멤버 채널로만 나가고, 커밋 뒤에 나간다', async () => {
      const [a, b, outsider] = [await newUser(), await newUser(), await newUser()];
      const room = await rooms.create({ chatRoomType: 'DIRECT', memberIds: [b.employeeId] }, a);
      emitted.length = 0;
      const sent = await messages.post(room.id, { content: '  안녕하세요  ' }, a);
      expect(sent).toMatchObject({ chatRoomId: room.id, senderId: a.employeeId, senderName: a.employeeName, messageType: 'TEXT', content: '안녕하세요', file: null, links: [] });
      expect(eventsFor(b.employeeId, 'message')).toHaveLength(1);
      expect(eventsFor(a.employeeId, 'message')).toHaveLength(1);
      expect(eventsFor(outsider.employeeId, 'message')).toHaveLength(0);
      expect(eventsFor(b.employeeId, 'message')[0].payload).toMatchObject({ id: sent.id, content: '안녕하세요', createdAt: sent.createdAt.toISOString() });
      await expect(messages.post(room.id, { content: '   ' }, a)).rejects.toMatchObject({ code: 'COM-003' });
    });

    it('첨부: 실행 파일·빈 파일·용량 초과는 받지 않는다', async () => {
      const [a, b] = [await newUser(), await newUser()];
      const room = await rooms.create({ chatRoomType: 'DIRECT', memberIds: [b.employeeId] }, a);
      const base = { mimetype: 'application/octet-stream', buffer: Buffer.from('x') };
      await expect(messages.postFile(room.id, { ...base, originalname: 'setup.EXE', size: 1 }, undefined, a)).rejects.toMatchObject({ code: 'COM-003' });
      await expect(messages.postFile(room.id, { ...base, originalname: 'a.pdf', size: 0 }, undefined, a)).rejects.toMatchObject({ code: 'COM-003' });
      await expect(messages.postFile(room.id, { ...base, originalname: 'a.pdf', size: ATTACHMENT_MAX_BYTES + 1 }, undefined, a)).rejects.toMatchObject({ code: 'COM-003' });
      await expect(messages.postFile(room.id, undefined, undefined, a)).rejects.toMatchObject({ code: 'COM-003' });
      const ok = await messages.postFile(room.id, { ...base, originalname: '../../etc/검사 성적서.pdf', size: 1 }, ' 확인 부탁드립니다 ', a);
      expect(ok).toMatchObject({ messageType: 'FILE', content: '확인 부탁드립니다', file: { fileName: '검사 성적서.pdf' } });
    });
  });

  describe('읽음', () => {
    it('안 읽은 수는 내가 보내지 않은, 읽음 위치 뒤의 메시지 수이고 읽음 위치는 뒤로 가지 않는다', async () => {
      const [a, b] = [await newUser(), await newUser()];
      const room = await rooms.create({ chatRoomType: 'DIRECT', memberIds: [b.employeeId] }, a);
      const m1 = await messages.post(room.id, { content: '하나' }, a);
      const m2 = await messages.post(room.id, { content: '둘' }, a);
      const m3 = await messages.post(room.id, { content: '셋' }, a);
      await messages.post(room.id, { content: '내가 쓴 것' }, b);

      expect((await rooms.detail(room.id, b)).unreadCount).toBe(3);
      expect((await rooms.detail(room.id, a)).unreadCount).toBe(1);
      expect(await rooms.unreadCount(b)).toEqual({ totalUnreadCount: 3 });

      emitted.length = 0;
      const afterTwo = await rooms.markRead(room.id, { lastReadMessageId: m2.id }, b);
      expect(afterTwo).toEqual({ chatRoomId: room.id, lastReadMessageId: m2.id, unreadCount: 1, totalUnreadCount: 1 });
      // 본인 채널로만 읽음 이벤트
      expect(eventsFor(b.employeeId, 'chat-read')).toEqual([expect.objectContaining({ payload: afterTwo })]);
      expect(eventsFor(a.employeeId, 'chat-read')).toHaveLength(0);

      const backwards = await rooms.markRead(room.id, { lastReadMessageId: m1.id }, b);
      expect(backwards.lastReadMessageId).toBe(m2.id);
      expect(backwards.unreadCount).toBe(1);

      // 아직 없는 메시지 id를 보내도 최신 메시지까지만
      const beyond = await rooms.markRead(room.id, { lastReadMessageId: m3.id + 1_000_000 }, b);
      const latestId = (await messages.list(room.id, {}, b)).items.at(-1)?.id;
      expect(beyond).toMatchObject({ lastReadMessageId: latestId, unreadCount: 0, totalUnreadCount: 0 });

      await messages.post(room.id, { content: '넷' }, a);
      expect((await rooms.list(b)).find((r) => r.id === room.id)).toMatchObject({ unreadCount: 1, myLastReadMessageId: latestId, lastMessage: { preview: '넷', senderId: a.employeeId } });
      const all = await rooms.markRead(room.id, undefined, b);
      expect(all.unreadCount).toBe(0);
    });

    it('메시지 목록은 최신 쪽 한 페이지를 오래된 순으로 주고 beforeId로 이어 받는다', async () => {
      const [a, b] = [await newUser(), await newUser()];
      const room = await rooms.create({ chatRoomType: 'DIRECT', memberIds: [b.employeeId] }, a);
      const ids: number[] = [];
      for (let i = 1; i <= 5; i++) ids.push((await messages.post(room.id, { content: `m${i}` }, a)).id);
      const newest = await messages.list(room.id, { limit: 2 }, b);
      expect(newest.items.map((m) => m.id)).toEqual([ids[3], ids[4]]);
      expect(newest.hasMore).toBe(true);
      const older = await messages.list(room.id, { limit: 3, beforeId: ids[3] }, b);
      expect(older.items.map((m) => m.id)).toEqual([ids[0], ids[1], ids[2]]);
      expect(older.hasMore).toBe(false);
    });
  });

  describe('멘션', () => {
    it('parseMentions: 조사가 붙어도 찾고, 긴 이름을 먼저 맞춰 짧은 이름이 잘못 걸리지 않는다', () => {
      const members = [{ employeeId: 1, employeeName: '김영' }, { employeeId: 2, employeeName: '김영업' }, { employeeId: 3, employeeName: '박생산' }];
      expect(parseMentions('@김영업님 확인 부탁드립니다', members)).toEqual([2]);
      expect(parseMentions('@김영 @김영업 같이 봐 주세요', members)).toEqual([1, 2]);
      expect(parseMentions('박생산님께 전달 (골뱅이 없음), mail@test.com', members)).toEqual([]);
      expect(parseMentions('@박생산@김영업', members)).toEqual([2, 3]);
    });

    it('mentionEmployeeIds가 없으면 @이름으로 찾고, 있으면 그것을 쓰되 방 멤버만 남긴다', async () => {
      const tag = run.slice(-4);
      const [a, b, c, outsider] = [await newUser(), await newUser(`가나${tag}`), await newUser(`다라${tag}`), await newUser(`마바${tag}`)];
      const room = await rooms.create({ chatRoomType: 'GROUP', memberIds: [b.employeeId, c.employeeId] }, a);

      const parsed = await messages.post(room.id, { content: `@${b.employeeName}님 @${outsider.employeeName}님 @${a.employeeName} 확인 부탁드립니다` }, a);
      expect(parsed.mentionEmployeeIds).toEqual([b.employeeId]);
      expect(await notificationsOf(b.employeeId)).toEqual([
        expect.objectContaining({ notificationType: 'MENTION', linkPath: `/messenger?room=${room.id}`, dedupeKey: `MENTION:${parsed.id}`, isRead: false }),
      ]);
      expect(await notificationsOf(c.employeeId)).toHaveLength(0);
      expect(await notificationsOf(a.employeeId)).toHaveLength(0);
      expect(eventsFor(b.employeeId, 'notification')).toHaveLength(1);

      const explicit = await messages.post(room.id, { content: `@${b.employeeName} 말고 다른 분`, mentionEmployeeIds: [c.employeeId, outsider.employeeId, a.employeeId, c.employeeId] }, a);
      expect(explicit.mentionEmployeeIds).toEqual([c.employeeId]);
      expect(await notificationsOf(c.employeeId)).toHaveLength(1);
      expect(await notificationsOf(b.employeeId)).toHaveLength(1);
      expect(await notificationsOf(outsider.employeeId)).toHaveLength(0);

      const none = await messages.post(room.id, { content: `@${b.employeeName} 이건 멘션 아님`, mentionEmployeeIds: [] }, a);
      expect(none.mentionEmployeeIds).toEqual([]);
      expect(await notificationsOf(b.employeeId)).toHaveLength(1);
    });
  });

  describe('알림', () => {
    it('업무방 새 메시지는 보낸 사람을 빼고 알리되, 안 읽은 업무방 알림이 있는 동안은 다시 보내지 않는다', async () => {
      const [a, b, c] = [await newUser(), await newUser(), await newUser()];
      const so = await newSalesOrder(a);
      const room = await rooms.create({ chatRoomType: 'WORK', salesOrderId: so.id, memberIds: [b.employeeId, c.employeeId] }, a);
      const link = `/messenger?room=${room.id}`;

      const m1 = await messages.post(room.id, { content: '납기 확인 부탁드립니다' }, a);
      await messages.post(room.id, { content: '추가로 수량도요' }, a);
      await messages.post(room.id, { content: '그리고 규격도요' }, a);
      expect(await notificationsOf(a.employeeId)).toHaveLength(0);
      for (const u of [b, c]) {
        expect(await notificationsOf(u.employeeId)).toEqual([
          expect.objectContaining({ notificationType: 'WORK_ROOM_MESSAGE', linkPath: link, dedupeKey: `WORK_ROOM_MESSAGE:${m1.id}`, title: `#${so.salesOrderNo} 새 메시지` }),
        ]);
      }

      // b가 방을 끝까지 읽으면 그 알림은 읽음이 되고, 다음 메시지부터 다시 알림이 간다. c는 그대로 1건.
      await rooms.markRead(room.id, undefined, b);
      expect((await notificationsOf(b.employeeId)).map((n) => n.isRead)).toEqual([true]);
      const m4 = await messages.post(room.id, { content: '읽은 뒤 새 메시지' }, a);
      expect((await notificationsOf(b.employeeId)).map((n) => n.dedupeKey)).toEqual([`WORK_ROOM_MESSAGE:${m1.id}`, `WORK_ROOM_MESSAGE:${m4.id}`]);
      expect(await notificationsOf(c.employeeId)).toHaveLength(1);

      // 멘션은 안 읽은 업무방 알림이 있어도 가고, 같은 메시지로 업무방 알림을 겹쳐 받지 않는다
      const m5 = await messages.post(room.id, { content: '확인 부탁', mentionEmployeeIds: [c.employeeId] }, b);
      expect((await notificationsOf(c.employeeId)).map((n) => n.dedupeKey)).toEqual([`WORK_ROOM_MESSAGE:${m1.id}`, `MENTION:${m5.id}`]);
      // a는 처음 받는 업무방 알림
      expect((await notificationsOf(a.employeeId)).map((n) => n.dedupeKey)).toEqual([`WORK_ROOM_MESSAGE:${m5.id}`]);
    });

    it('같은 (메시지, 수신자, 종류)의 알림은 한 번만 만들어진다', async () => {
      const [a, b] = [await newUser(), await newUser()];
      const room = await rooms.create({ chatRoomType: 'GROUP', memberIds: [b.employeeId] }, a);
      const m = await messages.post(room.id, { content: '멘션', mentionEmployeeIds: [b.employeeId] }, a);
      const sender = new NotificationSender(realtime);
      // 같은 이벤트를 다시 보내도(재시도 등) 늘지 않는다
      await prisma.tx((tx) => sender.toEmployees(tx, [b.employeeId], { notificationType: 'MENTION', title: '다시', linkPath: `/messenger?room=${room.id}`, dedupeKey: `MENTION:${m.id}` }));
      expect(await notificationsOf(b.employeeId)).toHaveLength(1);
      // 일반 그룹·1:1의 멘션 없는 메시지는 알림을 만들지 않는다 (안 읽은 수 배지로만)
      await messages.post(room.id, { content: '그냥 메시지' }, a);
      expect(await notificationsOf(b.employeeId)).toHaveLength(1);
    });
  });

  describe('ERP 참조 링크', () => {
    it('extractErpReferences: 번호 모양을 나온 순서대로 뽑는다', () => {
      const found = extractErpReferences('SO-20260930-0001 건, 슬래브 HT-1-260921-001-01번과 코일 C1-260921-001-01, 원료 RM-IO-260918-001, 용선 HM-1-260921-01, PR-20260930-0002. SO-20260930-0001 다시');
      expect(found.map((f) => [f.kind, f.numbers[0]])).toEqual([
        ['SALES_ORDER', 'SO-20260930-0001'], ['LOT', 'HT-1-260921-001-01'], ['LOT', 'C1-260921-001-01'], ['LOT', 'RM-IO-260918-001'],
        ['LOT', 'HM-1-260921-01'], ['PURCHASE_REQUISITION', 'PR-20260930-0002'],
      ]);
      expect(extractErpReferences('XSO-20260930-0001, SO-2026-1, PC1-2-3, HT-1, 그냥 글')).toEqual([]);
    });

    it('실제로 있는 번호만 링크가 된다', async () => {
      const [a, b] = [await newUser(), await newUser()];
      const so = await newSalesOrder(a);
      const d = String(Math.floor(Math.random() * 1e6)).padStart(6, '0');
      const heatNo = `HT-9-${d}-001`;
      const lots = [heatNo, `${heatNo}-01`, `C9-${d}-001-01`, `RM-ZZ-${d}-001`, `HM-9-${d}-01`];
      lotNos.push(...lots);
      await prisma.lot.createMany({ data: [
        { lotNo: lots[0], lotType: 'HEAT' }, { lotNo: lots[1], lotType: 'SLAB' }, { lotNo: lots[2], lotType: 'COIL' },
        { lotNo: lots[3], lotType: 'RAW_MATERIAL' }, { lotNo: lots[4], lotType: 'HOT_METAL' },
      ] });
      const pr = await prisma.purchaseRequisition.create({ data: { purchaseRequisitionNo: `PR-2099${d.slice(0, 4)}-${d.slice(2)}`.slice(0, 16), requesterId: a.employeeId, departmentId } });
      requisitionIds.push(pr.id);

      const room = await rooms.create({ chatRoomType: 'DIRECT', memberIds: [b.employeeId] }, a);
      const content = `${so.salesOrderNo} 건입니다. 슬래브 ${lots[1]}번, 코일 ${lots[2]}, 히트 ${heatNo}, 원료 ${lots[3]}, 용선 ${lots[4]}, 구매요청 ${pr.purchaseRequisitionNo}. `
        + `없는 번호: SO-20010101-9999, ${heatNo}-99, PR-20010101-9999, RM-NOPE-000000-001`;
      const sent = await messages.post(room.id, { content }, a);
      expect(sent.links).toEqual([
        { label: so.salesOrderNo, linkPath: `/sales-orders/${so.id}` },
        { label: lots[1], linkPath: `/lots/trace?lot=${lots[1]}` },
        { label: lots[2], linkPath: `/lots/trace?lot=${lots[2]}` },
        { label: heatNo, linkPath: `/lots/trace?lot=${heatNo}` },
        { label: lots[3], linkPath: `/lots/trace?lot=${lots[3]}` },
        { label: lots[4], linkPath: `/lots/trace?lot=${lots[4]}` },
        { label: pr.purchaseRequisitionNo, linkPath: `/purchase-requisitions/${pr.id}` },
      ]);
      // 목록 조회와 소켓 전달에도 같은 링크가 실린다
      expect((await messages.list(room.id, {}, b)).items.at(-1)?.links).toEqual(sent.links);
      expect(eventsFor(b.employeeId, 'message').at(-1)?.payload).toMatchObject({ links: sent.links });
    });
  });
});
