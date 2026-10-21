// 외부 연결 장애 알림 (이슈 #518)을 실제 앱·DB(fs_collab)로 확인한다: 장애 → 연동 관리 권한자에게 알림 한 번,
// 같은 장애를 되풀이해도 다시 안 가고(하루 안), 풀리면 복구 알림 한 번, 서버가 두 대여도(앱 두 개) 한 번.
// Notion·Google 호출 흐름(토큰 거절·서비스 계정 키 오류)은 integration.spec.ts·google-drive*.spec.ts가 본다.
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import { NOTIFICATION_TYPE, PERMISSION, PERMISSION_LEVEL, type IntegrationConnectionView, type NotificationPage } from '@fantasteel/shared';
import { AppModule } from '../../app.module';
import { AppException } from '../../common/errors/app.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { FAULT_REPEAT_MS } from './integration-fault.rules';
import { IntegrationFaultRepository } from './integration-fault.repository';
import { IntegrationFaultService } from './integration-fault.service';

let app: INestApplication;
let secondApp: INestApplication;
let baseUrl: string;
let prisma: PrismaService;
let faults: IntegrationFaultService;
let adminCookie: string;
/** 연동 관리 권한자(ORG_MANAGE 사용)인 재직 사원 id */
let managerIds: number[];
/** 권한이 없는 사원 (영업) */
let salesId: number;

async function login(employeeNo: string): Promise<string> {
  const res = await fetch(`${baseUrl}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ employeeNo, password: process.env.SEED_PASSWORD ?? 'fantasteel' }) });
  if (!res.ok) throw new Error(`로그인 실패 (HTTP ${res.status})`);
  return (res.headers.get('set-cookie') ?? '').split(';')[0];
}

async function get<T>(path: string, cookie: string) {
  const res = await fetch(`${baseUrl}${path}`, { headers: { cookie } });
  return { status: res.status, body: (await res.json()) as { success: boolean; data: T } };
}

const ALERT_TYPES = [NOTIFICATION_TYPE.INTEGRATION_FAULT, NOTIFICATION_TYPE.INTEGRATION_RECOVERED];

function alertsOf(type: string, recipientId?: number) {
  return prisma.notification.findMany({ where: { notificationType: type, ...(recipientId === undefined ? {} : { recipientId }) }, orderBy: { id: 'asc' } });
}

async function createApp(listen: boolean): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const created = moduleRef.createNestApplication();
  created.setGlobalPrefix('api/v1');
  created.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  if (listen) await created.listen(0);
  else await created.init();
  return created;
}

beforeAll(async () => {
  process.env.INTEGRATION_SECRET_KEY = process.env.INTEGRATION_SECRET_KEY ?? Buffer.alloc(32, 7).toString('base64');
  app = await createApp(true);
  baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1`;
  prisma = app.get(PrismaService);
  faults = app.get(IntegrationFaultService);
  adminCookie = await login('1503001');
  managerIds = (
    await prisma.employee.findMany({
      where: { isActive: true, role: { rolePermissions: { some: { permission: PERMISSION.ORG_MANAGE, permissionLevel: PERMISSION_LEVEL.USE } } } },
      select: { id: true },
      orderBy: { id: 'asc' },
    })
  ).map((e) => e.id);
  salesId = (await prisma.employee.findUniqueOrThrow({ where: { employeeNo: '2103003' } })).id;
}, 60_000);

afterAll(async () => {
  await clean();
  await secondApp?.close();
  await app?.close();
});

async function clean(): Promise<void> {
  await prisma.integrationFault.deleteMany();
  await prisma.notification.deleteMany({ where: { notificationType: { in: ALERT_TYPES } } });
}

beforeEach(clean);

describe('장애 알림', () => {
  it('연동 관리 권한자(ORG_MANAGE 사용)가 있고, 권한 없는 사원은 받지 않는다', () => {
    expect(managerIds.length).toBeGreaterThan(0);
    expect(managerIds).not.toContain(salesId);
  });

  it('장애가 나면 연동 관리 권한자에게만 알림이 한 번 간다 (유형·문구·이동 화면)', async () => {
    await faults.report('google-drive', 'RECONNECT_REQUIRED', 'Google 인증이 만료됐거나 취소됐어요. 관리자가 다시 연결해 주세요');
    const alerts = await alertsOf(NOTIFICATION_TYPE.INTEGRATION_FAULT);
    expect(alerts.map((a) => a.recipientId)).toEqual(managerIds);
    expect(alerts[0]).toMatchObject({ linkPath: '/admin/integrations', readAt: null });
    expect(alerts[0].notificationContent).toContain('Google Drive 연결이 끊겼어요');
    expect(alerts[0].notificationContent).toContain('다시 연결해 주세요');
    expect(await alertsOf(NOTIFICATION_TYPE.INTEGRATION_FAULT, salesId)).toHaveLength(0);

    const row = await prisma.integrationFault.findUniqueOrThrow({ where: { providerKey_faultKind: { providerKey: 'google-drive', faultKind: 'RECONNECT_REQUIRED' } } });
    expect(row).toMatchObject({ failureCount: 1, notifiedAt: expect.any(Date) });
  });

  it('같은 장애가 되풀이돼도 풀리기 전에는 다시 알리지 않는다 (횟수는 올라간다)', async () => {
    for (let i = 0; i < 4; i += 1) await faults.report('google-drive', 'RECONNECT_REQUIRED', `다시 연결 필요 ${i}`);
    expect(await alertsOf(NOTIFICATION_TYPE.INTEGRATION_FAULT)).toHaveLength(managerIds.length);
    const row = await prisma.integrationFault.findFirstOrThrow({ where: { providerKey: 'google-drive' } });
    expect(row.failureCount).toBe(4);
    expect(row.lastMessage).toBe('다시 연결 필요 3');
  });

  it('하루가 지나도 풀리지 않았으면 한 번 더 알린다', async () => {
    await faults.report('notion', 'RECONNECT_REQUIRED', '연결이 끊겼어요');
    const where = { providerKey_faultKind: { providerKey: 'notion', faultKind: 'RECONNECT_REQUIRED' } };
    // 23시간 전에 알렸으면 아직 이르다
    await prisma.integrationFault.update({ where, data: { notifiedAt: new Date(Date.now() - FAULT_REPEAT_MS + 60 * 60_000) } });
    await faults.report('notion', 'RECONNECT_REQUIRED', '연결이 끊겼어요');
    expect(await alertsOf(NOTIFICATION_TYPE.INTEGRATION_FAULT)).toHaveLength(managerIds.length);
    // 25시간 전에 알렸으면 다시 알린다
    await prisma.integrationFault.update({ where, data: { notifiedAt: new Date(Date.now() - FAULT_REPEAT_MS - 60 * 60_000) } });
    await faults.report('notion', 'RECONNECT_REQUIRED', '연결이 끊겼어요');
    expect(await alertsOf(NOTIFICATION_TYPE.INTEGRATION_FAULT)).toHaveLength(managerIds.length * 2);
  });

  it('일시적일 수 있는 장애(요청 실패)는 3번 이어질 때 처음 알린다', async () => {
    await faults.report('notion', 'REQUEST_FAILED', '시간 초과');
    await faults.report('notion', 'REQUEST_FAILED', '시간 초과');
    expect(await alertsOf(NOTIFICATION_TYPE.INTEGRATION_FAULT)).toHaveLength(0);
    await faults.report('notion', 'REQUEST_FAILED', '시간 초과');
    const alerts = await alertsOf(NOTIFICATION_TYPE.INTEGRATION_FAULT);
    expect(alerts).toHaveLength(managerIds.length);
    expect(alerts[0].notificationContent).toBe('Notion 요청이 3번 이어서 실패했어요 (시간 초과)');
    await faults.report('notion', 'REQUEST_FAILED', '시간 초과');
    expect(await alertsOf(NOTIFICATION_TYPE.INTEGRATION_FAULT)).toHaveLength(managerIds.length);
  });

  it('연결 대상이나 종류가 다르면 따로 알린다', async () => {
    await faults.report('google-drive', 'RECONNECT_REQUIRED', '만료');
    await faults.report('google-drive', 'CREDENTIAL_ERROR', '서비스 계정 키를 거절했어요');
    await faults.report('notion', 'RECONNECT_REQUIRED', '만료');
    expect(await alertsOf(NOTIFICATION_TYPE.INTEGRATION_FAULT)).toHaveLength(managerIds.length * 3);
  });

  it('장애로 세지 않는 오류(연결 안 함·파일 없음)는 기록도 알림도 없다', async () => {
    await faults.reportFailure('google-drive', new AppException('INT-002'));
    await faults.reportFailure('google-drive', new AppException('INT-012'));
    expect(await prisma.integrationFault.count()).toBe(0);
    await faults.reportFailure('google-drive', new AppException('INT-003'));
    expect(await prisma.integrationFault.count()).toBe(1);
    expect(await alertsOf(NOTIFICATION_TYPE.INTEGRATION_FAULT)).toHaveLength(managerIds.length);
  });

  it('동시에 여러 번 보고해도 알림은 한 번이다 (조건부 UPDATE)', async () => {
    await Promise.all(Array.from({ length: 12 }, () => faults.report('google-drive', 'CREDENTIAL_ERROR', '서비스 계정 키를 거절했어요')));
    expect(await alertsOf(NOTIFICATION_TYPE.INTEGRATION_FAULT)).toHaveLength(managerIds.length);
    expect((await prisma.integrationFault.findFirstOrThrow({ where: { providerKey: 'google-drive' } })).failureCount).toBe(12);
  });
});

describe('받는 사람', () => {
  it('재직 중이 아닌 연동 관리 권한자에게는 보내지 않고, 받을 사람이 없으면 알린 것으로 적지 않는다. 권한이 생긴 재직 사원에게는 보낸다', async () => {
    const admin = await prisma.employee.findUniqueOrThrow({ where: { employeeNo: '1503001' } });
    const sales = await prisma.employee.findUniqueOrThrow({ where: { employeeNo: '2103003' } });
    const where = { providerKey_faultKind: { providerKey: 'google-drive', faultKind: 'RECONNECT_REQUIRED' } };
    try {
      // 연동 관리 권한자가 모두 퇴사 처리된 상태
      await prisma.employee.updateMany({ where: { id: { in: managerIds } }, data: { isActive: false } });
      await faults.report('google-drive', 'RECONNECT_REQUIRED', '만료');
      expect(await alertsOf(NOTIFICATION_TYPE.INTEGRATION_FAULT)).toHaveLength(0);
      expect((await prisma.integrationFault.findUniqueOrThrow({ where })).notifiedAt).toBeNull();

      // 영업 사원에게 관리자 역할을 주면(권한이 생기면) 그 사람이 받는다. 퇴사 처리된 관리자는 여전히 받지 않는다
      await prisma.employee.update({ where: { id: sales.id }, data: { roleId: admin.roleId } });
      await faults.report('google-drive', 'RECONNECT_REQUIRED', '만료');
      expect((await alertsOf(NOTIFICATION_TYPE.INTEGRATION_FAULT)).map((a) => a.recipientId)).toEqual([sales.id]);

      // 관리자가 돌아오면 다음 장애부터 함께 받는다
      await prisma.employee.updateMany({ where: { id: { in: managerIds } }, data: { isActive: true } });
      await faults.report('notion', 'RECONNECT_REQUIRED', '만료');
      expect((await alertsOf(NOTIFICATION_TYPE.INTEGRATION_FAULT)).map((a) => a.recipientId).sort()).toEqual([...managerIds, sales.id, sales.id].sort());
    } finally {
      await prisma.employee.updateMany({ where: { id: { in: managerIds } }, data: { isActive: true } });
      await prisma.employee.update({ where: { id: sales.id }, data: { roleId: sales.roleId } });
    }
  });
});

describe('풀 장애가 없다는 확인의 기억', () => {
  it('성공한 호출마다 DB를 읽지 않고(30초 기억), 이 서버가 장애를 기록하면 바로 잊으며, 30초가 지나면 다시 읽는다', async () => {
    const read = jest.spyOn(app.get(IntegrationFaultRepository), 'findByProvider');
    const KEY = 'cache-check';
    try {
      await faults.resolveConnection(KEY);
      await faults.resolveConnection(KEY);
      await faults.resolveConnection(KEY);
      expect(read).toHaveBeenCalledTimes(1);

      // 장애를 기록하면 기억을 잊어 다음 성공 호출이 읽고 푼다
      await faults.report(KEY, 'REQUEST_FAILED', '시간 초과');
      await faults.resolveConnection(KEY);
      expect(read).toHaveBeenCalledTimes(2);
      expect(await prisma.integrationFault.count({ where: { providerKey: KEY } })).toBe(0);

      // 푼 뒤 읽어 보니 장애가 없어 다시 기억하고, 30초가 지나야 다시 읽는다
      await faults.resolveConnection(KEY);
      await faults.resolveConnection(KEY);
      expect(read).toHaveBeenCalledTimes(3);
      const now = Date.now();
      const clock = jest.spyOn(Date, 'now').mockReturnValue(now + 31_000);
      try {
        await faults.resolveConnection(KEY);
      } finally {
        clock.mockRestore();
      }
      expect(read).toHaveBeenCalledTimes(4);
    } finally {
      read.mockRestore();
      await prisma.integrationFault.deleteMany({ where: { providerKey: KEY } });
    }
  });

  it('다른 연결 대상의 기억은 건드리지 않고, 기억 동안에도 이 서버가 기록한 장애는 풀린다', async () => {
    await faults.resolveConnection('notion');
    await faults.report('google-drive', 'RECONNECT_REQUIRED', '만료');
    await faults.resolveConnection('google-drive');
    expect(await prisma.integrationFault.count()).toBe(0);
    expect(await alertsOf(NOTIFICATION_TYPE.INTEGRATION_RECOVERED)).toHaveLength(managerIds.length);
  });
});

describe('복구 알림', () => {
  it('알렸던 장애가 풀리면 복구 알림이 한 번 가고 장애 줄은 사라진다. 또 풀어도 다시 가지 않는다', async () => {
    await faults.report('google-drive', 'RECONNECT_REQUIRED', '만료');
    await faults.resolveConnection('google-drive');
    const recovered = await alertsOf(NOTIFICATION_TYPE.INTEGRATION_RECOVERED);
    expect(recovered.map((a) => a.recipientId)).toEqual(managerIds);
    expect(recovered[0]).toMatchObject({ notificationContent: 'Google Drive 연결이 다시 정상이에요', linkPath: '/admin/integrations' });
    expect(await prisma.integrationFault.count()).toBe(0);

    await faults.resolveConnection('google-drive');
    expect(await alertsOf(NOTIFICATION_TYPE.INTEGRATION_RECOVERED)).toHaveLength(managerIds.length);
  });

  it('풀린 뒤 같은 장애가 다시 나면 새 장애로 다시 알린다', async () => {
    await faults.report('google-drive', 'RECONNECT_REQUIRED', '만료');
    await faults.resolveConnection('google-drive');
    await faults.report('google-drive', 'RECONNECT_REQUIRED', '또 만료');
    expect(await alertsOf(NOTIFICATION_TYPE.INTEGRATION_FAULT)).toHaveLength(managerIds.length * 2);
  });

  it('알리지 않은 장애(아직 3번이 안 됨)가 풀리면 복구 알림도 없다', async () => {
    await faults.report('notion', 'REQUEST_FAILED', '시간 초과');
    await faults.resolveConnection('notion');
    expect(await prisma.integrationFault.count()).toBe(0);
    expect(await alertsOf(NOTIFICATION_TYPE.INTEGRATION_RECOVERED)).toHaveLength(0);
  });

  it('성공한 호출은 연결 장애만 풀고 반영 실패는 두며, 반영 실패는 따로 풀어야 한다', async () => {
    await faults.report('notion', 'SYNC_FAILED', '반영 실패');
    await faults.report('notion', 'SYNC_FAILED', '반영 실패');
    await faults.report('notion', 'SYNC_FAILED', '반영 실패');
    await faults.report('notion', 'RECONNECT_REQUIRED', '만료');
    await faults.resolveConnection('notion');
    expect((await prisma.integrationFault.findMany()).map((f) => f.faultKind)).toEqual(['SYNC_FAILED']);
    await faults.resolve('notion', ['SYNC_FAILED']);
    const recovered = await alertsOf(NOTIFICATION_TYPE.INTEGRATION_RECOVERED);
    expect(recovered.filter((a) => a.notificationContent.includes('연결이 다시 정상이에요'))).toHaveLength(managerIds.length);
    expect(recovered.filter((a) => a.notificationContent === 'Notion 업무 공간 반영이 다시 정상이에요')).toHaveLength(managerIds.length);
  });

  it('다른 연결 대상의 장애는 건드리지 않는다', async () => {
    await faults.report('google-drive', 'RECONNECT_REQUIRED', '만료');
    await faults.report('notion', 'RECONNECT_REQUIRED', '만료');
    await faults.resolveConnection('notion');
    expect((await prisma.integrationFault.findMany()).map((f) => f.providerKey)).toEqual(['google-drive']);
  });

  it('관리자가 일부러 연결을 끊으면 알림 없이 장애를 지운다', async () => {
    await faults.report('google-drive', 'RECONNECT_REQUIRED', '만료');
    await faults.clear('google-drive');
    expect(await prisma.integrationFault.count()).toBe(0);
    expect(await alertsOf(NOTIFICATION_TYPE.INTEGRATION_RECOVERED)).toHaveLength(0);
  });
});

describe('서버가 두 대일 때', () => {
  beforeAll(async () => {
    secondApp = await createApp(false);
  }, 60_000);

  it('두 서버가 같은 장애를 동시에 보고해도 알림은 한 번이다', async () => {
    const other = secondApp.get(IntegrationFaultService);
    await Promise.all(
      Array.from({ length: 10 }, (_, i) => (i % 2 === 0 ? faults : other).report('notion', 'CREDENTIAL_ERROR', 'INTEGRATION_SECRET_KEY가 올바르지 않아요')),
    );
    expect(await alertsOf(NOTIFICATION_TYPE.INTEGRATION_FAULT)).toHaveLength(managerIds.length);
    expect((await prisma.integrationFault.findFirstOrThrow({ where: { providerKey: 'notion' } })).failureCount).toBe(10);
  });

  it('두 서버가 같은 장애를 동시에 풀어도 복구 알림은 한 번이다', async () => {
    const other = secondApp.get(IntegrationFaultService);
    await faults.report('notion', 'RECONNECT_REQUIRED', '만료');
    await Promise.all(Array.from({ length: 8 }, (_, i) => (i % 2 === 0 ? faults : other).resolveConnection('notion')));
    expect(await alertsOf(NOTIFICATION_TYPE.INTEGRATION_RECOVERED)).toHaveLength(managerIds.length);
    expect(await prisma.integrationFault.count()).toBe(0);
  });
});

describe('관리 화면 목록의 연결 상태', () => {
  it('장애가 있으면 끊김/주의와 장애 목록이, 풀리면 정상이 보인다', async () => {
    const list = async () => (await get<IntegrationConnectionView[]>('/integrations', adminCookie)).body.data.find((v) => v.providerKey === 'google-drive');
    // 같은 묶음 DB의 다른 시험이 남긴 연결 행이 마지막 오류를 갖고 있지 않게 비운다
    await prisma.integrationConnection.deleteMany({ where: { providerKey: 'google-drive' } });
    expect((await list())?.health).toEqual({ level: 'NORMAL', lastErrorAt: null, faults: [] });

    await faults.report('google-drive', 'REQUEST_FAILED', '시간 초과');
    expect((await list())?.health).toMatchObject({ level: 'WARNING', faults: [{ faultKind: 'REQUEST_FAILED', failureCount: 1, notifiedAt: null }] });

    await faults.report('google-drive', 'RECONNECT_REQUIRED', '만료');
    const down = (await list())?.health;
    expect(down?.level).toBe('DOWN');
    expect(down?.faults.map((f) => f.faultKind)).toEqual(['RECONNECT_REQUIRED', 'REQUEST_FAILED']);
    expect(down?.faults[0].notifiedAt).not.toBeNull();

    await faults.resolveConnection('google-drive');
    expect((await list())?.health.level).toBe('NORMAL');
  });

  it('알림은 알림함 API에도 보인다 (유형·이동 화면)', async () => {
    await faults.report('google-drive', 'RECONNECT_REQUIRED', '만료');
    const page = (await get<NotificationPage>('/notifications?unreadOnly=true', adminCookie)).body.data;
    const alert = page.items.find((n) => n.notificationType === NOTIFICATION_TYPE.INTEGRATION_FAULT);
    expect(alert).toMatchObject({ linkPath: '/admin/integrations', readAt: null });
  });
});
