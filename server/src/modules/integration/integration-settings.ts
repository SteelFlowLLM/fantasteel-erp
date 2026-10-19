import { NOTION_WORKSPACE_DATABASES, type IntegrationSettings, type NotionCalendarSettings, type NotionDatabaseRef, type NotionWorkspaceSettings } from '@fantasteel/shared';
import type { Prisma } from '../../generated/prisma/client';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readDatabaseRef(value: unknown): NotionDatabaseRef | null {
  if (!isRecord(value) || typeof value.dataSourceId !== 'string' || value.dataSourceId === '') return null;
  const views = Array.isArray(value.views) ? value.views.filter((v): v is string => typeof v === 'string') : [];
  return {
    dataSourceId: value.dataSourceId,
    databaseId: typeof value.databaseId === 'string' ? value.databaseId : null,
    url: typeof value.url === 'string' ? value.url : null,
    ...(views.length > 0 ? { views } : {}),
  };
}

function readCalendar(value: unknown): NotionCalendarSettings | null {
  if (!isRecord(value) || typeof value.accountId !== 'string' || typeof value.calendarId !== 'string' || !value.accountId || !value.calendarId) return null;
  return {
    accountId: value.accountId,
    calendarId: value.calendarId,
    name: typeof value.name === 'string' ? value.name : value.calendarId,
    accountEmail: typeof value.accountEmail === 'string' ? value.accountEmail : null,
    sendInvites: value.sendInvites === true,
  };
}

function readWorkspace(value: unknown): NotionWorkspaceSettings | null {
  if (!isRecord(value)) return null;
  const workspace: NotionWorkspaceSettings = {};
  for (const key of NOTION_WORKSPACE_DATABASES) {
    const ref = readDatabaseRef(value[key]);
    if (ref) workspace[key] = ref;
  }
  if (typeof value.createdAt === 'string') workspace.createdAt = value.createdAt;
  const calendar = readCalendar(value.calendar);
  if (calendar) workspace.calendar = calendar;
  return Object.keys(workspace).length > 0 ? workspace : null;
}

/** settings(jsonb)를 읽는다. 모르는 칸·모양이 틀린 값은 버린다 */
export function readSettings(value: Prisma.JsonValue): IntegrationSettings {
  if (!isRecord(value)) return {};
  const settings: IntegrationSettings = {};
  if (typeof value.parentPageId === 'string') settings.parentPageId = value.parentPageId;
  if (typeof value.folderId === 'string') settings.folderId = value.folderId;
  const workspace = readWorkspace(value.notionWorkspace);
  if (workspace) settings.notionWorkspace = workspace;
  return settings;
}

export type ReadyNotionWorkspace = Required<Pick<NotionWorkspaceSettings, 'scheduleEvents' | 'meetingMinutes' | 'tasks'>> & { calendar: NotionCalendarSettings | null };

/** 세 데이터베이스가 모두 있으면 그 참조와 고른 캘린더. 하나라도 없으면 null (자동 반영을 하지 않는다) */
export function readyWorkspace(settings: IntegrationSettings): ReadyNotionWorkspace | null {
  const ws = settings.notionWorkspace;
  if (!ws?.scheduleEvents || !ws.meetingMinutes || !ws.tasks) return null;
  return { scheduleEvents: ws.scheduleEvents, meetingMinutes: ws.meetingMinutes, tasks: ws.tasks, calendar: ws.calendar ?? null };
}
