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

async function call<T>(method: 'GET' | 'POST', path: string, cookie: string, payload?: unknown) {
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
