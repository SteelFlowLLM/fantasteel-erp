// 내 일정 서버 모드: 기간을 쿼리로 보내고 응답을 그대로 돌려준다.
import type { ScheduleEventView } from '@fantasteel/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { scheduleEventApi } from '@/api/scheduleEvents';
import { ok, stopFakeServer, useFakeServer, type ServerCall } from '@/api/server/serverTestKit';
import { SEED_EMPLOYEE_NO } from '@/test/actors';

afterEach(() => stopFakeServer());

const event: ScheduleEventView = {
  id: 1,
  scheduleEventTitle: '동해철강 방문',
  scheduleEventDescription: null,
  startAt: '2026-10-20T05:00:00.000Z',
  endAt: '2026-10-20T06:00:00.000Z',
  linkPath: '/meetings?id=3',
  meetingMinutes: { id: 3, title: '방문 준비' },
  attendees: [{ employeeId: 2, employeeName: '박서영' }],
  creator: { id: 5, name: '정다은' },
  notionSync: true,
  notionPageUrl: 'https://www.notion.so/aaaabbbbccccddddeeeeffff00001111',
};

describe('내 일정 서버 모드 (api/server/scheduleEvents.ts)', () => {
  it('기간을 from·to로 보내고 일정 목록을 돌려준다', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.sales, (c: ServerCall) => (c.path === '/schedule-events' ? ok([event]) : undefined));
    const events = await scheduleEventApi.list('2026-10-19', '2026-10-25');
    expect(calls[0]).toMatchObject({ method: 'GET', path: '/schedule-events', query: { from: '2026-10-19', to: '2026-10-25' } });
    expect(events).toEqual([event]);
  });

  it('Notion 상태: GET notion-status를 그대로 돌려준다 (이슈 #434)', async () => {
    const status = { ready: false, reason: '관리자가 아직 Notion 업무 공간을 만들지 않았어요', calendarName: null };
    const calls = useFakeServer(SEED_EMPLOYEE_NO.sales, (c: ServerCall) => (c.path === '/schedule-events/notion-status' ? ok(status) : undefined));
    expect(await scheduleEventApi.notionStatus()).toEqual(status);
    expect(calls[0].method).toBe('GET');
  });
});
