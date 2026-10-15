// 화자 분리(Voice2ERP 묶음 1)를 실제 앱과 DB(fs_collab)로 확인한다: 화자가 붙은 전사 저장, 화자 연결 PATCH, 확장자로 받는 업로드.
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import type { MeetingMinutesView } from '@fantasteel/shared';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';
import { SttClient, type SttTranscript } from '../stt/stt.client';
import { SttSettingsStore } from '../stt/stt-settings.store';
import { MeetingTranscriptionRunner } from './meeting-transcription.runner';

let app: INestApplication;
let baseUrl: string;
let prisma: PrismaService;
let runner: MeetingTranscriptionRunner;
const sttClient = { transcribe: jest.fn<Promise<SttTranscript>, unknown[]>() };
const sttSettings = { read: jest.fn(async () => ({ baseUrl: 'http://stt.test/v1', model: null, apiKey: null })) };
/** 정다은 (구매, 작성자) */
let purchaseCookie: string;
let purchaseId: number;
/** 최준혁 (구매부 부서장, 참석자) */
let headCookie: string;
let headId: number;
/** 김영업 등 참석자가 아닌 사원 */
let outsiderId: number;
let startId = 0;

async function login(employeeNo: string): Promise<string> {
  const res = await fetch(`${baseUrl}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ employeeNo, password: process.env.SEED_PASSWORD ?? 'fantasteel' }) });
  if (!res.ok) throw new Error(`로그인 실패 (HTTP ${res.status})`);
  return (res.headers.get('set-cookie') ?? '').split(';')[0];
}

async function call<T>(method: 'GET' | 'PATCH', path: string, cookie: string, payload?: unknown) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { cookie, ...(payload === undefined ? {} : { 'content-type': 'application/json' }) },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  return { status: res.status, body: (await res.json()) as { data: T; error?: { code: string; message: string } } };
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
  startId = (await prisma.meetingMinutes.aggregate({ _max: { id: true } }))._max.id ?? 0;
  purchaseCookie = await login('2207005');
  headCookie = await login('1702004');
  purchaseId = (await prisma.employee.findUniqueOrThrow({ where: { employeeNo: '2207005' } })).id;
  headId = (await prisma.employee.findUniqueOrThrow({ where: { employeeNo: '1702004' } })).id;
  outsiderId = (await prisma.employee.findFirstOrThrow({ where: { id: { notIn: [purchaseId, headId] }, isActive: true } })).id;
}, 60_000);

afterAll(async () => {
  await prisma?.meetingAttendee.deleteMany({ where: { meetingMinutesId: { gt: startId } } });
  await prisma?.meetingMinutes.deleteMany({ where: { id: { gt: startId } } });
  await app?.close();
});

const SEGMENTS = [
  { start: 0, end: 2, text: '다음 주에 방문합시다', speaker: 'SPEAKER_1' },
  { start: 2, end: 4, text: '네 좋습니다', speaker: 'SPEAKER_2' },
  { start: 4, end: 6, text: '시간은 두 시로 해요', speaker: 'SPEAKER_1' },
];

async function seedMinutes(status = 'TRANSCRIBED', extra: Record<string, unknown> = {}): Promise<number> {
  const row = await prisma.meetingMinutes.create({
    data: {
      meetingMinutesTitle: '화자 시험',
      meetingDate: new Date('2026-10-15T00:00:00.000Z'),
      meetingMinutesStatus: status,
      transcript: SEGMENTS.map((s) => s.text).join('\n'),
      transcriptSegments: SEGMENTS,
      creatorId: purchaseId,
      ...extra,
    },
  });
  await prisma.meetingAttendee.createMany({ data: [purchaseId, headId].map((employeeId) => ({ meetingMinutesId: row.id, employeeId })) });
  return row.id;
}

describe('화자가 붙은 전사 저장', () => {
  beforeEach(() => sttClient.transcribe.mockReset());

  it('STT가 준 speaker를 구간에 그대로 저장하고 상세에 화자 요약을 만든다', async () => {
    sttClient.transcribe.mockResolvedValue({
      text: 'x',
      durationSec: 6,
      segments: SEGMENTS.map((s) => ({ ...s })),
    });
    const form = new FormData();
    form.append('meetingMinutesTitle', '화자 음성');
    form.append('meetingDate', '2026-10-15');
    form.append('attendeeIds', JSON.stringify([purchaseId, headId]));
    // MIME이 octet-stream이어도 .m4a면 받는다
    form.append('file', new Blob(['fake'], { type: 'application/octet-stream' }), '회의.m4a');
    const res = await fetch(`${baseUrl}/meeting-minutes/audio`, { method: 'POST', headers: { cookie: purchaseCookie }, body: form });
    expect(res.status).toBe(201);
    const created = ((await res.json()) as { data: MeetingMinutesView }).data;
    await runner.drain();
    const { body } = await call<MeetingMinutesView>('GET', `/meeting-minutes/${created.id}`, purchaseCookie);
    expect(body.data.transcriptSegments.map((s) => s.speaker)).toEqual(['SPEAKER_1', 'SPEAKER_2', 'SPEAKER_1']);
    expect(body.data.speakers).toEqual([
      { label: 'SPEAKER_1', employeeId: null, employeeName: null, segmentCount: 2, firstTexts: ['다음 주에 방문합시다', '시간은 두 시로 해요'] },
      { label: 'SPEAKER_2', employeeId: null, employeeName: null, segmentCount: 1, firstTexts: ['네 좋습니다'] },
    ]);
  });

  it('MIME이 비었거나 octet-stream이어도 확장자가 오디오가 아니면 거절한다', async () => {
    const form = new FormData();
    form.append('meetingMinutesTitle', '이상한 파일');
    form.append('meetingDate', '2026-10-15');
    form.append('attendeeIds', JSON.stringify([purchaseId]));
    form.append('file', new Blob(['x'], { type: 'application/octet-stream' }), '문서.pdf');
    const res = await fetch(`${baseUrl}/meeting-minutes/audio`, { method: 'POST', headers: { cookie: purchaseCookie }, body: form });
    expect(res.status).toBe(400);
  });
});

describe('PATCH /meeting-minutes/:id/speakers', () => {
  it('참석자에게 연결하면 구간에 이름이 들어가고, 보내지 않은 이름표는 그대로다', async () => {
    const id = await seedMinutes();
    const first = await call<MeetingMinutesView>('PATCH', `/meeting-minutes/${id}/speakers`, purchaseCookie, { mapping: { SPEAKER_1: purchaseId } });
    expect(first.status).toBe(200);
    expect(first.body.data.transcriptSegments.map((s) => [s.speaker, s.speakerEmployeeId, s.speakerName])).toEqual([
      ['SPEAKER_1', purchaseId, '정다은'],
      ['SPEAKER_2', null, null],
      ['SPEAKER_1', purchaseId, '정다은'],
    ]);
    expect(first.body.data.speakers[0]).toMatchObject({ label: 'SPEAKER_1', employeeId: purchaseId, employeeName: '정다은', segmentCount: 2 });

    const second = await call<MeetingMinutesView>('PATCH', `/meeting-minutes/${id}/speakers`, purchaseCookie, { mapping: { SPEAKER_2: headId, SPEAKER_1: null } });
    expect(second.body.data.speakers.map((s) => [s.label, s.employeeId])).toEqual([
      ['SPEAKER_1', null],
      ['SPEAKER_2', headId],
    ]);
    expect(second.body.data.transcriptSegments[1].speakerName).toBe('최준혁');
  });

  it('REVIEW와 전사가 남은 FAILED에서도 연결할 수 있다', async () => {
    const review = await seedMinutes('REVIEW');
    const failed = await seedMinutes('FAILED', { failureReason: 'AI 오류' });
    for (const id of [review, failed]) {
      const { status } = await call<MeetingMinutesView>('PATCH', `/meeting-minutes/${id}/speakers`, purchaseCookie, { mapping: { SPEAKER_1: headId } });
      expect(status).toBe(200);
    }
  });

  it('작성자가 아니면 VOC-003', async () => {
    const id = await seedMinutes();
    const { status, body } = await call<MeetingMinutesView>('PATCH', `/meeting-minutes/${id}/speakers`, headCookie, { mapping: { SPEAKER_1: headId } });
    expect(status).toBe(403);
    expect(body.error?.code).toBe('VOC-003');
  });

  it('확정·전사 중·분석 중이거나 전사가 없으면 VOC-004', async () => {
    const confirmed = await seedMinutes('CONFIRMED');
    const analyzing = await seedMinutes('ANALYZING');
    const transcribing = await seedMinutes('TRANSCRIBING', { transcript: null, transcriptSegments: undefined });
    const failedNoTranscript = await seedMinutes('FAILED', { transcript: null, transcriptSegments: undefined, failureReason: '전사 실패' });
    for (const id of [confirmed, analyzing, transcribing, failedNoTranscript]) {
      const { status, body } = await call<MeetingMinutesView>('PATCH', `/meeting-minutes/${id}/speakers`, purchaseCookie, { mapping: { SPEAKER_1: headId } });
      expect([id, status, body.error?.code]).toEqual([id, 409, 'VOC-004']);
    }
    const row = await prisma.meetingMinutes.findUniqueOrThrow({ where: { id: confirmed } });
    expect(row.transcriptSegments).toEqual(SEGMENTS);
  });

  it('참석자가 아닌 사원은 VOC-002, 없는 이름표나 잘못된 값은 400이고 아무것도 저장하지 않는다', async () => {
    const id = await seedMinutes();
    const outsider = await call<MeetingMinutesView>('PATCH', `/meeting-minutes/${id}/speakers`, purchaseCookie, { mapping: { SPEAKER_1: outsiderId } });
    expect(outsider.status).toBe(404);
    expect(outsider.body.error?.code).toBe('VOC-002');
    expect((await call<MeetingMinutesView>('PATCH', `/meeting-minutes/${id}/speakers`, purchaseCookie, { mapping: { SPEAKER_9: purchaseId } })).status).toBe(400);
    expect((await call<MeetingMinutesView>('PATCH', `/meeting-minutes/${id}/speakers`, purchaseCookie, { mapping: { SPEAKER_1: 'abc' } })).status).toBe(400);
    expect((await call<MeetingMinutesView>('PATCH', `/meeting-minutes/${id}/speakers`, purchaseCookie, {})).status).toBe(400);
    const row = await prisma.meetingMinutes.findUniqueOrThrow({ where: { id } });
    expect(row.transcriptSegments).toEqual(SEGMENTS);
  });

  it('없는 회의록은 VOC-001', async () => {
    const { status, body } = await call<MeetingMinutesView>('PATCH', '/meeting-minutes/99999999/speakers', purchaseCookie, { mapping: {} });
    expect(status).toBe(404);
    expect(body.error?.code).toBe('VOC-001');
  });
});
