// 회의 질문하기 도우미: 근거 발언(#n) 나누기, 질문 가능 조건, 서버 호출 본문.
import { MEETING_MINUTES_STATUS, type MeetingMinutesView } from '@fantasteel/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { aiAssistantApi } from '@/api/aiAssistant';
import { resetServerSessionForTest, serverLogin } from '@/api/http';
import { actAs, SEED_EMPLOYEE_NO } from '@/test/actors';
import { canAskAboutMeeting, meetingScreenContext, splitCitations } from '@/lib/meetingAsk';

const minutes = (status: MeetingMinutesView['meetingMinutesStatus'], count: number) => ({ meetingMinutesStatus: status, transcriptSegments: Array.from({ length: count }, () => ({ start: null, end: null, text: 'x' })) });

describe('splitCitations', () => {
  it('#n을 눌러 이동할 조각으로 나누고 위치는 0부터다', () => {
    expect(splitCitations('박서영 대리가 맡았어요 #3 #12.', 20)).toEqual([
      { kind: 'text', text: '박서영 대리가 맡았어요 ' },
      { kind: 'cite', text: '#3', segmentIndex: 2 },
      { kind: 'text', text: ' ' },
      { kind: 'cite', text: '#12', segmentIndex: 11 },
      { kind: 'text', text: '.' },
    ]);
  });

  it('전사 길이를 벗어난 번호나 #0은 이동 조각으로 만들지 않고 글로 둔다', () => {
    expect(splitCitations('#0 #21 #5', 20)).toEqual([
      { kind: 'text', text: '#0 #21 ' },
      { kind: 'cite', text: '#5', segmentIndex: 4 },
    ]);
    expect(splitCitations('근거 없는 답이에요', 20)).toEqual([{ kind: 'text', text: '근거 없는 답이에요' }]);
    expect(splitCitations('', 20)).toEqual([]);
  });
});

describe('질문 가능 조건', () => {
  it('전사가 있고 음성을 글로 바꾸는 중이 아닐 때만 묻는다', () => {
    expect(canAskAboutMeeting(minutes(MEETING_MINUTES_STATUS.REVIEW, 3))).toBe(true);
    expect(canAskAboutMeeting(minutes(MEETING_MINUTES_STATUS.TRANSCRIBED, 1))).toBe(true);
    expect(canAskAboutMeeting(minutes(MEETING_MINUTES_STATUS.FAILED, 2))).toBe(true);
    expect(canAskAboutMeeting(minutes(MEETING_MINUTES_STATUS.TRANSCRIBING, 0))).toBe(false);
    expect(canAskAboutMeeting(minutes(MEETING_MINUTES_STATUS.FAILED, 0))).toBe(false);
  });

  it('보고 있는 화면은 회의록 주소와 제목(200자까지)을 담는다', () => {
    expect(meetingScreenContext({ id: 5, meetingMinutesTitle: '가'.repeat(300) })).toEqual({ path: '/meetings?id=5', title: '회의록', label: '가'.repeat(200) });
  });
});

describe('aiAssistantApi.ask + meetingMinutesId', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetServerSessionForTest();
  });

  it('회의록 id를 본문에 담아 보낸다', async () => {
    const bodies: unknown[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      const body = init.body ? JSON.parse(String(init.body)) : undefined;
      if (String(url).endsWith('/auth/login')) return new Response(JSON.stringify({ success: true, data: { employeeId: 3, employeeNo: SEED_EMPLOYEE_NO.sales } }), { status: 200, headers: { 'content-type': 'application/json' } });
      bodies.push(body);
      return new Response(JSON.stringify({ success: true, data: { answer: '네', sources: [], model: 'm', latencyMs: 1 } }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    actAs(SEED_EMPLOYEE_NO.sales);
    await serverLogin(SEED_EMPLOYEE_NO.sales, 'test-password');
    await aiAssistantApi.ask({ question: '요약해 줘', meetingMinutesId: 5 });
    expect(bodies.at(-1)).toEqual({ question: '요약해 줘', meetingMinutesId: 5 });
  });
});
