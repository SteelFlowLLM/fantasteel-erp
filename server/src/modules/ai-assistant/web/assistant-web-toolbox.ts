import { Logger } from '@nestjs/common';
import { isAiAssistantWebTool, type AiWebSearchCapabilities, type AiWebSource } from '@fantasteel/shared';
import type { LlmToolCall, LlmToolDefinition } from '../../llm/llm.client';
import { optionalEnum, requiredString, ToolArgumentError } from '../tools/assistant-tool';
import { decodeBody, extractPageIsolated, extractPdfIsolated, limitPageText, PAGE_TEXT_MAX, PageTooComplexError } from './page-extract';
import { PDF_CONTENT_TYPE, SafePageFetcher, WebFetchError } from './safe-fetch';
import { PLACE_CATEGORIES, WEB_SEARCH_RESULT_LIMIT, type Place, type WebSearchResult } from './search-parsers';
import { KakaoPlaceClient, NaverPlaceClient, PlaceSearch, PlaceSearchError, SearchRateLimitError, SearchUnavailableError, WebSearchClient, type SearchEngine, type WebSearchOutcome } from './web-search.client';
import { cutText, filterAnswerLinks, internalReferenceIn, partnerNamesIn, redactQuery, stripInvisible, UNTRUSTED_NOTE, uniqueSources, urlKey, wrapUntrusted } from './web-text';

/** 한 답에서 웹 도구를 부르는 수 (가정값). 한 차례에 여러 도구를 한꺼번에 불러도 이만큼만 실행한다 */
export const MAX_WEB_SEARCHES_PER_ANSWER = 3;
export const MAX_PAGE_READS_PER_ANSWER = 3;
/** 출처 링크를 달지 않았을 때 답 아래 보일 검색 결과 수 */
const FALLBACK_SOURCE_COUNT = 3;
const TITLE_MAX = 200;
const SNIPPET_MAX = 300;
/** 검색어 길이 상한 (보안 검토: 긴 검색어에 ERP 데이터를 실어 내보내지 못하게) */
export const WEB_QUERY_MAX = 80;
/** 서버 전체에서 동시에 읽는 페이지 수 (보안 검토). 넘으면 차례를 기다린다 */
export const PAGE_READ_CONCURRENCY = 4;
/** 사원 한 명이 1분에 하는 검색 수 (웹·장소 합쳐, 캐시 포함). 서버 전체 1분 10번과 따로 센다 */
export const SEARCHES_PER_USER_PER_MINUTE = 5;

/** 동시에 도는 작업 수를 묶는다 */
export class Semaphore {
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(private readonly limit: number) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.active += 1;
    try {
      return await task();
    } finally {
      this.active -= 1;
      this.waiting.shift()?.();
    }
  }
}

/** 사원별 1분 검색 수 */
export class UserSearchLimiter {
  private readonly sent = new Map<number, number[]>();

  constructor(
    private readonly perMinute = SEARCHES_PER_USER_PER_MINUTE,
    private readonly now: () => number = Date.now,
  ) {}

  /** 한 번 쓴다. 한도를 넘었으면 false (세지 않음) */
  take(employeeId: number): boolean {
    const now = this.now();
    const recent = (this.sent.get(employeeId) ?? []).filter((at) => now - at < 60_000);
    if (recent.length >= this.perMinute) {
      this.sent.set(employeeId, recent);
      return false;
    }
    recent.push(now);
    this.sent.set(employeeId, recent);
    return true;
  }
}

/** 읽은 페이지. title·text는 웹에서 온 글이라 감싸서 넘긴다 */
export interface ReadPage {
  url: string;
  title: string;
  text: string;
}

export interface WebPageReader {
  read(url: string, signal?: AbortSignal): Promise<ReadPage>;
}

/**
 * SSRF를 막는 fetch + Readability 본문 뽑기. 글 뽑기는 worker에서 3초까지만(서버 스레드를 막지 않게),
 * 서버 전체에서 동시에 4개까지만 읽는다 (보안 검토).
 */
export class SafeWebPageReader implements WebPageReader {
  private readonly slots: Semaphore;
  private readonly extractTimeoutMs: number | undefined;

  constructor(
    private readonly fetcher: SafePageFetcher = new SafePageFetcher(),
    options: { concurrency?: number; extractTimeoutMs?: number } = {},
  ) {
    this.slots = new Semaphore(options.concurrency ?? PAGE_READ_CONCURRENCY);
    this.extractTimeoutMs = options.extractTimeoutMs;
  }

  read(url: string, signal?: AbortSignal): Promise<ReadPage> {
    return this.slots.run(async () => {
      if (signal?.aborted) throw signal.reason;
      const page = await this.fetcher.fetch(url, signal);
      const extracted =
        page.contentType === PDF_CONTENT_TYPE
          ? await extractPdfIsolated(page.body, page.url, this.extractTimeoutMs)
          : await extractPageIsolated(decodeBody(page.body, page.contentType), page.contentType, page.url, this.extractTimeoutMs);
      return { url: page.url, title: extracted.title, text: extracted.text };
    });
  }
}

/** 장소 검색: PlaceSearch(카카오 → 네이버) 또는 제공자 하나 */
export type PlaceSearchLike = Pick<PlaceSearch, 'enabled' | 'search'> & { readonly provider: 'kakao' | 'naver' | null };

export interface WebToolDeps {
  search: WebSearchClient;
  places: PlaceSearchLike;
  pages: WebPageReader;
  /** 없으면 사원당 1분 5번 */
  userLimiter?: UserSearchLimiter;
}

/** 운영 기본값. 카카오·네이버 키는 부를 때마다 환경 변수에서 읽는다 */
export function defaultWebToolDeps(): WebToolDeps {
  return {
    search: new WebSearchClient(),
    places: new PlaceSearch([new KakaoPlaceClient(() => process.env.KAKAO_REST_API_KEY?.trim() || null), new NaverPlaceClient()]),
    pages: new SafeWebPageReader(),
  };
}

const PLACE_PROVIDER_LABEL = { kakao: '카카오맵', naver: '네이버 지도' } as const;

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
  description: '맛집·식당·카페·가게·장소를 지도(카카오맵, 없으면 네이버 지도)에서 찾는다. 지역 이름과 찾는 것을 검색어에 넣는다(예: 포항 남구 맛집, 광양 중마동 카페). 이름·분류·주소·전화·지도 주소를 돌려준다.',
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
 * 웹 도구 모음 (이슈 #367): web_search·read_web_page, 카카오나 네이버 키가 있으면 search_places.
 * 조회 도구처럼 묻지 않고 실행하지만 웹 검색을 켠 실시간 답에서만 알린다. 답마다 session()을 새로 만들어
 * 그 답의 검색 결과 주소만 읽게 하고(모델이 지어낸 주소는 거절), 답의 링크도 그 주소만 남긴다.
 */
export class AssistantWebToolbox {
  private readonly userLimiter: UserSearchLimiter;

  constructor(private readonly deps: WebToolDeps) {
    this.userLimiter = deps.userLimiter ?? new UserSearchLimiter();
  }

  /** 장소 검색은 카카오 키가 있을 때만 */
  definitions(): LlmToolDefinition[] {
    return this.deps.places.enabled ? [WEB_SEARCH, SEARCH_PLACES, READ_WEB_PAGE] : [WEB_SEARCH, READ_WEB_PAGE];
  }

  get placeSearchEnabled(): boolean {
    return this.deps.places.enabled;
  }

  /** 화면에 보일 웹 검색 기능 (GET ai-assistant/capabilities) */
  capabilities(): AiWebSearchCapabilities {
    return { engines: this.deps.search.engines(), placeSearch: this.deps.places.enabled };
  }

  /**
   * employeeId: 사원별 1분 검색 수를 센다. offerTools: false면 웹 도구는 알리지 않고 주소 허용 목록·답의 링크 거르기·
   * 회사 안 정보 막기만 쓴다 (웹 검색을 끄고 브라우저만 켠 질문, 이슈 #373)
   */
  session(employeeId: number, options: WebSessionOptions = {}): WebToolSession {
    const limits = { searches: options.maxSearches ?? MAX_WEB_SEARCHES_PER_ANSWER, reads: options.maxReads ?? MAX_PAGE_READS_PER_ANSWER };
    return new WebToolSession(this.deps, options.offerTools === false ? [] : this.definitions().map((d) => d.name), employeeId, this.userLimiter, limits);
  }
}

export interface WebSessionOptions {
  offerTools?: boolean;
  /** 한 세션의 검색·페이지 읽기 상한. 기본은 한 답의 3번·3개. 심층 조사(이슈 #378)는 조사 예산으로 따로 센다 */
  maxSearches?: number;
  maxReads?: number;
}

/** 구조화된 검색 결과 (심층 조사, 이슈 #378). 막히거나 실패하면 kind와 이유 */
export type SessionSearchOutcome =
  | { ok: true; query: string; engine: SearchEngine; results: WebSearchResult[]; removed: string[] }
  | { ok: false; kind: 'empty' | 'internal' | 'limit' | 'rate' | 'unavailable' | 'none'; reason: string; hint: string; query: string; removed: string[] };

/** 구조화된 페이지 읽기 결과 (심층 조사, 이슈 #378). text는 웹에서 온 글이라 감싸서 모델에 넘긴다 */
export type SessionReadOutcome =
  | { ok: true; url: string; title: string; text: string; truncated: boolean }
  | { ok: false; reason: string; hint: string; url: string | null };

/** 같은 구조의 이유를 모델에 돌려줄 도구 결과로 */
function blockedFailure(outcome: { reason: string; hint: string }): WebToolResult {
  return failure(outcome.reason, { 안내: outcome.hint });
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
  /** 링크로만 허용하는 주소 (allowLink). 읽지도, 출처 대체 후보로 쓰지도 않는다 */
  private readonly linkable = new Map<string, AiWebSource>();
  /** 읽은 페이지 (이동 뒤 최종 주소) */
  private readonly read: AiWebSource[] = [];
  private searches = 0;
  private reads = 0;
  /** 이번 답의 ERP 조회 결과에 나온 거래처 이름. 검색어에 넣어 회사 밖으로 내보내지 않는다 */
  private readonly partnerNames = new Set<string>();

  constructor(
    private readonly deps: WebToolDeps,
    private readonly offered: readonly string[],
    private readonly employeeId: number,
    private readonly userLimiter: UserSearchLimiter,
    private readonly limits: { searches: number; reads: number } = { searches: MAX_WEB_SEARCHES_PER_ANSWER, reads: MAX_PAGE_READS_PER_ANSWER },
  ) {}

  /** ERP 조회 도구 결과를 본다 (거래처 이름 모으기). 서비스가 조회 도구를 부를 때마다 넘긴다 */
  observeErpResult(content: string) {
    for (const name of partnerNamesIn(content)) this.partnerNames.add(name);
  }

  /** 회사 밖으로 나가는 글(브라우저가 여는 주소·입력하는 글, 이슈 #373)에 회사 안 정보가 있으면 그 종류 */
  internalReference(text: string): ReturnType<typeof internalReferenceIn> {
    return internalReferenceIn(text, this.partnerNames);
  }

  /** 이번 답의 웹 결과(검색·장소 결과, 읽은 페이지, 브라우저로 본 페이지)에 있던 주소인지 */
  knows(url: string): boolean {
    const key = urlKey(url);
    return key !== null && this.found.has(key);
  }

  /** 브라우저로 본 페이지 (이슈 #373). 답이 이 주소를 링크로 달 수 있게 한다 */
  rememberVisited(url: string, title: string) {
    this.remember(url, cutText(stripInvisible(title), TITLE_MAX));
  }

  /**
   * 답이 링크로 달 수 있게만 허용하는 주소 (Drive 찾기 결과). 읽을 수 있는 주소(found)나 출처 대체 후보에는 넣지 않는다:
   * 요약만 보고 답했을 때 검색 결과 앞의 3개를 출처로 쓰는데, 쓰지 않은 Drive 찾기 결과가 거기 붙지 않게 한다(이슈 #473)
   */
  allowLink(url: string, title: string) {
    const key = urlKey(url);
    if (key && !this.found.has(key) && !this.linkable.has(key)) this.linkable.set(key, { title: cutText(stripInvisible(title), TITLE_MAX), url });
  }

  /** 검색 전 확인: 회사 안 정보·한 답 횟수·사원별 1분 수. 막히면 그 종류와 이유 */
  private searchBlocked(query: string): { kind: 'internal' | 'limit' | 'rate'; reason: string; hint: string } | null {
    const internal = internalReferenceIn(query, this.partnerNames);
    if (internal)
      return {
        kind: 'internal',
        reason: `검색어에 회사 안 정보(${internal})가 있어 검색하지 않았어요`,
        hint: '업무·LOT 번호, 고객사·공급업체 이름 같은 회사 내부 정보는 빼고 일반적인 낱말로만 다시 검색해요. 내부 데이터는 조회 도구로 확인해요',
      };
    if (++this.searches > this.limits.searches) return { kind: 'limit', reason: `이번 질문에서는 검색을 ${this.limits.searches}번까지만 해요`, hint: '지금까지의 결과로 답해요' };
    if (!this.userLimiter.take(this.employeeId)) return { kind: 'rate', reason: '검색을 너무 자주 했어요. 1분쯤 뒤에 다시 물어봐 주세요', hint: '검색하지 못했다고 사용자에게 알리고 지어내지 않아요' };
    return null;
  }

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

  /**
   * 개인정보를 빼고·회사 안 정보와 한도를 확인한 뒤 웹 검색한다. 결과 주소는 이 세션이 읽어도 되는 주소로 기억한다.
   * web_search 도구와 심층 조사(이슈 #378)가 함께 쓴다. query는 WEB_QUERY_MAX 안이어야 한다(부르는 쪽이 자른다).
   */
  async searchWeb(rawQuery: string): Promise<SessionSearchOutcome> {
    const { query, removed } = redactQuery(rawQuery);
    if (!query) return { ok: false, kind: 'empty', reason: '검색어가 비었어요', hint: '개인정보를 뺀 검색어로 다시 불러요', query, removed };
    const blocked = this.searchBlocked(query);
    if (blocked) return { ok: false, ...blocked, query, removed };
    let outcome: WebSearchOutcome;
    try {
      outcome = await this.deps.search.search(query);
    } catch (error) {
      if (error instanceof SearchRateLimitError) return { ok: false, kind: 'rate', reason: error.message, hint: '검색하지 못했다고 사용자에게 알리고 지어내지 않아요', query, removed };
      if (error instanceof SearchUnavailableError) return { ok: false, kind: 'unavailable', reason: error.message, hint: '검색하지 못했다고 사용자에게 알리고 지어내지 않아요', query, removed };
      throw error;
    }
    if (!outcome.results.length) return { ok: false, kind: 'none', reason: '검색 결과가 없어요', hint: '찾지 못했다고 사용자에게 알려요', query, removed };
    const results = outcome.results.slice(0, WEB_SEARCH_RESULT_LIMIT);
    for (const r of results) this.remember(r.url, r.title);
    return { ok: true, query, engine: outcome.engine, results, removed };
  }

  private async webSearch(args: Record<string, unknown>): Promise<WebToolResult> {
    const outcome = await this.searchWeb(requiredString(args, 'query', WEB_QUERY_MAX));
    const removedNote = outcome.removed.length ? `검색어에서 ${outcome.removed.join('·')}로 보이는 부분을 빼고 검색했어요.` : null;
    if (!outcome.ok) {
      if (outcome.kind === 'none') return failure(outcome.reason, { 검색어: outcome.query, 안내: outcome.hint, ...(removedNote ? { 참고: removedNote } : {}) });
      return blockedFailure(outcome);
    }
    const { query, results } = outcome;
    const body = results.map((r, i) => [`${i + 1}. ${cutText(r.title, TITLE_MAX)}`, `   주소: ${r.url}`, r.snippet ? `   요약: ${cutText(r.snippet, SNIPPET_MAX)}` : null].filter(Boolean).join('\n')).join('\n');
    const content = [`[웹 검색 결과] 검색어: ${query} · 검색: ${outcome.engine} · ${results.length}건`, removedNote, UNTRUSTED_NOTE, wrapUntrusted(`web_search:${outcome.engine}`, body)].filter(Boolean).join('\n');
    return { content, webSources: results.map(({ title, url }) => ({ title: stripInvisible(title), url })) };
  }

  private async searchPlaces(args: Record<string, unknown>): Promise<WebToolResult> {
    const { query, removed } = redactQuery(requiredString(args, 'query', WEB_QUERY_MAX));
    const category = optionalEnum(args, 'category', PLACE_CATEGORIES) ?? 'any';
    if (!query) return failure('검색어가 비었어요');
    const blocked = this.searchBlocked(query);
    if (blocked) return blockedFailure(blocked);
    let places: Place[];
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
          `   지도: ${p.url}`,
        ]
          .filter(Boolean)
          .join('\n'),
      )
      .join('\n');
    const removedNote = removed.length ? `검색어에서 ${removed.join('·')}로 보이는 부분을 빼고 검색했어요.` : null;
    const provider = this.deps.places.provider;
    const label = provider ? PLACE_PROVIDER_LABEL[provider] : '지도';
    const content = [`[장소 검색 결과] 검색어: ${query} · ${label} · ${places.length}곳`, removedNote, UNTRUSTED_NOTE, wrapUntrusted(`search_places:${provider ?? 'map'}`, body)].filter(Boolean).join('\n');
    return { content, webSources: places.map((p) => ({ title: stripInvisible(p.name), url: p.url })) };
  }

  /**
   * 이 세션의 검색 결과(또는 기억한 주소)에 있던 주소만 읽는다. 모델이 지어내거나 페이지 안에서 본 주소는 읽지 않는다.
   * read_web_page 도구와 심층 조사(이슈 #378)가 함께 쓴다.
   */
  async readKnownPage(raw: string, signal?: AbortSignal): Promise<SessionReadOutcome> {
    const key = urlKey(raw);
    const known = key ? this.found.get(key) : undefined;
    if (!key || !known) return { ok: false, reason: '이번 답의 검색 결과에 없던 주소라 읽지 않았어요', hint: 'web_search 결과의 주소를 그대로 넘기거나, 먼저 검색해요', url: null };
    if (++this.reads > this.limits.reads) return { ok: false, reason: `이번 질문에서는 페이지를 ${this.limits.reads}개까지만 읽어요`, hint: '지금까지 읽은 내용으로 답해요', url: null };
    let page: ReadPage;
    try {
      page = await this.deps.pages.read(known.url, signal);
    } catch (error) {
      if (error instanceof WebFetchError || error instanceof PageTooComplexError) return { ok: false, reason: error.message, hint: '읽지 못했다고 알리고 검색 요약이나 다른 결과로 답해요', url: known.url };
      throw error;
    }
    const limited = limitPageText(page.text);
    if (!limited.text.trim()) return { ok: false, reason: '페이지에 읽을 글이 없어요', hint: '검색 요약이나 다른 결과로 답해요', url: page.url };
    const title = cutText(stripInvisible(page.title || known.title), TITLE_MAX);
    const source = { title, url: page.url };
    this.read.push(source);
    const finalKey = urlKey(page.url);
    if (finalKey && !this.found.has(finalKey)) this.found.set(finalKey, source);
    return { ok: true, url: page.url, title, text: limited.text, truncated: limited.truncated };
  }

  private async readPage(args: Record<string, unknown>, signal?: AbortSignal): Promise<WebToolResult> {
    const outcome = await this.readKnownPage(requiredString(args, 'url', 2000), signal);
    if (!outcome.ok) return failure(outcome.reason, { ...(outcome.url ? { 주소: outcome.url } : {}), 안내: outcome.hint });
    const { url, title, text, truncated } = outcome;
    const content = [
      // 최종 주소는 페이지가 정한 값(이동)이라 감싼 안에 두고, 밖에는 호스트만
      `[웹 페이지] ${hostOf(url)}`,
      UNTRUSTED_NOTE,
      wrapUntrusted(hostOf(url), `주소: ${url}\n제목: ${title}\n\n${text}`),
      truncated ? `(페이지가 길어 앞 ${PAGE_TEXT_MAX}자만 넘겼어요)` : null,
    ]
      .filter(Boolean)
      .join('\n');
    return { content, webSources: [{ title, url }] };
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
    const { answer: filtered, citedKeys } = filterAnswerLinks(answer, new Set([...this.found.keys(), ...this.linkable.keys()]));
    const cited = citedKeys.map((key) => this.found.get(key) ?? this.linkable.get(key)).filter((s): s is AiWebSource => s !== undefined);
    let webSources = uniqueSources([...cited, ...this.read]);
    if (!webSources.length) webSources = [...this.found.values()].slice(0, FALLBACK_SOURCE_COUNT);
    return { answer: filtered, webSources };
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return 'web';
  }
}

function failure(reason: string, extra: Record<string, unknown> = {}): WebToolResult {
  return { content: JSON.stringify({ 오류: reason, ...extra }), webSources: [] };
}
