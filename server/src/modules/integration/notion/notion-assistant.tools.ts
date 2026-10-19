// 철강맨AI의 Notion 읽기·쓰기(이슈 #398)에서 Notion 원격 MCP 서버에 맞춘 부분: 검색·읽기·행 조회·페이지 고치기 도구 입력과 결과 읽기,
// 그리고 대상이 상위 페이지 아래인지 가리는 규칙. 서버가 도구 모양을 바꾸면 여기만 고친다.
// LLM에는 Notion 도구 스키마를 넘기지 않는다: 이 파일이 만든 입력만 서버 코드가 부른다.
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { AppException } from '../../../common/errors/app.exception';
import { cleanNotionUrl, isNotionNotFound, normalizeNotionPageId, notionPageUrlOf, textsOf, type ToolShape } from './notion.tools';

export const NOTION_SEARCH_TOOL = 'notion-search';
export const NOTION_QUERY_DATA_SOURCES_TOOL = 'notion-query-data-sources';

/** 검색 결과 수 (철강맨AI 문맥 32k에 맞춘 가정값) */
export const NOTION_SEARCH_LIMIT = 8;
const SNIPPET_MAX = 200;
const TITLE_MAX = 200;
/** 데이터베이스를 읽을 때 함께 보는 행 수 */
export const NOTION_ROW_LIMIT = 20;

export type NotionEntityKind = 'page' | 'database' | 'data_source' | 'unknown';

/** 32자리 16진수(소문자, 대시 없음). Notion 주소·대시 있는 UUID·collection:// 모두 받는다 */
export function notionIdOf(value: string): string | null {
  const trimmed = value.trim().replace(/^\{\{|\}\}$/g, '');
  const collection = /^collection:\/\/([0-9a-f-]{32,36})$/i.exec(trimmed);
  if (collection) {
    const hex = collection[1].replace(/-/g, '').toLowerCase();
    return /^[0-9a-f]{32}$/.test(hex) ? hex : null;
  }
  return normalizeNotionPageId(trimmed);
}

function toUuid(hex: string): string {
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** 데이터 소스 id(32자리) → notion-fetch·query가 받는 collection:// 주소 */
export function collectionUrlOf(hex: string): string {
  return `collection://${toUuid(hex)}`;
}

// ── 범위 규칙 ──

/** ERP가 자동으로 채우는 데이터베이스들 (settings.notionWorkspace). Notion에서 고치면 다음 반영 때 덮어써진다 */
export interface MirroredNotionIds {
  databaseIds: readonly string[];
  dataSourceIds: readonly string[];
}

export type NotionScope = 'inside' | 'mirrored' | 'outside' | 'unknown';

/**
 * 대상이 상위 페이지 아래인지 가린다. ancestors는 가까운 조상부터의 id(페이지·데이터베이스·데이터 소스)이고, null이면 조상을 읽지 못한 것이다.
 * ERP가 채우는 데이터베이스 자신·그 데이터 소스·그 행(조상에 있음)은 상위 페이지 아래여도 mirrored로 먼저 가린다.
 * 조상을 모르면 상위 페이지 자신일 때만 inside, 아니면 unknown(쓰지 않는다).
 */
export function notionScopeOf(target: { id: string; ancestors: readonly string[] | null }, parentPageId: string, mirrored: MirroredNotionIds): NotionScope {
  const norm = (id: string) => id.replace(/-/g, '').toLowerCase();
  const mirroredIds = new Set([...mirrored.databaseIds, ...mirrored.dataSourceIds].map(norm));
  const id = norm(target.id);
  const parent = norm(parentPageId);
  const ancestors = target.ancestors?.map(norm) ?? [];
  if (mirroredIds.has(id) || ancestors.some((a) => mirroredIds.has(a))) return 'mirrored';
  if (id === parent || ancestors.includes(parent)) return 'inside';
  return target.ancestors === null ? 'unknown' : 'outside';
}

/**
 * 모델이 쓴 글에 하위 페이지·데이터베이스 태그가 있는지. Notion 마크다운에서 `<page url=…>`는 그 페이지를 이 페이지 아래로 옮기는 뜻이 될 수 있어
 * (상위 페이지 밖의 페이지를 끌어올 수 있다) 카드 글에서는 받지 않는다. 페이지를 가리킬 때는 mention-page나 링크를 쓴다.
 */
export function hasStructuralTag(text: string): boolean {
  return /<\s*(page|database|data-source)\b/i.test(text);
}

// ── 공통 ──

function propertiesOf(tool: ToolShape): Record<string, unknown> {
  return tool.inputSchema.properties ?? {};
}

function requireInputs(tool: ToolShape, names: string[]): Record<string, unknown> {
  const properties = propertiesOf(tool);
  const missing = names.filter((name) => !(name in properties));
  if (missing.length > 0) throw new AppException('INT-005', `Notion ${tool.name} 도구의 입력 모양이 예상과 달라요 (${missing.join('·')} 없음)`);
  return properties;
}

function syncFlag(properties: Record<string, unknown>): { allow_async?: false } {
  return 'allow_async' in properties ? { allow_async: false } : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);

/** 결과 글의 `{{https://…}}`·`{{collection://…}}` 감싸기를 벗긴다 */
export function unwrapNotionLinks(text: string): string {
  return text.replace(/\{\{((?:https?|collection|view):\/\/[^}\s]+)\}\}/g, '$1');
}

// ── 검색 ──

export interface NotionSearchHit {
  id: string | null;
  title: string;
  url: string | null;
  snippet: string;
  type: string | null;
}

/** 상위 페이지 아래만 찾는다. 범위를 좁힐 수 없는 서버면 찾지 않는다(회사 계정의 다른 페이지가 보일 수 있다) */
export function buildSearchArgs(tool: ToolShape, query: string, parentPageId: string): Record<string, unknown> {
  const properties = requireInputs(tool, ['query']);
  if (!('page_url' in properties)) throw new AppException('INT-005', `Notion ${tool.name} 도구가 찾을 범위(page_url)를 받지 않아 검색하지 않았어요`);
  return {
    query,
    page_url: notionPageUrlOf(parentPageId),
    ...('page_size' in properties ? { page_size: NOTION_SEARCH_LIMIT } : {}),
    ...('max_highlight_length' in properties ? { max_highlight_length: SNIPPET_MAX } : {}),
  };
}

function stringOf(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim() !== '') return value;
  }
  return null;
}

function hitOf(item: unknown): NotionSearchHit | null {
  if (!isRecord(item)) return null;
  const url = stringOf(item, ['url']);
  const rawId = stringOf(item, ['id']);
  const id = (rawId ? notionIdOf(rawId) : null) ?? (url ? notionIdOf(url) : null);
  const title = stringOf(item, ['title', 'name']) ?? '';
  if (!id && !url) return null;
  return {
    id,
    title: cut(title, TITLE_MAX),
    url: url ? cleanNotionUrl(unwrapNotionLinks(url)) : id ? notionPageUrlOf(id) : null,
    snippet: cut((stringOf(item, ['highlight', 'snippet', 'text', 'content']) ?? '').replace(/\s+/g, ' ').trim(), SNIPPET_MAX),
    type: stringOf(item, ['type', 'object']),
  };
}

/** 검색 결과 (JSON `{ results: [{ id, title, url, highlight, type }] }`로 본다). 모양을 모르면 null: 부르는 쪽이 글을 그대로 넘긴다 */
export function readSearchHits(result: CallToolResult): NotionSearchHit[] | null {
  const texts = textsOf(result);
  if (result.isError) throw new AppException('INT-004', `Notion 검색에 실패했어요: ${cut(texts.join(' '), 300) || '이유 없음'}`);
  const candidates: unknown[] = [result.structuredContent, ...texts.map(parseJson)];
  for (const candidate of candidates) {
    const list = Array.isArray(candidate) ? candidate : isRecord(candidate) ? (candidate.results ?? candidate.pages ?? candidate.data) : undefined;
    if (!Array.isArray(list)) continue;
    return list
      .map(hitOf)
      .filter((hit): hit is NotionSearchHit => hit !== null)
      .slice(0, NOTION_SEARCH_LIMIT);
  }
  return null;
}

// ── 읽기 (notion-fetch) ──

export interface NotionFetched {
  /** 32자리. 결과에서 읽지 못하면 요청한 id */
  id: string;
  kind: NotionEntityKind;
  title: string;
  url: string;
  /** 가까운 조상부터. 읽지 못했으면 null */
  ancestors: string[] | null;
  /** 데이터베이스 안의 데이터 소스 (행을 읽을 때) */
  dataSourceIds: string[];
  /** 페이지면 본문(<content>), 아니면 결과 글 전체 */
  body: string;
}

export function buildFetchArgs(tool: ToolShape, id: string, kindHint: 'collection' | 'page'): Record<string, unknown> {
  requireInputs(tool, ['id']);
  return { id: kindHint === 'collection' ? collectionUrlOf(id) : id };
}

const KIND_OF_TAG: Record<string, NotionEntityKind> = { page: 'page', database: 'database', 'data-source': 'data_source' };

function kindOf(value: string | null): NotionEntityKind {
  if (!value) return 'unknown';
  const key = value.toLowerCase().replace(/_/g, '-');
  return KIND_OF_TAG[key] ?? 'unknown';
}

/** 조상 목록: JSON의 path·ancestors, 없으면 머리말(<properties>·<content> 앞)의 <ancestor-path> 또는 parent-…·ancestor-… 태그 주소 */
function ancestorsOf(json: Record<string, unknown> | null, header: string): string[] | null {
  for (const key of ['path', 'ancestors', 'ancestor_path']) {
    const list = json?.[key];
    if (!Array.isArray(list)) continue;
    const ids = list.flatMap((item) => {
      const raw = typeof item === 'string' ? item : isRecord(item) ? (stringOf(item, ['id', 'url']) ?? '') : '';
      const id = raw ? notionIdOf(raw) : null;
      return id ? [id] : [];
    });
    return ids;
  }
  // 본문(사용자가 쓴 글)에 같은 태그를 적어 조상을 꾸미지 못하게 머리말에서만 읽는다
  const block = /<ancestor-path>([\s\S]*?)<\/ancestor-path>/i.exec(header)?.[1];
  const scope = block ?? header;
  const tags = [...scope.matchAll(/<((?:parent|ancestor)-[\w-]*)\b[^>]*?\burl="([^"]+)"/gi)];
  if (block === undefined && tags.length === 0) return null;
  return tags.flatMap((tag) => {
    const id = notionIdOf(unwrapNotionLinks(tag[2]));
    return id ? [id] : [];
  });
}

/**
 * notion-fetch 결과를 읽는다. 결과는 `{ metadata: { type }, title, url, text }` JSON이거나 그 text(마크업) 자체로 본다:
 *   <page url="{{https://…}}"> <ancestor-path> <parent-page url="…" title="…"/> … </ancestor-path> <properties>…</properties> <content>…</content> </page>
 * 오류 답이면 INT-004 (찾지 못함은 알아볼 수 있는 문구).
 */
export function readFetched(result: CallToolResult, requestedId: string): NotionFetched {
  const texts = textsOf(result);
  if (result.isError) {
    if (isNotionNotFound(texts.join(' '))) throw new AppException('INT-004', 'Notion 페이지를 찾을 수 없어요. 주소를 확인하거나 먼저 notion_search로 찾아 주세요');
    throw new AppException('INT-004', `Notion 페이지를 읽지 못했어요: ${cut(texts.join(' '), 300) || '이유 없음'}`);
  }
  const json = [result.structuredContent, ...texts.map(parseJson)].find(isRecord) ?? null;
  const markup = json && typeof json.text === 'string' ? json.text : texts.join('\n');
  const contentAt = markup.search(/<content>/i);
  const propertiesAt = markup.search(/<properties>/i);
  const cutAt = [contentAt, propertiesAt].filter((i) => i >= 0);
  const header = cutAt.length ? markup.slice(0, Math.min(...cutAt)) : markup;
  const topTag = /<(page|database|data-source)\b([^>]*)>/i.exec(header);
  const metadata = json && isRecord(json.metadata) ? json.metadata : null;
  const kind = kindOf((metadata ? stringOf(metadata, ['type']) : null) ?? topTag?.[1] ?? null);
  const tagUrl = topTag ? /\burl="([^"]+)"/i.exec(topTag[2])?.[1] : undefined;
  const rawUrl = (json ? stringOf(json, ['url']) : null) ?? (tagUrl ? unwrapNotionLinks(tagUrl) : null);
  const id = (rawUrl ? notionIdOf(rawUrl) : null) ?? requestedId;
  const tagTitle = topTag ? /\btitle="([^"]*)"/i.exec(topTag[2])?.[1] : undefined;
  const propertyTitle = /<properties>\s*([\s\S]*?)\s*<\/properties>/i.exec(markup)?.[1];
  const propertyJson = propertyTitle ? parseJson(propertyTitle) : undefined;
  const title = (json ? stringOf(json, ['title']) : null) ?? tagTitle ?? (isRecord(propertyJson) ? stringOf(propertyJson, ['title', '제목', 'Name', '이름']) : null) ?? '';
  const content = /<content>([\s\S]*?)(?:<\/content>|$)/i.exec(markup)?.[1];
  const dataSourceIds = [...new Set([...markup.matchAll(/<data-source\b[^>]*?\burl="\{?\{?(collection:\/\/[0-9a-f-]{32,36})/gi)].flatMap((m) => notionIdOf(m[1]) ?? []))];
  return {
    id,
    kind,
    title: cut(title.trim(), TITLE_MAX),
    url: rawUrl && /^https:\/\//i.test(rawUrl) ? cleanNotionUrl(rawUrl) : notionPageUrlOf(id),
    ancestors: ancestorsOf(json, header),
    dataSourceIds,
    body: unwrapNotionLinks(content ?? markup).trim(),
  };
}

// ── 데이터베이스 행 ──

/** 읽기 전용 SQL로 앞의 몇 행만 본다 (실제 Notion에서 확인한 모양, 2026-10-19). 표 이름은 우리가 만든 collection:// 주소라 따옴표로 감싸도 안전하다 */
export function buildQueryRowsArgs(tool: ToolShape, dataSourceId: string): Record<string, unknown> {
  requireInputs(tool, ['data']);
  const table = collectionUrlOf(dataSourceId);
  return { data: { data_source_urls: [table], query: `SELECT * FROM "${table}" LIMIT ${NOTION_ROW_LIMIT}` } };
}

/** 행 조회 결과 글. 모양은 서버가 정하므로 글 그대로 넘기고 부르는 쪽이 길이를 자른다. 오류면 null */
export function readRowsText(result: CallToolResult): string | null {
  if (result.isError) return null;
  return unwrapNotionLinks(textsOf(result).join('\n')).trim() || null;
}

// ── 쓰기 ──

/** 페이지 끝에 글 더하기 */
export function buildAppendArgs(tool: ToolShape, pageId: string, content: string): Record<string, unknown> {
  const properties = requireInputs(tool, ['page_id', 'command', 'content']);
  return { page_id: pageId, command: 'insert_content', content, ...('position' in properties ? { position: { type: 'end' } } : {}), ...syncFlag(properties) };
}

/** 찾아 바꾸기. 페이지 전체 덮어쓰기(replace_content)와 하위 페이지 지우기 허용(allow_deleting_content)은 쓰지 않는다 */
export function buildEditArgs(tool: ToolShape, pageId: string, edits: readonly { oldStr: string; newStr: string }[]): Record<string, unknown> {
  const properties = requireInputs(tool, ['page_id', 'command', 'content_updates']);
  return { page_id: pageId, command: 'update_content', content_updates: edits.map((e) => ({ old_str: e.oldStr, new_str: e.newStr })), ...syncFlag(properties) };
}

export function buildRenameArgs(tool: ToolShape, pageId: string, title: string): Record<string, unknown> {
  const properties = requireInputs(tool, ['page_id', 'command', 'properties']);
  return { page_id: pageId, command: 'update_properties', properties: { title }, ...syncFlag(properties) };
}

/** 고치기 결과. 오류면 INT-004(고치지 않았다). 성공이어도 Notion이 알린 경고(찾지 못한 곳 등)는 돌려준다 */
export function readWriteResult(result: CallToolResult, what: string): string | null {
  const text = textsOf(result).join(' ');
  if (result.isError) throw new AppException('INT-004', `Notion ${what}: ${cut(text, 300) || '이유 없음'}`);
  const json = parseJson(text);
  const warnings = isRecord(json) ? json.warnings : undefined;
  if (Array.isArray(warnings) && warnings.length > 0) return cut(warnings.map((w) => (typeof w === 'string' ? w : JSON.stringify(w))).join(' · '), 300);
  if (typeof warnings === 'string' && warnings.trim()) return cut(warnings, 300);
  return null;
}
