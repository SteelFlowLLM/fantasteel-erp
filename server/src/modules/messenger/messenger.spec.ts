// 메신저: 채팅방 만들기·목록·상세, 메시지 목록·보내기, 첨부, 읽음, 멘션·업무방 알림, 소켓 발송을 실제 앱과 DB(fs_collab)로 확인한다.
// 방 멤버 확인·업무방 권한까지 보려고 HTTP로 부른다. 사원은 시드(seed.md), 수주는 테스트에서 직접 만든다.
// 소켓은 게이트웨이의 발송 함수를 기록용으로 바꿔 "커밋 뒤 누구에게 무엇을 보냈는지"를 본다.
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MESSAGE_ATTACHMENT_MAX_BYTES,
  MESSAGE_TYPE,
  NOTIFICATION_TYPE,
  type ChatMessagePage,
  type ChatMessageView,
  type ChatRoomDetail,
  type ChatRoomListItem,
  type ChatRoomReadResult,
  type CreateChatRoomResult,
} from '@fantasteel/shared';
import type { AuthUser } from '@fantasteel/shared';
import { AppModule } from '../../app.module';
import { BusinessEventRecorder } from '../../common/business-event/business-event.recorder';
import { PrismaService } from '../../prisma/prisma.service';
import type { Socket } from 'socket.io';
import { MessengerGateway } from './messenger.gateway';

interface SocketRecord {
  event: 'message:new' | 'message:updated' | 'room:read' | 'room:updated' | 'member:read';
  employeeId: number;
  payload: unknown;
}

let app: INestApplication;
let baseUrl: string;
let prisma: PrismaService;
/** 박서영 (영업) */
let salesCookie: string;
/** 정다은 (구매, 수주 조회 권한 없음) */
let purchaseCookie: string;
/** 서민지 (품질) */
let qualityCookie: string;
let salesId: number;
let purchaseId: number;
let qualityId: number;
let logisticsId: number;
/** 임재원 (생산). 알림 테스트용: 권예진은 task.spec이 알림 0건을 가정한다 */
let productionId: number;
let storageDir: string;
const originalStorage = process.env.STORAGE_DIR;
const socketRecords: SocketRecord[] = [];

async function login(employeeNo: string, password = process.env.SEED_PASSWORD ?? 'fantasteel'): Promise<string> {
  const res = await fetch(`${baseUrl}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ employeeNo, password }) });
  if (!res.ok) throw new Error(`로그인 실패 (HTTP ${res.status})`);
  return (res.headers.get('set-cookie') ?? '').split(';')[0];
}

async function call<T>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, cookie: string, body?: unknown) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body === undefined ? { cookie } : { cookie, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as { success: boolean; data: T; error?: { code: string; message: string } } };
}

const employeeIdOf = async (employeeNo: string) => (await prisma.employee.findUniqueOrThrow({ where: { employeeNo } })).id;

async function createRoom(cookie: string, body: Record<string, unknown>) {
  const res = await call<CreateChatRoomResult>('POST', '/chat-rooms', cookie, body);
  expect(res.status).toBe(201);
  return res.body.data;
}

const send = (cookie: string, chatRoomId: number, content: string) => call<ChatMessageView>('POST', `/chat-rooms/${chatRoomId}/messages`, cookie, { content });

async function createSalesOrder(salesOrderNo: string) {
  const customer = await prisma.customer.findFirstOrThrow({ orderBy: { id: 'asc' } });
  const item = await prisma.item.findFirstOrThrow({ where: { itemType: 'SLAB' }, orderBy: { id: 'asc' } });
  return prisma.salesOrder.create({
    data: {
      salesOrderNo,
      customerId: customer.id,
      ownerEmployeeId: salesId,
      salesOrderItems: {
        create: [
          { itemId: item.id, orderedQty: 3, dueDate: new Date('2026-11-20T00:00:00Z') },
          { itemId: item.id, orderedQty: 1, dueDate: new Date('2026-11-05T00:00:00Z'), salesOrderItemStatus: 'CANCELLED' },
        ],
      },
    },
  });
}

beforeAll(async () => {
  storageDir = await mkdtemp(join(tmpdir(), 'fs-messenger-'));
  process.env.STORAGE_DIR = storageDir;
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(0);
  baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1`;
  prisma = app.get(PrismaService);
  salesCookie = await login('2103003');
  purchaseCookie = await login('2207005');
  qualityCookie = await login('2205013');
  salesId = await employeeIdOf('2103003');
  purchaseId = await employeeIdOf('2207005');
  qualityId = await employeeIdOf('2205013');
  logisticsId = await employeeIdOf('2304015');
  productionId = await employeeIdOf('1906009');

  const gateway = app.get(MessengerGateway);
  gateway.emitMessage = (memberIds, toView) => {
    for (const employeeId of memberIds) socketRecords.push({ event: 'message:new', employeeId, payload: toView(employeeId) });
  };
  gateway.emitRead = (employeeId, payload) => socketRecords.push({ event: 'room:read', employeeId, payload });
  gateway.emitMessageUpdated = (memberIds, toView) => {
    for (const employeeId of memberIds) socketRecords.push({ event: 'message:updated', employeeId, payload: toView(employeeId) });
  };
  gateway.emitMemberRead = (memberIds, payload) => {
    for (const employeeId of memberIds) socketRecords.push({ event: 'member:read', employeeId, payload });
  };
  gateway.emitRoomUpdated = (memberIds, payload) => {
    for (const employeeId of memberIds) socketRecords.push({ event: 'room:updated', employeeId, payload });
  };
}, 60_000);

afterAll(async () => {
  await app?.close();
  await rm(storageDir, { recursive: true, force: true });
  if (originalStorage === undefined) delete process.env.STORAGE_DIR;
  else process.env.STORAGE_DIR = originalStorage;
});

beforeEach(() => {
  socketRecords.length = 0;
});

const recordsOf = (event: SocketRecord['event']) => socketRecords.filter((r) => r.event === event);

async function upload(cookie: string, chatRoomId: number, fileName: string, content: Uint8Array, text?: string) {
  const form = new FormData();
  form.append('file', new Blob([content]), fileName);
  if (text !== undefined) form.append('content', text);
  const res = await fetch(`${baseUrl}/chat-rooms/${chatRoomId}/attachments`, { method: 'POST', headers: { cookie }, body: form });
  return { status: res.status, body: (await res.json()) as { success: boolean; data: ChatMessageView; error?: { code: string; message: string } } };
}

describe('채팅방 만들기', () => {
  it('같은 상대와의 1:1 방은 어느 쪽이 만들어도 같은 방을 돌려준다', async () => {
    const first = await createRoom(salesCookie, { chatRoomType: 'DIRECT', memberIds: [purchaseId] });
    const again = await createRoom(purchaseCookie, { chatRoomType: 'DIRECT', memberIds: [salesId] });
    expect(first.reused).toBe(false);
    expect(again).toEqual({ id: first.id, reused: true });
    expect(await prisma.chatRoomMember.count({ where: { chatRoomId: first.id } })).toBe(2);
  });

  it('1:1은 상대 1명, 그룹은 1명 이상이어야 한다 (나 자신은 빼고 센다)', async () => {
    const direct = await call('POST', '/chat-rooms', salesCookie, { chatRoomType: 'DIRECT', memberIds: [purchaseId, qualityId] });
    const group = await call('POST', '/chat-rooms', salesCookie, { chatRoomType: 'GROUP', memberIds: [salesId] });
    expect([direct.status, direct.body.error?.code]).toEqual([400, 'COM-004']);
    expect([group.status, group.body.error?.code]).toEqual([400, 'COM-004']);
  });

  it('없는 사원은 COM-003, 사용 중이 아닌 사원은 COM-004', async () => {
    const base = await prisma.employee.findUniqueOrThrow({ where: { id: qualityId } });
    const retired = await prisma.employee.create({
      data: { employeeNo: '9910001', employeeName: '퇴사자', passwordHash: base.passwordHash, departmentId: base.departmentId, jobGradeId: base.jobGradeId, roleId: base.roleId, isActive: false },
    });
    const missing = await call('POST', '/chat-rooms', salesCookie, { chatRoomType: 'GROUP', memberIds: [999_999] });
    const inactive = await call('POST', '/chat-rooms', salesCookie, { chatRoomType: 'GROUP', memberIds: [retired.id] });
    expect([missing.status, missing.body.error?.code]).toEqual([404, 'COM-003']);
    expect([inactive.status, inactive.body.error?.code]).toEqual([400, 'COM-004']);
  });
});

describe('방 멤버만 본다', () => {
  it('멤버가 아니면 상세·메시지 목록·보내기가 COM-002, 없는 방은 COM-003', async () => {
    const room = await createRoom(salesCookie, { chatRoomType: 'GROUP', memberIds: [purchaseId], chatRoomName: '구매 협의' });
    const detail = await call('GET', `/chat-rooms/${room.id}`, qualityCookie);
    const messages = await call('GET', `/chat-rooms/${room.id}/messages`, qualityCookie);
    const sent = await send(qualityCookie, room.id, '끼어들기');
    const missing = await call('GET', '/chat-rooms/999999', salesCookie);
    expect([detail.status, messages.status, sent.status, missing.status]).toEqual([403, 403, 403, 404]);
    expect(detail.body.error?.code).toBe('COM-002');
    expect(missing.body.error?.code).toBe('COM-003');
  });
});

describe('메시지와 안 읽은 수', () => {
  it('보낸 사람은 0, 받는 사람은 받은 수만큼 안 읽음이고, 목록은 최근 대화 방이 위에 온다', async () => {
    const quiet = await createRoom(qualityCookie, { chatRoomType: 'GROUP', memberIds: [logisticsId], chatRoomName: '조용한 방' });
    const room = await createRoom(qualityCookie, { chatRoomType: 'GROUP', memberIds: [logisticsId, purchaseId], chatRoomName: '품질 공유' });
    await send(qualityCookie, room.id, '검사 결과 공유해요');
    const second = await send(qualityCookie, room.id, '  내일   확인 부탁해요  ');
    expect(second.status).toBe(201);
    expect(second.body.data).toMatchObject({ content: '내일   확인 부탁해요', isMine: true, senderName: '서민지' });

    const mine = await call<ChatRoomListItem[]>('GET', '/chat-rooms', qualityCookie);
    const theirs = await call<ChatRoomListItem[]>('GET', '/chat-rooms', purchaseCookie);
    const myRoom = mine.body.data.find((r) => r.id === room.id);
    const theirRoom = theirs.body.data.find((r) => r.id === room.id);
    expect(myRoom).toMatchObject({ unreadCount: 0, memberCount: 3, displayName: '품질 공유', lastMessage: { isMine: true, preview: '내일 확인 부탁해요' } });
    expect(theirRoom).toMatchObject({ unreadCount: 2, lastMessage: { isMine: false, senderName: '서민지' } });
    const order = mine.body.data.map((r) => r.id);
    expect(order.indexOf(room.id)).toBeLessThan(order.indexOf(quiet.id));

    const detail = await call<ChatRoomDetail>('GET', `/chat-rooms/${room.id}`, purchaseCookie);
    expect(detail.body.data).toMatchObject({ unreadCount: 2, lastReadMessageId: null, salesOrderState: 'none' });
    expect(detail.body.data.members[0]).toMatchObject({ id: purchaseId, isMe: true });
  });

  it('빈 메시지는 COM-004', async () => {
    const room = await createRoom(salesCookie, { chatRoomType: 'GROUP', memberIds: [qualityId] });
    const blank = await send(salesCookie, room.id, '   ');
    expect([blank.status, blank.body.error?.code]).toEqual([400, 'COM-004']);
  });

  it('최근 메시지부터 limit개를 오래된 순으로 주고, before로 이전 메시지를 더 불러온다', async () => {
    const room = await createRoom(salesCookie, { chatRoomType: 'GROUP', memberIds: [logisticsId], chatRoomName: '페이지' });
    for (const n of [1, 2, 3, 4, 5]) await send(salesCookie, room.id, `메시지 ${n}`);
    const latest = await call<ChatMessagePage>('GET', `/chat-rooms/${room.id}/messages?limit=2`, salesCookie);
    expect(latest.body.data.items.map((m) => m.content)).toEqual(['메시지 4', '메시지 5']);
    expect(latest.body.data.hasMore).toBe(true);
    const older = await call<ChatMessagePage>('GET', `/chat-rooms/${room.id}/messages?limit=3&before=${latest.body.data.items[0].id}`, salesCookie);
    expect(older.body.data.items.map((m) => m.content)).toEqual(['메시지 1', '메시지 2', '메시지 3']);
    expect(older.body.data.hasMore).toBe(false);
  });
});

describe('업무방', () => {
  it('수주 조회 권한이 없으면 열 수 없고, 수주가 없으면 COM-003', async () => {
    const salesOrder = await createSalesOrder('SO-2610-901');
    const denied = await call('POST', '/chat-rooms', purchaseCookie, { chatRoomType: 'WORK', memberIds: [], salesOrderId: salesOrder.id });
    const missing = await call('POST', '/chat-rooms', salesCookie, { chatRoomType: 'WORK', memberIds: [], salesOrderId: 999_999 });
    const noSalesOrder = await call('POST', '/chat-rooms', salesCookie, { chatRoomType: 'WORK', memberIds: [] });
    expect([denied.status, denied.body.error?.code]).toEqual([403, 'COM-002']);
    expect([missing.status, missing.body.error?.code]).toEqual([404, 'COM-003']);
    expect([noSalesOrder.status, noSalesOrder.body.error?.code]).toEqual([400, 'COM-004']);
  });

  it('수주당 1개: 다시 열면 같은 방에 새 멤버만 더하고, 상단 수주 요약은 조회 권한이 있는 멤버에게만 보인다', async () => {
    const salesOrder = await createSalesOrder('SO-2610-902');
    // 업무방 메시지는 멤버에게 알림을 만든다. 권예진(물류)은 task.spec이 알림 0건을 가정해서 생산 사원을 쓴다
    const first = await createRoom(salesCookie, { chatRoomType: 'WORK', memberIds: [productionId], salesOrderId: salesOrder.id });
    await send(salesCookie, first.id, '출하 일정 맞춰 주세요');
    const again = await createRoom(salesCookie, { chatRoomType: 'WORK', memberIds: [productionId, purchaseId], salesOrderId: salesOrder.id });
    expect(again).toEqual({ id: first.id, reused: true });
    expect(await prisma.chatRoomMember.count({ where: { chatRoomId: first.id } })).toBe(3);

    const sales = await call<ChatRoomDetail>('GET', `/chat-rooms/${first.id}`, salesCookie);
    expect(sales.body.data).toMatchObject({
      displayName: expect.stringContaining('SO-2610-902'),
      salesOrderState: 'ok',
      salesOrder: { salesOrderNo: 'SO-2610-902', dueDate: '2026-11-20', linkPath: `/sales-orders/${salesOrder.id}` },
    });
    expect(sales.body.data.salesOrder?.items).toHaveLength(2);

    // 나중에 들어온 멤버는 이전 메시지를 읽은 것으로 시작하고, 수주 조회 권한이 없어 요약을 못 본다
    const purchase = await call<ChatRoomDetail>('GET', `/chat-rooms/${first.id}`, purchaseCookie);
    expect(purchase.body.data).toMatchObject({ salesOrderState: 'denied', salesOrder: null, unreadCount: 0 });
    const purchaseList = await call<ChatRoomListItem[]>('GET', '/chat-rooms', purchaseCookie);
    expect(purchaseList.body.data.find((r) => r.id === first.id)?.salesOrder).toBeNull();
  });
});

describe('읽음 위치', () => {
  it('앞으로만 옮기고 남은 안 읽은 수를 돌려주며, 내 다른 화면에 room:read를 보낸다', async () => {
    const room = await createRoom(salesCookie, { chatRoomType: 'GROUP', memberIds: [qualityId], chatRoomName: '읽음' });
    const first = (await send(salesCookie, room.id, '하나')).body.data;
    const second = (await send(salesCookie, room.id, '둘')).body.data;
    socketRecords.length = 0;

    const read = await call<ChatRoomReadResult>('POST', `/chat-rooms/${room.id}/read`, qualityCookie, { lastMessageId: second.id });
    expect(read.status).toBe(200);
    expect(read.body.data).toEqual({ chatRoomId: room.id, lastReadMessageId: second.id, unreadCount: 0 });
    expect(recordsOf('room:read')).toEqual([{ event: 'room:read', employeeId: qualityId, payload: read.body.data }]);

    const back = await call<ChatRoomReadResult>('POST', `/chat-rooms/${room.id}/read`, qualityCookie, { lastMessageId: first.id });
    expect(back.body.data.lastReadMessageId).toBe(second.id);
  });

  it('다른 방의 메시지 id면 COM-003, 멤버가 아니면 COM-002', async () => {
    const room = await createRoom(salesCookie, { chatRoomType: 'GROUP', memberIds: [qualityId] });
    const other = await createRoom(salesCookie, { chatRoomType: 'GROUP', memberIds: [purchaseId] });
    const otherMessage = (await send(salesCookie, other.id, '다른 방')).body.data;
    const wrongRoom = await call('POST', `/chat-rooms/${room.id}/read`, qualityCookie, { lastMessageId: otherMessage.id });
    const notMember = await call('POST', `/chat-rooms/${other.id}/read`, qualityCookie, { lastMessageId: otherMessage.id });
    expect([wrongRoom.status, wrongRoom.body.error?.code]).toEqual([404, 'COM-003']);
    expect([notMember.status, notMember.body.error?.code]).toEqual([403, 'COM-002']);
  });
});

describe('실시간 발송 (커밋 뒤)', () => {
  it('새 메시지는 멤버마다 isMine을 맞춰 보내고, 저장에 실패하면 보내지 않는다', async () => {
    const room = await createRoom(salesCookie, { chatRoomType: 'GROUP', memberIds: [qualityId, logisticsId] });
    expect(recordsOf('room:updated').map((r) => r.employeeId).sort()).toEqual([salesId, qualityId, logisticsId].sort());
    socketRecords.length = 0;

    const sent = (await send(salesCookie, room.id, '실시간')).body.data;
    const delivered = recordsOf('message:new');
    expect(delivered.map((r) => r.employeeId).sort()).toEqual([salesId, qualityId, logisticsId].sort());
    expect(delivered.find((r) => r.employeeId === salesId)?.payload).toMatchObject({ id: sent.id, isMine: true });
    expect(delivered.find((r) => r.employeeId === qualityId)?.payload).toMatchObject({ id: sent.id, isMine: false });

    socketRecords.length = 0;
    await send(purchaseCookie, room.id, '멤버 아님');
    expect(socketRecords).toEqual([]);
  });

  it('이미 있는 1:1 방을 다시 열면 room:updated를 보내지 않는다', async () => {
    await createRoom(qualityCookie, { chatRoomType: 'DIRECT', memberIds: [logisticsId] });
    socketRecords.length = 0;
    const again = await createRoom(qualityCookie, { chatRoomType: 'DIRECT', memberIds: [logisticsId] });
    expect(again.reused).toBe(true);
    expect(recordsOf('room:updated')).toEqual([]);
  });
});

describe('멘션·업무방 알림', () => {
  const notificationsOf = (messageId: number) => prisma.notification.findMany({ where: { messageId }, orderBy: { recipientId: 'asc' } });

  it('업무방: 멘션된 멤버는 MENTION 1건, 나머지 멤버는 WORK_ROOM_MESSAGE, 보낸 사람은 받지 않는다', async () => {
    const salesOrder = await createSalesOrder('SO-2610-903');
    const room = await createRoom(salesCookie, { chatRoomType: 'WORK', memberIds: [productionId, qualityId], salesOrderId: salesOrder.id });
    const sent = await call<ChatMessageView>('POST', `/chat-rooms/${room.id}/messages`, salesCookie, { content: '@임재원 출하 확인 부탁해요', mentionedEmployeeIds: [productionId, productionId] });
    expect(sent.status).toBe(201);
    const rows = await notificationsOf(sent.body.data.id);
    expect(rows.map((r) => [r.recipientId, r.notificationType]).sort()).toEqual(
      [
        [productionId, NOTIFICATION_TYPE.MENTION],
        [qualityId, NOTIFICATION_TYPE.WORK_ROOM_MESSAGE],
      ].sort(),
    );
    expect(rows.find((r) => r.recipientId === productionId)).toMatchObject({
      notificationContent: expect.stringMatching(/^박서영님이 멘션했어요 · SO-2610-903 .+ · @임재원 출하 확인 부탁해요$/),
      linkPath: `/messenger?room=${room.id}&message=${sent.body.data.id}`,
    });
  });

  it('그룹방: 멘션만 알리고, 방 멤버가 아닌 사원·나 자신 멘션은 무시한다', async () => {
    const room = await createRoom(salesCookie, { chatRoomType: 'GROUP', memberIds: [qualityId, productionId], chatRoomName: '멘션방' });
    const sent = await call<ChatMessageView>('POST', `/chat-rooms/${room.id}/messages`, salesCookie, { content: '확인', mentionedEmployeeIds: [qualityId, purchaseId, salesId] });
    const rows = await notificationsOf(sent.body.data.id);
    expect(rows.map((r) => [r.recipientId, r.notificationType])).toEqual([[qualityId, NOTIFICATION_TYPE.MENTION]]);
    expect(rows[0].notificationContent).toBe('박서영님이 멘션했어요 · 멘션방 · 확인');
  });
});

describe('첨부', () => {
  it('업로드하면 메시지 1건이 생기고(한글 이름 유지), 멤버만 같은 내용을 내려받는다', async () => {
    const room = await createRoom(salesCookie, { chatRoomType: 'GROUP', memberIds: [qualityId] });
    const bytes = new TextEncoder().encode('밀시트 확인용 파일');
    const sent = await upload(salesCookie, room.id, '검사 성적서.txt', bytes, '첨부해요');
    expect(sent.status).toBe(201);
    expect(sent.body.data).toMatchObject({ attachmentName: '검사 성적서.txt', content: '첨부해요', isMine: true });
    expect(recordsOf('message:new')).toHaveLength(2);

    const res = await fetch(`${baseUrl}/attachments/${sent.body.data.id}`, { headers: { cookie: qualityCookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toContain(encodeURIComponent('검사 성적서.txt'));
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);

    const outsider = await fetch(`${baseUrl}/attachments/${sent.body.data.id}`, { headers: { cookie: purchaseCookie } });
    expect(outsider.status).toBe(403);
    const list = await call<ChatRoomListItem[]>('GET', '/chat-rooms', qualityCookie);
    expect(list.body.data.find((r) => r.id === room.id)?.lastMessage?.preview).toBe('첨부해요');
  });

  it('파일만 보내면 목록 미리보기는 "파일 · 이름", 글만 있는 메시지의 첨부 내려받기는 COM-003', async () => {
    const room = await createRoom(salesCookie, { chatRoomType: 'GROUP', memberIds: [logisticsId] });
    await upload(salesCookie, room.id, 'plan.pdf', new Uint8Array([1, 2, 3]));
    const list = await call<ChatRoomListItem[]>('GET', '/chat-rooms', salesCookie);
    expect(list.body.data.find((r) => r.id === room.id)?.lastMessage?.preview).toBe('파일 · plan.pdf');
    const text = (await send(salesCookie, room.id, '글만')).body.data;
    const res = await call('GET', `/attachments/${text.id}`, salesCookie);
    expect([res.status, res.body.error?.code]).toEqual([404, 'COM-003']);
  });

  it('실행 파일·파일 없음·용량 초과는 COM-004이고, 멤버가 아니면 저장하지 않고 COM-002', async () => {
    const room = await createRoom(salesCookie, { chatRoomType: 'GROUP', memberIds: [logisticsId] });
    const exe = await upload(salesCookie, room.id, 'setup.EXE', new Uint8Array([1]));
    expect([exe.status, exe.body.error?.code]).toEqual([400, 'COM-004']);

    const noFile = await fetch(`${baseUrl}/chat-rooms/${room.id}/attachments`, { method: 'POST', headers: { cookie: salesCookie }, body: new FormData() });
    expect(noFile.status).toBe(400);

    const big = await upload(salesCookie, room.id, 'big.bin', new Uint8Array(MESSAGE_ATTACHMENT_MAX_BYTES + 1));
    expect([big.status, big.body.error?.code]).toEqual([413, 'COM-004']);

    const outsider = await upload(qualityCookie, room.id, 'note.txt', new Uint8Array([1]));
    expect([outsider.status, outsider.body.error?.code]).toEqual([403, 'COM-002']);
    expect(await prisma.message.count({ where: { chatRoomId: room.id } })).toBe(0);
  });
});

describe('방 관리', () => {
  it('멤버 초대: 새 멤버만 더하고(이전 메시지는 읽은 것으로 시작), 기존·새 멤버 모두에게 room:updated를 보낸다', async () => {
    const room = await createRoom(salesCookie, { chatRoomType: 'GROUP', memberIds: [qualityId], chatRoomName: '초대' });
    await send(salesCookie, room.id, '초대 전 메시지');
    socketRecords.length = 0;

    const invited = await call<{ chatRoomId: number; addedCount: number }>('POST', `/chat-rooms/${room.id}/members`, qualityCookie, { memberIds: [salesId, logisticsId, logisticsId] });
    expect(invited.status).toBe(201);
    expect(invited.body.data).toEqual({ chatRoomId: room.id, addedCount: 1 });
    expect(recordsOf('room:updated').map((r) => r.employeeId).sort()).toEqual([salesId, qualityId, logisticsId].sort());

    const logistics = await login('2304015');
    const detail = await call<ChatRoomDetail>('GET', `/chat-rooms/${room.id}`, logistics);
    expect(detail.body.data).toMatchObject({ unreadCount: 0 });
    const history = await call<ChatMessagePage>('GET', `/chat-rooms/${room.id}/messages`, logistics);
    expect(history.body.data.items.map((m) => [m.content, m.isSystem])).toEqual([
      ['초대 전 메시지', false],
      ['서민지님이 권예진님을 초대했어요', true],
    ]);
  });

  it('1:1 방·새 멤버 없음·퇴사자는 COM-004, 멤버가 아니면 COM-002', async () => {
    const direct = await createRoom(salesCookie, { chatRoomType: 'DIRECT', memberIds: [productionId] });
    const group = await createRoom(salesCookie, { chatRoomType: 'GROUP', memberIds: [qualityId] });
    const retired = await prisma.employee.findUniqueOrThrow({ where: { employeeNo: '9910001' } });
    const cases = await Promise.all([
      call('POST', `/chat-rooms/${direct.id}/members`, salesCookie, { memberIds: [qualityId] }),
      call('POST', `/chat-rooms/${group.id}/members`, salesCookie, { memberIds: [qualityId] }),
      call('POST', `/chat-rooms/${group.id}/members`, salesCookie, { memberIds: [retired.id] }),
      call('POST', `/chat-rooms/${group.id}/members`, purchaseCookie, { memberIds: [purchaseId] }),
    ]);
    expect(cases.map((c) => [c.status, c.body.error?.code])).toEqual([
      [400, 'COM-004'],
      [400, 'COM-004'],
      [400, 'COM-004'],
      [403, 'COM-002'],
    ]);
  });

  it('그룹방 이름 바꾸기: 비우면 멤버 이름으로 보이고, 1:1·업무방은 COM-004', async () => {
    const group = await createRoom(salesCookie, { chatRoomType: 'GROUP', memberIds: [qualityId], chatRoomName: '옛 이름' });
    socketRecords.length = 0;
    const renamed = await call<{ chatRoomName: string | null; displayName: string }>('PATCH', `/chat-rooms/${group.id}`, qualityCookie, { chatRoomName: '  새 이름  ' });
    expect(renamed.body.data).toMatchObject({ chatRoomName: '새 이름', displayName: '새 이름' });
    expect(recordsOf('room:updated')).toHaveLength(2);
    const cleared = await call<{ chatRoomName: string | null; displayName: string }>('PATCH', `/chat-rooms/${group.id}`, salesCookie, { chatRoomName: '' });
    expect(cleared.body.data).toEqual({ id: group.id, chatRoomName: null, displayName: '서민지' });

    const direct = await createRoom(salesCookie, { chatRoomType: 'DIRECT', memberIds: [qualityId] });
    const directRename = await call('PATCH', `/chat-rooms/${direct.id}`, salesCookie, { chatRoomName: '안 됨' });
    expect([directRename.status, directRename.body.error?.code]).toEqual([400, 'COM-004']);
  });
});

describe('편의: 안 읽은 사람 수 · 파일 모아보기 · 검색', () => {
  it('메시지마다 아직 안 읽은 멤버 수(보낸 사람 제외)를 붙이고, 누가 읽으면 다른 멤버에게 member:read를 보낸다', async () => {
    const room = await createRoom(salesCookie, { chatRoomType: 'GROUP', memberIds: [qualityId, purchaseId] });
    const first = (await send(salesCookie, room.id, '첫째')).body.data;
    const second = (await send(salesCookie, room.id, '둘째')).body.data;
    expect(second.unreadMemberCount).toBe(2);
    socketRecords.length = 0;

    await call('POST', `/chat-rooms/${room.id}/read`, qualityCookie, { lastMessageId: first.id });
    expect(recordsOf('member:read').map((r) => r.employeeId).sort()).toEqual([salesId, purchaseId].sort());
    expect(recordsOf('member:read')[0].payload).toEqual({ chatRoomId: room.id, employeeId: qualityId, lastReadMessageId: first.id });

    const page = await call<ChatMessagePage>('GET', `/chat-rooms/${room.id}/messages`, salesCookie);
    expect(page.body.data.items.map((m) => [m.content, m.unreadMemberCount])).toEqual([
      ['첫째', 1],
      ['둘째', 2],
    ]);
  });

  it('파일 모아보기는 첨부가 있는 메시지만 최신순, before로 더 보고, 멤버가 아니면 COM-002', async () => {
    const room = await createRoom(salesCookie, { chatRoomType: 'GROUP', memberIds: [qualityId] });
    await upload(salesCookie, room.id, 'a.pdf', new Uint8Array([1]));
    await send(salesCookie, room.id, '글만');
    await upload(qualityCookie, room.id, 'b.xlsx', new Uint8Array([2]));
    const files = await call<ChatMessagePage>('GET', `/chat-rooms/${room.id}/attachments?limit=1`, salesCookie);
    expect(files.body.data.items.map((m) => m.attachmentName)).toEqual(['b.xlsx']);
    expect(files.body.data.hasMore).toBe(true);
    const older = await call<ChatMessagePage>('GET', `/chat-rooms/${room.id}/attachments?before=${files.body.data.items[0].id}`, salesCookie);
    expect(older.body.data).toMatchObject({ items: [expect.objectContaining({ attachmentName: 'a.pdf' })], hasMore: false });
    const outsider = await call('GET', `/chat-rooms/${room.id}/attachments`, purchaseCookie);
    expect(outsider.status).toBe(403);
  });

  it('검색은 이 방 본문에서 대소문자 없이 찾아 최신순으로, 빈 검색어는 COM-004', async () => {
    const room = await createRoom(salesCookie, { chatRoomType: 'GROUP', memberIds: [qualityId] });
    const other = await createRoom(salesCookie, { chatRoomType: 'GROUP', memberIds: [purchaseId] });
    await send(salesCookie, room.id, 'SO-2610-001 출하 확인');
    await send(qualityCookie, room.id, '검사 끝났어요');
    await send(salesCookie, room.id, 'so-2610-001 납기 변경');
    await send(salesCookie, other.id, 'SO-2610-001 다른 방');
    const found = await call<ChatMessagePage>('GET', `/chat-rooms/${room.id}/messages/search?q=${encodeURIComponent('So-2610')}`, qualityCookie);
    expect(found.body.data.items.map((m) => m.content)).toEqual(['so-2610-001 납기 변경', 'SO-2610-001 출하 확인']);
    const blank = await call('GET', `/chat-rooms/${room.id}/messages/search?q=${encodeURIComponent('  ')}`, qualityCookie);
    expect([blank.status, blank.body.error?.code]).toEqual([400, 'COM-004']);
  });
});

describe('접속 상태 · 입력 중 (소켓)', () => {
  /** handshake 쿠키만 가진 가짜 소켓: 서버가 보낸 이벤트와 끊김을 기록한다 */
  function fakeSocket(cookie: string) {
    const emitted: { event: string; payload: unknown }[] = [];
    const socket = {
      handshake: { headers: { cookie } },
      data: {},
      disconnected: false,
      join: async () => undefined,
      emit: (event: string, payload: unknown) => void emitted.push({ event, payload }),
      disconnect: () => {
        socket.disconnected = true;
      },
    };
    return { socket, emitted, asSocket: socket as unknown as Socket };
  }

  type GatewayInternals = { broadcast: (event: string, payload: unknown) => void; emit: (employeeId: number, event: string, payload: unknown) => void };
  let originals: Pick<GatewayInternals, 'broadcast' | 'emit'>;
  beforeEach(() => {
    const internals = app.get(MessengerGateway) as unknown as GatewayInternals;
    originals = { broadcast: internals.broadcast, emit: internals.emit };
  });
  afterEach(() => Object.assign(app.get(MessengerGateway), originals));

  it('첫 연결에서 접속을 알리고 지금 접속자 목록을 주며, 마지막 연결이 끊기면 나감을 알린다. 쿠키가 없으면 끊는다', async () => {
    const gateway = app.get(MessengerGateway);
    const broadcasts: { event: string; payload: unknown }[] = [];
    (gateway as unknown as GatewayInternals).broadcast = (event, payload) => void broadcasts.push({ event, payload });

    const tab1 = fakeSocket(qualityCookie);
    const tab2 = fakeSocket(qualityCookie);
    await gateway.handleConnection(tab1.asSocket);
    await gateway.handleConnection(tab2.asSocket);
    expect(broadcasts).toEqual([{ event: 'presence:changed', payload: { employeeId: qualityId, online: true } }]);
    expect(tab2.emitted).toEqual([{ event: 'presence:snapshot', payload: { onlineEmployeeIds: expect.arrayContaining([qualityId]) } }]);

    gateway.handleDisconnect(tab1.asSocket);
    expect(broadcasts).toHaveLength(1);
    gateway.handleDisconnect(tab2.asSocket);
    expect(broadcasts.at(-1)).toEqual({ event: 'presence:changed', payload: { employeeId: qualityId, online: false } });

    const anonymous = fakeSocket('');
    await gateway.handleConnection(anonymous.asSocket);
    expect(anonymous.socket.disconnected).toBe(true);
  });

  it('입력 중은 방 멤버일 때만 나를 뺀 멤버에게 보내고, 멤버가 아니거나 형식이 틀리면 무시한다', async () => {
    const gateway = app.get(MessengerGateway);
    const sent: { employeeId: number; event: string; payload: unknown }[] = [];
    (gateway as unknown as GatewayInternals).emit = (employeeId, event, payload) => void sent.push({ employeeId, event, payload });
    const room = await createRoom(salesCookie, { chatRoomType: 'GROUP', memberIds: [qualityId, purchaseId] });

    const sales = fakeSocket(salesCookie);
    await gateway.handleConnection(sales.asSocket);
    await gateway.handleTyping(sales.asSocket, { chatRoomId: room.id });
    expect(sent.map((s) => s.employeeId).sort()).toEqual([qualityId, purchaseId].sort());
    expect(sent[0]).toMatchObject({ event: 'typing', payload: { chatRoomId: room.id, employeeId: salesId, employeeName: '박서영' } });

    sent.length = 0;
    const outsider = fakeSocket(await login('2304015'));
    await gateway.handleConnection(outsider.asSocket);
    await gateway.handleTyping(outsider.asSocket, { chatRoomId: room.id });
    await gateway.handleTyping(sales.asSocket, { chatRoomId: 'x' });
    await gateway.handleTyping(sales.asSocket, null);
    expect(sent).toEqual([]);
    gateway.handleDisconnect(sales.asSocket);
    gateway.handleDisconnect(outsider.asSocket);
  });
});

describe('ERP 링크 (REQ-MSG-006)', () => {
  it('본문의 수주 번호 중 실제로 있는 것만 상세 화면 링크가 되고, 보낼 때와 목록·검색이 같다', async () => {
    const salesOrder = await createSalesOrder('SO-2610-904');
    const room = await createRoom(salesCookie, { chatRoomType: 'GROUP', memberIds: [qualityId] });
    const sent = (await send(salesCookie, room.id, 'SO-2610-904 확인, SO-2610-999는 없는 번호, SO-2610-904 다시')).body.data;
    expect(sent.erpLinks).toEqual([{ text: 'SO-2610-904', href: `/sales-orders/${salesOrder.id}` }]);
    await send(salesCookie, room.id, '번호 없는 메시지');

    const page = await call<ChatMessagePage>('GET', `/chat-rooms/${room.id}/messages`, qualityCookie);
    expect(page.body.data.items.map((m) => m.erpLinks)).toEqual([[{ text: 'SO-2610-904', href: `/sales-orders/${salesOrder.id}` }], []]);
    const found = await call<ChatMessagePage>('GET', `/chat-rooms/${room.id}/messages/search?q=SO-2610`, qualityCookie);
    expect(found.body.data.items[0].erpLinks).toHaveLength(1);
  });
});

describe('스키마 1차 (#151): 메시지 유형·중복 방지 제약', () => {
  it('시스템 메시지는 보낸 사람 없이 저장되고, 목록에서 "시스템"으로 보인다', async () => {
    const room = await createRoom(salesCookie, { chatRoomType: 'GROUP', memberIds: [qualityId] });
    await send(salesCookie, room.id, '사람 메시지');
    await prisma.message.create({ data: { chatRoomId: room.id, messageType: MESSAGE_TYPE.SYSTEM, senderId: null, content: '서민지님이 들어왔어요' } });

    const page = await call<ChatMessagePage>('GET', `/chat-rooms/${room.id}/messages`, qualityCookie);
    expect(page.body.data.items.map((m) => [m.isSystem, m.senderId, m.senderName])).toEqual([
      [false, salesId, '박서영'],
      [true, null, '시스템'],
    ]);
    const list = await call<ChatRoomListItem[]>('GET', '/chat-rooms', qualityCookie);
    expect(list.body.data.find((r) => r.id === room.id)?.lastMessage).toMatchObject({ isSystem: true, senderName: '시스템', isMine: false });
  });

  it('USER는 보낸 사람이 꼭 있어야 하고, SYSTEM은 보낸 사람이 없어야 한다 (CHECK)', async () => {
    const room = await createRoom(salesCookie, { chatRoomType: 'GROUP', memberIds: [qualityId] });
    await expect(prisma.message.create({ data: { chatRoomId: room.id, messageType: MESSAGE_TYPE.USER, senderId: null, content: 'x' } })).rejects.toThrow();
    await expect(prisma.message.create({ data: { chatRoomId: room.id, messageType: MESSAGE_TYPE.SYSTEM, senderId: salesId, content: 'x' } })).rejects.toThrow();
  });

  it('같은 사람이 같은 client_message_id로 두 번 저장할 수 없고, 다른 사람이면 된다 (부분 unique)', async () => {
    const room = await createRoom(salesCookie, { chatRoomType: 'GROUP', memberIds: [qualityId] });
    const clientMessageId = '7f1d2c3e-0000-4000-8000-000000000001';
    await prisma.message.create({ data: { chatRoomId: room.id, senderId: salesId, content: '한 번', clientMessageId } });
    await expect(prisma.message.create({ data: { chatRoomId: room.id, senderId: salesId, content: '두 번', clientMessageId } })).rejects.toThrow();
    await expect(prisma.message.create({ data: { chatRoomId: room.id, senderId: qualityId, content: '다른 사람', clientMessageId } })).resolves.toBeTruthy();
    // client_message_id가 없으면 몇 번이든 된다
    await prisma.message.create({ data: { chatRoomId: room.id, senderId: salesId, content: 'a' } });
    await expect(prisma.message.create({ data: { chatRoomId: room.id, senderId: salesId, content: 'b' } })).resolves.toBeTruthy();
  });
});

describe('10번: 중복 전송 방지 · 시스템 메시지 · 업무방 진행 알림', () => {
  it('같은 clientMessageId로 다시 보내면 새로 저장하지 않고 처음 메시지를 돌려주며, 알림·소켓도 다시 보내지 않는다', async () => {
    const room = await createRoom(salesCookie, { chatRoomType: 'GROUP', memberIds: [qualityId] });
    const body = { content: '@서민지 한 번만', mentionedEmployeeIds: [qualityId], clientMessageId: 'a1b2c3d4-0000-4000-8000-000000000010' };
    const first = await call<ChatMessageView>('POST', `/chat-rooms/${room.id}/messages`, salesCookie, body);
    socketRecords.length = 0;
    const again = await call<ChatMessageView>('POST', `/chat-rooms/${room.id}/messages`, salesCookie, body);
    expect(again.body.data.id).toBe(first.body.data.id);
    expect(await prisma.message.count({ where: { chatRoomId: room.id } })).toBe(1);
    expect(await prisma.notification.count({ where: { messageId: first.body.data.id } })).toBe(1);
    expect(recordsOf('message:new')).toEqual([]);

    const otherRoom = await createRoom(salesCookie, { chatRoomType: 'GROUP', memberIds: [purchaseId] });
    const reused = await call('POST', `/chat-rooms/${otherRoom.id}/messages`, salesCookie, body);
    expect([reused.status, reused.body.error?.code]).toEqual([400, 'COM-004']);
    const badId = await call('POST', `/chat-rooms/${room.id}/messages`, salesCookie, { content: 'x', clientMessageId: '공백 있음' });
    expect(badId.status).toBe(400);
  });

  it('첨부도 같은 clientMessageId면 파일을 다시 저장하지 않는다', async () => {
    const room = await createRoom(salesCookie, { chatRoomType: 'GROUP', memberIds: [qualityId] });
    const form = () => {
      const f = new FormData();
      f.append('file', new Blob([new Uint8Array([1, 2])]), 'a.pdf');
      f.append('clientMessageId', 'a1b2c3d4-0000-4000-8000-000000000011');
      return f;
    };
    const post = async () => (await fetch(`${baseUrl}/chat-rooms/${room.id}/attachments`, { method: 'POST', headers: { cookie: salesCookie }, body: form() })).json() as Promise<{ data: ChatMessageView }>;
    const first = await post();
    const again = await post();
    expect(again.data.id).toBe(first.data.id);
    expect(await prisma.message.count({ where: { chatRoomId: room.id } })).toBe(1);
  });

  it('그룹방 이름 바꾸기·업무방 열기는 시스템 메시지를 남기고 소켓으로 보낸다 (안 읽은 수에는 넣지 않는다)', async () => {
    const group = await createRoom(salesCookie, { chatRoomType: 'GROUP', memberIds: [qualityId] });
    socketRecords.length = 0;
    await call('PATCH', `/chat-rooms/${group.id}`, salesCookie, { chatRoomName: '품질 회의' });
    const delivered = recordsOf('message:new');
    expect(delivered.map((r) => r.employeeId).sort()).toEqual([salesId, qualityId].sort());
    expect(delivered[0].payload).toMatchObject({ isSystem: true, senderId: null, content: "박서영님이 방 이름을 '품질 회의'(으)로 바꿨어요" });
    const detail = await call<ChatRoomDetail>('GET', `/chat-rooms/${group.id}`, qualityCookie);
    expect(detail.body.data.unreadCount).toBe(0);

    const salesOrder = await createSalesOrder('SO-2610-905');
    const work = await createRoom(salesCookie, { chatRoomType: 'WORK', memberIds: [productionId], salesOrderId: salesOrder.id });
    const page = await call<ChatMessagePage>('GET', `/chat-rooms/${work.id}/messages`, salesCookie);
    expect(page.body.data.items.map((m) => m.content)).toEqual(['박서영님이 수주 SO-2610-905 업무방을 열었어요']);
  });

  it('수주 작업 로그가 기록되면 같은 tx에서 업무방에 진행 알림을 남기고, 커밋 뒤 소켓으로 보낸다. 롤백되면 남지도 보내지도 않는다', async () => {
    const recorder = app.get(BusinessEventRecorder);
    const salesOrder = await createSalesOrder('SO-2610-906');
    const work = await createRoom(salesCookie, { chatRoomType: 'WORK', memberIds: [productionId], salesOrderId: salesOrder.id });
    const actor = { employeeId: salesId, employeeName: '박서영' } as unknown as AuthUser;
    socketRecords.length = 0;

    await prisma.$transaction((tx) =>
      recorder.record(tx, { type: 'GOODS_ISSUE_CONFIRMED', actor, target: { table: 'goods_issue', id: 1 }, salesOrderId: salesOrder.id, after: { shipmentRequestNo: 'DR-2610-0099', lots: [] } }),
    );
    // 수주에 연결되지 않았거나 알림 대상이 아닌 작업 로그는 남기지 않는다
    await prisma.$transaction((tx) => recorder.record(tx, { type: 'RESERVATION_CREATED', actor: 'SYSTEM', target: { table: 'reservation', id: 1 }, salesOrderId: salesOrder.id }));
    await expect(
      prisma.$transaction(async (tx) => {
        await recorder.record(tx, { type: 'SALES_ORDER_CANCELLED', actor, target: { table: 'sales_order', id: salesOrder.id }, salesOrderId: salesOrder.id });
        throw new Error('본 거래 실패');
      }),
    ).rejects.toThrow('본 거래 실패');

    const contents = (await prisma.message.findMany({ where: { chatRoomId: work.id }, orderBy: { id: 'asc' } })).map((m) => [m.messageType, m.content]);
    expect(contents).toEqual([
      ['SYSTEM', '박서영님이 수주 SO-2610-906 업무방을 열었어요'],
      ['SYSTEM', '[출고 확정] DR-2610-0099 · 박서영님'],
    ]);
    // 커밋을 확인한 뒤(100ms 간격) 보낸다
    await new Promise((resolve) => setTimeout(resolve, 600));
    const notices = recordsOf('message:new').filter((r) => (r.payload as ChatMessageView).content?.startsWith('['));
    expect(notices.map((r) => r.employeeId).sort()).toEqual([salesId, productionId].sort());
  });
});

describe('11번: 메시지 수정·삭제·답글', () => {
  it('내 메시지를 고치면 고친 시각이 남고 방 멤버에게 message:updated를 보낸다. 남의 메시지·시스템 메시지는 COM-004', async () => {
    const room = await createRoom(salesCookie, { chatRoomType: 'GROUP', memberIds: [qualityId] });
    const mine = (await send(salesCookie, room.id, '처음 글')).body.data;
    const theirs = (await send(qualityCookie, room.id, '서민지 글')).body.data;
    socketRecords.length = 0;

    const edited = await call<ChatMessageView>('PATCH', `/messages/${mine.id}`, salesCookie, { content: '  고친 글 SO-2610-907  ' });
    expect(edited.status).toBe(200);
    expect(edited.body.data).toMatchObject({ id: mine.id, content: '고친 글 SO-2610-907', isDeleted: false });
    expect(edited.body.data.editedAt).not.toBeNull();
    const updates = recordsOf('message:updated');
    expect(updates.map((r) => r.employeeId).sort()).toEqual([salesId, qualityId].sort());
    expect(updates.find((r) => r.employeeId === qualityId)?.payload).toMatchObject({ id: mine.id, isMine: false });

    const notMine = await call('PATCH', `/messages/${theirs.id}`, salesCookie, { content: '남의 글' });
    expect([notMine.status, notMine.body.error?.code]).toEqual([400, 'COM-004']);
    const blank = await call('PATCH', `/messages/${mine.id}`, salesCookie, { content: '   ' });
    expect([blank.status, blank.body.error?.code]).toEqual([400, 'COM-004']);
    const outsider = await call('PATCH', `/messages/${mine.id}`, purchaseCookie, { content: 'x' });
    expect(outsider.status).toBe(403);
  });

  it('삭제는 표시만 하고 본문·첨부를 비워 보여 주며, 안 읽은 수·검색·파일 목록·첨부 내려받기에서 빠진다', async () => {
    const room = await createRoom(salesCookie, { chatRoomType: 'GROUP', memberIds: [qualityId] });
    const text = (await send(salesCookie, room.id, '지울 비밀 글')).body.data;
    const file = (await upload(salesCookie, room.id, '지울.pdf', new Uint8Array([1]))).body.data;
    expect((await call<ChatRoomDetail>('GET', `/chat-rooms/${room.id}`, qualityCookie)).body.data.unreadCount).toBe(2);

    const removed = await call<ChatMessageView>('DELETE', `/messages/${text.id}`, salesCookie);
    expect(removed.body.data).toMatchObject({ isDeleted: true, content: null });
    await call('DELETE', `/messages/${file.id}`, salesCookie);
    const again = await call<ChatMessageView>('DELETE', `/messages/${text.id}`, salesCookie);
    expect(again.status).toBe(200);
    expect(await prisma.message.count({ where: { chatRoomId: room.id } })).toBe(2);

    expect((await call<ChatRoomDetail>('GET', `/chat-rooms/${room.id}`, qualityCookie)).body.data.unreadCount).toBe(0);
    const page = await call<ChatMessagePage>('GET', `/chat-rooms/${room.id}/messages`, qualityCookie);
    expect(page.body.data.items.map((m) => [m.isDeleted, m.content, m.attachmentName])).toEqual([
      [true, null, null],
      [true, null, null],
    ]);
    const list = await call<ChatRoomListItem[]>('GET', '/chat-rooms', qualityCookie);
    expect(list.body.data.find((r) => r.id === room.id)?.lastMessage?.preview).toBe('삭제된 메시지예요');
    expect((await call<ChatMessagePage>('GET', `/chat-rooms/${room.id}/messages/search?q=${encodeURIComponent('비밀')}`, qualityCookie)).body.data.items).toEqual([]);
    expect((await call<ChatMessagePage>('GET', `/chat-rooms/${room.id}/attachments`, qualityCookie)).body.data.items).toEqual([]);
    const download = await call('GET', `/attachments/${file.id}`, qualityCookie);
    expect(download.status).toBe(404);
    const editDeleted = await call('PATCH', `/messages/${text.id}`, salesCookie, { content: '되살리기' });
    expect(editDeleted.body.error?.code).toBe('COM-004');
  });

  it('답글은 같은 방의 일반 메시지에만 달리고, 원본 요약을 함께 보여 준다 (원본이 지워지면 비움)', async () => {
    const room = await createRoom(salesCookie, { chatRoomType: 'GROUP', memberIds: [qualityId] });
    const other = await createRoom(salesCookie, { chatRoomType: 'GROUP', memberIds: [purchaseId] });
    const original = (await send(qualityCookie, room.id, '검사 결과 공유해요')).body.data;
    const otherMessage = (await send(salesCookie, other.id, '다른 방')).body.data;

    const reply = await call<ChatMessageView>('POST', `/chat-rooms/${room.id}/messages`, salesCookie, { content: '확인했어요', parentMessageId: original.id });
    expect(reply.body.data.parent).toEqual({ id: original.id, senderName: '서민지', preview: '검사 결과 공유해요', isDeleted: false });
    const wrongRoom = await call('POST', `/chat-rooms/${room.id}/messages`, salesCookie, { content: 'x', parentMessageId: otherMessage.id });
    expect([wrongRoom.status, wrongRoom.body.error?.code]).toEqual([404, 'COM-003']);

    await call('DELETE', `/messages/${original.id}`, qualityCookie);
    const page = await call<ChatMessagePage>('GET', `/chat-rooms/${room.id}/messages`, salesCookie);
    expect(page.body.data.items.find((m) => m.id === reply.body.data.id)?.parent).toEqual({ id: original.id, senderName: '서민지', preview: '', isDeleted: true });
    const toDeleted = await call('POST', `/chat-rooms/${room.id}/messages`, salesCookie, { content: 'x', parentMessageId: original.id });
    expect(toDeleted.body.error?.code).toBe('COM-004');
  });
});

describe('12번: 공지 고정', () => {
  it('방 멤버가 일반 메시지를 공지로 고정·해제하면 방 정보에 보이고, 시스템 메시지와 room:updated를 보낸다', async () => {
    const room = await createRoom(salesCookie, { chatRoomType: 'GROUP', memberIds: [qualityId] });
    const first = (await send(qualityCookie, room.id, '내일 9시 회의합니다')).body.data;
    const second = (await send(salesCookie, room.id, '자료는 공유 폴더에')).body.data;
    socketRecords.length = 0;

    const pinned = await call<ChatRoomDetail>('POST', `/chat-rooms/${room.id}/pin`, salesCookie, { messageId: first.id });
    expect(pinned.status).toBe(200);
    expect(pinned.body.data.pinnedMessage).toMatchObject({ id: first.id, senderName: '서민지', preview: '내일 9시 회의합니다' });
    expect(recordsOf('room:updated').map((r) => r.employeeId).sort()).toEqual([salesId, qualityId].sort());
    expect(recordsOf('message:new')[0].payload).toMatchObject({ isSystem: true, content: '박서영님이 메시지를 공지로 고정했어요' });

    const replaced = await call<ChatRoomDetail>('POST', `/chat-rooms/${room.id}/pin`, qualityCookie, { messageId: second.id });
    expect(replaced.body.data.pinnedMessage?.id).toBe(second.id);

    // 고정한 메시지를 지우면 공지도 보이지 않는다
    await call('DELETE', `/messages/${second.id}`, salesCookie);
    expect((await call<ChatRoomDetail>('GET', `/chat-rooms/${room.id}`, qualityCookie)).body.data.pinnedMessage).toBeNull();

    const unpinned = await call<ChatRoomDetail>('POST', `/chat-rooms/${room.id}/unpin`, qualityCookie);
    expect(unpinned.body.data.pinnedMessage).toBeNull();
    const messages = await prisma.message.findMany({ where: { chatRoomId: room.id, messageType: 'SYSTEM' }, orderBy: { id: 'asc' } });
    expect(messages.map((m) => m.content)).toEqual(['박서영님이 메시지를 공지로 고정했어요', '서민지님이 메시지를 공지로 고정했어요', '서민지님이 공지를 내렸어요']);
  });

  it('다른 방·삭제된·시스템 메시지는 고정할 수 없고, 멤버가 아니면 COM-002', async () => {
    const room = await createRoom(salesCookie, { chatRoomType: 'GROUP', memberIds: [qualityId] });
    const other = await createRoom(salesCookie, { chatRoomType: 'GROUP', memberIds: [purchaseId] });
    const otherMessage = (await send(salesCookie, other.id, '다른 방')).body.data;
    const system = await prisma.message.create({ data: { chatRoomId: room.id, messageType: 'SYSTEM', senderId: null, content: '안내' } });
    const cases = await Promise.all([
      call('POST', `/chat-rooms/${room.id}/pin`, salesCookie, { messageId: otherMessage.id }),
      call('POST', `/chat-rooms/${room.id}/pin`, salesCookie, { messageId: system.id }),
      call('POST', `/chat-rooms/${room.id}/pin`, purchaseCookie, { messageId: system.id }),
    ]);
    expect(cases.map((c) => [c.status, c.body.error?.code])).toEqual([
      [404, 'COM-003'],
      [400, 'COM-004'],
      [403, 'COM-002'],
    ]);
  });
});
