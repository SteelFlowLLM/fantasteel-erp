// 회의록 서버 모드: 목록 조회 조건, 만들기 요청 본문(정리한 값), 입력 확인 오류.
import type { MeetingMinutesPage, MeetingMinutesView } from '@fantasteel/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { InputError } from '@/api/errors';
import { meetingMinutesApi } from '@/api/meetingMinutes';
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
});
