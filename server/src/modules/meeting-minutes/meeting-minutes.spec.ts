// 회의록 API(생성 API-258, 목록·상세 API-259)를 실제 앱과 DB(fs_collab)로 확인한다. 사원은 시드(seed.md)를 쓴다.
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import type { MeetingMinutesPage, MeetingMinutesView } from '@fantasteel/shared';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';
import { SttClient, SttRequestError, type SttTranscript } from '../stt/stt.client';
import { SttSettingsStore } from '../stt/stt-settings.store';
import { JOB_STALE_MS } from './meeting-job.lease';
import { MeetingTranscriptionRunner, TRANSCRIPTION_INTERRUPTED_REASON } from './meeting-transcription.runner';

let app: INestApplication;
let baseUrl: string;
let prisma: PrismaService;
let runner: MeetingTranscriptionRunner;
// 실제 whisper 서버 없이 전사 결과를 정한다. 시험마다 transcribe 동작을 바꾼다
const sttClient = { transcribe: jest.fn<Promise<SttTranscript>, unknown[]>() };
const sttSettings = { read: jest.fn(async () => ({ baseUrl: 'http://stt.test/v1', model: null, apiKey: null })) };
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
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(SttClient)
    .useValue(sttClient)
    .overrideProvider(SttSettingsStore)
    .useValue(sttSettings)
    .compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(0);
  baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1`;
  prisma = app.get(PrismaService);
  runner = app.get(MeetingTranscriptionRunner);
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
    const none = await call<MeetingMinutesPage>('GET', `/meeting-minutes?meetingMinutesStatus=CONFIRMED&keyword=${encodeURIComponent('목록 확인')}`, purchaseCookie);
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

async function uploadAudio(fields: Record<string, string> = {}, file: { name: string; type: string; body: string } | null = { name: '회의.webm', type: 'audio/webm', body: 'fake-audio' }) {
  const form = new FormData();
  form.append('meetingMinutesTitle', fields.meetingMinutesTitle ?? '음성 회의');
  form.append('meetingDate', fields.meetingDate ?? '2026-10-15');
  form.append('attendeeIds', fields.attendeeIds ?? JSON.stringify([purchaseId, headId]));
  if (file) form.append('file', new Blob([file.body], { type: file.type }), file.name);
  const res = await fetch(`${baseUrl}/meeting-minutes/audio`, { method: 'POST', headers: { cookie: purchaseCookie }, body: form });
  return { status: res.status, body: (await res.json()) as { data: MeetingMinutesView; error?: { code: string; message: string } } };
}

describe('POST /meeting-minutes/audio (음성 → 전사)', () => {
  beforeEach(() => {
    sttClient.transcribe.mockReset();
  });

  it('전사 중(TRANSCRIBING)으로 바로 돌려주고, 끝나면 구간을 저장해 TRANSCRIBED로 바꾼다', async () => {
    let release: (value: SttTranscript) => void = () => undefined;
    sttClient.transcribe.mockImplementation(() => new Promise<SttTranscript>((resolve) => (release = resolve)));
    const { status, body } = await uploadAudio();
    expect(status).toBe(201);
    expect(body.data).toMatchObject({ meetingMinutesStatus: 'TRANSCRIBING', transcript: null, transcriptSegments: [], failureReason: null });
    expect(body.data.attendees).toHaveLength(2);

    release({
      text: '합친 전체 글',
      segments: [
        { start: 0, end: 2.5, text: ' 다음 주 화요일 두 시에 ' },
        { start: 2.5, end: 5, text: '동해철강을 방문합시다' },
      ],
      durationSec: 5,
    });
    await runner.drain();
    const detail = await call<MeetingMinutesView>('GET', `/meeting-minutes/${body.data.id}`, purchaseCookie);
    expect(detail.body.data).toMatchObject({
      meetingMinutesStatus: 'TRANSCRIBED',
      transcript: '다음 주 화요일 두 시에\n동해철강을 방문합시다',
      failureReason: null,
    });
    expect(detail.body.data.transcriptSegments).toEqual([
      { start: 0, end: 2.5, text: '다음 주 화요일 두 시에' },
      { start: 2.5, end: 5, text: '동해철강을 방문합시다' },
    ]);
    const firstCall = sttClient.transcribe.mock.calls[0] as [unknown, { fileName: string; mimeType: string }];
    expect(firstCall[1]).toMatchObject({ fileName: '회의.webm', mimeType: 'audio/webm' });
  });

  it('구간이 없으면 전체 글을 전사로 쓴다', async () => {
    sttClient.transcribe.mockResolvedValue({ text: ' 통째 글 ', segments: [], durationSec: null });
    const { body } = await uploadAudio();
    await runner.drain();
    const row = await prisma.meetingMinutes.findUniqueOrThrow({ where: { id: body.data.id } });
    expect(row.meetingMinutesStatus).toBe('TRANSCRIBED');
    expect(row.transcript).toBe('통째 글');
  });

  it('음성 인식 실패는 FAILED와 한국어 이유로 남긴다', async () => {
    sttClient.transcribe.mockRejectedValueOnce(new SttRequestError('음성 인식 서버에 연결할 수 없어요'));
    const first = await uploadAudio();
    sttClient.transcribe.mockRejectedValueOnce(new Error('boom'));
    const second = await uploadAudio();
    await runner.drain();
    const rows = await prisma.meetingMinutes.findMany({ where: { id: { in: [first.body.data.id, second.body.data.id] } }, orderBy: { id: 'asc' } });
    expect(rows.map((r) => [r.meetingMinutesStatus, r.failureReason])).toEqual([
      ['FAILED', '음성 인식 서버에 연결할 수 없어요'],
      ['FAILED', '전사 중 오류가 났어요'],
    ]);
  });

  it('음성 서버 연결 실패 이유에는 서버 주소가 없다: 회의록은 모든 사원이 본다 (이슈 #497)', async () => {
    sttClient.transcribe.mockRejectedValueOnce(new SttRequestError('http://100.87.40.116:8001/v1/audio/transcriptions에 연결할 수 없어요', '음성 서버에 연결할 수 없어요. 관리자에게 알려 주세요'));
    const { body } = await uploadAudio();
    await runner.drain();
    const row = await prisma.meetingMinutes.findUniqueOrThrow({ where: { id: body.data.id } });
    expect([row.meetingMinutesStatus, row.failureReason]).toEqual(['FAILED', '음성 서버에 연결할 수 없어요. 관리자에게 알려 주세요']);
  });

  it('더 이상 TRANSCRIBING이 아닌 행은 덮어쓰지 않는다', async () => {
    let release: (value: SttTranscript) => void = () => undefined;
    sttClient.transcribe.mockImplementation(() => new Promise<SttTranscript>((resolve) => (release = resolve)));
    const { body } = await uploadAudio();
    await prisma.meetingMinutes.update({ where: { id: body.data.id }, data: { meetingMinutesStatus: 'FAILED', failureReason: '직접 바꿈' } });
    release({ text: '늦은 결과', segments: [], durationSec: null });
    await runner.drain();
    const row = await prisma.meetingMinutes.findUniqueOrThrow({ where: { id: body.data.id } });
    expect(row).toMatchObject({ meetingMinutesStatus: 'FAILED', failureReason: '직접 바꿈', transcript: null });
  });

  it('전사는 한 번에 하나씩만 돈다', async () => {
    let running = 0;
    let peak = 0;
    sttClient.transcribe.mockImplementation(async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 20));
      running -= 1;
      return { text: '글', segments: [], durationSec: null };
    });
    await Promise.all([uploadAudio(), uploadAudio(), uploadAudio()]);
    await runner.drain();
    expect(sttClient.transcribe).toHaveBeenCalledTimes(3);
    expect(peak).toBe(1);
  });

  it('맡은 서버의 표시가 끊긴 전사 중 행만 실패로 바꾼다', async () => {
    const meetingDate = new Date('2026-10-15T00:00:00.000Z');
    const stuck = await prisma.meetingMinutes.create({ data: { meetingMinutesTitle: '멈춘 회의', meetingDate, meetingMinutesStatus: 'TRANSCRIBING', creatorId: purchaseId } });
    await prisma.meetingMinutes.update({ where: { id: stuck.id }, data: { updatedAt: new Date(Date.now() - JOB_STALE_MS - 60_000) } });
    // 다른 팀원 서버가 방금 표시를 남긴 행: 공용 DB에서 건드리면 안 된다
    const others = await prisma.meetingMinutes.create({ data: { meetingMinutesTitle: '남의 전사', meetingDate, meetingMinutesStatus: 'TRANSCRIBING', creatorId: purchaseId } });
    const done = await prisma.meetingMinutes.create({ data: { meetingMinutesTitle: '끝난 회의', meetingDate, meetingMinutesStatus: 'TRANSCRIBED', transcript: '글', creatorId: purchaseId } });
    expect(await runner.recoverInterrupted()).toBeGreaterThanOrEqual(1);
    expect(await prisma.meetingMinutes.findUniqueOrThrow({ where: { id: stuck.id } })).toMatchObject({ meetingMinutesStatus: 'FAILED', failureReason: TRANSCRIPTION_INTERRUPTED_REASON });
    expect((await prisma.meetingMinutes.findUniqueOrThrow({ where: { id: others.id } })).meetingMinutesStatus).toBe('TRANSCRIBING');
    expect((await prisma.meetingMinutes.findUniqueOrThrow({ where: { id: done.id } })).meetingMinutesStatus).toBe('TRANSCRIBED');
    await prisma.meetingMinutes.update({ where: { id: others.id }, data: { meetingMinutesStatus: 'FAILED' } });
  });

  it('이 서버가 맡은 전사는 오래 걸려도 실패로 바꾸지 않는다', async () => {
    let release: (value: SttTranscript) => void = () => undefined;
    sttClient.transcribe.mockImplementation(() => new Promise<SttTranscript>((resolve) => (release = resolve)));
    const { body } = await uploadAudio();
    await prisma.meetingMinutes.update({ where: { id: body.data.id }, data: { updatedAt: new Date(Date.now() - JOB_STALE_MS - 60_000) } });
    await runner.recoverInterrupted();
    expect((await prisma.meetingMinutes.findUniqueOrThrow({ where: { id: body.data.id } })).meetingMinutesStatus).toBe('TRANSCRIBING');
    await new Promise((resolve) => setTimeout(resolve, 50));
    release({ text: '끝난 글', segments: [], durationSec: null });
    await runner.drain();
    expect((await prisma.meetingMinutes.findUniqueOrThrow({ where: { id: body.data.id } })).meetingMinutesStatus).toBe('TRANSCRIBED');
  });

  it('파일이 없거나 오디오가 아니거나 입력이 틀리면 거절하고 저장하지 않는다', async () => {
    const before = await prisma.meetingMinutes.count();
    expect((await uploadAudio({}, null)).status).toBe(400);
    expect((await uploadAudio({}, { name: 'a.txt', type: 'text/plain', body: 'x' })).status).toBe(400);
    expect((await uploadAudio({ attendeeIds: 'not-json' })).status).toBe(400);
    expect((await uploadAudio({ attendeeIds: '[]' })).status).toBe(400);
    const missing = await uploadAudio({ attendeeIds: JSON.stringify([purchaseId, 999999]) });
    expect(missing.status).toBe(404);
    expect(missing.body.error?.code).toBe('VOC-002');
    expect(await prisma.meetingMinutes.count()).toBe(before);
    expect(sttClient.transcribe).not.toHaveBeenCalled();
  });
});
