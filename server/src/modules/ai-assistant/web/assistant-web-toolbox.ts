import { Logger } from '@nestjs/common';
import { isAiAssistantWebTool, type AiWebSource } from '@fantasteel/shared';
import type { LlmToolCall, LlmToolDefinition } from '../../llm/llm.client';
import { optionalEnum, requiredString, ToolArgumentError } from '../tools/assistant-tool';
import { decodeBody, extractPage, limitPageText, PAGE_TEXT_MAX } from './page-extract';
import { SafePageFetcher, WebFetchError } from './safe-fetch';
import { PLACE_CATEGORIES, WEB_SEARCH_RESULT_LIMIT, type KakaoPlace } from './search-parsers';
import { KakaoPlaceClient, PlaceSearchError, SearchRateLimitError, SearchUnavailableError, WebSearchClient, type WebSearchOutcome } from './web-search.client';
import { cutText, filterAnswerLinks, redactQuery, UNTRUSTED_NOTE, uniqueSources, urlKey, wrapUntrusted } from './web-text';

/** 한 답에서 웹 도구를 부르는 수 (가정값). 한 차례에 여러 도구를 한꺼번에 불러도 이만큼만 실행한다 */
export const MAX_WEB_SEARCHES_PER_ANSWER = 3;
export const MAX_PAGE_READS_PER_ANSWER = 3;
/** 출처 링크를 달지 않았을 때 답 아래 보일 검색 결과 수 */
const FALLBACK_SOURCE_COUNT = 3;
const TITLE_MAX = 200;
const SNIPPET_MAX = 300;

/** 읽은 페이지. title·text는 웹에서 온 글이라 감싸서 넘긴다 */
export interface ReadPage {
  url: string;
  title: string;
  text: string;
}

export interface WebPageReader {
  read(url: string, signal?: AbortSignal): Promise<ReadPage>;
}

/** SSRF를 막는 fetch + Readability 본문 뽑기 */
export class SafeWebPageReader implements WebPageReader {
  constructor(private readonly fetcher: SafePageFetcher = new SafePageFetcher()) {}

  async read(url: string, signal?: AbortSignal): Promise<ReadPage> {
    const page = await this.fetcher.fetch(url, signal);
    const extracted = extractPage(decodeBody(page.body, page.contentType), page.contentType, page.url);
    return { url: page.url, title: extracted.title, text: extracted.text };
  }
}

export interface WebToolDeps {
  search: WebSearchClient;
  places: KakaoPlaceClient;
  pages: WebPageReader;
}

/** 운영 기본값. 카카오 키는 부를 때마다 환경 변수에서 읽는다 */
export function defaultWebToolDeps(): WebToolDeps {
  return {
    search: new WebSearchClient(),
    places: new KakaoPlaceClient(() => process.env.KAKAO_REST_API_KEY?.trim() || null),
    pages: new SafeWebPageReader(),
  };
}

const WEB_SEARCH: LlmToolDefinition = {
  name: 'web_search',
  description:
    '인터넷에서 찾는다. ERP 밖의 일반 정보(회사·뉴스·제품·기술·규격 해설·시세 등)를 물을 때 쓴다. 재고·수주 같은 ERP 업무 데이터는 이 도구가 아니라 조회 도구로 찾는다. 결과는 제목·주소·요약 5개까지이고, 자세한 내용이 필요하면 결과의 주소를 read_web_page로 읽는다.',
  parameters: {
    type: 'object',
    properties: { query: { type: 'string', description: '검색어. 짧은 핵심어로 (예: 포항 제철소 역사, SS275 인장강도). 개인정보는 넣지 않는다' } },
    required: ['query'],
  },
};

const SEARCH_PLACES: LlmToolDefinition = {
  name: 'search_places',
  description: '맛집·식당·카페·가게·장소를 카카오맵에서 찾는다. 지역 이름을 검색어에 넣는다(예: 포항 남구 맛집, 광양 중마동 카페). 이름·분류·주소·전화·카카오맵 주소를 10개까지 돌려준다.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '지역 이름 + 찾는 것 (예: 포항 남구 맛집)' },
      category: { type: 'string', enum: [...PLACE_CATEGORIES], description: 'restaurant(음식점)·cafe(카페)·any(전체). 묻지 않았으면 any' },
    },
    required: ['query'],
  },
};

const READ_WEB_PAGE: LlmToolDefinition = {
  name: 'read_web_page',
  description: `이번 답에서 web_search·search_places 결과로 받은 주소의 페이지를 읽어 제목과 본문 글(${PAGE_TEXT_MAX}자까지)을 돌려준다. 결과에 없던 주소는 읽지 않는다. 한 답에 ${MAX_PAGE_READS_PER_ANSWER}개까지.`,
  parameters: {
    type: 'object',
    properties: { url: { type: 'string', description: '검색 결과에 있던 주소 그대로' } },
    required: ['url'],
  },
};

/**
 * 웹 도구 모음 (이슈 #367): web_search·read_web_page, 카카오 키가 있으면 search_places.
 * 조회 도구처럼 묻지 않고 실행하지만 웹 검색을 켠 실시간 답에서만 알린다. 답마다 session()을 새로 만들어
 * 그 답의 검색 결과 주소만 읽게 하고(모델이 지어낸 주소는 거절), 답의 링크도 그 주소만 남긴다.
 */
export class AssistantWebToolbox {
  constructor(private readonly deps: WebToolDeps) {}

  /** 장소 검색은 카카오 키가 있을 때만 */
  definitions(): LlmToolDefinition[] {
    return this.deps.places.enabled ? [WEB_SEARCH, SEARCH_PLACES, READ_WEB_PAGE] : [WEB_SEARCH, READ_WEB_PAGE];
  }

  get placeSearchEnabled(): boolean {
    return this.deps.places.enabled;
  }

  session(): WebToolSession {
    return new WebToolSession(this.deps, this.definitions().map((d) => d.name));
  }
}

export interface WebToolResult {
  content: string;
  /** 이 호출이 찾은·읽은 페이지 (tool_end.webSources) */
  webSources: AiWebSource[];
}

/** 한 답 동안의 웹 도구 상태: 결과로 받은 주소(읽어도 되는 주소), 읽은 페이지, 부른 횟수 */
export class WebToolSession {
  private readonly logger = new Logger(WebToolSession.name);
  /** 검색·장소 결과로 받은 주소 (키 → 출처). read_web_page는 여기 있는 주소만 읽는다 */
  private readonly found = new Map<string, AiWebSource>();
  /** 읽은 페이지 (이동 뒤 최종 주소) */
  private readonly read: AiWebSource[] = [];
  private searches = 0;
  private reads = 0;

  constructor(
    private readonly deps: WebToolDeps,
    private readonly offered: readonly string[],
  ) {}

  /** 이번 답에서 알린 웹 도구인지 */
  has(name: string): boolean {
    return isAiAssistantWebTool(name) && this.offered.includes(name);
  }

  async run(call: LlmToolCall, signal?: AbortSignal): Promise<WebToolResult> {
    let args: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(call.arguments || '{}');
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return failure('인자는 객체여야 해요');
      args = parsed as Record<string, unknown>;
    } catch {
      return failure('인자가 JSON이 아니에요');
    }
    try {
      if (call.name === 'web_search') return await this.webSearch(args);
      if (call.name === 'search_places') return await this.searchPlaces(args);
      if (call.name === 'read_web_page') return await this.readPage(args, signal);
      return failure(`없는 도구예요: ${call.name}`);
    } catch (error) {
      if (error instanceof ToolArgumentError) return failure(error.message);
      if (signal?.aborted) throw error;
      this.logger.error(`웹 도구 실패 (${call.name})`, error instanceof Error ? error.stack : String(error));
      return failure('웹 도구에서 서버 오류가 났어요', { 안내: '검색하지 못했다고 사용자에게 알려요' });
    }
  }

  private async webSearch(args: Record<string, unknown>): Promise<WebToolResult> {
    const { query, removed } = redactQuery(requiredString(args, 'query', 200));
    if (!query) return failure('검색어가 비었어요', { 안내: '개인정보를 뺀 검색어로 다시 불러요' });
    if (++this.searches > MAX_WEB_SEARCHES_PER_ANSWER) return failure(`이번 질문에서는 검색을 ${MAX_WEB_SEARCHES_PER_ANSWER}번까지만 해요`, { 안내: '지금까지의 결과로 답해요' });
    let outcome: WebSearchOutcome;
    try {
      outcome = await this.deps.search.search(query);
    } catch (error) {
      if (error instanceof SearchRateLimitError || error instanceof SearchUnavailableError) return failure(error.message, { 안내: '검색하지 못했다고 사용자에게 알리고 지어내지 않아요' });
      throw error;
    }
    const removedNote = removed.length ? `검색어에서 ${removed.join('·')}로 보이는 부분을 빼고 검색했어요.` : null;
    if (!outcome.results.length) return failure('검색 결과가 없어요', { 검색어: query, 안내: '찾지 못했다고 사용자에게 알려요', ...(removedNote ? { 참고: removedNote } : {}) });

    const results = outcome.results.slice(0, WEB_SEARCH_RESULT_LIMIT);
    for (const r of results) this.remember(r.url, r.title);
    const body = results.map((r, i) => [`${i + 1}. ${cutText(r.title, TITLE_MAX)}`, `   주소: ${r.url}`, r.snippet ? `   요약: ${cutText(r.snippet, SNIPPET_MAX)}` : null].filter(Boolean).join('\n')).join('\n');
    const content = [`[웹 검색 결과] 검색어: ${query} · 검색: ${outcome.engine} · ${results.length}건`, removedNote, UNTRUSTED_NOTE, wrapUntrusted(`web_search:${outcome.engine}`, body)].filter(Boolean).join('\n');
    return { content, webSources: results.map(({ title, url }) => ({ title, url })) };
  }

  private async searchPlaces(args: Record<string, unknown>): Promise<WebToolResult> {
    const { query, removed } = redactQuery(requiredString(args, 'query', 100));
    const category = optionalEnum(args, 'category', PLACE_CATEGORIES) ?? 'any';
    if (!query) return failure('검색어가 비었어요');
    if (++this.searches > MAX_WEB_SEARCHES_PER_ANSWER) return failure(`이번 질문에서는 검색을 ${MAX_WEB_SEARCHES_PER_ANSWER}번까지만 해요`, { 안내: '지금까지의 결과로 답해요' });
    let places: KakaoPlace[];
    try {
      places = await this.deps.places.search(query, category);
    } catch (error) {
      if (error instanceof PlaceSearchError) return failure(error.message, { 안내: '장소를 찾지 못했다고 사용자에게 알려요' });
      throw error;
    }
    if (!places.length) return failure('찾은 장소가 없어요', { 검색어: query, 안내: '지역 이름을 바꾸거나 넓혀 다시 찾을 수 있다고 알려요' });
    for (const place of places) this.remember(place.url, place.name);
    const body = places
      .map((p, i) =>
        [
          `${i + 1}. ${cutText(p.name, TITLE_MAX)} (${p.category || '분류 없음'})`,
          `   주소: ${p.address || '(없음)'}`,
          p.phone ? `   전화: ${p.phone}` : null,
          p.distanceM !== null ? `   거리: ${p.distanceM}m` : null,
          `   카카오맵: ${p.url}`,
        ]
          .filter(Boolean)
          .join('\n'),
      )
      .join('\n');
    const removedNote = removed.length ? `검색어에서 ${removed.join('·')}로 보이는 부분을 빼고 검색했어요.` : null;
    const content = [`[장소 검색 결과] 검색어: ${query} · 카카오맵 · ${places.length}곳`, removedNote, UNTRUSTED_NOTE, wrapUntrusted('search_places:kakao', body)].filter(Boolean).join('\n');
    return { content, webSources: places.map((p) => ({ title: p.name, url: p.url })) };
  }

  private async readPage(args: Record<string, unknown>, signal?: AbortSignal): Promise<WebToolResult> {
    const raw = requiredString(args, 'url', 2000);
    const key = urlKey(raw);
    const known = key ? this.found.get(key) : undefined;
    // 모델이 지어내거나 페이지 안에서 본 주소는 읽지 않는다 (검색 결과로 받은 주소만)
    if (!key || !known) return failure('이번 답의 검색 결과에 없던 주소라 읽지 않았어요', { 안내: 'web_search 결과의 주소를 그대로 넘기거나, 먼저 검색해요' });
    if (++this.reads > MAX_PAGE_READS_PER_ANSWER) return failure(`이번 질문에서는 페이지를 ${MAX_PAGE_READS_PER_ANSWER}개까지만 읽어요`, { 안내: '지금까지 읽은 내용으로 답해요' });
    let page: ReadPage;
    try {
      page = await this.deps.pages.read(known.url, signal);
    } catch (error) {
      if (error instanceof WebFetchError) return failure(error.message, { 주소: known.url, 안내: '읽지 못했다고 알리고 검색 요약이나 다른 결과로 답해요' });
      throw error;
    }
    const limited = limitPageText(page.text);
    if (!limited.text.trim()) return failure('페이지에 읽을 글이 없어요', { 주소: page.url, 안내: '검색 요약이나 다른 결과로 답해요' });
    const title = cutText(page.title || known.title, TITLE_MAX);
    const source = { title, url: page.url };
    this.read.push(source);
    const finalKey = urlKey(page.url);
    if (finalKey && !this.found.has(finalKey)) this.found.set(finalKey, source);
    const content = [
      `[웹 페이지] 주소: ${page.url}`,
      UNTRUSTED_NOTE,
      wrapUntrusted(page.url, `제목: ${title}\n\n${limited.text}`),
      limited.truncated ? `(페이지가 길어 앞 ${PAGE_TEXT_MAX}자만 넘겼어요)` : null,
    ]
      .filter(Boolean)
      .join('\n');
    return { content, webSources: [source] };
  }

  private remember(url: string, title: string) {
    const key = urlKey(url);
    if (key && !this.found.has(key)) this.found.set(key, { title, url });
  }

  /**
   * 마지막 답 정리: 이번 답의 웹 결과에 없던 링크는 지우고, 웹 출처를 고른다.
   * 출처 = 답이 링크로 단 결과 → 읽은 페이지 순. 둘 다 없으면 검색 결과 앞의 3개(요약만 보고 답했을 때).
   */
  finalize(answer: string): { answer: string; webSources: AiWebSource[] } {
    const { answer: filtered, citedKeys } = filterAnswerLinks(answer, new Set(this.found.keys()));
    const cited = citedKeys.map((key) => this.found.get(key)).filter((s): s is AiWebSource => s !== undefined);
    let webSources = uniqueSources([...cited, ...this.read]);
    if (!webSources.length) webSources = [...this.found.values()].slice(0, FALLBACK_SOURCE_COUNT);
    return { answer: filtered, webSources };
  }
}

function failure(reason: string, extra: Record<string, unknown> = {}): WebToolResult {
  return { content: JSON.stringify({ 오류: reason, ...extra }), webSources: [] };
}
