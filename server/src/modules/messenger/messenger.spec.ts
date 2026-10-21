// 메신저: 채팅방 만들기·목록·상세, 메시지 목록·보내기, 첨부, 읽음, 멘션·업무방 알림, 소켓 발송을 실제 앱과 DB(fs_collab)로 확인한다.
// 방 멤버 확인·업무방 권한까지 보려고 HTTP로 부른다. 사원은 시드(seed.md), 수주는 테스트에서 직접 만든다.
// 소켓은 게이트웨이의 발송 함수를 기록용으로 바꿔 "커밋 뒤 누구에게 무엇을 보냈는지"를 본다.
import type { INestApplication } from '@nestjs/common';
import { HttpStatus, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AI_REPLY_MARK,
  AI_REPLY_PREFIX,
  AI_SENDER_NAME,
  AI_TYPING_EMPLOYEE_ID,
  TYPING_SEND_INTERVAL_MS,
  type TypingEvent,
  CHAT_MEMBER_PICK_MAX,
  MESSAGE_ATTACHMENT_MAX_BYTES,
  MESSAGE_ATTACHMENT_MAX_COUNT,
  MESSAGE_TYPE,
  NOTIFICATION_TYPE,
  type ChatMessagePage,
  type ChatMessageView,
  type ChatRoomDetail,
  type ChatRoomListItem,
  type ChatRoomReadResult,
  type ChatRoomSettings,
  type LeaveChatRoomResult,
  type CreateChatRoomResult,
} from '@fantasteel/shared';
import type { AuthUser } from '@fantasteel/shared';
import { JwtService } from '@nestjs/jwt';
import { AppModule } from '../../app.module';
import { AuthSessionEvents, type AuthRevocation } from '../../common/auth/auth-sessions';
import { AppException } from '../../common/errors/app.exception';
import { BusinessEventRecorder } from '../../common/business-event/business-event.recorder';
import { PrismaService } from '../../prisma/prisma.service';
import { AiAssistantService } from '../ai-assistant/ai-assistant.service';
import type { HistorySearchSource } from '../ai-assistant/history/chat-memory';
import type { Socket } from 'socket.io';
import { MessengerGateway } from './messenger.gateway';
import { MessengerService } from './messenger.service';

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
/** 정다은 (구매). 수주 조회 권한이 없는 경우는 테스트 동안 역할 권한을 빼서 본다 */
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
const typingRecords: { employeeId: number; event: TypingEvent }[] = [];

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
  gateway.emitTyping = (memberIds, event) => {
    for (const employeeId of memberIds) typingRecords.push({ employeeId, event });
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

/** 관리자가 부서·권한 화면에서 역할 권한을 뺀 상태를 만든다(업무 조회는 기본으로 모든 역할, 역할별 메뉴 v2 3장). 돌려놓는 함수를 돌려준다 */
async function revokeRolePermission(roleCode: string, permission: string): Promise<() => Promise<void>> {
  const role = await prisma.role.findUniqueOrThrow({ where: { roleCode } });
  const row = await prisma.rolePermission.findUniqueOrThrow({ where: { roleId_permission: { roleId: role.id, permission } } });
  await prisma.rolePermission.delete({ where: { id: row.id } });
  return async () => {
    await prisma.rolePermission.create({ data: { roleId: role.id, permission, permissionLevel: row.permissionLevel } });
  };
}

beforeEach(() => {
  socketRecords.length = 0;
  typingRecords.length = 0;
});

const recordsOf = (event: SocketRecord['event']) => socketRecords.filter((r) => r.event === event);

async function upload(cookie: string, chatRoomId: number, fileName: string, content: Uint8Array, text?: string) {
  return uploadMany(cookie, chatRoomId, [{ fileName, content }], text);
}

async function uploadMany(cookie: string, chatRoomId: number, files: readonly { fileName: string; content: Uint8Array }[], text?: string, mentionedEmployeeIds: readonly (number | string)[] = []) {
  const form = new FormData();
  for (const file of files) form.append('files', new Blob([file.content]), file.fileName);
  if (text !== undefined) form.append('content', text);
  for (const id of mentionedEmployeeIds) form.append('mentionedEmployeeIds', String(id));
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
    const restore = await revokeRolePermission('PURCHASE', 'SALES_ORDER_CREATE');
    const denied = await call('POST', '/chat-rooms', purchaseCookie, { chatRoomType: 'WORK', memberIds: [], salesOrderId: salesOrder.id }).finally(restore);
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

    // 나중에 들어온 멤버는 이전 메시지를 읽은 것으로 시작한다. 업무 조회는 모든 역할이라 구매도 요약을 본다
    const purchase = await call<ChatRoomDetail>('GET', `/chat-rooms/${first.id}`, purchaseCookie);
    expect(purchase.body.data).toMatchObject({ salesOrderState: 'ok', unreadCount: 0 });
    // 관리자가 수주 조회 권한을 빼면 요약을 못 본다
    const restore = await revokeRolePermission('PURCHASE', 'SALES_ORDER_CREATE');
    try {
      const denied = await call<ChatRoomDetail>('GET', `/chat-rooms/${first.id}`, purchaseCookie);
      expect(denied.body.data).toMatchObject({ salesOrderState: 'denied', salesOrder: null });
      const purchaseList = await call<ChatRoomListItem[]>('GET', '/chat-rooms', purchaseCookie);
      expect(purchaseList.body.data.find((r) => r.id === first.id)?.salesOrder).toBeNull();
    } finally {
      await restore();
    }
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

describe('첨부와 함께 보낸 멘션', () => {
  const notificationsOf = (messageId: number) => prisma.notification.findMany({ where: { messageId }, orderBy: { recipientId: 'asc' } });
  const bytes = new TextEncoder().encode('hello');

  it('멘션을 한 명만 보내도(글자 하나로 온다) 멘션 알림이 가고, 방 멤버가 아닌 사원·나 자신은 무시한다', async () => {
    const room = await createRoom(salesCookie, { chatRoomType: 'GROUP', memberIds: [qualityId, productionId], chatRoomName: '첨부 멘션방' });
    const sent = await uploadMany(salesCookie, room.id, [{ fileName: '성적서.txt', content: bytes }], '@서민지 확인', [qualityId]);
    expect(sent.status).toBe(201);
    const rows = await notificationsOf(sent.body.data.id);
    expect(rows.map((r) => [r.recipientId, r.notificationType])).toEqual([[qualityId, NOTIFICATION_TYPE.MENTION]]);
    expect(rows[0].notificationContent).toBe('박서영님이 멘션했어요 · 첨부 멘션방 · @서민지 확인');

    const several = await uploadMany(salesCookie, room.id, [{ fileName: 'a.txt', content: bytes }], '확인', [qualityId, productionId, purchaseId, salesId]);
    const severalRows = await notificationsOf(several.body.data.id);
    expect(severalRows.map((r) => [r.recipientId, r.notificationType])).toEqual(
      [
        [qualityId, NOTIFICATION_TYPE.MENTION],
        [productionId, NOTIFICATION_TYPE.MENTION],
      ].sort((a, b) => Number(a[0]) - Number(b[0])),
    );
  });

  it('같은 clientMessageId로 다시 보내도 멘션 알림은 한 번만 간다', async () => {
    const room = await createRoom(salesCookie, { chatRoomType: 'GROUP', memberIds: [qualityId] });
    const send = async () => {
      const form = new FormData();
      form.append('files', new Blob([bytes]), 'a.txt');
      form.append('content', '확인');
      form.append('mentionedEmployeeIds', String(qualityId));
      form.append('clientMessageId', 'a1b2c3d4-0000-4000-8000-000000000077');
      return (await (await fetch(`${baseUrl}/chat-rooms/${room.id}/attachments`, { method: 'POST', headers: { cookie: salesCookie }, body: form })).json()) as { data: ChatMessageView };
    };
    const first = await send();
    const again = await send();
    expect(again.data.id).toBe(first.data.id);
    expect(await notificationsOf(first.data.id)).toHaveLength(1);
  });

  it('멘션 id가 숫자가 아니면 400, 정한 수를 넘어도 400이고 아무것도 저장하지 않는다', async () => {
    const room = await createRoom(salesCookie, { chatRoomType: 'GROUP', memberIds: [qualityId] });
    const before = await prisma.message.count({ where: { chatRoomId: room.id } });
    const bad = await uploadMany(salesCookie, room.id, [{ fileName: 'a.txt', content: bytes }], '확인', ['abc']);
    expect(bad.status).toBe(400);
    const tooMany = await uploadMany(salesCookie, room.id, [{ fileName: 'a.txt', content: bytes }], '확인', Array.from({ length: CHAT_MEMBER_PICK_MAX + 1 }, (_, i) => i + 1));
    expect(tooMany.status).toBe(400);
    expect(await prisma.message.count({ where: { chatRoomId: room.id } })).toBe(before);
  });
});

describe('첨부', () => {
  it('업로드하면 메시지 1건이 생기고(한글 이름 유지), 멤버만 같은 내용을 내려받는다', async () => {
    const room = await createRoom(salesCookie, { chatRoomType: 'GROUP', memberIds: [qualityId] });
    const bytes = new TextEncoder().encode('밀시트 확인용 파일');
    const sent = await upload(salesCookie, room.id, '검사 성적서.txt', bytes, '첨부해요');
    expect(sent.status).toBe(201);
    expect(sent.body.data).toMatchObject({ attachments: [{ fileName: '검사 성적서.txt', fileSize: bytes.length }], content: '첨부해요', isMine: true });
    expect(recordsOf('message:new')).toHaveLength(2);
    const attachmentId = sent.body.data.attachments[0].id;

    const res = await fetch(`${baseUrl}/attachments/${attachmentId}`, { headers: { cookie: qualityCookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toContain(encodeURIComponent('검사 성적서.txt'));
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);

    const outsider = await fetch(`${baseUrl}/attachments/${attachmentId}`, { headers: { cookie: purchaseCookie } });
    expect(outsider.status).toBe(403);
    const list = await call<ChatRoomListItem[]>('GET', '/chat-rooms', qualityCookie);
    expect(list.body.data.find((r) => r.id === room.id)?.lastMessage?.preview).toBe('첨부해요');
  });

  it('파일만 보내면 목록 미리보기는 "파일 · 이름", 없는 첨부 내려받기는 COM-003', async () => {
    const room = await createRoom(salesCookie, { chatRoomType: 'GROUP', memberIds: [logisticsId] });
    await upload(salesCookie, room.id, 'plan.pdf', new Uint8Array([1, 2, 3]));
    const list = await call<ChatRoomListItem[]>('GET', '/chat-rooms', salesCookie);
    expect(list.body.data.find((r) => r.id === room.id)?.lastMessage?.preview).toBe('파일 · plan.pdf');
    const res = await call('GET', '/attachments/999999', salesCookie);
    expect([res.status, res.body.error?.code]).toEqual([404, 'COM-003']);
  });

  it('여러 파일을 한 메시지로 올리면 올린 순서대로 보이고 각각 내려받는다. 미리보기는 "파일 · 첫 이름 외 N개"', async () => {
    const room = await createRoom(salesCookie, { chatRoomType: 'GROUP', memberIds: [qualityId] });
    const files = ['a.pdf', 'b.png', 'c.xlsx'].map((fileName, i) => ({ fileName, content: new Uint8Array(i + 1).fill(i + 1) }));
    const sent = await uploadMany(salesCookie, room.id, files);
    expect(sent.status).toBe(201);
    expect(sent.body.data.attachments.map((a) => [a.fileName, a.fileSize])).toEqual([
      ['a.pdf', 1],
      ['b.png', 2],
      ['c.xlsx', 3],
    ]);
    const second = await fetch(`${baseUrl}/attachments/${sent.body.data.attachments[1].id}`, { headers: { cookie: qualityCookie } });
    expect(new Uint8Array(await second.arrayBuffer())).toEqual(new Uint8Array([2, 2]));
    const list = await call<ChatRoomListItem[]>('GET', '/chat-rooms', qualityCookie);
    expect(list.body.data.find((r) => r.id === room.id)?.lastMessage?.preview).toBe('파일 · a.pdf 외 2개');
    expect(await prisma.messageAttachment.count({ where: { messageId: sent.body.data.id } })).toBe(3);
  });

  it('파일 수가 넘거나 하나라도 실행 파일이면 COM-004이고 아무것도 저장하지 않는다', async () => {
    const room = await createRoom(salesCookie, { chatRoomType: 'GROUP', memberIds: [qualityId] });
    const tooMany = await uploadMany(salesCookie, room.id, Array.from({ length: MESSAGE_ATTACHMENT_MAX_COUNT + 1 }, (_, i) => ({ fileName: `${i}.txt`, content: new Uint8Array([1]) })));
    expect([tooMany.status, tooMany.body.error?.code]).toEqual([400, 'COM-004']);
    const mixed = await uploadMany(salesCookie, room.id, [
      { fileName: 'ok.pdf', content: new Uint8Array([1]) },
      { fileName: 'run.bat', content: new Uint8Array([1]) },
    ]);
    expect([mixed.status, mixed.body.error?.code]).toEqual([400, 'COM-004']);
    expect(await prisma.message.count({ where: { chatRoomId: room.id } })).toBe(0);
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

  it('퇴사자(사용 안 함 사원)는 안 읽은 사람 수에 세지 않는다 (#496)', async () => {
    const room = await createRoom(salesCookie, { chatRoomType: 'GROUP', memberIds: [qualityId, purchaseId, logisticsId] });
    await prisma.employee.update({ where: { id: logisticsId }, data: { isActive: false } });
    try {
      const sent = (await send(salesCookie, room.id, '퇴사자 빼고')).body.data;
      expect(sent.unreadMemberCount).toBe(2);
      const page = await call<ChatMessagePage>('GET', `/chat-rooms/${room.id}/messages`, salesCookie);
      expect(page.body.data.items.map((m) => m.unreadMemberCount)).toEqual([2]);
    } finally {
      await prisma.employee.update({ where: { id: logisticsId }, data: { isActive: true } });
    }
  });

  it('파일 모아보기는 첨부가 있는 메시지만 최신순, before로 더 보고, 멤버가 아니면 COM-002', async () => {
    const room = await createRoom(salesCookie, { chatRoomType: 'GROUP', memberIds: [qualityId] });
    await upload(salesCookie, room.id, 'a.pdf', new Uint8Array([1]));
    await send(salesCookie, room.id, '글만');
    await upload(qualityCookie, room.id, 'b.xlsx', new Uint8Array([2]));
    const files = await call<ChatMessagePage>('GET', `/chat-rooms/${room.id}/attachments?limit=1`, salesCookie);
    expect(files.body.data.items.map((m) => m.attachments.map((a) => a.fileName))).toEqual([['b.xlsx']]);
    expect(files.body.data.hasMore).toBe(true);
    const older = await call<ChatMessagePage>('GET', `/chat-rooms/${room.id}/attachments?before=${files.body.data.items[0].id}`, salesCookie);
    expect(older.body.data).toMatchObject({ items: [expect.objectContaining({ attachments: [expect.objectContaining({ fileName: 'a.pdf' })] })], hasMore: false });
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
      connected: true,
      disconnected: false,
      join: async (): Promise<void> => undefined,
      emit: (event: string, payload: unknown) => void emitted.push({ event, payload }),
      disconnect: () => {
        socket.connected = false;
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

  it('연결 처리 중 오류(깨진 쿠키·join 실패)는 던지지 않고 끊는다 — Nest가 이 promise를 버려 던지면 서버가 끝난다', async () => {
    const gateway = app.get(MessengerGateway);
    (gateway as unknown as GatewayInternals).broadcast = () => undefined;
    const broken = fakeSocket('access_token=%');
    await expect(gateway.handleConnection(broken.asSocket)).resolves.toBeUndefined();
    expect(broken.socket.disconnected).toBe(true);

    const failing = fakeSocket(qualityCookie);
    failing.socket.join = async () => {
      throw new Error('adapter down');
    };
    await expect(gateway.handleConnection(failing.asSocket)).resolves.toBeUndefined();
    expect(failing.socket.disconnected).toBe(true);
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

  it('입력 중 신호가 방마다 정한 간격보다 자주 오면 DB를 읽지 않고 버린다 (이슈 #488)', async () => {
    const gateway = app.get(MessengerGateway);
    const sent: number[] = [];
    (gateway as unknown as GatewayInternals).emit = (employeeId) => void sent.push(employeeId);
    const room = await createRoom(salesCookie, { chatRoomType: 'GROUP', memberIds: [qualityId] });
    const other = await createRoom(salesCookie, { chatRoomType: 'GROUP', memberIds: [qualityId] });
    const sales = fakeSocket(salesCookie);
    await gateway.handleConnection(sales.asSocket);
    await gateway.handleTyping(sales.asSocket, { chatRoomId: room.id });
    await gateway.handleTyping(sales.asSocket, { chatRoomId: room.id });
    await gateway.handleTyping(sales.asSocket, { chatRoomId: other.id });
    expect(sent).toEqual([qualityId, qualityId]);
    gateway.handleDisconnect(sales.asSocket);
  });

  it('확인하는 사이 끊긴 소켓은 접속 상태에 세지 않는다 (온라인으로 남지 않음, 이슈 #488)', async () => {
    const gateway = app.get(MessengerGateway);
    const broadcasts: unknown[] = [];
    (gateway as unknown as GatewayInternals).broadcast = (_event, payload) => void broadcasts.push(payload);
    const tab = fakeSocket(await login('2304015'));
    tab.socket.join = async () => {
      // 접속을 확인하는 사이 브라우저가 끊고 handleDisconnect가 먼저 지나간다
      tab.socket.disconnect();
      gateway.handleDisconnect(tab.asSocket);
    };
    await gateway.handleConnection(tab.asSocket);
    expect(broadcasts).toEqual([]);
    const later = fakeSocket(await login('2304015'));
    await gateway.handleConnection(later.asSocket);
    // 남은 수가 없으므로 이번이 첫 연결이다
    expect(broadcasts).toEqual([{ employeeId: logisticsId, online: true }]);
    gateway.handleDisconnect(later.asSocket);
    gateway.handleDisconnect(later.asSocket);
    expect(broadcasts.at(-1)).toEqual({ employeeId: logisticsId, online: false });
    expect(broadcasts).toHaveLength(2);
  });

  it('토큰 만료 시각이 되면 끊고, 이미 만료된 토큰은 받지 않는다 (이슈 #488)', async () => {
    const gateway = app.get(MessengerGateway);
    (gateway as unknown as GatewayInternals).broadcast = () => undefined;
    const jwt = app.get(JwtService);
    const short = fakeSocket(`access_token=${await jwt.signAsync({ sub: qualityId }, { expiresIn: 1 })}`);
    await gateway.handleConnection(short.asSocket);
    expect(short.socket.disconnected).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 1_300));
    expect(short.socket.disconnected).toBe(true);
    gateway.handleDisconnect(short.asSocket);

    // 만료된 토큰으로 접속해 끊겨도, 같은 사원의 다른 기기 접속 수를 빼지 않는다
    const online = fakeSocket(qualityCookie);
    await gateway.handleConnection(online.asSocket);
    const expired = fakeSocket(`access_token=${await jwt.signAsync({ sub: qualityId }, { expiresIn: -10 })}`);
    await gateway.handleConnection(expired.asSocket);
    gateway.handleDisconnect(expired.asSocket);
    expect(expired.socket.disconnected).toBe(true);
    const presence = (gateway as unknown as { presence: { onlineEmployeeIds(): number[] } }).presence;
    expect(presence.onlineEmployeeIds()).toContain(qualityId);
    gateway.handleDisconnect(online.asSocket);
    expect(presence.onlineEmployeeIds()).not.toContain(qualityId);
  });

  it('사원을 읽는 사이 퇴사 처리되면 채널에 든 뒤 다시 확인해 끊고, 접속에 세지 않는다 (이슈 #488)', async () => {
    const gateway = app.get(MessengerGateway);
    const broadcasts: unknown[] = [];
    (gateway as unknown as GatewayInternals).broadcast = (_event, payload) => void broadcasts.push(payload);
    const users = (gateway as unknown as { users: { load: (id: number) => Promise<unknown> } }).users;
    const original = users.load.bind(users);
    let calls = 0;
    users.load = async (id: number) => (++calls === 1 ? original(id) : null);
    try {
      const tab = fakeSocket(qualityCookie);
      await gateway.handleConnection(tab.asSocket);
      expect(tab.socket.disconnected).toBe(true);
      gateway.handleDisconnect(tab.asSocket);
      expect(broadcasts).toEqual([]);
    } finally {
      users.load = original;
    }
  });

  it('로그아웃하면 그 토큰의 소켓만, 퇴사 처리하면 그 사원의 소켓을 모두 끊는다 (이슈 #488)', async () => {
    const gateway = app.get(MessengerGateway);
    const revocations: AuthRevocation[] = [];
    const stop = app.get(AuthSessionEvents).on((r) => void revocations.push(r));
    // 같은 1초에 두 기기에서 로그인해도 토큰이 다르다(jti): 한쪽 로그아웃이 다른 쪽을 끊지 않는다
    const [first, second] = await Promise.all([login('2304015'), login('2304015')]);
    expect(first).not.toBe(second);
    const token = first.split('=')[1];
    const logout = await fetch(`${baseUrl}/auth/logout`, { method: 'POST', headers: { cookie: `access_token=${token}` } });
    expect(logout.status).toBe(200);
    expect(revocations).toEqual([{ token }]);

    const admin = await login('1503001');
    const res = await call('PATCH', `/employees/${logisticsId}`, admin, { isActive: false });
    expect(res.status).toBe(200);
    expect(revocations.at(-1)).toEqual({ employeeId: logisticsId });
    await prisma.employee.update({ where: { id: logisticsId }, data: { isActive: true } });
    stop();

    // 게이트웨이가 알림을 받아 맞는 소켓을 끊는지는 서버 객체를 바꿔 본다
    const kept = { data: { user: { token: 'other' } }, disconnect: jest.fn() };
    const mine = { data: { user: { token } }, disconnect: jest.fn() };
    const channels: string[] = [];
    const internals = gateway as unknown as { server: unknown };
    const original = internals.server;
    internals.server = { fetchSockets: async () => [kept, mine], in: (channel: string) => ({ disconnectSockets: () => void channels.push(channel) }) };
    app.get(AuthSessionEvents).revokeToken(token);
    app.get(AuthSessionEvents).revokeEmployee(logisticsId);
    await new Promise((resolve) => setImmediate(resolve));
    internals.server = original;
    expect(mine.disconnect).toHaveBeenCalledWith(true);
    expect(kept.disconnect).not.toHaveBeenCalled();
    expect(channels).toEqual([`employee:${logisticsId}`]);
  });
});

describe('메신저 보강 (이슈 #488)', () => {
  const storedFiles = async () => (await readdir(join(storageDir, 'messages')).catch(() => [] as string[])).length;

  it('답글 대상이 틀린 첨부는 파일을 저장하지 않고 COM-003, 저장한 뒤 실패해도 파일을 지운다', async () => {
    const room = await createRoom(salesCookie, { chatRoomType: 'GROUP', memberIds: [qualityId] });
    const before = await storedFiles();
    const form = new FormData();
    form.append('files', new Blob([new Uint8Array([1, 2])]), 'reply.txt');
    form.append('parentMessageId', '99999999');
    const res = await fetch(`${baseUrl}/chat-rooms/${room.id}/attachments`, { method: 'POST', headers: { cookie: salesCookie }, body: form });
    expect(res.status).toBe(404);
    expect(await storedFiles()).toBe(before);

    // 검사를 지난 뒤 저장(tx)에서 실패하는 경우: 메시지 만들기를 한 번 실패시킨다
    const service = app.get(MessengerService) as unknown as { saveMessage: (...args: unknown[]) => Promise<unknown> };
    const original = service.saveMessage;
    service.saveMessage = async () => {
      throw new AppException('COM-999', '저장 실패');
    };
    try {
      const failed = await upload(salesCookie, room.id, 'fail.txt', new Uint8Array([3]));
      expect(failed.status).toBe(500);
    } finally {
      service.saveMessage = original;
    }
    expect(await storedFiles()).toBe(before);

    // 커밋된 뒤 실패(ERP 링크 조회)하면 파일은 메시지가 쓰므로 지우지 않는다
    const linked = app.get(MessengerService) as unknown as { erpLinkResolver: (...args: unknown[]) => Promise<unknown> };
    const originalLinks = linked.erpLinkResolver;
    linked.erpLinkResolver = async () => {
      throw new Error('링크 조회 실패');
    };
    try {
      const failedAfterCommit = await upload(salesCookie, room.id, 'kept.txt', new Uint8Array([4, 5]));
      expect(failedAfterCommit.status).toBe(500);
    } finally {
      linked.erpLinkResolver = originalLinks;
    }
    expect(await storedFiles()).toBe(before + 1);
    const page = await call<ChatMessagePage>('GET', `/chat-rooms/${room.id}/messages`, salesCookie);
    const keptId = page.body.data.items.at(-1)?.attachments[0]?.id;
    const kept = await fetch(`${baseUrl}/attachments/${keptId}`, { headers: { cookie: salesCookie } });
    expect(new Uint8Array(await kept.arrayBuffer())).toEqual(new Uint8Array([4, 5]));
  });

  it('반응을 거의 동시에 두 번 눌러도 500 없이 처리된다', async () => {
    const room = await createRoom(salesCookie, { chatRoomType: 'GROUP', memberIds: [qualityId] });
    const message = (await send(salesCookie, room.id, '반응 시험')).body.data;
    const results = await Promise.all([1, 2, 3].map(() => call('POST', `/messages/${message.id}/reactions`, qualityCookie, { emoji: '👍' })));
    expect(results.map((r) => r.status).every((status) => status === 201 || status === 200)).toBe(true);
    expect(await prisma.messageReaction.count({ where: { messageId: message.id } })).toBeLessThanOrEqual(1);
  });

  it('두 사람이 서로에게 동시에 1:1을 열어도 방은 하나다', async () => {
    const productionCookie = await login('1906009');
    const [a, b] = await Promise.all([
      call<CreateChatRoomResult>('POST', '/chat-rooms', productionCookie, { chatRoomType: 'DIRECT', memberIds: [logisticsId] }),
      call<CreateChatRoomResult>('POST', '/chat-rooms', await login('2304015'), { chatRoomType: 'DIRECT', memberIds: [productionId] }),
    ]);
    expect(a.body.data.id).toBe(b.body.data.id);
  });

  it('memberIds·mentionedEmployeeIds는 한 번에 정한 수까지만 받는다', async () => {
    const tooMany = Array.from({ length: CHAT_MEMBER_PICK_MAX + 1 }, (_, i) => i + 1);
    const created = await call('POST', '/chat-rooms', salesCookie, { chatRoomType: 'GROUP', memberIds: tooMany });
    expect([created.status, created.body.error?.code]).toEqual([400, 'COM-004']);
    const room = await createRoom(salesCookie, { chatRoomType: 'GROUP', memberIds: [qualityId] });
    const mention = await call('POST', `/chat-rooms/${room.id}/messages`, salesCookie, { content: 'x', mentionedEmployeeIds: tooMany });
    expect(mention.status).toBe(400);
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
      f.append('files', new Blob([new Uint8Array([1, 2])]), 'a.pdf');
      f.append('clientMessageId', 'a1b2c3d4-0000-4000-8000-000000000011');
      return f;
    };
    const post = async () => (await fetch(`${baseUrl}/chat-rooms/${room.id}/attachments`, { method: 'POST', headers: { cookie: salesCookie }, body: form() })).json() as Promise<{ data: ChatMessageView }>;
    const first = await post();
    const again = await post();
    expect(again.data.id).toBe(first.data.id);
    expect(await prisma.message.count({ where: { chatRoomId: room.id } })).toBe(1);
    expect(await prisma.messageAttachment.count({ where: { messageId: first.data.id } })).toBe(1);
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
    expect(page.body.data.items.map((m) => [m.isDeleted, m.content, m.attachments])).toEqual([
      [true, null, []],
      [true, null, []],
    ]);
    const list = await call<ChatRoomListItem[]>('GET', '/chat-rooms', qualityCookie);
    expect(list.body.data.find((r) => r.id === room.id)?.lastMessage?.preview).toBe('삭제된 메시지예요');
    expect((await call<ChatMessagePage>('GET', `/chat-rooms/${room.id}/messages/search?q=${encodeURIComponent('비밀')}`, qualityCookie)).body.data.items).toEqual([]);
    expect((await call<ChatMessagePage>('GET', `/chat-rooms/${room.id}/attachments`, qualityCookie)).body.data.items).toEqual([]);
    const download = await call('GET', `/attachments/${file.attachments[0].id}`, qualityCookie);
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

describe('13번: 이모지 반응', () => {
  it('누르면 더하고 다시 누르면 빼며, 이모지별 인원·내 반응·이름을 보여 주고 message:updated를 보낸다', async () => {
    const room = await createRoom(salesCookie, { chatRoomType: 'GROUP', memberIds: [qualityId, purchaseId] });
    const message = (await send(qualityCookie, room.id, '검사 끝났어요')).body.data;
    socketRecords.length = 0;

    await call('POST', `/messages/${message.id}/reactions`, salesCookie, { emoji: '👍' });
    await call('POST', `/messages/${message.id}/reactions`, purchaseCookie, { emoji: '👍' });
    const mine = await call<ChatMessageView>('POST', `/messages/${message.id}/reactions`, salesCookie, { emoji: '✅' });
    expect(mine.body.data.reactions).toEqual([
      { emoji: '👍', count: 2, reactedByMe: true, employeeNames: ['박서영', '정다은'] },
      { emoji: '✅', count: 1, reactedByMe: true, employeeNames: ['박서영'] },
    ]);
    expect(recordsOf('message:updated').length).toBeGreaterThanOrEqual(9);

    const removed = await call<ChatMessageView>('POST', `/messages/${message.id}/reactions`, salesCookie, { emoji: '👍' });
    expect(removed.body.data.reactions).toEqual([
      { emoji: '👍', count: 1, reactedByMe: false, employeeNames: ['정다은'] },
      { emoji: '✅', count: 1, reactedByMe: true, employeeNames: ['박서영'] },
    ]);
    const page = await call<ChatMessagePage>('GET', `/chat-rooms/${room.id}/messages`, purchaseCookie);
    expect(page.body.data.items[0].reactions[0]).toMatchObject({ emoji: '👍', reactedByMe: true });
  });

  it('23번 작은 철강맨 반응(sm:…)도 받고 이모지 뒤에 보이며, 목록에 없는 sm: 값은 COM-004', async () => {
    const room = await createRoom(salesCookie, { chatRoomType: 'GROUP', memberIds: [qualityId] });
    const message = (await send(qualityCookie, room.id, '출하 끝났어요')).body.data;
    await call('POST', `/messages/${message.id}/reactions`, salesCookie, { emoji: 'sm:thanks' });
    const both = await call<ChatMessageView>('POST', `/messages/${message.id}/reactions`, qualityCookie, { emoji: '👍' });
    expect(both.body.data.reactions).toEqual([
      { emoji: '👍', count: 1, reactedByMe: true, employeeNames: ['서민지'] },
      { emoji: 'sm:thanks', count: 1, reactedByMe: false, employeeNames: ['박서영'] },
    ]);
    const unknown = await call('POST', `/messages/${message.id}/reactions`, salesCookie, { emoji: 'sm:none' });
    expect([unknown.status, unknown.body.error?.code]).toEqual([400, 'COM-004']);
  });

  it('허용 목록 밖 이모지는 COM-004, 삭제된 메시지·비멤버는 막는다', async () => {
    const room = await createRoom(salesCookie, { chatRoomType: 'GROUP', memberIds: [qualityId] });
    const message = (await send(salesCookie, room.id, '지울 글')).body.data;
    const bad = await call('POST', `/messages/${message.id}/reactions`, salesCookie, { emoji: '🍕' });
    expect([bad.status, bad.body.error?.code]).toEqual([400, 'COM-004']);
    const outsider = await call('POST', `/messages/${message.id}/reactions`, purchaseCookie, { emoji: '👍' });
    expect(outsider.status).toBe(403);
    await call('DELETE', `/messages/${message.id}`, salesCookie);
    const deleted = await call('POST', `/messages/${message.id}/reactions`, qualityCookie, { emoji: '👍' });
    expect([deleted.status, deleted.body.error?.code]).toEqual([400, 'COM-004']);
  });
});

describe('14번: 방 알림 끄기 · 목록 위 고정', () => {
  const settings = (cookie: string, chatRoomId: number, body: object) => call<ChatRoomSettings>('PATCH', `/chat-rooms/${chatRoomId}/settings`, cookie, body);

  it('알림을 끈 멤버는 업무방 새 메시지 알림을 받지 않지만 멘션은 받는다. 설정은 나에게만 적용된다', async () => {
    const salesOrder = await createSalesOrder('SO-2610-914');
    const room = await createRoom(salesCookie, { chatRoomType: 'WORK', memberIds: [productionId, qualityId], salesOrderId: salesOrder.id });
    socketRecords.length = 0;
    const muted = await settings(qualityCookie, room.id, { muted: true });
    expect(muted.body.data).toEqual({ chatRoomId: room.id, muted: true, pinnedAt: null });
    expect(recordsOf('room:updated').map((r) => r.employeeId)).toEqual([qualityId]);

    const plain = (await send(salesCookie, room.id, '진행 공유')).body.data;
    const plainRows = await prisma.notification.findMany({ where: { messageId: plain.id } });
    expect(plainRows.map((r) => r.recipientId)).toEqual([productionId]);
    const mention = await call<ChatMessageView>('POST', `/chat-rooms/${room.id}/messages`, salesCookie, { content: '@서민지 확인', mentionedEmployeeIds: [qualityId] });
    const mentionRows = await prisma.notification.findMany({ where: { messageId: mention.body.data.id, recipientId: qualityId } });
    expect(mentionRows.map((r) => r.notificationType)).toEqual([NOTIFICATION_TYPE.MENTION]);

    const detail = await call<ChatRoomDetail>('GET', `/chat-rooms/${room.id}`, qualityCookie);
    expect(detail.body.data).toMatchObject({ muted: true, pinnedAt: null });
    const others = await call<ChatRoomDetail>('GET', `/chat-rooms/${room.id}`, salesCookie);
    expect(others.body.data.muted).toBe(false);
  });

  it('고정한 방은 목록 맨 위에 오고, 다시 고정해도 처음 시각을 두며, 해제하면 최근 대화 순으로 돌아간다', async () => {
    const pinnedRoom = await createRoom(salesCookie, { chatRoomType: 'GROUP', memberIds: [qualityId] });
    const recentRoom = await createRoom(salesCookie, { chatRoomType: 'GROUP', memberIds: [purchaseId] });
    await send(salesCookie, recentRoom.id, '최근 대화');
    const first = (await settings(salesCookie, pinnedRoom.id, { pinned: true })).body.data;
    expect(first.pinnedAt).not.toBeNull();
    const again = (await settings(salesCookie, pinnedRoom.id, { pinned: true })).body.data;
    expect(again.pinnedAt).toBe(first.pinnedAt);

    const list = (await call<ChatRoomListItem[]>('GET', '/chat-rooms', salesCookie)).body.data;
    expect(list[0]).toMatchObject({ id: pinnedRoom.id, pinnedAt: first.pinnedAt, muted: false });
    const qualityList = (await call<ChatRoomListItem[]>('GET', '/chat-rooms', qualityCookie)).body.data;
    expect(qualityList.find((r) => r.id === pinnedRoom.id)?.pinnedAt).toBeNull();

    await settings(salesCookie, pinnedRoom.id, { pinned: false });
    const after = (await call<ChatRoomListItem[]>('GET', '/chat-rooms', salesCookie)).body.data;
    expect(after.findIndex((r) => r.id === recentRoom.id)).toBeLessThan(after.findIndex((r) => r.id === pinnedRoom.id));
  });

  it('멤버가 아니면 COM-002, 형식이 틀리면 COM-004', async () => {
    const room = await createRoom(salesCookie, { chatRoomType: 'GROUP', memberIds: [qualityId] });
    expect((await settings(purchaseCookie, room.id, { muted: true })).status).toBe(403);
    const bad = await settings(salesCookie, room.id, { muted: 'yes' });
    expect([bad.status, bad.body.error?.code]).toEqual([400, 'COM-004']);
  });
});

describe('15번: 방 나가기', () => {
  it('그룹방에서 나가면 목록에서 사라지고 볼 수 없으며, 남은 멤버에게 시스템 메시지·room:updated를 보낸다', async () => {
    const room = await createRoom(salesCookie, { chatRoomType: 'GROUP', memberIds: [qualityId, purchaseId] });
    socketRecords.length = 0;
    const left = await call<LeaveChatRoomResult>('POST', `/chat-rooms/${room.id}/leave`, purchaseCookie);
    expect([left.status, left.body.data]).toEqual([200, { chatRoomId: room.id }]);
    expect(recordsOf('room:updated').map((r) => r.employeeId).sort()).toEqual([salesId, qualityId, purchaseId].sort());
    expect(recordsOf('message:new').map((r) => r.employeeId).sort()).toEqual([salesId, qualityId].sort());

    const list = (await call<ChatRoomListItem[]>('GET', '/chat-rooms', purchaseCookie)).body.data;
    expect(list.some((r) => r.id === room.id)).toBe(false);
    expect((await call('GET', `/chat-rooms/${room.id}/messages`, purchaseCookie)).status).toBe(403);
    const page = (await call<ChatMessagePage>('GET', `/chat-rooms/${room.id}/messages`, salesCookie)).body.data;
    expect(page.items.at(-1)).toMatchObject({ isSystem: true, content: '정다은님이 나갔어요' });
    expect((await call<ChatRoomDetail>('GET', `/chat-rooms/${room.id}`, salesCookie)).body.data.members.map((m) => m.id).sort()).toEqual([salesId, qualityId].sort());
  });

  it('업무방에서 나간 뒤 수주 화면에서 다시 열면 돌아온다', async () => {
    const salesOrder = await createSalesOrder('SO-2610-915');
    const room = await createRoom(salesCookie, { chatRoomType: 'WORK', memberIds: [productionId], salesOrderId: salesOrder.id });
    await call('POST', `/chat-rooms/${room.id}/leave`, salesCookie);
    const reopened = await createRoom(salesCookie, { chatRoomType: 'WORK', memberIds: [], salesOrderId: salesOrder.id });
    expect(reopened).toMatchObject({ id: room.id, reused: true });
    const page = (await call<ChatMessagePage>('GET', `/chat-rooms/${room.id}/messages`, salesCookie)).body.data;
    expect(page.items.at(-1)).toMatchObject({ isSystem: true, content: '박서영님이 들어왔어요' });
  });

  it('1:1 방은 COM-004, 멤버가 아니면 COM-002', async () => {
    const direct = await createRoom(salesCookie, { chatRoomType: 'DIRECT', memberIds: [qualityId] });
    const res = await call('POST', `/chat-rooms/${direct.id}/leave`, salesCookie);
    expect([res.status, res.body.error?.code]).toEqual([400, 'COM-004']);
    const group = await createRoom(salesCookie, { chatRoomType: 'GROUP', memberIds: [qualityId] });
    expect((await call('POST', `/chat-rooms/${group.id}/leave`, purchaseCookie)).status).toBe(403);
  });
});

describe('18번: 이모티콘', () => {
  it('이모티콘만 보내면 글 없이 저장되고, 목록·답글 미리보기는 "이모티콘 · 이름"이다', async () => {
    const room = await createRoom(salesCookie, { chatRoomType: 'GROUP', memberIds: [qualityId] });
    socketRecords.length = 0;
    const sent = await call<ChatMessageView>('POST', `/chat-rooms/${room.id}/messages`, salesCookie, { content: '', emoticonKey: 'steelman-approve' });
    expect(sent.status).toBe(201);
    expect(sent.body.data).toMatchObject({ content: null, emoticonKey: 'steelman-approve', attachments: [] });
    expect(recordsOf('message:new').map((r) => (r.payload as ChatMessageView).emoticonKey)).toEqual(['steelman-approve', 'steelman-approve']);
    const list = await call<ChatRoomListItem[]>('GET', '/chat-rooms', qualityCookie);
    expect(list.body.data.find((r) => r.id === room.id)?.lastMessage?.preview).toBe('이모티콘 · 결재 완료');
    const reply = await call<ChatMessageView>('POST', `/chat-rooms/${room.id}/messages`, qualityCookie, { content: '확인했어요', parentMessageId: sent.body.data.id });
    expect(reply.body.data.parent?.preview).toBe('이모티콘 · 결재 완료');
  });

  it('글과 함께 보내면 미리보기는 글이고, 글을 비우는 수정도 된다. 삭제하면 이모티콘도 비운다', async () => {
    const room = await createRoom(salesCookie, { chatRoomType: 'GROUP', memberIds: [qualityId] });
    const sent = (await call<ChatMessageView>('POST', `/chat-rooms/${room.id}/messages`, salesCookie, { content: '오늘 고생했어요', emoticonKey: 'steelman-off' })).body.data;
    const list = await call<ChatRoomListItem[]>('GET', '/chat-rooms', qualityCookie);
    expect(list.body.data.find((r) => r.id === room.id)?.lastMessage?.preview).toBe('오늘 고생했어요');
    const edited = await call<ChatMessageView>('PATCH', `/messages/${sent.id}`, salesCookie, { content: '' });
    expect(edited.body.data).toMatchObject({ content: null, emoticonKey: 'steelman-off' });
    const deleted = await call<ChatMessageView>('DELETE', `/messages/${sent.id}`, salesCookie);
    expect(deleted.body.data).toMatchObject({ isDeleted: true, emoticonKey: null });
  });

  it('19번 묶음에서 더한 이모티콘도 받고, 목록 미리보기는 "이모티콘 · 이름"이다', async () => {
    const room = await createRoom(salesCookie, { chatRoomType: 'GROUP', memberIds: [qualityId] });
    const sent = await call<ChatMessageView>('POST', `/chat-rooms/${room.id}/messages`, salesCookie, { content: '', emoticonKey: 'steelman-hot-rolling' });
    expect(sent.status).toBe(201);
    expect(sent.body.data).toMatchObject({ content: null, emoticonKey: 'steelman-hot-rolling' });
    const list = await call<ChatRoomListItem[]>('GET', '/chat-rooms', qualityCookie);
    expect(list.body.data.find((r) => r.id === room.id)?.lastMessage?.preview).toBe('이모티콘 · 열연 중');
  });

  it('23번 글 속 작은 이모티콘(:키:)은 본문 그대로 저장하고, 목록·답글·알림 미리보기는 (이름)으로 바꾼다. 모르는 키는 그대로', async () => {
    const room = await createRoom(salesCookie, { chatRoomType: 'GROUP', memberIds: [qualityId] });
    const sent = await call<ChatMessageView>('POST', `/chat-rooms/${room.id}/messages`, salesCookie, { content: ':steelman-ok: 확인했어요 :steelman-none:' });
    expect(sent.body.data).toMatchObject({ content: ':steelman-ok: 확인했어요 :steelman-none:', emoticonKey: null });
    const list = await call<ChatRoomListItem[]>('GET', '/chat-rooms', qualityCookie);
    expect(list.body.data.find((r) => r.id === room.id)?.lastMessage?.preview).toBe('(확인) 확인했어요 :steelman-none:');
    const reply = await call<ChatMessageView>('POST', `/chat-rooms/${room.id}/messages`, qualityCookie, { content: '네', parentMessageId: sent.body.data.id });
    expect(reply.body.data.parent?.preview).toBe('(확인) 확인했어요 :steelman-none:');
  });

  it('목록에 없는 이모티콘이나 글·이모티콘이 모두 없으면 COM-004', async () => {
    const room = await createRoom(salesCookie, { chatRoomType: 'GROUP', memberIds: [qualityId] });
    const unknown = await call('POST', `/chat-rooms/${room.id}/messages`, salesCookie, { content: '', emoticonKey: 'steelman-none' });
    const empty = await call('POST', `/chat-rooms/${room.id}/messages`, salesCookie, { content: '  ' });
    expect([unknown.status, unknown.body.error?.code]).toEqual([400, 'COM-004']);
    expect([empty.status, empty.body.error?.code]).toEqual([400, 'COM-004']);
    expect(await prisma.message.count({ where: { chatRoomId: room.id } })).toBe(0);
  });
});

describe('@AI 호출 (REQ-AST-002)', () => {
  const askSpy = () => jest.spyOn(app.get(AiAssistantService), 'ask');

  /** AI 답은 응답 뒤에 저장되므로 나타날 때까지 기다린다 */
  async function aiRepliesOf(chatRoomId: number, count: number) {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const rows = await prisma.message.findMany({ where: { chatRoomId, messageType: MESSAGE_TYPE.SYSTEM, content: { startsWith: AI_REPLY_MARK } }, orderBy: { id: 'asc' } });
      if (rows.length >= count) return rows;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('AI 답이 저장되지 않았어요');
  }

  afterEach(() => jest.restoreAllMocks());

  it('@AI가 든 메시지는 먼저 저장해 돌려주고, 묻는 사람 권한으로 물은 답을 시스템 메시지로 남겨 멤버에게 보낸다', async () => {
    const ask = askSpy().mockResolvedValue({ answer: '예약은 재고를 수주에 묶어 두는 것이에요.', sources: [{ kind: 'GLOSSARY', id: 'TRM-056', label: '예약' }], model: 'test-model', latencyMs: 1, toolCalls: [], thinking: null, reasoningApplied: true, actionCards: [] });
    const room = await createRoom(salesCookie, { chatRoomType: 'GROUP', memberIds: [qualityId] });
    await send(qualityCookie, room.id, '예약이 뭐였죠?');

    const sent = await send(salesCookie, room.id, '@AI 예약이 뭐야?');
    expect(sent.status).toBe(201);
    expect(sent.body.data).toMatchObject({ content: '@AI 예약이 뭐야?', isAi: false });

    const [reply] = await aiRepliesOf(room.id, 1);
    expect(ask).toHaveBeenCalledTimes(1);
    const [user, input] = ask.mock.calls[0];
    expect(user.employeeId).toBe(salesId);
    expect(input).toMatchObject({ question: '예약이 뭐야?', screen: { title: '사내 채팅', label: null } });
    expect(input.history).toEqual([{ role: 'user', content: '서민지: 예약이 뭐였죠?' }]);

    const delivered = socketRecords.filter((r) => r.event === 'message:new' && (r.payload as ChatMessageView).id === reply.id);
    expect(delivered.map((r) => r.employeeId).sort()).toEqual([salesId, qualityId].sort());
    expect(delivered[0].payload).toMatchObject({
      isAi: true,
      isSystem: true,
      senderId: null,
      senderName: AI_SENDER_NAME,
      content: '박서영님의 질문에 답해요\n\n예약은 재고를 수주에 묶어 두는 것이에요.\n\n출처: 용어 사전 · 예약',
    });
    const page = await call<ChatMessagePage>('GET', `/chat-rooms/${room.id}/messages`, qualityCookie);
    expect(page.body.data.items.at(-1)).toMatchObject({ isAi: true, senderName: AI_SENDER_NAME });
    const list = await call<ChatRoomListItem[]>('GET', '/chat-rooms', qualityCookie);
    expect(list.body.data.find((r) => r.id === room.id)?.lastMessage).toMatchObject({ senderName: AI_SENDER_NAME, preview: expect.stringMatching(/^박서영님의 질문에 답해요 예약은/) });
  });

  it('질문이 없거나 @AI가 아닌 글(@AIR)은 AI를 부르지 않는다 (질문이 없으면 안내만)', async () => {
    const ask = askSpy();
    const room = await createRoom(salesCookie, { chatRoomType: 'GROUP', memberIds: [qualityId] });
    await send(salesCookie, room.id, '@AIR 부서 회의');
    await send(salesCookie, room.id, '@AI');
    const [reply] = await aiRepliesOf(room.id, 1);
    expect(ask).not.toHaveBeenCalled();
    expect(reply.content).toBe(`${AI_REPLY_PREFIX}@AI 뒤에 묻고 싶은 내용을 적어 주세요`);
    expect(await prisma.message.count({ where: { chatRoomId: room.id, messageType: MESSAGE_TYPE.SYSTEM } })).toBe(1);
  });

  it('AI가 답하지 못하면(LLM 연결 실패 등) 이유를 같은 방식으로 방에 알린다', async () => {
    askSpy().mockRejectedValue(new AppException('COM-999', 'AI 모델이 아직 정해지지 않았어요', HttpStatus.SERVICE_UNAVAILABLE));
    const room = await createRoom(salesCookie, { chatRoomType: 'GROUP', memberIds: [qualityId] });
    await send(salesCookie, room.id, '@AI 재고 알려줘');
    const [reply] = await aiRepliesOf(room.id, 1);
    expect(reply.content).toBe(`${AI_REPLY_PREFIX}박서영님의 질문에 답하지 못했어요. AI 모델이 아직 정해지지 않았어요`);
  });

  it('조회 데이터로 답한 AI 답은 그 데이터를 볼 권한이 있는 멤버에게만 보낸다 (소켓·목록·방 목록 미리보기·이어 묻는 맥락)', async () => {
    // 관리자가 정다은(구매)의 수주 조회 권한을 뺀 경우. 박서영(영업)이 수주 조회 도구로 답을 받는다
    const restore = await revokeRolePermission('PURCHASE', 'SALES_ORDER_CREATE');
    try {
      const ask = askSpy().mockResolvedValue({
        answer: 'SO-2610-001은 납기가 11월 20일이에요.',
        sources: [{ kind: 'DATA', id: 'get_sales_orders', label: '수주 · SO-2610-001' }],
        model: 'test-model',
        latencyMs: 1,
        toolCalls: [],
        thinking: null,
        reasoningApplied: true,
actionCards: [],
      });
      const room = await createRoom(salesCookie, { chatRoomType: 'GROUP', memberIds: [purchaseId] });
      await send(salesCookie, room.id, '@AI SO-2610-001 납기 알려줘');
      const [reply] = await aiRepliesOf(room.id, 1);

      expect(reply.content?.startsWith('[AI 어시스턴트:get_sales_orders] ')).toBe(true);
      const delivered = socketRecords.filter((r) => r.event === 'message:new' && (r.payload as ChatMessageView).id === reply.id);
      expect(delivered.map((r) => r.employeeId)).toEqual([salesId]);
      expect(delivered[0].payload).toMatchObject({ isAi: true, content: expect.stringContaining('납기가 11월 20일') });

      const salesPage = await call<ChatMessagePage>('GET', `/chat-rooms/${room.id}/messages`, salesCookie);
      const purchasePage = await call<ChatMessagePage>('GET', `/chat-rooms/${room.id}/messages`, purchaseCookie);
      expect(salesPage.body.data.items.at(-1)).toMatchObject({ isAi: true });
      expect(purchasePage.body.data.items.map((m) => m.isAi)).toEqual([false]);
      const purchaseSearch = await call<ChatMessagePage>('GET', `/chat-rooms/${room.id}/messages/search?q=${encodeURIComponent('납기')}`, purchaseCookie);
      expect(purchaseSearch.body.data.items.map((m) => m.isAi)).toEqual([false]);
      const purchaseRooms = await call<ChatRoomListItem[]>('GET', '/chat-rooms', purchaseCookie);
      expect(purchaseRooms.body.data.find((r) => r.id === room.id)?.lastMessage?.preview).toBe('AI 어시스턴트가 답했어요');

      // 정다은이 이어 물어도 박서영에게만 보인 답은 맥락으로 넘어가지 않는다
      ask.mockResolvedValue({ answer: '확인할 수 없어요', sources: [], model: 'test-model', latencyMs: 1, toolCalls: [], thinking: null, reasoningApplied: true, actionCards: [] });
      await send(purchaseCookie, room.id, '@AI 방금 뭐라고 했어?');
      await aiRepliesOf(room.id, 2);
      const history = ask.mock.calls[1][1].history ?? [];
      expect(history.some((turn) => turn.content.includes('납기가 11월 20일'))).toBe(false);
    } finally {
      await restore();
    }
  });

  it('AI가 답을 만드는 동안 방 멤버에게 입력 중(AI 표시)을 보낸다', async () => {
    let finish: (reply: Awaited<ReturnType<AiAssistantService['ask']>>) => void = () => undefined;
    askSpy().mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const room = await createRoom(salesCookie, { chatRoomType: 'GROUP', memberIds: [qualityId] });
    await send(salesCookie, room.id, '@AI 안녕');
    for (let attempt = 0; attempt < 50 && typingRecords.length < 2; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 50));
    expect(typingRecords.map((r) => r.employeeId).sort()).toEqual([salesId, qualityId].sort());
    expect(typingRecords[0].event).toEqual({ chatRoomId: room.id, employeeId: AI_TYPING_EMPLOYEE_ID, employeeName: AI_SENDER_NAME });
    finish({ answer: '안녕하세요', sources: [], model: 'test-model', latencyMs: 1, toolCalls: [], thinking: null, reasoningApplied: true, actionCards: [] });
    await aiRepliesOf(room.id, 1);
    // 답이 저장되면 더 보내지 않는다
    const sentCount = typingRecords.length;
    await new Promise((resolve) => setTimeout(resolve, TYPING_SEND_INTERVAL_MS + 500));
    expect(typingRecords.length).toBe(sentCount);
  }, 15_000);

  it('지난 대화 찾기(이슈 #412): 이 방 메시지만, 지운 글은 빼고, AI 답은 철강맨AI로, 묻는 사람이 못 보는 AI 답은 뺀다', async () => {
    const restore = await revokeRolePermission('PURCHASE', 'SALES_ORDER_CREATE');
    try {
      const reply = (answer: string, withData: boolean) => ({ answer, sources: withData ? [{ kind: 'DATA' as const, id: 'get_sales_orders', label: '수주 · SO-2610-001' }] : [], model: 'test-model', latencyMs: 1, toolCalls: [], thinking: null, reasoningApplied: true, actionCards: [] });
      const ask = askSpy().mockResolvedValueOnce(reply('기억검색 출하 일정은 11월 20일이에요.', true)).mockResolvedValue(reply('알겠어요', false));
      const room = await createRoom(salesCookie, { chatRoomType: 'GROUP', memberIds: [purchaseId, qualityId] });
      const otherRoom = await createRoom(qualityCookie, { chatRoomType: 'GROUP', memberIds: [salesId] });
      await send(qualityCookie, otherRoom.id, '기억검색 출하 일정은 다른 방 이야기');
      await send(qualityCookie, room.id, '기억검색 출하 일정은 금요일로 정했어요');
      const removed = await send(qualityCookie, room.id, '기억검색 출하 일정 지울 글');
      await call('DELETE', `/messages/${removed.body.data.id}`, qualityCookie);

      // 영업(박서영)이 묻고, 데이터를 쓴 AI 답이 방에 남는다
      await send(salesCookie, room.id, '@AI 기억검색 출하 일정 알려줘');
      await aiRepliesOf(room.id, 1);
      // 영업과 구매가 각각 이어 묻는다
      await send(salesCookie, room.id, '@AI 기억검색 출하 일정 다시');
      await aiRepliesOf(room.id, 2);
      await send(purchaseCookie, room.id, '@AI 기억검색 출하 일정 뭐였죠?');
      await aiRepliesOf(room.id, 3);

      const sourceOf = (index: number): HistorySearchSource => {
        const options = ask.mock.calls[index][2];
        if (!options?.historySearch) throw new Error('historySearch 없음');
        return options.historySearch;
      };
      expect(ask.mock.calls.map((c) => c[2]?.historySearch?.kind)).toEqual(['room', 'room', 'room']);

      const salesHits = await sourceOf(1).search(['기억검색', '출하', '일정'], 8);
      const salesTexts = salesHits.map((h) => `${h.who}: ${h.text}`);
      expect(salesTexts).toEqual(expect.arrayContaining(['서민지: 기억검색 출하 일정은 금요일로 정했어요', '박서영: @AI 기억검색 출하 일정 알려줘']));
      // AI 답은 표식·접두어 없이 철강맨AI의 말로
      expect(salesHits.filter((h) => h.who === '철강맨AI').map((h) => h.text)).toEqual([expect.stringContaining('기억검색 출하 일정은 11월 20일이에요.')]);
      expect(salesTexts.join('\n')).not.toContain(AI_REPLY_MARK);
      // 지운 글·다른 방 글은 없다. 새것부터, 방이라 where는 없다
      expect(salesTexts.join('\n')).not.toContain('지울 글');
      expect(salesTexts.join('\n')).not.toContain('다른 방');
      expect(salesHits.every((h) => h.where === null)).toBe(true);
      const times = salesHits.map((h) => h.at.getTime());
      expect(times).toEqual([...times].sort((a, b) => b - a));

      // 구매(정다은)는 수주 조회 권한이 없어 영업에게만 보인 AI 답을 찾을 수 없다. 사람 글은 그대로 찾는다
      const purchaseHits = await sourceOf(2).search(['기억검색', '출하', '일정'], 8);
      const purchaseTexts = purchaseHits.map((h) => `${h.who}: ${h.text}`);
      expect(purchaseTexts.join('\n')).not.toContain('11월 20일');
      expect(purchaseTexts).toEqual(expect.arrayContaining(['서민지: 기억검색 출하 일정은 금요일로 정했어요']));

      // 한도를 지킨다
      expect(await sourceOf(1).search(['기억검색'], 2)).toHaveLength(2);
    } finally {
      await restore();
    }
  });

  it('같은 보내기 id로 다시 보내면(재전송) AI를 다시 부르지 않는다', async () => {
    const ask = askSpy().mockResolvedValue({ answer: '답이에요', sources: [], model: 'test-model', latencyMs: 1, toolCalls: [], thinking: null, reasoningApplied: true, actionCards: [] });
    const room = await createRoom(salesCookie, { chatRoomType: 'GROUP', memberIds: [qualityId] });
    const body = { content: '@AI 안녕', clientMessageId: 'ai-resend-1' };
    await call<ChatMessageView>('POST', `/chat-rooms/${room.id}/messages`, salesCookie, body);
    await aiRepliesOf(room.id, 1);
    const again = await call<ChatMessageView>('POST', `/chat-rooms/${room.id}/messages`, salesCookie, body);
    expect(again.status).toBe(201);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(ask).toHaveBeenCalledTimes(1);
    expect(await prisma.message.count({ where: { chatRoomId: room.id, content: { startsWith: AI_REPLY_PREFIX } } })).toBe(1);
  });
});
