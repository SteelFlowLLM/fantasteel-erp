// Notion 캘린더(이슈 #391 2단계)에서 Notion 원격 MCP 서버에 맞춘 부분: 캘린더 목록 읽기, 일정 만들기·고치기 입력, 결과에서 일정 id 읽기.
// 서버가 도구 모양을 바꾸면 여기만 고친다. 결과 모양은 문서가 없어 JSON·태그 글 두 가지를 모두 읽는다.
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { NotionCalendarOption, NotionCalendarSettings } from '@fantasteel/shared';
import { AppException } from '../../../common/errors/app.exception';
import { textsOf, type ToolShape } from './notion.tools';
import { seoulIso } from './notion-workspace.tools';

export const NOTION_CALENDAR_LIST_TOOL = 'notion-calendar-list-calendars';
export const NOTION_CALENDAR_CREATE_TOOL = 'notion-calendar-create-events';
export const NOTION_CALENDAR_UPDATE_TOOL = 'notion-calendar-update-events';

export const CALENDAR_TIME_ZONE = 'Asia/Seoul';
/** 일정 설명 상한 (Google 캘린더 설명은 길게 받지만 목록에서 읽히는 길이로 자른다) */
const DESCRIPTION_MAX = 4000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : typeof value === 'number' ? String(value) : null;
}

function failIfError(result: CallToolResult, what: string): string[] {
  const texts = textsOf(result);
  if (result.isError) throw new AppException('INT-004', `Notion 캘린더 ${what}: ${texts.join(' ').slice(0, 300) || '이유 없음'}`);
  return texts;
}

function jsonCandidates(result: CallToolResult, texts: string[]): unknown[] {
  const out: unknown[] = [];
  if (result.structuredContent) out.push(result.structuredContent);
  for (const text of texts) {
    try {
      out.push(JSON.parse(text) as unknown);
    } catch {
      // 태그 글은 아래에서 읽는다
    }
  }
  return out;
}

function writableOf(record: Record<string, unknown>): boolean | null {
  const role = str(record.accessRole) ?? str(record.access_role) ?? str(record.role);
  if (role) return ['owner', 'writer', 'write', 'editor'].includes(role.toLowerCase());
  for (const key of ['writable', 'canWrite', 'isWritable']) if (typeof record[key] === 'boolean') return record[key] as boolean;
  for (const key of ['readOnly', 'isReadOnly']) if (typeof record[key] === 'boolean') return !(record[key] as boolean);
  return null;
}

function calendarOf(record: Record<string, unknown>, account: { accountId: string | null; accountEmail: string | null }): NotionCalendarOption | null {
  const accountId = str(record.accountId) ?? account.accountId;
  const calendarId = str(record.calendarId) ?? str(record.id);
  if (!accountId || !calendarId) return null;
  return {
    accountId,
    accountEmail: str(record.accountEmail) ?? account.accountEmail,
    calendarId,
    name: str(record.name) ?? str(record.summary) ?? str(record.title) ?? calendarId,
    primary: record.primary === true || record.isPrimary === true,
    writable: writableOf(record),
  };
}

/** JSON에서 계정(calendars 배열을 가진 객체)과 그 아래 캘린더, 또는 accountId·calendarId를 함께 가진 캘린더를 찾는다 */
function walkCalendars(value: unknown, account: { accountId: string | null; accountEmail: string | null }, out: NotionCalendarOption[], depth = 0): void {
  if (depth > 8) return;
  if (Array.isArray(value)) {
    for (const item of value) walkCalendars(item, account, out, depth + 1);
    return;
  }
  if (!isRecord(value)) return;
  if (Array.isArray(value.calendars)) {
    const inner = {
      accountId: str(value.accountId) ?? str(value.id) ?? account.accountId,
      accountEmail: str(value.email) ?? str(value.accountEmail) ?? account.accountEmail,
    };
    for (const item of value.calendars) {
      const calendar = isRecord(item) ? calendarOf(item, inner) : null;
      if (calendar) out.push(calendar);
    }
    return;
  }
  if (str(value.calendarId) && str(value.accountId)) {
    const calendar = calendarOf(value, account);
    if (calendar) out.push(calendar);
    return;
  }
  for (const child of Object.values(value)) walkCalendars(child, account, out, depth + 1);
}

function attributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of tag.matchAll(/([\w-]+)="([^"]*)"/g)) attrs[match[1]] = match[2].replace(/^\{\{|\}\}$/g, '');
  return attrs;
}

/** 태그 글: `<account id=".." email="..">` 아래의 `<calendar id=".." name=".." accessRole="..">` */
function calendarsFromTags(text: string): NotionCalendarOption[] {
  const out: NotionCalendarOption[] = [];
  let account: { accountId: string | null; accountEmail: string | null } = { accountId: null, accountEmail: null };
  for (const match of text.matchAll(/<(account|calendar)\b([^>]*)>/gi)) {
    const attrs = attributes(match[2]);
    if (match[1].toLowerCase() === 'account') {
      account = { accountId: attrs.accountId ?? attrs.id ?? null, accountEmail: attrs.email ?? attrs.accountEmail ?? null };
      continue;
    }
    const calendar = calendarOf({ ...attrs, primary: attrs.primary === 'true', ...(attrs.writable ? { writable: attrs.writable === 'true' } : {}) }, account);
    if (calendar) out.push(calendar);
  }
  return out;
}

/**
 * 캘린더 목록 결과(계정별로 묶인 캘린더)를 한 줄씩 편다. 서버가 오류로 답하면 INT-004.
 * 읽을 수 있는 캘린더가 없으면 빈 배열: Notion 캘린더에 Google 캘린더를 연결하지 않은 계정이다.
 */
export function readCalendarList(result: CallToolResult): NotionCalendarOption[] {
  const texts = failIfError(result, '목록을 받지 못했어요');
  const found: NotionCalendarOption[] = [];
  for (const candidate of jsonCandidates(result, texts)) walkCalendars(candidate, { accountId: null, accountEmail: null }, found);
  if (found.length === 0) found.push(...calendarsFromTags(texts.join('\n')));
  const seen = new Set<string>();
  return found.filter((c) => {
    const key = `${c.accountId}\u0000${c.calendarId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function requireInputs(tool: ToolShape, names: string[]): void {
  const properties = tool.inputSchema.properties ?? {};
  const missing = names.filter((name) => !(name in properties));
  if (missing.length > 0) throw new AppException('INT-005', `Notion ${tool.name} 도구의 입력 모양이 예상과 달라요 (${missing.join('·')} 없음)`);
}

export interface CalendarEventDraft {
  title: string;
  description: string | null;
  startAt: Date;
  endAt: Date;
  erpUrl: string;
  /** null이면 참석자를 보내지 않는다 (초대 꺼짐: 만들 때 빼고, 고칠 때는 건드리지 않음) */
  attendees: { email: string; displayName: string }[] | null;
}

function period(draft: CalendarEventDraft) {
  return {
    type: 'DATE_TIME',
    start: { dateTime: seoulIso(draft.startAt), timeZone: CALENDAR_TIME_ZONE },
    end: { dateTime: seoulIso(draft.endAt), timeZone: CALENDAR_TIME_ZONE },
  };
}

function descriptionOf(draft: CalendarEventDraft): string {
  const body = draft.description?.trim();
  return `${body ? `${body}\n\n` : ''}ERP: ${draft.erpUrl}`.slice(0, DESCRIPTION_MAX);
}

function calendarRef(calendar: Pick<NotionCalendarSettings, 'accountId' | 'calendarId'>) {
  return { accountId: calendar.accountId, calendarId: calendar.calendarId };
}

/** 일정 하나 만들기. 화상 회의 링크는 붙이지 않는다 */
export function buildCreateCalendarEventArgs(tool: ToolShape, calendar: Pick<NotionCalendarSettings, 'accountId' | 'calendarId'>, draft: CalendarEventDraft): Record<string, unknown> {
  requireInputs(tool, ['timeZone', 'events']);
  return {
    timeZone: CALENDAR_TIME_ZONE,
    events: [
      {
        summary: draft.title,
        description: descriptionOf(draft),
        period: period(draft),
        calendar: calendarRef(calendar),
        disableConferencing: true,
        ...(draft.attendees ? { attendees: draft.attendees } : {}),
      },
    ],
  };
}

export function buildUpdateCalendarEventArgs(
  tool: ToolShape,
  calendar: Pick<NotionCalendarSettings, 'accountId' | 'calendarId'>,
  eventId: string,
  draft: CalendarEventDraft,
): Record<string, unknown> {
  requireInputs(tool, ['timeZone', 'updates']);
  return {
    timeZone: CALENDAR_TIME_ZONE,
    updates: [
      {
        updateType: 'UPDATE',
        event: { calendar: calendarRef(calendar), eventId },
        update: { summary: draft.title, description: descriptionOf(draft), period: period(draft), ...(draft.attendees ? { attendees: draft.attendees } : {}) },
      },
    ],
  };
}

function eventIdOf(value: unknown): string | null {
  if (!isRecord(value)) return null;
  return str(value.eventId) ?? str(value.id) ?? (isRecord(value.event) ? (str(value.event.eventId) ?? str(value.event.id)) : null);
}

function eventIdsFromJson(value: unknown, depth = 0): string[] | null {
  if (depth > 6) return null;
  if (Array.isArray(value)) {
    const ids = value.map(eventIdOf);
    return ids.every((id): id is string => id !== null) ? ids : null;
  }
  if (!isRecord(value)) return null;
  for (const key of ['events', 'createdEvents', 'results', 'created', 'data']) {
    if (key in value) {
      const ids = eventIdsFromJson(value[key], depth + 1);
      if (ids) return ids;
    }
  }
  const single = isRecord(value.event) ? eventIdOf(value.event) : null;
  return single ? [single] : null;
}

/**
 * 만든 일정 id를 보낸 순서대로 읽는다. 서버가 오류로 답했으면(만들지 않았다) INT-004.
 * 읽은 수가 보낸 수와 다르면 null: 만들어졌을 수 있어 부르는 쪽이 결과를 모르는 것으로 다룬다.
 */
export function readCreatedCalendarEvents(result: CallToolResult, expected: number): string[] | null {
  const texts = failIfError(result, '일정을 만들지 못했어요');
  for (const candidate of jsonCandidates(result, texts)) {
    const ids = eventIdsFromJson(candidate);
    if (ids) return ids.length === expected ? ids : null;
  }
  const text = texts.join('\n');
  const tagged = [...text.matchAll(/<event\b[^>]*\b(?:eventId|id)="([^"]+)"/gi)].map((m) => m[1]);
  const keyed = [...text.matchAll(/\beventId["'\s]*[:=]\s*["']?([^"'\s,}<>]+)/gi)].map((m) => m[1]);
  const ids = tagged.length > 0 ? tagged : keyed;
  return ids.length === expected ? ids : null;
}

export function readCalendarUpdateResult(result: CallToolResult): void {
  failIfError(result, '일정을 고치지 못했어요');
}
