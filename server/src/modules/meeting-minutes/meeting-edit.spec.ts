// 회의록 지우기·참석자 고치기(이슈 #449)를 실제 앱과 DB(fs_collab)로 확인한다: 누가·어떤 상태에서 되는지, 화자 연결 풀기, 행 삭제.
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import type { MeetingMinutesView } from '@fantasteel/shared';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';

let app: INestApplication;
let baseUrl: string;
let prisma: PrismaService;
/** 정다은 (구매, 작성자) */
let creatorCookie: string;
let creatorId: number;
/** 최준혁 (구매부 부서장, 참석자) */
let headCookie: string;
let headId: number;
/** 관리자 (ORG_MANAGE 사용) */
let adminCookie: string;
let outsiderId: number;
let retiredId: number;
let startId = 0;

async function login(employeeNo: string): Promise<string> {
  const res = await fetch(`${baseUrl}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ employeeNo, password: process.env.SEED_PASSWORD ?? 'fantasteel' }) });
  if (!res.ok) throw new Error(`로그인 실패 (HTTP ${res.status})`);
  return (res.headers.get('set-cookie') ?? '').split(';')[0];
}

async function call<T>(method: 'GET' | 'PUT' | 'DELETE', path: string, cookie: string, payload?: unknown) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { cookie, ...(payload === undefined ? {} : { 'content-type': 'application/json' }) },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  return { status: res.status, body: (await res.json()) as { data: T; error?: { code: string; message: string } } };
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(0);
  baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1`;
  prisma = app.get(PrismaService);
  startId = (await prisma.meetingMinutes.aggregate({ _max: { id: true } }))._max.id ?? 0;
  creatorCookie = await login('2207005');
  headCookie = await login('1702004');
  adminCookie = await login('1503001');
  creatorId = (await prisma.employee.findUniqueOrThrow({ where: { employeeNo: '2207005' } })).id;
  headId = (await prisma.employee.findUniqueOrThrow({ where: { employeeNo: '1702004' } })).id;
  outsiderId = (await prisma.employee.findFirstOrThrow({ where: { id: { notIn: [creatorId, headId] }, isActive: true } })).id;
  retiredId = (await prisma.employee.findFirstOrThrow({ where: { id: { notIn: [creatorId, headId, outsiderId] }, isActive: true, employeeNo: { not: '1503001' } }, orderBy: { id: 'desc' } })).id;
}, 60_000);

afterAll(async () => {
  await prisma?.meetingAttendee.deleteMany({ where: { meetingMinutesId: { gt: startId } } });
  await prisma?.meetingMinutes.deleteMany({ where: { id: { gt: startId } } });
  await app?.close();
});

async function seedMinutes(status = 'TRANSCRIBED'): Promise<number> {
  const row = await prisma.meetingMinutes.create({
    data: {
      meetingMinutesTitle: '고치기 시험',
      meetingDate: new Date('2026-10-21T00:00:00.000Z'),
      meetingMinutesStatus: status,
      transcript: '안녕하세요\n네',
      transcriptSegments: [
        { start: 0, end: 1, text: '안녕하세요', speaker: 'SPEAKER_1', speakerEmployeeId: creatorId, speakerName: '정다은' },
        { start: 1, end: 2, text: '네', speaker: 'SPEAKER_2', speakerEmployeeId: headId, speakerName: '최준혁' },
      ],
      creatorId,
      ...(status === 'CONFIRMED' ? { confirmedAt: new Date() } : {}),
    },
  });
  await prisma.meetingAttendee.createMany({ data: [creatorId, headId].map((employeeId) => ({ meetingMinutesId: row.id, employeeId })) });
  return row.id;
}

describe('PUT /meeting-minutes/:id/attendees', () => {
  it('작성자가 참석자를 바꾸면 빠진 사람의 화자 연결만 모름으로 되돌린다', async () => {
    const id = await seedMinutes();
    const { status, body } = await call<MeetingMinutesView>('PUT', `/meeting-minutes/${id}/attendees`, creatorCookie, { attendeeIds: [creatorId, outsiderId, outsiderId] });
    expect(status).toBe(200);
    expect(body.data.attendees.map((a) => a.employeeId).sort()).toEqual([creatorId, outsiderId].sort());
    expect(body.data.transcriptSegments.map((s) => s.speakerEmployeeId ?? null)).toEqual([creatorId, null]);
    expect(body.data.transcriptSegments[1].speakerName ?? null).toBeNull();
  });

  it('관리자는 남의 회의록도 고치고, 작성자도 관리자도 아니면 403', async () => {
    const id = await seedMinutes('REVIEW');
    expect((await call('PUT', `/meeting-minutes/${id}/attendees`, headCookie, { attendeeIds: [headId] })).body.error?.code).toBe('VOC-003');
    const { status } = await call('PUT', `/meeting-minutes/${id}/attendees`, adminCookie, { attendeeIds: [creatorId] });
    expect(status).toBe(200);
  });

  it('빈 목록은 400, 새로 넣는 퇴사자는 404, 그대로 둔 참석자는 퇴사했어도 남긴다', async () => {
    const id = await seedMinutes();
    // 시드에 퇴사자가 없어 이 시험 동안만 퇴사로 바꾼다 (같은 DB를 쓰는 다음 시험 파일을 위해 되돌린다)
    await prisma.employee.update({ where: { id: retiredId }, data: { isActive: false } });
    try {
      expect((await call('PUT', `/meeting-minutes/${id}/attendees`, creatorCookie, { attendeeIds: [] })).status).toBe(400);
      const retiredAdd = await call('PUT', `/meeting-minutes/${id}/attendees`, creatorCookie, { attendeeIds: [creatorId, retiredId] });
      expect(retiredAdd.status).toBe(404);
      expect(retiredAdd.body.error?.code).toBe('VOC-002');

      await prisma.meetingAttendee.create({ data: { meetingMinutesId: id, employeeId: retiredId } });
      const kept = await call<MeetingMinutesView>('PUT', `/meeting-minutes/${id}/attendees`, creatorCookie, { attendeeIds: [creatorId, retiredId] });
      expect(kept.status).toBe(200);
      expect(kept.body.data.attendees.map((a) => a.employeeId).sort()).toEqual([creatorId, retiredId].sort());
    } finally {
      await prisma.employee.update({ where: { id: retiredId }, data: { isActive: true } });
    }
  });

  it.each(['CONFIRMED', 'ANALYZING', 'TRANSCRIBING'])('%s이면 409로 막는다', async (status) => {
    const id = await seedMinutes(status);
    const res = await call('PUT', `/meeting-minutes/${id}/attendees`, creatorCookie, { attendeeIds: [creatorId] });
    expect(res.status).toBe(409);
    expect(res.body.error?.code).toBe('VOC-004');
    expect(await prisma.meetingAttendee.count({ where: { meetingMinutesId: id } })).toBe(2);
  });
});

describe('DELETE /meeting-minutes/:id', () => {
  it('작성자가 지우면 회의록과 참석자 행이 사라진다', async () => {
    const id = await seedMinutes('FAILED');
    const { status, body } = await call<{ id: number }>('DELETE', `/meeting-minutes/${id}`, creatorCookie);
    expect(status).toBe(200);
    expect(body.data).toEqual({ id });
    expect(await prisma.meetingMinutes.count({ where: { id } })).toBe(0);
    expect(await prisma.meetingAttendee.count({ where: { meetingMinutesId: id } })).toBe(0);
    expect((await call('GET', `/meeting-minutes/${id}`, creatorCookie)).status).toBe(404);
  });

  it('참석자라도 작성자가 아니면 403, 관리자는 지운다', async () => {
    const id = await seedMinutes('REVIEW');
    expect((await call('DELETE', `/meeting-minutes/${id}`, headCookie)).body.error?.code).toBe('VOC-003');
    expect((await call('DELETE', `/meeting-minutes/${id}`, adminCookie)).status).toBe(200);
  });

  it.each(['CONFIRMED', 'ANALYZING', 'TRANSCRIBING'])('%s이면 409로 막고 아무것도 지우지 않는다', async (status) => {
    const id = await seedMinutes(status);
    const res = await call('DELETE', `/meeting-minutes/${id}`, creatorCookie);
    expect(res.status).toBe(409);
    expect(res.body.error?.code).toBe('VOC-004');
    expect(await prisma.meetingAttendee.count({ where: { meetingMinutesId: id } })).toBe(2);
  });

  it('없는 회의록은 404', async () => {
    expect((await call('DELETE', `/meeting-minutes/2147483000`, creatorCookie)).status).toBe(404);
  });
});
