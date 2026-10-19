// Notion 업무 공간(이슈 #391)에서 Notion 원격 MCP 서버에 맞춘 부분: 데이터베이스·보기 정의, 도구 입력 만들기, 결과 읽기, 행 → 속성 바꾸기.
// 서버가 도구 모양을 바꾸면 여기만 고친다. 페이지 하나 만들기(회의록 직접 내보내기)는 notion.tools.ts에 있다.
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { TASK_STATUS_LABEL, type NotionDatabaseRef, type NotionWorkspaceDatabaseKey, type TaskStatus } from '@fantasteel/shared';
import { AppException } from '../../../common/errors/app.exception';
import { normalizeNotionPageId, notionPageUrlOf, textsOf, type ToolShape } from './notion.tools';

export const NOTION_CREATE_DATABASE_TOOL = 'notion-create-database';
export const NOTION_CREATE_VIEW_TOOL = 'notion-create-view';
export const NOTION_UPDATE_PAGE_TOOL = 'notion-update-page';

/** Notion 글 속성 한 칸의 상한 (rich text 조각 하나가 2000자) */
const TEXT_MAX = 2000;
/** 선택 항목 이름 상한 (Notion은 100자까지 받는다) */
const OPTION_MAX = 100;
const SEOUL_OFFSET_MS = 9 * 3_600_000;
const OPTION_COLORS = ['blue', 'green', 'orange', 'purple', 'pink', 'yellow', 'brown', 'red', 'gray'] as const;

export const NOTION_DATABASE_TITLES: Record<NotionWorkspaceDatabaseKey, string> = {
  scheduleEvents: 'ERP 일정',
  meetingMinutes: 'ERP 회의록',
  tasks: 'ERP 할 일',
};

const DESCRIPTION = 'FantaSteel ERP가 자동으로 채워요. 여기서 고친 내용은 ERP로 돌아가지 않고, ERP에서 다시 바뀌면 덮어써요.';

/** 업무 출처 (할 일 데이터베이스의 "출처" 선택 항목) */
export const TASK_SOURCE_LABEL = { DIRECT: '직접 등록', MEETING: '회의록', MESSAGE: '메시지' } as const;

export interface NotionViewDef {
  name: string;
  type: 'table' | 'board' | 'calendar';
  configure: string;
}

export interface NotionDatabaseDef {
  key: NotionWorkspaceDatabaseKey;
  title: string;
  description: string;
  /** notion-create-database의 CREATE TABLE 문 */
  schema: string;
  views: NotionViewDef[];
}

/** Notion 속성 값 (도구 입력의 SQLite 값: 글·수·null) */
export type NotionPropertyValue = string | number | null;
export type NotionProperties = Record<string, NotionPropertyValue>;

/**
 * 선택 항목 이름. Notion은 쉼표가 든 항목 이름을 받지 않고, CREATE TABLE 문에서는 작은따옴표가 값의 끝이라 바꾼다.
 * 데이터베이스를 만들 때와 값을 쓸 때 같은 함수를 거쳐야 같은 항목이 된다.
 */
export function selectOption(name: string): string {
  const cleaned = name.replace(/,/g, ' ').replace(/'/g, '’').replace(/\s+/g, ' ').trim();
  return (cleaned || '이름 없음').slice(0, OPTION_MAX);
}

function selectDdl(options: readonly string[]): string {
  return `SELECT(${options.map((option, i) => `'${selectOption(option)}':${OPTION_COLORS[i % OPTION_COLORS.length]}`).join(', ')})`;
}

/**
 * 세 데이터베이스의 정의. 담당자는 Notion 계정이 없는 사원이라 사람 속성이 아니라 선택 항목으로 두고(보드를 담당자별로 묶으려고),
 * 만들 때 사용 중인 사원 이름을 항목으로 넣는다. 그 뒤에 생긴 이름은 값을 쓸 때 Notion이 항목을 더한다.
 */
export function notionDatabaseDefs(assigneeNames: readonly string[]): Record<NotionWorkspaceDatabaseKey, NotionDatabaseDef> {
  const names = [...new Set(assigneeNames.map(selectOption))];
  const status = [TASK_STATUS_LABEL.OPEN, TASK_STATUS_LABEL.DONE];
  const sources = [TASK_SOURCE_LABEL.DIRECT, TASK_SOURCE_LABEL.MEETING, TASK_SOURCE_LABEL.MESSAGE];
  return {
    scheduleEvents: {
      key: 'scheduleEvents',
      title: NOTION_DATABASE_TITLES.scheduleEvents,
      description: DESCRIPTION,
      schema: 'CREATE TABLE ("제목" TITLE, "일시" DATE, "참석자" RICH_TEXT, "등록자" RICH_TEXT, "설명" RICH_TEXT, "회의록" URL, "ERP" URL, "번호" NUMBER)',
      views: [
        { name: '달력', type: 'calendar', configure: 'CALENDAR BY "일시"' },
        { name: '일정 목록', type: 'table', configure: 'SORT BY "일시" ASC' },
      ],
    },
    meetingMinutes: {
      key: 'meetingMinutes',
      title: NOTION_DATABASE_TITLES.meetingMinutes,
      description: DESCRIPTION,
      schema: 'CREATE TABLE ("제목" TITLE, "회의일" DATE, "참석자" RICH_TEXT, "작성자" RICH_TEXT, "확정" DATE, "ERP" URL, "번호" NUMBER)',
      views: [
        { name: '최근 회의', type: 'table', configure: 'SORT BY "회의일" DESC' },
        { name: '회의 달력', type: 'calendar', configure: 'CALENDAR BY "회의일"' },
      ],
    },
    tasks: {
      key: 'tasks',
      title: NOTION_DATABASE_TITLES.tasks,
      description: DESCRIPTION,
      schema: `CREATE TABLE ("제목" TITLE, "상태" ${selectDdl(status)}, "담당자" ${selectDdl(names.length > 0 ? names : ['담당자 없음'])}, "마감일" DATE, "등록자" RICH_TEXT, "출처" ${selectDdl(sources)}, "회의록" URL, "설명" RICH_TEXT, "ERP" URL, "번호" NUMBER)`,
      views: [
        { name: '상태별', type: 'board', configure: 'GROUP BY "상태"' },
        { name: '담당자별', type: 'board', configure: 'GROUP BY "담당자"' },
        { name: '마감일순', type: 'table', configure: 'SORT BY "마감일" ASC' },
      ],
    },
  };
}

function propertiesOf(tool: ToolShape): Record<string, unknown> {
  return tool.inputSchema.properties ?? {};
}

function requireInputs(tool: ToolShape, names: string[]): Record<string, unknown> {
  const properties = propertiesOf(tool);
  const missing = names.filter((name) => !(name in properties));
  if (missing.length > 0) throw new AppException('INT-005', `Notion ${tool.name} 도구의 입력 모양이 예상과 달라요 (${missing.join('·')} 없음)`);
  return properties;
}

/** allow_async가 있는 서버는 기본이 비동기라 바로 결과(id)를 받으려고 false로 둔다 */
function syncFlag(properties: Record<string, unknown>): { allow_async?: false } {
  return 'allow_async' in properties ? { allow_async: false } : {};
}

export function buildCreateDatabaseArgs(tool: ToolShape, parentPageId: string, def: NotionDatabaseDef): Record<string, unknown> {
  const properties = requireInputs(tool, ['parent', 'schema']);
  return {
    parent: { type: 'page_id', page_id: parentPageId },
    title: def.title,
    ...('description' in properties ? { description: def.description } : {}),
    schema: def.schema,
  };
}

function failIfError(result: CallToolResult, what: string): string[] {
  const texts = textsOf(result);
  if (result.isError) throw new AppException('INT-004', `Notion ${what}: ${texts.join(' ').slice(0, 300) || '이유 없음'}`);
  return texts;
}

function jsonCandidates(result: CallToolResult, texts: string[]): unknown[] {
  const candidates: unknown[] = [];
  if (result.structuredContent) candidates.push(result.structuredContent);
  for (const text of texts) {
    try {
      candidates.push(JSON.parse(text) as unknown);
    } catch {
      // 마크다운 답은 아래에서 글로 찾는다
    }
  }
  return candidates;
}

/** JSON 안에서 key에 해당하는 첫 글 값을 깊이 찾는다 */
function findString(value: unknown, keys: string[], depth = 0): string | null {
  if (depth > 6 || value === null || typeof value !== 'object') return null;
  const entries = Array.isArray(value) ? value.map((v) => [null, v] as const) : Object.entries(value as Record<string, unknown>);
  for (const [key, v] of entries) {
    if (key !== null && keys.includes(key) && typeof v === 'string') return v;
  }
  for (const [, v] of entries) {
    const found = findString(v, keys, depth + 1);
    if (found) return found;
  }
  return null;
}

const UUID_IN_TEXT = /[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}/i;
const NOTION_URL = /https:\/\/(?:www\.)?notion\.(?:so|site|com)\/[^\s)"'\]<>}]+/gi;

/** 데이터 소스 id를 대시 있는 UUID 소문자로 */
function toUuid(value: string): string | null {
  const match = UUID_IN_TEXT.exec(value);
  if (!match) return null;
  const hex = match[0].replace(/-/g, '').toLowerCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * 데이터베이스 만들기 결과에서 데이터 소스 id(`<data-source url="collection://…">`)와 데이터베이스 주소·id를 읽는다.
 * 서버가 오류로 답했으면(만들지 않았다) INT-004. 성공 답인데 데이터 소스 id가 없으면 null: 만들어졌을 수 있다.
 * 상위 페이지 주소가 글에 함께 나올 수 있어 그 id는 데이터베이스 id로 보지 않는다.
 */
export function readCreatedDatabase(result: CallToolResult, parentPageId: string): NotionDatabaseRef | null {
  const texts = failIfError(result, '데이터베이스를 만들지 못했어요');
  const text = texts.join('\n');
  const json = jsonCandidates(result, texts);

  const collection = /collection:\/\/([0-9a-f-]{32,36})/i.exec(text)?.[1] ?? json.map((c) => findString(c, ['data_source_id', 'dataSourceId'])).find((v) => v !== null) ?? null;
  const dataSourceId = collection ? toUuid(collection) : null;
  if (!dataSourceId) return null;

  const urls: string[] = [];
  const tag = /<database\b[^>]*\burl="([^"]+)"/i.exec(text)?.[1];
  if (tag) urls.push(...(tag.match(NOTION_URL) ?? []));
  for (const candidate of json) {
    const url = findString(candidate, ['url']);
    if (url) urls.push(url);
  }
  urls.push(...(text.match(NOTION_URL) ?? []));
  const fromJsonId = json.map((c) => findString(c, ['database_id', 'databaseId'])).find((v) => v !== null) ?? null;

  const parent = parentPageId.replace(/-/g, '').toLowerCase();
  const own = urls.map((url) => ({ url: url.replace(/[.,;:]+$/, ''), id: normalizeNotionPageId(url) })).find((u) => u.id !== null && u.id !== parent && u.id !== dataSourceId.replace(/-/g, ''));
  const databaseId = own?.id ?? (fromJsonId ? normalizeNotionPageId(fromJsonId) : null);
  return { databaseId, dataSourceId, url: own?.url ?? (databaseId ? notionPageUrlOf(databaseId) : null) };
}

/** 보기 만들기. 데이터베이스 id를 읽지 못했으면 상위 페이지에 연결된 보기로 붙인다 */
export function buildCreateViewArgs(tool: ToolShape, ref: NotionDatabaseRef, parentPageId: string, view: NotionViewDef): Record<string, unknown> {
  requireInputs(tool, ['data_source_id', 'name', 'type']);
  return {
    ...(ref.databaseId ? { database_id: ref.databaseId } : { parent_page_id: parentPageId }),
    data_source_id: ref.dataSourceId,
    name: view.name,
    type: view.type,
    configure: view.configure,
  };
}

export function readViewResult(result: CallToolResult): void {
  failIfError(result, '보기를 만들지 못했어요');
}

export interface NotionRowDraft {
  properties: NotionProperties;
  /** 페이지 본문 (Notion 마크다운). 회의록만 쓴다 */
  content?: string;
}

/** 데이터베이스(데이터 소스)에 페이지 여러 개를 한 번에 만든다 */
export function buildCreateRowsArgs(tool: ToolShape, dataSourceId: string, rows: NotionRowDraft[]): Record<string, unknown> {
  const properties = requireInputs(tool, ['parent', 'pages']);
  return {
    parent: { type: 'data_source_id', data_source_id: dataSourceId },
    pages: rows.map((row) => (row.content === undefined ? { properties: row.properties } : { properties: row.properties, content: row.content })),
    ...syncFlag(properties),
  };
}

export interface CreatedNotionPage {
  /** 32자리 16진수 */
  id: string;
  url: string;
}

function pagesFromJson(value: unknown): CreatedNotionPage[] | null {
  if (value === null || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const list = Array.isArray(value) ? value : Array.isArray(record.pages) ? record.pages : Array.isArray(record.results) ? record.results : null;
  if (!list) return null;
  const pages: CreatedNotionPage[] = [];
  for (const item of list) {
    if (item === null || typeof item !== 'object') return null;
    const entry = item as Record<string, unknown>;
    const id = (typeof entry.id === 'string' ? normalizeNotionPageId(entry.id) : null) ?? (typeof entry.url === 'string' ? normalizeNotionPageId(entry.url) : null);
    if (!id) return null;
    pages.push({ id, url: typeof entry.url === 'string' && /^https:\/\//i.test(entry.url) ? entry.url : notionPageUrlOf(id) });
  }
  return pages;
}

/**
 * 만든 페이지들을 보낸 순서대로 읽는다. 서버가 오류로 답했으면(만들지 않았다) INT-004.
 * 성공 답에서 읽은 수가 보낸 수와 다르면 어느 행의 페이지인지 알 수 없어 null: 부르는 쪽이 결과를 모르는 것으로 다룬다.
 */
export function readCreatedPages(result: CallToolResult, expected: number): CreatedNotionPage[] | null {
  const texts = failIfError(result, '페이지를 만들지 못했어요');
  for (const candidate of jsonCandidates(result, texts)) {
    const pages = pagesFromJson(candidate);
    if (pages) return pages.length === expected ? pages : null;
  }
  const urls = (texts.join('\n').match(NOTION_URL) ?? []).map((url) => url.replace(/[.,;:]+$/, ''));
  const pages = urls.flatMap((url) => {
    const id = normalizeNotionPageId(url);
    return id ? [{ id, url }] : [];
  });
  return pages.length === expected ? pages : null;
}

export function buildUpdatePropertiesArgs(tool: ToolShape, pageId: string, properties: NotionProperties): Record<string, unknown> {
  const inputs = requireInputs(tool, ['page_id', 'command', 'properties']);
  return { page_id: pageId, command: 'update_properties', properties, ...syncFlag(inputs) };
}

export function buildReplaceContentArgs(tool: ToolShape, pageId: string, content: string): Record<string, unknown> {
  const inputs = requireInputs(tool, ['page_id', 'command', 'new_str']);
  return { page_id: pageId, command: 'replace_content', new_str: content, ...syncFlag(inputs) };
}

export function readUpdateResult(result: CallToolResult): void {
  failIfError(result, '페이지를 고치지 못했어요');
}

/** Date → 서울 시각 ISO (`2026-10-21T14:00:00+09:00`) */
export function seoulIso(at: Date): string {
  return `${new Date(at.getTime() + SEOUL_OFFSET_MS).toISOString().slice(0, 19)}+09:00`;
}

/** date 칸(UTC 자정으로 저장된 날짜) → `YYYY-MM-DD` */
export function dateOnlyOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function text(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, TEXT_MAX) : null;
}

/** 화면 주소 + ERP 경로 */
export function erpUrl(clientBaseUrl: string, path: string): string {
  return `${clientBaseUrl}${path.startsWith('/') ? path : `/${path}`}`;
}

export interface ScheduleEventSyncInput {
  id: number;
  title: string;
  description: string | null;
  startAt: Date;
  endAt: Date;
  attendeeNames: string[];
  creatorName: string;
  /** 원본 회의록의 Notion 페이지 주소 (없으면 ERP 회의록 화면) */
  meetingUrl: string | null;
  erpUrl: string;
}

export function scheduleEventProperties(input: ScheduleEventSyncInput): NotionProperties {
  return {
    제목: input.title,
    'date:일시:start': seoulIso(input.startAt),
    'date:일시:end': seoulIso(input.endAt),
    'date:일시:is_datetime': 1,
    참석자: text(input.attendeeNames.join(', ')),
    등록자: input.creatorName,
    설명: text(input.description),
    회의록: input.meetingUrl,
    ERP: input.erpUrl,
    번호: input.id,
  };
}

export interface TaskSyncInput {
  id: number;
  title: string;
  description: string | null;
  status: TaskStatus;
  assigneeName: string;
  creatorName: string;
  dueDate: Date;
  source: keyof typeof TASK_SOURCE_LABEL;
  meetingUrl: string | null;
  erpUrl: string;
}

export function taskProperties(input: TaskSyncInput): NotionProperties {
  return {
    제목: input.title,
    상태: TASK_STATUS_LABEL[input.status] ?? input.status,
    담당자: selectOption(input.assigneeName),
    'date:마감일:start': dateOnlyOf(input.dueDate),
    'date:마감일:is_datetime': 0,
    등록자: input.creatorName,
    출처: TASK_SOURCE_LABEL[input.source],
    회의록: input.meetingUrl,
    설명: text(input.description),
    ERP: input.erpUrl,
    번호: input.id,
  };
}

export interface MeetingSyncInput {
  id: number;
  title: string;
  meetingDate: Date;
  attendeeNames: string[];
  creatorName: string;
  confirmedAt: Date | null;
  erpUrl: string;
}

export function meetingProperties(input: MeetingSyncInput): NotionProperties {
  return {
    제목: input.title,
    'date:회의일:start': dateOnlyOf(input.meetingDate),
    'date:회의일:is_datetime': 0,
    참석자: text(input.attendeeNames.join(', ')),
    작성자: input.creatorName,
    ...(input.confirmedAt ? { 'date:확정:start': seoulIso(input.confirmedAt), 'date:확정:is_datetime': 1 } : {}),
    ERP: input.erpUrl,
    번호: input.id,
  };
}
