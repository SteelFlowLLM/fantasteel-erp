// Notion 캘린더(이슈 #391 2단계)에 맞춘 부분: 캘린더 목록 읽기, 일정 만들기·고치기 입력, 일정 id 읽기. 상위 페이지를 못 찾은 답 문구.
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { AppException } from '../../../common/errors/app.exception';
import {
  buildCancelCalendarEventArgs,
  readCalendarCancelResult,
  buildCreateCalendarEventArgs,
  buildUpdateCalendarEventArgs,
  readCalendarList,
  readCalendarUpdateResult,
  readCreatedCalendarEvents,
  type CalendarEventDraft,
} from './notion-calendar.tools';
import { isNotionNotFound, PARENT_PAGE_NOT_FOUND_MESSAGE, parentPageNotFound, readCreatedPageUrl } from './notion.tools';
import { readCreatedDatabase } from './notion-workspace.tools';

const text = (value: string, isError = false): CallToolResult => ({ content: [{ type: 'text', text: value }], ...(isError ? { isError: true } : {}) });
const tool = (name: string, keys: string[]) => ({ name, inputSchema: { properties: Object.fromEntries(keys.map((k) => [k, {}])) } });
const CAL = { accountId: 'acc-1', calendarId: 'team@company.com' };

describe('readCalendarList', () => {
  it('계정별로 묶인 JSON을 한 줄씩 편다 (쓰기 권한·기본 캘린더)', () => {
    const json = {
      accounts: [
        {
          accountId: 'acc-1',
          email: 'erp@company.com',
          calendars: [
            { calendarId: 'erp@company.com', name: 'ERP', accessRole: 'owner', primary: true },
            { id: 'holiday@group', summary: '대한민국 휴일', accessRole: 'reader' },
          ],
        },
        { id: 'acc-2', accountEmail: 'me@gmail.com', calendars: [{ calendarId: 'me@gmail.com', title: '개인', canWrite: true }] },
      ],
    };
    expect(readCalendarList(text(JSON.stringify(json)))).toEqual([
      { accountId: 'acc-1', accountEmail: 'erp@company.com', calendarId: 'erp@company.com', name: 'ERP', primary: true, writable: true },
      { accountId: 'acc-1', accountEmail: 'erp@company.com', calendarId: 'holiday@group', name: '대한민국 휴일', primary: false, writable: false },
      { accountId: 'acc-2', accountEmail: 'me@gmail.com', calendarId: 'me@gmail.com', name: '개인', primary: false, writable: true },
    ]);
  });

  it('평평한 목록(캘린더마다 accountId)과 구조화 결과도 읽고, 같은 캘린더는 한 번만', () => {
    const flat = { calendars: [{ accountId: 'acc-1', calendarId: 'c1', name: 'A', readOnly: false }] };
    const result: CallToolResult = { content: [{ type: 'text', text: JSON.stringify(flat) }], structuredContent: flat };
    expect(readCalendarList(result)).toEqual([{ accountId: 'acc-1', accountEmail: null, calendarId: 'c1', name: 'A', primary: false, writable: true }]);
  });

  it('Notion 캘린더를 쓰지 않는 계정의 calendar_request_rejected 오류는 빈 목록이고, 다른 오류는 INT-004', () => {
    const rejected =
      '{"name":"APIResponseError","code":"validation_error","status":400,"body":"{\\"message\\":\\"Failed to run Calendar tool \'listCalendars\': Something went wrong.\\",\\"additional_data\\":{\\"tool_error_code\\":\\"calendar_request_rejected\\"}}"}';
    expect(readCalendarList({ content: [{ type: 'text', text: rejected }], isError: true })).toEqual([]);
    expect(() => readCalendarList({ content: [{ type: 'text', text: 'rate limited' }], isError: true })).toThrow(expect.objectContaining({ code: 'INT-004' }));
  });

  it('태그 글(<account> 아래 <calendar>)도 읽는다', () => {
    const tags = '<account id="acc-9" email="erp@company.com">\n<calendar id="c-1" name="ERP 일정" accessRole="writer" primary="true"/>\n</account>';
    expect(readCalendarList(text(tags))).toEqual([{ accountId: 'acc-9', accountEmail: 'erp@company.com', calendarId: 'c-1', name: 'ERP 일정', primary: true, writable: true }]);
  });

  it('연결된 캘린더가 없으면 빈 배열, 오류 답은 INT-004', () => {
    expect(readCalendarList(text(JSON.stringify({ accounts: [] })))).toEqual([]);
    expect(readCalendarList(text('No calendar accounts connected.'))).toEqual([]);
    expect(() => readCalendarList(text('unauthorized', true))).toThrow(AppException);
  });
});

describe('일정 만들기·고치기 입력', () => {
  const draft: CalendarEventDraft = {
    title: '공급사 미팅',
    description: '2층 회의실',
    startAt: new Date('2026-10-21T05:00:00.000Z'),
    endAt: new Date('2026-10-21T06:00:00.000Z'),
    erpUrl: 'http://client.test/schedule?week=2026-10-19',
    attendees: null,
  };
  const period = {
    type: 'DATE_TIME',
    start: { dateTime: '2026-10-21T14:00:00+09:00', timeZone: 'Asia/Seoul' },
    end: { dateTime: '2026-10-21T15:00:00+09:00', timeZone: 'Asia/Seoul' },
  };

  it('만들기: 서울 시각, 설명 끝에 ERP 링크, 화상 회의 없음. 초대가 꺼져 있으면 참석자를 보내지 않는다', () => {
    const args = buildCreateCalendarEventArgs(tool('notion-calendar-create-events', ['timeZone', 'events']), CAL, draft);
    expect(args).toEqual({
      timeZone: 'Asia/Seoul',
      events: [{ summary: '공급사 미팅', description: '2층 회의실\n\nERP: http://client.test/schedule?week=2026-10-19', period, calendar: CAL, disableConferencing: true }],
    });
  });

  it('초대를 켜면 참석자(메일·이름)를 보낸다, 설명이 없으면 ERP 링크만', () => {
    const attendees = [{ email: 'kim@company.com', displayName: '김영업' }];
    const args = buildCreateCalendarEventArgs(tool('notion-calendar-create-events', ['timeZone', 'events']), CAL, { ...draft, description: null, attendees }) as { events: Record<string, unknown>[] };
    expect(args.events[0]).toMatchObject({ attendees, description: 'ERP: http://client.test/schedule?week=2026-10-19' });
  });

  it('고치기: UPDATE로 같은 일정 id, 초대가 꺼져 있으면 참석자를 건드리지 않는다', () => {
    const args = buildUpdateCalendarEventArgs(tool('notion-calendar-update-events', ['timeZone', 'updates']), CAL, 'evt-1', draft);
    expect(args).toEqual({
      timeZone: 'Asia/Seoul',
      updates: [{ updateType: 'UPDATE', event: { calendar: CAL, eventId: 'evt-1' }, update: { summary: '공급사 미팅', description: '2층 회의실\n\nERP: http://client.test/schedule?week=2026-10-19', period } }],
    });
  });

  it('입력 모양이 다르면 INT-005', () => {
    expect(() => buildCreateCalendarEventArgs(tool('notion-calendar-create-events', ['events']), CAL, draft)).toThrow(AppException);
    expect(() => buildUpdateCalendarEventArgs(tool('notion-calendar-update-events', ['timeZone']), CAL, 'e', draft)).toThrow(AppException);
  });
});

describe('readCreatedCalendarEvents', () => {
  it('JSON 결과에서 보낸 순서대로 일정 id를 읽는다 (eventId·id·event.id)', () => {
    expect(readCreatedCalendarEvents(text(JSON.stringify({ events: [{ eventId: 'e1' }, { id: 'e2' }, { event: { id: 'e3' } }] })), 3)).toEqual(['e1', 'e2', 'e3']);
    expect(readCreatedCalendarEvents(text(JSON.stringify([{ eventId: 'e1' }])), 1)).toEqual(['e1']);
  });

  it('글 결과의 태그·eventId 값도 읽는다', () => {
    expect(readCreatedCalendarEvents(text('<event id="abc123" summary="회의"/>'), 1)).toEqual(['abc123']);
    expect(readCreatedCalendarEvents(text('Created event. eventId: xyz_9'), 1)).toEqual(['xyz_9']);
  });

  it('읽은 수가 다르거나 없으면 null, 오류 답은 INT-004', () => {
    expect(readCreatedCalendarEvents(text(JSON.stringify({ events: [] })), 1)).toBeNull();
    expect(readCreatedCalendarEvents(text('Done'), 1)).toBeNull();
    expect(() => readCreatedCalendarEvents(text('calendar not writable', true), 1)).toThrow(AppException);
    expect(() => readCalendarUpdateResult(text('event not found', true))).toThrow(AppException);
  });
});

describe('상위 페이지를 찾지 못한 답', () => {
  const messageOf = (fn: () => unknown) => {
    try {
      fn();
    } catch (error) {
      return error instanceof AppException ? [error.code, (error.getResponse() as { message: string }).message] : null;
    }
    return null;
  };

  it('object_not_found·404를 알아본다', () => {
    expect(isNotionNotFound('{"status":404,"code":"object_not_found"}')).toBe(true);
    expect(isNotionNotFound('Could not find page with ID')).toBe(true);
    expect(isNotionNotFound('validation_error')).toBe(false);
  });

  it('데이터베이스 만들기·페이지 만들기 오류 답이면 알아볼 수 있는 문구로 INT-004', () => {
    const notFound = text('API error: {"status":404,"code":"object_not_found","message":"Could not find block"}', true);
    expect(messageOf(() => readCreatedDatabase(notFound, 'p'))).toEqual(['INT-004', PARENT_PAGE_NOT_FOUND_MESSAGE]);
    expect(messageOf(() => readCreatedPageUrl(notFound))).toEqual(['INT-004', PARENT_PAGE_NOT_FOUND_MESSAGE]);
    expect(messageOf(() => readCreatedDatabase(text('validation_error', true), 'p'))?.[1]).toContain('validation_error');
  });

  it('JSON-RPC 오류로 거절돼도 같은 문구, 다른 오류는 null', () => {
    expect(parentPageNotFound(new McpError(ErrorCode.InvalidParams, 'object_not_found: Could not find page'))?.code).toBe('INT-004');
    expect(parentPageNotFound(new McpError(ErrorCode.InvalidParams, 'bad schema'))).toBeNull();
    expect(parentPageNotFound(new Error('object_not_found'))).toBeNull();
  });
});

describe('넣지 않기로 바꾼 일정의 캘린더 일정 취소 (이슈 #434)', () => {
  it('고른 캘린더와 일정 id로 하나를 취소하고, 오류 답은 INT-004', () => {
    const calendar = { accountId: 'acc-1', calendarId: 'erp-cal' };
    expect(buildCancelCalendarEventArgs(tool('notion-calendar-cancel-events', ['events']), calendar, 'evt-1')).toEqual({ events: [{ calendar, eventId: 'evt-1' }] });
    expect(() => buildCancelCalendarEventArgs(tool('notion-calendar-cancel-events', ['ids']), calendar, 'evt-1')).toThrow(AppException);
    expect(() => readCalendarCancelResult({ content: [{ type: 'text', text: 'Event not found' }], isError: true })).toThrow(AppException);
    expect(() => readCalendarCancelResult({ content: [{ type: 'text', text: '{"cancelled":1}' }] })).not.toThrow();
  });
});
