// 메신저 1단계: 채팅방 만들기·목록·상세, 메시지 목록·보내기를 실제 앱과 DB(fs_collab)로 확인한다.
// 방 멤버 확인·업무방 권한까지 보려고 HTTP로 부른다. 사원은 시드(seed.md), 수주는 테스트에서 직접 만든다.
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import type { ChatMessagePage, ChatMessageView, ChatRoomDetail, ChatRoomListItem, CreateChatRoomResult } from '@fantasteel/shared';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';

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

async function login(employeeNo: string, password = process.env.SEED_PASSWORD ?? 'fantasteel'): Promise<string> {
  const res = await fetch(`${baseUrl}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ employeeNo, password }) });
  if (!res.ok) throw new Error(`로그인 실패 (HTTP ${res.status})`);
  return (res.headers.get('set-cookie') ?? '').split(';')[0];
}

async function call<T>(method: 'GET' | 'POST', path: string, cookie: string, body?: unknown) {
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
}, 60_000);

afterAll(async () => {
  await app?.close();
});

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
    const first = await createRoom(salesCookie, { chatRoomType: 'WORK', memberIds: [logisticsId], salesOrderId: salesOrder.id });
    await send(salesCookie, first.id, '출하 일정 맞춰 주세요');
    const again = await createRoom(salesCookie, { chatRoomType: 'WORK', memberIds: [logisticsId, purchaseId], salesOrderId: salesOrder.id });
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
