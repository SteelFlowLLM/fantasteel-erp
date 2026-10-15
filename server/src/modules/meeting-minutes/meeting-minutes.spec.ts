// 회의록 API(생성 API-258, 목록·상세 API-259)를 실제 앱과 DB(fs_collab)로 확인한다. 사원은 시드(seed.md)를 쓴다.
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import type { MeetingMinutesPage, MeetingMinutesView } from '@fantasteel/shared';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';

let app: INestApplication;
let baseUrl: string;
let prisma: PrismaService;
/** 정다은 (구매) */
let purchaseCookie: string;
let purchaseId: number;
/** 최준혁 (구매부 부서장) */
let headId: number;

async function login(employeeNo: string, password = process.env.SEED_PASSWORD ?? 'fantasteel'): Promise<string> {
  const res = await fetch(`${baseUrl}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ employeeNo, password }) });
  if (!res.ok) throw new Error(`로그인 실패 (HTTP ${res.status})`);
  return (res.headers.get('set-cookie') ?? '').split(';')[0];
}

async function call<T>(method: 'GET' | 'POST', path: string, cookie: string | null, payload?: unknown) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...(payload === undefined ? {} : { 'content-type': 'application/json' }) },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  return { status: res.status, body: (await res.json()) as { success: boolean; data: T; error?: { code: string; message: string } } };
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
  purchaseId = (await prisma.employee.findUniqueOrThrow({ where: { employeeNo: '2207005' } })).id;
  headId = (await prisma.employee.findUniqueOrThrow({ where: { employeeNo: '1702004' } })).id;
}, 60_000);

afterAll(async () => {
  await app?.close();
});

const newMinutes = (overrides: Record<string, unknown> = {}) => ({
  meetingMinutesTitle: '  동해철강 방문 준비  ',
  meetingDate: '2026-10-14',
  attendeeIds: [purchaseId, headId],
  transcript: '김영업: 다음 주 화요일 2시에 동해철강 방문합시다\r\n\n  정다은: 원료 입고 일정부터 확인할게요  \n',
  ...overrides,
});

describe('POST /meeting-minutes (API-258)', () => {
  it('전사 완료(TRANSCRIBED)로 만들고 한 줄을 한 발언으로 나눈다', async () => {
    const { status, body } = await call<MeetingMinutesView>('POST', '/meeting-minutes', purchaseCookie, newMinutes());
    expect(status).toBe(201);
    expect(body.data).toMatchObject({
      meetingMinutesTitle: '동해철강 방문 준비',
      meetingDate: '2026-10-14',
      meetingMinutesStatus: 'TRANSCRIBED',
      summary: null,
      analysisResult: null,
      failureReason: null,
      confirmedAt: null,
      creator: { id: purchaseId, name: '정다은' },
    });
    expect(body.data.transcriptSegments).toEqual([
      { start: null, end: null, text: '김영업: 다음 주 화요일 2시에 동해철강 방문합시다' },
      { start: null, end: null, text: '정다은: 원료 입고 일정부터 확인할게요' },
    ]);
    expect(body.data.transcript).toContain('김영업');
    expect(body.data.attendees.map((a) => a.employeeId).sort()).toEqual([purchaseId, headId].sort());
    expect(body.data.attendees[0]).toEqual(expect.objectContaining({ employeeName: expect.any(String), departmentName: expect.any(String), roleCode: expect.any(String) }));
  });

  it('같은 참석자를 두 번 보내도 한 번만 넣는다', async () => {
    const { status, body } = await call<MeetingMinutesView>('POST', '/meeting-minutes', purchaseCookie, newMinutes({ attendeeIds: [purchaseId, purchaseId] }));
    expect(status).toBe(201);
    expect(body.data.attendees).toHaveLength(1);
  });

  it('기록이 공백뿐이면 거절한다', async () => {
    const { status, body } = await call('POST', '/meeting-minutes', purchaseCookie, newMinutes({ transcript: ' \n  ' }));
    expect(status).toBe(400);
    expect(body.error?.code).toBe('COM-004');
  });

  it('없는 참석자는 VOC-002로 거절하고 아무것도 저장하지 않는다', async () => {
    const before = await prisma.meetingMinutes.count();
    const { status, body } = await call('POST', '/meeting-minutes', purchaseCookie, newMinutes({ attendeeIds: [purchaseId, 999999] }));
    expect(status).toBe(404);
    expect(body.error?.code).toBe('VOC-002');
    expect(await prisma.meetingMinutes.count()).toBe(before);
  });

  it('참석자가 없거나 회의일이 없는 날짜면 거절한다', async () => {
    expect((await call('POST', '/meeting-minutes', purchaseCookie, newMinutes({ attendeeIds: [] }))).status).toBe(400);
    const { status, body } = await call('POST', '/meeting-minutes', purchaseCookie, newMinutes({ meetingDate: '2026-02-30' }));
    expect(status).toBe(400);
    expect(body.error?.code).toBe('COM-004');
  });

  it('로그인하지 않으면 거절한다', async () => {
    expect((await call('POST', '/meeting-minutes', null, newMinutes())).status).toBe(401);
  });
});

describe('GET /meeting-minutes (API-259)', () => {
  it('회의일 최신순, 같은 날은 나중에 만든 것이 위이고 제목으로 거를 수 있다', async () => {
    const old = await call<MeetingMinutesView>('POST', '/meeting-minutes', purchaseCookie, newMinutes({ meetingMinutesTitle: '목록 확인 옛 회의', meetingDate: '2026-01-02' }));
    const first = await call<MeetingMinutesView>('POST', '/meeting-minutes', purchaseCookie, newMinutes({ meetingMinutesTitle: '목록 확인 같은날 A', meetingDate: '2030-05-05' }));
    const second = await call<MeetingMinutesView>('POST', '/meeting-minutes', purchaseCookie, newMinutes({ meetingMinutesTitle: '목록 확인 같은날 B', meetingDate: '2030-05-05' }));

    const { status, body } = await call<MeetingMinutesPage>('GET', `/meeting-minutes?keyword=${encodeURIComponent('목록 확인')}`, purchaseCookie);
    expect(status).toBe(200);
    expect(body.data.items.map((i) => i.id)).toEqual([second.body.data.id, first.body.data.id, old.body.data.id]);
    expect(body.data.items[0]).toMatchObject({ meetingMinutesStatus: 'TRANSCRIBED', attendeeCount: 2, creatorId: purchaseId, creatorName: '정다은', meetingDate: '2030-05-05' });
    expect(body.data.total).toBe(3);

    const paged = await call<MeetingMinutesPage>('GET', `/meeting-minutes?keyword=${encodeURIComponent('목록 확인')}&page=2&size=2`, purchaseCookie);
    expect(paged.body.data.items.map((i) => i.id)).toEqual([old.body.data.id]);
  });

  it('상태로 거르고, 잘못된 상태값은 거절한다', async () => {
    const none = await call<MeetingMinutesPage>('GET', '/meeting-minutes?meetingMinutesStatus=CONFIRMED', purchaseCookie);
    expect(none.body.data.items).toHaveLength(0);
    expect((await call('GET', '/meeting-minutes?meetingMinutesStatus=NOPE', purchaseCookie)).status).toBe(400);
  });
});

describe('GET /meeting-minutes/:id (API-259)', () => {
  it('만든 회의록을 상세로 읽는다', async () => {
    const created = await call<MeetingMinutesView>('POST', '/meeting-minutes', purchaseCookie, newMinutes());
    const { status, body } = await call<MeetingMinutesView>('GET', `/meeting-minutes/${created.body.data.id}`, purchaseCookie);
    expect(status).toBe(200);
    expect(body.data).toEqual(created.body.data);
  });

  it('없으면 VOC-001 (404)', async () => {
    const { status, body } = await call('GET', '/meeting-minutes/999999', purchaseCookie);
    expect(status).toBe(404);
    expect(body.error?.code).toBe('VOC-001');
  });
});
