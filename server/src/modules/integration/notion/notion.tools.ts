// Notion 원격 MCP 서버(https://mcp.notion.com/mcp)에 맞춘 부분은 이 파일에만 둔다: 도구 이름, 입력 만들기, 결과 읽기, 페이지 id 읽기.
// 서버가 도구 모양을 바꾸면 여기만 고친다.
import { McpError, type CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { AppException } from '../../../common/errors/app.exception';

export const NOTION_CREATE_PAGES_TOOL = 'notion-create-pages';

/** 도구 이름과 입력 스키마 (mcp.client.ts의 McpToolInfo와 같은 모양) */
export interface ToolShape {
  name: string;
  inputSchema: { properties?: Record<string, unknown> };
}

const HEX32 = /^[0-9a-f]{32}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TAIL_HEX32 = /(?:^|[^0-9a-f])([0-9a-f]{32})$/i;
const TAIL_UUID = /(?:^|[^0-9a-f])([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

function isNotionHost(host: string): boolean {
  return ['notion.so', 'notion.site', 'notion.com'].some((domain) => host === domain || host.endsWith(`.${domain}`));
}

function idFromSegment(segment: string): string | null {
  const match = TAIL_HEX32.exec(segment) ?? TAIL_UUID.exec(segment);
  return match ? match[1].replace(/-/g, '').toLowerCase() : null;
}

/**
 * 관리자가 붙여 넣은 Notion 페이지 주소나 id에서 페이지 id(32자리 16진수, 소문자, 대시 없음)를 읽는다. 읽지 못하면 null.
 *   https://www.notion.so/team/회의록-1a2b…(32자리)     → 주소 끝의 id
 *   https://www.notion.so/team/보드-…?p=<id>&pm=s      → 미리보기로 연 페이지(p)
 *   1a2b3c4d-…(대시 있는 UUID) · 1a2b3c4d…(대시 없음)  → 그대로
 */
export function normalizeNotionPageId(input: string): string | null {
  const value = input.trim();
  if (value === '') return null;
  if (HEX32.test(value) || UUID.test(value)) return value.replace(/-/g, '').toLowerCase();

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    return null;
  }
  if (!isNotionHost(url.hostname.toLowerCase())) return null;
  const peek = url.searchParams.get('p');
  if (peek) {
    const fromPeek = idFromSegment(peek);
    if (fromPeek) return fromPeek;
  }
  const segments = url.pathname.split('/').filter(Boolean);
  const last = segments.at(-1);
  if (!last) return null;
  let segment: string;
  try {
    segment = decodeURIComponent(last);
  } catch {
    segment = last;
  }
  return idFromSegment(segment);
}

/**
 * 글 속의 Notion 주소. Notion은 `www.notion.so`뿐 아니라 `app.notion.com/p/<id>` 같은 하위 도메인 주소도 준다.
 * 마크다운 결과는 주소를 `{{…}}`로 감싸므로 `}`에서 끊는다.
 */
export const NOTION_URL_IN_TEXT = /https:\/\/(?:[\w-]+\.)*notion\.(?:so|site|com)\/[^\s)"'\]<>{}]+/gi;

/** 저장할 주소: 물음표 뒤(`?pvs=204` 같은 추적 값)·# 뒤와 문장 끝 문장부호를 뗀다 */
export function cleanNotionUrl(url: string): string {
  return url.replace(/[?#].*$/, '').replace(/[.,;:]+$/, '');
}

/** id로 여는 Notion 주소 (도구 결과에 주소가 없을 때) */
export function notionPageUrlOf(pageId: string): string {
  return `https://www.notion.so/${pageId.replace(/-/g, '')}`;
}

export interface NotionPageDraft {
  title: string;
  /** Notion 마크다운. 제목은 넣지 않는다 (properties.title이 큰 제목으로 보인다) */
  content: string;
}

/**
 * notion-create-pages 입력. 상위 페이지 아래 일반 페이지 하나를 만든다(데이터베이스가 아니라 title 속성만 쓴다).
 * allow_async가 있는 서버는 기본이 비동기라 바로 주소를 받으려고 false로 둔다.
 */
export function buildCreatePageArgs(tool: ToolShape, parentPageId: string, page: NotionPageDraft): Record<string, unknown> {
  const properties = tool.inputSchema.properties ?? {};
  if (!('pages' in properties) || !('parent' in properties)) {
    throw new AppException('INT-005', `Notion ${NOTION_CREATE_PAGES_TOOL} 도구의 입력 모양이 예상과 달라요 (pages·parent 없음)`);
  }
  return {
    parent: { type: 'page_id', page_id: parentPageId },
    pages: [{ properties: { title: page.title }, content: page.content }],
    ...('allow_async' in properties ? { allow_async: false } : {}),
  };
}

/** Notion이 상위 페이지를 못 찾을 때 (연결한 계정에 공유되지 않았거나 지워졌다) 관리자에게 보일 문구 */
export const PARENT_PAGE_NOT_FOUND_MESSAGE = '상위 페이지를 찾을 수 없어요. 연결한 Notion 계정이 편집할 수 있는 페이지인지 확인해 주세요';

/** Notion이 대상(페이지·데이터베이스)을 찾지 못했다는 답인지. 결과 글과 JSON-RPC 오류 문구 모두 본다 */
export function isNotionNotFound(text: string): boolean {
  return /object_not_found|\b404\b|could not find|not found/i.test(text);
}

/** 상위 페이지 아래에 만들다 JSON-RPC 오류로 거절됐을 때: 찾지 못한 것이면 알아볼 수 있는 문구로 바꾼다. 아니면 null */
export function parentPageNotFound(error: unknown): AppException | null {
  return error instanceof McpError && isNotionNotFound(error.message) ? new AppException('INT-004', PARENT_PAGE_NOT_FOUND_MESSAGE) : null;
}

/** 도구 결과의 글 조각 */
export function textsOf(result: CallToolResult): string[] {
  return result.content.flatMap((item) => (item.type === 'text' ? [item.text] : []));
}

/** JSON 안에서 Notion 페이지 주소나 id를 찾는다 (결과 모양이 서버 버전마다 조금씩 달라 깊이 찾는다) */
function findPage(value: unknown, depth = 0): { url: string | null; id: string | null } | null {
  if (depth > 6 || value === null || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findPage(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  const record = value as Record<string, unknown>;
  const url = typeof record.url === 'string' && /^https:\/\/[^/]*notion\./i.test(record.url) ? record.url : null;
  const id = typeof record.id === 'string' && (HEX32.test(record.id) || UUID.test(record.id)) ? record.id : null;
  if (url || id) return { url, id };
  for (const key of ['pages', 'page', 'results', 'result', 'data']) {
    const found = findPage(record[key], depth + 1);
    if (found) return found;
  }
  return null;
}

/**
 * 페이지 만들기 결과에서 새 페이지 주소를 읽는다. 서버가 오류로 답했으면(만들지 않았다) INT-004.
 * 성공으로 답했는데 주소를 찾지 못하면(비동기 작업 결과 포함) null: 페이지가 만들어졌을 수 있다.
 */
export function readCreatedPageUrl(result: CallToolResult): string | null {
  const texts = textsOf(result);
  if (result.isError) {
    if (isNotionNotFound(texts.join(' '))) throw new AppException('INT-004', PARENT_PAGE_NOT_FOUND_MESSAGE);
    throw new AppException('INT-004', `Notion 페이지를 만들지 못했어요: ${texts.join(' ').slice(0, 300) || '이유 없음'}`);
  }
  const candidates: unknown[] = [result.structuredContent];
  for (const text of texts) {
    try {
      candidates.push(JSON.parse(text) as unknown);
    } catch {
      // JSON이 아닌 안내 글은 아래에서 주소만 찾는다
    }
  }
  for (const candidate of candidates) {
    const found = findPage(candidate);
    if (found?.url) return cleanNotionUrl(found.url);
    if (found?.id) return notionPageUrlOf(found.id);
  }
  const inText = texts.join('\n').match(NOTION_URL_IN_TEXT);
  return inText ? cleanNotionUrl(inText[0]) : null;
}
