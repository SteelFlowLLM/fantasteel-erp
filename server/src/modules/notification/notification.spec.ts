// 알림: 발송 함수(notifyEmployees·notifyDepartment)와 API(목록 API-242, 읽음 처리 임시 API)를 실제 앱과 DB(fs_collab)로 확인한다.
// 권한 가드·쿼리 변환까지 보려고 API는 HTTP로 부른다. 사원·부서는 시드(seed.md)를 쓴다.
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import { NOTIFICATION_TYPE, type NotificationPage, type NotificationReadAllResult, type NotificationView } from '@fantasteel/shared';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationService } from './notification.service';

let app: INestApplication;
let baseUrl: string;
let prisma: PrismaService;
let notifications: NotificationService;
/** 정다은 (구매부) */
let purchaseCookie: string;
/** 최준혁 (구매부 부서장) */
let headCookie: string;
let purchaseId: number;
let headId: number;
let purchaseDepartmentId: number;

async function login(employeeNo: string, password = process.env.SEED_PASSWORD ?? 'fantasteel'): Promise<string> {
  const res = await fetch(`${baseUrl}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ employeeNo, password }) });
  if (!res.ok) throw new Error(`로그인 실패 (HTTP ${res.status})`);
  return (res.headers.get('set-cookie') ?? '').split(';')[0];
}

async function call<T>(method: 'GET' | 'POST', path: string, cookie: string) {
  const res = await fetch(`${baseUrl}${path}`, { method, headers: { cookie } });
  return { status: res.status, body: (await res.json()) as { success: boolean; data: T; error?: { code: string } } };
}

const employeeOf = (employeeNo: string) => prisma.employee.findUniqueOrThrow({ where: { employeeNo } });

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(0);
  baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1`;
  prisma = app.get(PrismaService);
  notifications = app.get(NotificationService);
  purchaseCookie = await login('2207005');
  headCookie = await login('1702004');
  const purchase = await employeeOf('2207005');
  purchaseId = purchase.id;
  purchaseDepartmentId = purchase.departmentId;
  headId = (await employeeOf('1702004')).id;
}, 60_000);

afterAll(async () => {
  await app?.close();
});

const mention = (notificationContent: string) => ({ notificationType: NOTIFICATION_TYPE.MENTION, notificationContent, linkPath: '/messenger' });

describe('발송 함수 (다른 모듈이 본 거래 tx에서 부른다)', () => {
  it('같은 작업 로그로 같은 사람에게 다시 보내면 건너뛰고, 받는 사람 id가 겹쳐도 한 행이다', async () => {
    const event = await prisma.businessEvent.create({
      data: { businessEventNo: 'EV-261007-901', businessEventType: 'PURCHASE_REQUISITION_CREATED', actorType: 'USER', actorEmployeeId: purchaseId, targetType: 'purchase_requisition', targetId: 1 },
    });
    const input = { ...mention('중복 확인'), businessEventId: event.id };
    const first = await prisma.$transaction((tx) => notifications.notifyEmployees(tx, [headId, headId, purchaseId], input));
    const second = await prisma.$transaction((tx) => notifications.notifyEmployees(tx, [headId], input));
    expect([first, second]).toEqual([2, 0]);
    expect(await prisma.notification.count({ where: { businessEventId: event.id } })).toBe(2);
  });

  it('부서 알림은 그 부서의 재직 중 사원 수만큼 행을 만든다', async () => {
    const members = await prisma.employee.count({ where: { departmentId: purchaseDepartmentId, isActive: true } });
    const created = await prisma.$transaction((tx) => notifications.notifyDepartment(tx, purchaseDepartmentId, mention('구매부 공지')));
    expect(created).toBe(members);
    expect(await prisma.notification.count({ where: { notificationContent: '구매부 공지' } })).toBe(members);
  });

  it('본 거래가 롤백되면 알림도 남지 않는다', async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await notifications.notifyEmployees(tx, [headId], mention('롤백 확인'));
        throw new Error('본 거래 실패');
      }),
    ).rejects.toThrow('본 거래 실패');
    expect(await prisma.notification.count({ where: { notificationContent: '롤백 확인' } })).toBe(0);
  });
});

describe('GET /notifications (API-242)', () => {
  it('내 알림만 최신순으로 주고 안 읽은 수를 함께 준다. unreadOnly면 안 읽은 것만', async () => {
    await prisma.$transaction((tx) => notifications.notifyEmployees(tx, [purchaseId], mention('정다은 최신')));
    const { status, body } = await call<NotificationPage>('GET', '/notifications?page=1&size=2', purchaseCookie);
    expect(status).toBe(200);
    expect(body.data.items[0]).toMatchObject({ notificationType: 'MENTION', notificationContent: '정다은 최신', linkPath: '/messenger', readAt: null });
    expect(body.data).toMatchObject({ page: 1, size: 2 });
    const mine = await prisma.notification.count({ where: { recipientId: purchaseId } });
    expect(body.data.total).toBe(mine);
    expect(body.data.unreadCount).toBe(mine);

    const head = await call<NotificationPage>('GET', '/notifications?unreadOnly=true', headCookie);
    expect(head.body.data.items.every((n) => n.readAt === null)).toBe(true);
    expect(head.body.data.items.map((n) => n.notificationContent)).not.toContain('정다은 최신');
  });

  it('쿼리 형식이 틀리면 COM-004', async () => {
    expect((await call('GET', '/notifications?unreadOnly=yes', purchaseCookie)).body.error?.code).toBe('COM-004');
  });
});

describe('읽음 처리 (임시 API)', () => {
  it('내 알림을 읽음으로 바꾸고, 다시 불러도 읽은 시각은 그대로다. 남의 알림은 COM-002, 없는 알림은 COM-003', async () => {
    await prisma.$transaction((tx) => notifications.notifyEmployees(tx, [purchaseId], mention('읽음 확인')));
    const target = await prisma.notification.findFirstOrThrow({ where: { recipientId: purchaseId, notificationContent: '읽음 확인' } });

    expect((await call('POST', `/notifications/${target.id}/read`, headCookie)).body.error?.code).toBe('COM-002');
    expect((await call('POST', '/notifications/999999/read', purchaseCookie)).body.error?.code).toBe('COM-003');

    const first = await call<NotificationView>('POST', `/notifications/${target.id}/read`, purchaseCookie);
    expect(first.status).toBe(200);
    expect(first.body.data.readAt).not.toBeNull();
    const again = await call<NotificationView>('POST', `/notifications/${target.id}/read`, purchaseCookie);
    expect(again.body.data.readAt).toBe(first.body.data.readAt);
  });

  it('모두 읽음은 내 안 읽은 알림만 바꾸고 바꾼 수를 돌려준다', async () => {
    const unread = await prisma.notification.count({ where: { recipientId: purchaseId, readAt: null } });
    const headUnread = await prisma.notification.count({ where: { recipientId: headId, readAt: null } });
    const { body } = await call<NotificationReadAllResult>('POST', '/notifications/read-all', purchaseCookie);
    expect(body.data.readCount).toBe(unread);
    expect((await call<NotificationPage>('GET', '/notifications', purchaseCookie)).body.data.unreadCount).toBe(0);
    expect(await prisma.notification.count({ where: { recipientId: headId, readAt: null } })).toBe(headUnread);
  });
});
