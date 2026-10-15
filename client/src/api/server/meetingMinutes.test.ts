// 회의록 서버 모드: 목록 조회 조건, 만들기 요청 본문(정리한 값), 입력 확인 오류.
import type { MeetingAnalysis, MeetingMinutesPage, MeetingMinutesView, MeetingRegisterResult } from '@fantasteel/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { InputError } from '@/api/errors';
import { meetingMinutesApi, meetingMinutesAudioApi } from '@/api/meetingMinutes';
import { ok, stopFakeServer, useFakeServer, type ServerCall } from '@/api/server/serverTestKit';
import { SEED_EMPLOYEE_NO } from '@/test/actors';

afterEach(() => stopFakeServer());

const view: MeetingMinutesView = {
  id: 3,
  meetingMinutesTitle: '동해철강 방문 준비',
  meetingDate: '2026-10-14',
  meetingMinutesStatus: 'TRANSCRIBED',
  transcript: '김영업: 방문합시다',
  transcriptSegments: [{ start: null, end: null, text: '김영업: 방문합시다' }],
  speakers: [],
  summary: null,
  analysisResult: null,
  failureReason: null,
  creator: { id: 5, name: '정다은' },
  attendees: [{ employeeId: 5, employeeName: '정다은', departmentName: '구매부', roleCode: 'PURCHASE' }],
  confirmedAt: null,
  createdAt: '2026-10-14T01:00:00.000Z',
  updatedAt: '2026-10-14T01:00:00.000Z',
};

describe('회의록 서버 모드 (api/server/meetingMinutes.ts)', () => {
  it('목록: 상태·검색어·쪽을 서버 조건으로 보내고, 빈 검색어는 보내지 않는다', async () => {
    const empty: MeetingMinutesPage = { items: [], page: 2, size: 20, total: 0 };
    const calls = useFakeServer(SEED_EMPLOYEE_NO.purchase, (c: ServerCall) => (c.path === '/meeting-minutes' ? ok(empty) : undefined));
    await meetingMinutesApi.list({ meetingMinutesStatus: 'TRANSCRIBED', keyword: '  동해  ', page: 2 });
    await meetingMinutesApi.list({ keyword: '   ' });
    expect(calls[0].query).toEqual({ page: '2', size: '20', meetingMinutesStatus: 'TRANSCRIBED', keyword: '동해' });
    expect(calls[1].query).toEqual({ page: '1', size: '20' });
  });

  it('만들기: 제목을 다듬고 참석자 중복을 없애 보낸다', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.purchase, (c: ServerCall) => (c.method === 'POST' && c.path === '/meeting-minutes' ? ok(view) : undefined));
    const created = await meetingMinutesApi.create({ meetingMinutesTitle: '  동해철강 방문 준비 ', meetingDate: '2026-10-14', attendeeIds: [5, 5, 6], transcript: '김영업: 방문합시다\n' });
    expect(created.id).toBe(3);
    expect(calls[0].body).toEqual({ meetingMinutesTitle: '동해철강 방문 준비', meetingDate: '2026-10-14', attendeeIds: [5, 6], transcript: '김영업: 방문합시다\n' });
  });

  it('만들기: 비어 있는 칸은 서버를 부르기 전에 입력칸 오류로 알린다', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.purchase, () => undefined);
    const error = await meetingMinutesApi.create({ meetingMinutesTitle: ' ', meetingDate: '', attendeeIds: [], transcript: ' \n ' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InputError);
    expect((error as InputError).fieldErrors).toEqual({
      meetingMinutesTitle: '제목을 입력해 주세요',
      meetingDate: '회의일을 골라 주세요',
      attendeeIds: '참석자를 1명 이상 골라 주세요',
      transcript: '회의 기록을 입력해 주세요',
    });
    expect(calls).toHaveLength(0);
  });

  it('상세: id로 읽는다', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.purchase, (c: ServerCall) => (c.path === '/meeting-minutes/3' ? ok(view) : undefined));
    expect((await meetingMinutesApi.get(3)).transcriptSegments).toHaveLength(1);
    expect(calls[0].method).toBe('GET');
  });

  it('음성 올리기: multipart에 글 칸과 file을 담고 참석자는 JSON 배열 문자열로 보낸다', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.purchase, (c: ServerCall) => (c.path === '/meeting-minutes/audio' ? ok({ ...view, meetingMinutesStatus: 'TRANSCRIBING' }) : undefined));
    const created = await meetingMinutesAudioApi.create({
      meetingMinutesTitle: '  음성 회의 ',
      meetingDate: '2026-10-15',
      attendeeIds: [5, 5, 6],
      file: new File(['abc'], '회의.webm', { type: 'audio/webm' }),
    });
    expect(created.meetingMinutesStatus).toBe('TRANSCRIBING');
    expect(calls[0].method).toBe('POST');
    const form = calls[0].body as FormData;
    expect(form.get('meetingMinutesTitle')).toBe('음성 회의');
    expect(form.get('meetingDate')).toBe('2026-10-15');
    expect(form.get('attendeeIds')).toBe('[5,6]');
    const file = form.get('file') as File;
    expect(file.name).toBe('회의.webm');
    expect(file.size).toBe(3);
  });

  it('음성 올리기: 제목·참석자가 비었거나 파일이 비면 서버를 부르기 전에 입력칸 오류로 알린다', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.purchase, () => undefined);
    const error = await meetingMinutesAudioApi.create({ meetingMinutesTitle: ' ', meetingDate: '2026-10-15', attendeeIds: [], file: new File([], 'a.webm', { type: 'audio/webm' }) }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InputError);
    expect((error as InputError).fieldErrors).toEqual({ meetingMinutesTitle: '제목을 입력해 주세요', attendeeIds: '참석자를 1명 이상 골라 주세요', file: '음성이 비어 있어요' });
    expect(calls).toHaveLength(0);
  });
});

describe('회의록 AI 정리 (API-260)', () => {
  it('화자 연결: 이름표 → 사원 id(모름은 null)를 PATCH speakers로 보낸다', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.purchase, (c: ServerCall) => (c.method === 'PATCH' && c.path === '/meeting-minutes/3/speakers' ? ok(view) : undefined));
    await meetingMinutesApi.updateSpeakers(3, { mapping: { SPEAKER_1: 5, SPEAKER_2: null } });
    expect(calls[0].body).toEqual({ mapping: { SPEAKER_1: 5, SPEAKER_2: null } });
  });

  it('음성 올리기: 500MB를 넘으면 서버를 부르기 전에 입력칸 오류', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.purchase, () => undefined);
    const big = new File(['x'], '큰.wav', { type: 'audio/wav' });
    Object.defineProperty(big, 'size', { value: 500 * 1024 * 1024 + 1 });
    const error = await meetingMinutesAudioApi.create({ meetingMinutesTitle: '회의', meetingDate: '2026-10-15', attendeeIds: [5], file: big }).catch((e: unknown) => e);
    expect((error as InputError).fieldErrors).toEqual({ file: '음성 파일은 500MB까지 올릴 수 있어요' });
    expect(calls).toHaveLength(0);
  });

  it('작성자가 POST analyze를 부르면 분석 중 상세가 돌아온다', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.purchase, (c: ServerCall) => (c.method === 'POST' && c.path === '/meeting-minutes/3/analyze' ? ok({ ...view, meetingMinutesStatus: 'ANALYZING' }) : undefined));
    const started = await meetingMinutesApi.analyze(3);
    expect(started.meetingMinutesStatus).toBe('ANALYZING');
    expect(calls).toHaveLength(1);
  });

  it('상세의 analysisResult는 후보를 타입대로 담아 돌려준다', async () => {
    const analysis: MeetingAnalysis = {
      summary: '요약',
      decisions: [{ text: '방문한다', evidence: [0] }],
      candidates: [{
        key: 'c1', kind: 'EVENT', title: '동해철강 방문', description: null, evidence: [0], sourceText: '다음 주 화요일 2시', assigneeId: null, assigneeName: null, dueDate: null,
        startAt: '2026-10-20T14:00:00+09:00', endAt: '2026-10-20T15:00:00+09:00', endAssumed: true, attendeeIds: [5], purchase: null, itemName: null, relatedSalesOrderNo: null,
        salesOrderId: null, issues: ['끝 시각은 말이 없어 1시간으로 가정했어요'], context: [], decision: 'PENDING',
      }],
      model: 'm',
      analyzedAt: '2026-10-15T01:00:00.000Z',
    };
    useFakeServer(SEED_EMPLOYEE_NO.purchase, (c: ServerCall) => (c.path === '/meeting-minutes/3' ? ok({ ...view, meetingMinutesStatus: 'REVIEW', summary: '요약', analysisResult: analysis }) : undefined));
    const got = await meetingMinutesApi.get(3);
    expect(got.analysisResult?.candidates[0]).toMatchObject({ kind: 'EVENT', endAssumed: true, evidence: [0] });
    expect(got.analysisResult?.decisions[0].text).toBe('방문한다');
  });
});

describe('회의록 확인·등록 (API-261)', () => {
  it('후보 고치기: PATCH로 보낸 칸만 보내고 키는 주소에 담는다', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.purchase, (c: ServerCall) => (c.method === 'PATCH' && c.path === '/meeting-minutes/3/candidates/c2' ? ok({ ...view, meetingMinutesStatus: 'REVIEW' }) : undefined));
    const updated = await meetingMinutesApi.updateCandidate(3, 'c2', { endAt: '2026-10-20T16:30', decision: 'APPROVED' });
    expect(updated.meetingMinutesStatus).toBe('REVIEW');
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toEqual({ endAt: '2026-10-20T16:30', decision: 'APPROVED' });
  });

  it('요약 고치기: PATCH summary로 보내고, 3000자를 넘기면 서버를 부르기 전에 입력칸 오류로 알린다', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.purchase, (c: ServerCall) => (c.method === 'PATCH' && c.path === '/meeting-minutes/3/summary' ? ok(view) : undefined));
    await meetingMinutesApi.updateSummary(3, '고친 요약');
    expect(calls[0].body).toEqual({ summary: '고친 요약' });
    const error = await meetingMinutesApi.updateSummary(3, 'a'.repeat(3001)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InputError);
    expect((error as InputError).fieldErrors).toEqual({ summary: '요약은 3000자까지 쓸 수 있어요' });
    expect(calls).toHaveLength(1);
  });

  it('확정하고 등록: POST register가 만든 행의 id를 돌려준다', async () => {
    const result: MeetingRegisterResult = { meetingMinutes: { ...view, meetingMinutesStatus: 'CONFIRMED' }, taskIds: [11], scheduleEventIds: [4], actionDraftIds: [9], excludedKeys: ['c4'] };
    const calls = useFakeServer(SEED_EMPLOYEE_NO.purchase, (c: ServerCall) => (c.method === 'POST' && c.path === '/meeting-minutes/3/register' ? ok(result) : undefined));
    const registered = await meetingMinutesApi.register(3);
    expect(registered).toMatchObject({ taskIds: [11], scheduleEventIds: [4], actionDraftIds: [9], excludedKeys: ['c4'] });
    expect(registered.meetingMinutes.meetingMinutesStatus).toBe('CONFIRMED');
    expect(calls).toHaveLength(1);
  });
});
