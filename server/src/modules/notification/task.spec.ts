// 업무 API(목록 API-239, 등록 API-240, 완료 API-241)를 실제 앱과 DB(fs_collab)로 확인한다. 사원은 시드(seed.md)를 쓴다.
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import type { PageResult, TaskView } from '@fantasteel/shared';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';

let app: INestApplication;
let baseUrl: string;
let prisma: PrismaService;
/** 정다은 (구매) */
let purchaseCookie: string;
/** 최준혁 (구매부 부서장) */
let headCookie: string;
let purchaseId: number;
let headId: number;

async function login(employeeNo: string, password = process.env.SEED_PASSWORD ?? 'fantasteel'): Promise<string> {
  const res = await fetch(`${baseUrl}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ employeeNo, password }) });
  if (!res.ok) throw new Error(`로그인 실패 (HTTP ${res.status})`);
  return (res.headers.get('set-cookie') ?? '').split(';')[0];
}

async function call<T>(method: 'GET' | 'POST' | 'PATCH', path: string, cookie: string, payload?: unknown) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { cookie, ...(payload === undefined ? {} : { 'content-type': 'application/json' }) },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  return { status: res.status, body: (await res.json()) as { success: boolean; data: T; error?: { code: string } } };
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(0);
  baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1`;
  prisma = app.get(PrismaService);
  purchaseCookie = await login('2207005');
  headCookie = await login('1702004');
  purchaseId = (await prisma.employee.findUniqueOrThrow({ where: { employeeNo: '2207005' } })).id;
  headId = (await prisma.employee.findUniqueOrThrow({ where: { employeeNo: '1702004' } })).id;
}, 60_000);

afterAll(async () => {
  await app?.close();
});

const newTask = (overrides: Record<string, unknown> = {}) => ({ taskTitle: '  원료 입고 일정 확인  ', taskDescription: '', assigneeId: purchaseId, dueDate: '2026-10-20', ...overrides });

describe('POST /tasks (API-240)', () => {
  it('진행(OPEN)으로 등록하고, 담당자가 다른 사람이면 같은 거래에서 업무 지정 알림을 보낸다', async () => {
    const { status, body } = await call<TaskView>('POST', '/tasks', headCookie, newTask());
    expect(status).toBe(201);
    expect(body.data).toMatchObject({ taskTitle: '원료 입고 일정 확인', taskDescription: null, assigneeId: purchaseId, assigneeName: '정다은', dueDate: '2026-10-20', taskStatus: 'OPEN' });
    const sent = await prisma.notification.findMany({ where: { recipientId: purchaseId, notificationType: 'TASK_ASSIGNED' } });
    expect(sent.map((n) => [n.notificationContent, n.linkPath])).toEqual([['업무 지정 · 원료 입고 일정 확인', '/tasks']]);
    // 등록자는 로그인 사원 (ERD task.creator_id, 2026-10-08)
    expect((await prisma.task.findUniqueOrThrow({ where: { id: body.data.id } })).creatorId).toBe(headId);
  });

  it('나에게 맡기는 업무는 알림이 없다', async () => {
    const before = await prisma.notification.count({ where: { recipientId: headId } });
    await call<TaskView>('POST', '/tasks', headCookie, newTask({ assigneeId: headId, taskTitle: '내 할 일' }));
    expect(await prisma.notification.count({ where: { recipientId: headId } })).toBe(before);
  });

  it('없는·퇴사한 담당자는 COM-003, 형식이 틀리거나 없는 날짜·빈 제목은 COM-004 (알림도 남지 않는다)', async () => {
    const retired = await prisma.employee.findFirstOrThrow({ where: { employeeNo: '2304015' } });
    await prisma.employee.update({ where: { id: retired.id }, data: { isActive: false } });
    try {
      expect((await call('POST', '/tasks', headCookie, newTask({ assigneeId: 999999 }))).body.error?.code).toBe('COM-003');
      expect((await call('POST', '/tasks', headCookie, newTask({ assigneeId: retired.id }))).body.error?.code).toBe('COM-003');
    } finally {
      await prisma.employee.update({ where: { id: retired.id }, data: { isActive: true } });
    }
    expect(await prisma.notification.count({ where: { recipientId: retired.id } })).toBe(0);
    expect((await call('POST', '/tasks', headCookie, newTask({ dueDate: '2026/10/20' }))).body.error?.code).toBe('COM-004');
    expect((await call('POST', '/tasks', headCookie, newTask({ dueDate: '2026-02-30' }))).body.error?.code).toBe('COM-004');
    expect((await call('POST', '/tasks', headCookie, newTask({ taskTitle: '   ' }))).body.error?.code).toBe('COM-004');
  });
});

describe('GET /tasks (API-239)', () => {
  it('내 담당 업무만 마감일 빠른 순으로 주고, 상태로 거른다', async () => {
    await call('POST', '/tasks', headCookie, newTask({ taskTitle: '나중 업무', dueDate: '2026-11-30' }));
    await call('POST', '/tasks', headCookie, newTask({ taskTitle: '급한 업무', dueDate: '2026-10-08' }));
    const { body } = await call<PageResult<TaskView>>('GET', '/tasks', purchaseCookie);
    expect(body.data.items.every((t) => t.assigneeId === purchaseId)).toBe(true);
    expect(body.data.items[0].taskTitle).toBe('급한 업무');
    expect(body.data.items.map((t) => t.dueDate)).toEqual([...body.data.items.map((t) => t.dueDate)].sort());
    expect((await call<PageResult<TaskView>>('GET', '/tasks?taskStatus=DONE', purchaseCookie)).body.data.items).toEqual([]);
    expect((await call('GET', '/tasks?taskStatus=CLOSED', purchaseCookie)).body.error?.code).toBe('COM-004');
  });
});

describe('POST /tasks/:id/complete (API-241)', () => {
  it('담당자 본인만 완료하고(아니면 COM-002), 이미 완료면 COM-001, 없는 업무는 COM-003', async () => {
    const created = (await call<TaskView>('POST', '/tasks', headCookie, newTask({ taskTitle: '완료 확인' }))).body.data;
    expect((await call('POST', `/tasks/${created.id}/complete`, headCookie)).body.error?.code).toBe('COM-002');

    const done = await call<TaskView>('POST', `/tasks/${created.id}/complete`, purchaseCookie);
    expect(done.status).toBe(200);
    expect(done.body.data.taskStatus).toBe('DONE');
    expect((await call('POST', `/tasks/${created.id}/complete`, purchaseCookie)).body.error?.code).toBe('COM-001');
    expect((await call('POST', '/tasks/999999/complete', purchaseCookie)).body.error?.code).toBe('COM-003');
    expect((await call<PageResult<TaskView>>('GET', '/tasks?taskStatus=DONE', purchaseCookie)).body.data.items.map((t) => t.id)).toEqual([created.id]);
  });
});

describe('메시지에서 업무 등록 (16번, messageId)', () => {
  async function roomWithMessage(): Promise<{ chatRoomId: number; messageId: number }> {
    const room = await call<{ id: number }>('POST', '/chat-rooms', headCookie, { chatRoomType: 'GROUP', memberIds: [purchaseId] });
    const message = await call<{ id: number }>('POST', `/chat-rooms/${room.body.data.id}/messages`, headCookie, { content: '원료 입고 일정 확인 부탁해요' });
    return { chatRoomId: room.body.data.id, messageId: message.body.data.id };
  }

  it('방 멤버가 메시지로 업무를 등록하면 원본 메시지가 남고 메신저로 가는 경로를 준다', async () => {
    const { chatRoomId, messageId } = await roomWithMessage();
    const created = await call<TaskView>('POST', '/tasks', headCookie, newTask({ taskTitle: '입고 일정 확인', messageId }));
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ messageId, linkPath: `/messenger?room=${chatRoomId}&message=${messageId}` });
    const mine = await call<PageResult<TaskView>>('GET', '/tasks', purchaseCookie);
    expect(mine.body.data.items.find((t) => t.id === created.body.data.id)?.linkPath).toBe(`/messenger?room=${chatRoomId}&message=${messageId}`);
    const plain = await call<TaskView>('POST', '/tasks', headCookie, newTask({ taskTitle: '그냥 업무' }));
    expect(plain.body.data).toMatchObject({ messageId: null, linkPath: null });
  });

  it('없는 메시지 COM-003, 방 멤버가 아니면 COM-002, 삭제된 메시지 COM-004 (업무가 남지 않는다)', async () => {
    const { messageId } = await roomWithMessage();
    const before = await prisma.task.count();
    const missing = await call('POST', '/tasks', headCookie, newTask({ messageId: 999_999 }));
    expect([missing.status, missing.body.error?.code]).toEqual([404, 'COM-003']);
    const salesCookie = await login('2103003');
    const outsider = await call('POST', '/tasks', salesCookie, newTask({ messageId }));
    expect([outsider.status, outsider.body.error?.code]).toEqual([403, 'COM-002']);
    await fetch(`${baseUrl}/messages/${messageId}`, { method: 'DELETE', headers: { cookie: headCookie } });
    const deleted = await call('POST', '/tasks', headCookie, newTask({ messageId }));
    expect([deleted.status, deleted.body.error?.code]).toEqual([400, 'COM-004']);
    expect(await prisma.task.count()).toBe(before);
  });
});

// ── 등록자·범위·연결 화면·수정 (API-239 scope, API-274, 2026-10-08) ──

describe('업무 범위·연결 화면 (API-239·240)', () => {
  it('scope=created는 내가 등록한 업무, all은 담당하거나 등록한 업무이고 등록자 이름을 준다. 기본은 내 담당', async () => {
    const created = (await call<TaskView>('POST', '/tasks', headCookie, newTask({ taskTitle: '범위 확인' }))).body.data;
    expect(created).toMatchObject({ creatorId: headId, creatorName: '최준혁' });
    const ids = async (cookie: string, query: string) => (await call<PageResult<TaskView>>('GET', `/tasks${query}`, cookie)).body.data.items.map((t) => t.id);
    expect(await ids(headCookie, '')).not.toContain(created.id);
    expect(await ids(headCookie, '?scope=created')).toContain(created.id);
    expect(await ids(headCookie, '?scope=all')).toContain(created.id);
    expect(await ids(purchaseCookie, '?scope=all')).toContain(created.id);
    expect((await call('GET', '/tasks?scope=everyone', headCookie)).body.error?.code).toBe('COM-004');
  });

  it('연결 화면은 "/"로 시작하는 경로만 받고, 메시지 경로보다 먼저 보여 준다', async () => {
    const linked = await call<TaskView>('POST', '/tasks', headCookie, newTask({ linkPath: '/goods-receipts' }));
    expect(linked.body.data.linkPath).toBe('/goods-receipts');
    expect((await call('POST', '/tasks', headCookie, newTask({ linkPath: 'goods-receipts' }))).body.error?.code).toBe('COM-004');
    expect((await call('POST', '/tasks', headCookie, newTask({ linkPath: '//evil.example' }))).body.error?.code).toBe('COM-004');
  });
});

describe('PATCH /tasks/:id (API-274)', () => {
  it('등록자가 내용을 고치고, 담당자를 바꾸면 새 담당자에게 업무 지정 알림을 보낸다', async () => {
    const sales = await prisma.employee.findUniqueOrThrow({ where: { employeeNo: '2103003' } });
    const created = (await call<TaskView>('POST', '/tasks', headCookie, newTask({ taskTitle: '고칠 업무', linkPath: '/mrp' }))).body.data;
    const edited = await call<TaskView>('PATCH', `/tasks/${created.id}`, headCookie, { taskTitle: ' 고친 업무 ', dueDate: '2026-10-25', linkPath: null, assigneeId: sales.id });
    expect(edited.status).toBe(200);
    expect(edited.body.data).toMatchObject({ taskTitle: '고친 업무', dueDate: '2026-10-25', linkPath: null, assigneeId: sales.id, creatorId: headId });
    const sent = await prisma.notification.findMany({ where: { recipientId: sales.id, notificationType: 'TASK_ASSIGNED', notificationContent: '업무 지정 · 고친 업무' } });
    expect(sent).toHaveLength(1);
  });

  it('담당자도 고칠 수 있고, 등록자·담당자가 아니면 COM-002, 완료된 업무는 COM-001', async () => {
    const created = (await call<TaskView>('POST', '/tasks', headCookie, newTask({ taskTitle: '담당자 수정' }))).body.data;
    expect((await call<TaskView>('PATCH', `/tasks/${created.id}`, purchaseCookie, { taskDescription: '진행 중' })).body.data.taskDescription).toBe('진행 중');
    expect((await call('PATCH', `/tasks/${created.id}`, await login('2103003'), { taskTitle: '남의 업무' })).body.error?.code).toBe('COM-002');
    await call('POST', `/tasks/${created.id}/complete`, purchaseCookie);
    expect((await call('PATCH', `/tasks/${created.id}`, headCookie, { taskTitle: '완료 뒤' })).body.error?.code).toBe('COM-001');
  });

  it('없는 업무·퇴사한 담당자는 COM-003, 빈 제목·없는 날짜는 COM-004', async () => {
    const created = (await call<TaskView>('POST', '/tasks', headCookie, newTask())).body.data;
    expect((await call('PATCH', '/tasks/999999', headCookie, { taskTitle: '없음' })).body.error?.code).toBe('COM-003');
    expect((await call('PATCH', `/tasks/${created.id}`, headCookie, { assigneeId: 999_999 })).body.error?.code).toBe('COM-003');
    expect((await call('PATCH', `/tasks/${created.id}`, headCookie, { taskTitle: '   ' })).body.error?.code).toBe('COM-004');
    expect((await call('PATCH', `/tasks/${created.id}`, headCookie, { dueDate: '2026-02-30' })).body.error?.code).toBe('COM-004');
  });
});
