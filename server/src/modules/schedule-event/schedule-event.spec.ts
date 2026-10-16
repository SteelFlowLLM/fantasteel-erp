// 내 일정 API를 실제 앱과 DB(fs_collab)로 확인한다. 사원은 시드(seed.md)를 쓴다.
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import type { ScheduleEventView } from '@fantasteel/shared';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';

let app: INestApplication;
let baseUrl: string;
let prisma: PrismaService;
let salesCookie: string;
let purchaseCookie: string;
let outsiderCookie: string;
const ids: Record<string, number> = {};
const created: number[] = [];

async function login(employeeNo: string): Promise<string> {
  const res = await fetch(`${baseUrl}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ employeeNo, password: process.env.SEED_PASSWORD ?? 'fantasteel' }) });
  if (!res.ok) throw new Error(`로그인 실패 (HTTP ${res.status})`);
  return (res.headers.get('set-cookie') ?? '').split(';')[0];
}

async function get<T>(path: string, cookie: string) {
  const res = await fetch(`${baseUrl}${path}`, { headers: { cookie } });
  return { status: res.status, body: (await res.json()) as { success: boolean; data: T; error?: { code: string } } };
}

const makeEvent = async (title: string, startAt: string, creatorNo: string, attendeeNos: string[]) => {
  const event = await prisma.scheduleEvent.create({
    data: {
      scheduleEventTitle: title,
      startAt: new Date(startAt),
      endAt: new Date(new Date(startAt).getTime() + 3_600_000),
      creatorId: ids[creatorNo],
      attendees: { create: attendeeNos.map((no) => ({ employeeId: ids[no] })) },
    },
  });
  created.push(event.id);
};

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(0);
  baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1`;
  prisma = app.get(PrismaService);
  for (const no of ['2103003', '2207005', '1702004']) ids[no] = (await prisma.employee.findUniqueOrThrow({ where: { employeeNo: no } })).id;
  salesCookie = await login('2103003');
  purchaseCookie = await login('2207005');
  outsiderCookie = await login('1702004');
  // 2026-11-02(월)~11-08(일) 주. 시각은 KST(+09:00)
  await makeEvent('수요일 아침', '2026-11-04T09:00:00+09:00', '2207005', ['2103003']);
  await makeEvent('월요일 오전', '2026-11-02T10:00:00+09:00', '2207005', ['2103003']);
  await makeEvent('일요일 밤', '2026-11-08T23:30:00+09:00', '2207005', []);
  await makeEvent('다음 주 월요일 자정', '2026-11-09T00:00:00+09:00', '2207005', ['2103003']);
}, 60_000);

afterAll(async () => {
  await prisma?.scheduleEventAttendee.deleteMany({ where: { scheduleEventId: { in: created } } });
  await prisma?.scheduleEvent.deleteMany({ where: { id: { in: created } } });
  await app?.close();
});

const titles = (events: ScheduleEventView[]) => events.map((e) => e.scheduleEventTitle);

describe('GET /schedule-events', () => {
  it('참석자는 기간 안 일정을 시작 시각 순으로 본다 (끝 날짜 하루 전체 포함, 다음 날 00:00은 제외)', async () => {
    const { status, body } = await get<ScheduleEventView[]>('/schedule-events?from=2026-11-02&to=2026-11-08', salesCookie);
    expect(status).toBe(200);
    expect(titles(body.data)).toEqual(['월요일 오전', '수요일 아침']);
    expect(body.data[0]).toMatchObject({
      startAt: '2026-11-02T01:00:00.000Z',
      endAt: '2026-11-02T02:00:00.000Z',
      meetingMinutes: null,
      creator: { id: ids['2207005'], name: '정다은' },
      attendees: [{ employeeId: ids['2103003'], employeeName: '박서영' }],
    });
  });

  it('등록자는 참석자가 아니어도 본다 (일요일 23:30도 그 주에 든다)', async () => {
    const { body } = await get<ScheduleEventView[]>('/schedule-events?from=2026-11-02&to=2026-11-08', purchaseCookie);
    expect(titles(body.data)).toEqual(['월요일 오전', '수요일 아침', '일요일 밤']);
  });

  it('등록자도 참석자도 아니면 보이지 않는다', async () => {
    const { body } = await get<ScheduleEventView[]>('/schedule-events?from=2026-11-02&to=2026-11-09', outsiderCookie);
    expect(body.data).toEqual([]);
  });

  it('기간을 바꾸면 거른다', async () => {
    const { body } = await get<ScheduleEventView[]>('/schedule-events?from=2026-11-09&to=2026-11-09', salesCookie);
    expect(titles(body.data)).toEqual(['다음 주 월요일 자정']);
  });

  it('from만 주면 7일, 아무것도 없으면 이번 주 (오류 없이 배열)', async () => {
    const week = await get<ScheduleEventView[]>('/schedule-events?from=2026-11-02', salesCookie);
    expect(titles(week.body.data)).toEqual(['월요일 오전', '수요일 아침']);
    const now = await get<ScheduleEventView[]>('/schedule-events', salesCookie);
    expect(now.status).toBe(200);
    expect(Array.isArray(now.body.data)).toBe(true);
  });

  it.each([
    ['형식이 틀림', '?from=2026/11/02&to=2026-11-08'],
    ['없는 날짜', '?from=2026-02-30&to=2026-03-05'],
    ['끝이 시작보다 앞', '?from=2026-11-08&to=2026-11-02'],
    ['63일', '?from=2026-11-01&to=2027-01-02'],
  ])('잘못된 기간(%s)은 COM-004', async (_name, query) => {
    const { status, body } = await get<unknown>(`/schedule-events${query}`, salesCookie);
    expect(status).toBe(400);
    expect(body.error?.code).toBe('COM-004');
  });

  it('62일은 허용한다', async () => {
    const { status } = await get<unknown>('/schedule-events?from=2026-11-01&to=2027-01-01', salesCookie);
    expect(status).toBe(200);
  });

  it('로그인하지 않으면 401', async () => {
    const res = await fetch(`${baseUrl}/schedule-events`);
    expect(res.status).toBe(401);
  });
});

async function send<T>(method: 'POST' | 'PATCH', path: string, cookie: string, body: unknown) {
  const res = await fetch(`${baseUrl}${path}`, { method, headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as { success: boolean; data: T; error?: { code: string } } };
}

describe('내 일정 직접 등록·수정 (POST·PATCH /schedule-events, 2026-10-16)', () => {
  const input = (title: string, startAt = '2026-11-03T14:00:00+09:00', endAt = '2026-11-03T15:30:00+09:00') => ({ scheduleEventTitle: title, scheduleEventDescription: '  메모  ', startAt, endAt });

  it('등록하면 등록자 본인만 참석자로 두고, 내 일정에 보인다 (다른 사원에게는 안 보임)', async () => {
    const res = await send<ScheduleEventView>('POST', '/schedule-events', salesCookie, input('거래처 미팅'));
    expect(res.status).toBe(201);
    created.push(res.body.data.id);
    expect(res.body.data).toMatchObject({ scheduleEventTitle: '거래처 미팅', scheduleEventDescription: '메모', meetingMinutes: null, linkPath: null, creator: { id: ids['2103003'] } });
    expect(res.body.data.attendees.map((a) => a.employeeId)).toEqual([ids['2103003']]);
    expect(new Date(res.body.data.startAt).toISOString()).toBe('2026-11-03T05:00:00.000Z');
    expect(titles((await get<ScheduleEventView[]>('/schedule-events?from=2026-11-02&to=2026-11-08', salesCookie)).body.data)).toContain('거래처 미팅');
    expect(titles((await get<ScheduleEventView[]>('/schedule-events?from=2026-11-02&to=2026-11-08', outsiderCookie)).body.data)).not.toContain('거래처 미팅');
  });

  it('빈 메모는 없는 것으로, 끝이 시작과 같거나 앞이면 COM-004, 제목이 비면 COM-004', async () => {
    const blank = await send<ScheduleEventView>('POST', '/schedule-events', salesCookie, { ...input('메모 없음'), scheduleEventDescription: '   ' });
    created.push(blank.body.data.id);
    expect(blank.body.data.scheduleEventDescription).toBeNull();
    const same = await send<unknown>('POST', '/schedule-events', salesCookie, input('같은 시각', '2026-11-03T14:00:00+09:00', '2026-11-03T14:00:00+09:00'));
    expect([same.status, same.body.error?.code]).toEqual([400, 'COM-004']);
    const empty = await send<unknown>('POST', '/schedule-events', salesCookie, input('   '));
    expect([empty.status, empty.body.error?.code]).toEqual([400, 'COM-004']);
  });

  it('등록자 본인은 고칠 수 있고, 참석만 한 사원은 COM-002, 볼 수 없는 사원은 COM-003', async () => {
    const mine = await send<ScheduleEventView>('POST', '/schedule-events', salesCookie, input('고칠 일정'));
    created.push(mine.body.data.id);
    const edited = await send<ScheduleEventView>('PATCH', `/schedule-events/${mine.body.data.id}`, salesCookie, input('고친 일정', '2026-11-05T10:00:00+09:00', '2026-11-05T11:00:00+09:00'));
    expect(edited.status).toBe(200);
    expect(edited.body.data).toMatchObject({ id: mine.body.data.id, scheduleEventTitle: '고친 일정' });
    expect(new Date(edited.body.data.endAt).toISOString()).toBe('2026-11-05T02:00:00.000Z');
    const outsider = await send<unknown>('PATCH', `/schedule-events/${mine.body.data.id}`, outsiderCookie, input('남의 일정'));
    expect([outsider.status, outsider.body.error?.code]).toEqual([404, 'COM-003']);

    // 2207005가 만들고 2103003이 참석하는 일정: 참석자는 고칠 수 없다
    const shared = await prisma.scheduleEvent.findFirstOrThrow({ where: { scheduleEventTitle: '수요일 아침' } });
    const attendee = await send<unknown>('PATCH', `/schedule-events/${shared.id}`, salesCookie, input('참석자가 고침'));
    expect([attendee.status, attendee.body.error?.code]).toEqual([403, 'COM-002']);
  });

  it('회의록에서 등록한 일정은 등록자라도 여기서 고칠 수 없다 (COM-004 409)', async () => {
    const minutes = await prisma.meetingMinutes.findFirst({ select: { id: true } });
    if (!minutes) return;
    const fromMeeting = await prisma.scheduleEvent.create({
      data: { scheduleEventTitle: '회의 후속', startAt: new Date('2026-11-06T09:00:00+09:00'), endAt: new Date('2026-11-06T10:00:00+09:00'), creatorId: ids['2103003'], meetingMinutesId: minutes.id },
    });
    created.push(fromMeeting.id);
    const res = await send<unknown>('PATCH', `/schedule-events/${fromMeeting.id}`, salesCookie, input('회의 일정 고침'));
    expect([res.status, res.body.error?.code]).toEqual([409, 'COM-004']);
  });
});