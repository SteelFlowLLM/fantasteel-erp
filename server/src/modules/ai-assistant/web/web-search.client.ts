import { Logger } from '@nestjs/common';
import { BROWSER_USER_AGENT } from './safe-fetch';
import {
  isDuckDuckGoBlocked,
  kakaoKeywordUrl,
  mapKakaoPlaces,
  parseDuckDuckGoHtml,
  parseWikipediaSearch,
  wikipediaSearchUrl,
  type KakaoPlace,
  type PlaceCategory,
  type WebSearchResult,
} from './search-parsers';

/** 검색 엔진에 보내는 HTTP. 주소가 정해진 외부 API라 SSRF 막기 대신 보통 fetch를 쓴다. 시험은 가짜를 넣는다 */
export type HttpFetch = (url: string, init: RequestInit) => Promise<Response>;

/** 검색 한도 (이슈 #367 결정값) */
export const SEARCH_CACHE_TTL_MS = 10 * 60 * 1000;
const SEARCH_CACHE_MAX = 200;
/** 서버 전체에서 1분에 검색 엔진에 나가는 검색 수. 같은 검색어 캐시는 세지 않는다 */
export const SEARCH_PER_MINUTE = 10;
const SEARCH_REQUEST_TIMEOUT_MS = 8000;
/** 위키백과는 누구인지 밝히는 User-Agent를 요구한다 (API 이용 정책) */
export const WIKIPEDIA_USER_AGENT = 'FantaSteelERP/1.0 (internal assistant; contact via repo)';

export type SearchEngine = 'DuckDuckGo' | '위키백과(한국어)' | '위키백과(영어)';

export interface WebSearchOutcome {
  engine: SearchEngine;
  results: WebSearchResult[];
}

/** 1분 검색 수를 넘었을 때 */
export class SearchRateLimitError extends Error {}
/** 검색 엔진에 모두 실패했을 때 */
export class SearchUnavailableError extends Error {}

export interface WebSearchDeps {
  fetch?: HttpFetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  random?: () => number;
}

/**
 * 웹 검색. DuckDuckGo HTML(비공식) → 막히면 1~2초 쉬고 한 번 더 → 그래도 막히거나 결과가 없으면 위키백과(한국어 → 영어).
 * DuckDuckGo가 봇으로 보지 않게 요청을 한 번에 하나씩 보내고(차례로), 같은 검색어는 10분 기억하고, 서버 전체 1분 10번으로 묶는다.
 */
export class WebSearchClient {
  private readonly logger = new Logger(WebSearchClient.name);
  private readonly fetch: HttpFetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly cache = new Map<string, { at: number; outcome: WebSearchOutcome }>();
  private readonly sentAt: number[] = [];
  private queue: Promise<unknown> = Promise.resolve();

  constructor(deps: WebSearchDeps = {}) {
    this.fetch = deps.fetch ?? ((url, init) => fetch(url, init));
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = deps.now ?? Date.now;
    this.random = deps.random ?? Math.random;
  }

  async search(query: string): Promise<WebSearchOutcome> {
    const key = query.trim().toLowerCase();
    const cached = this.cached(key);
    if (cached) return cached;
    // 차례를 기다린 뒤 다시 본다: 같은 검색어가 동시에 오면 두 번째는 첫 번째 결과를 쓴다
    return this.serialized(async () => {
      const again = this.cached(key);
      if (again) return again;
      this.takeQuota();
      const outcome = await this.searchEngines(query);
      this.remember(key, outcome);
      return outcome;
    });
  }

  private async searchEngines(query: string): Promise<WebSearchOutcome> {
    const ddg = await this.duckDuckGoWithRetry(query);
    if (ddg?.length) return { engine: 'DuckDuckGo', results: ddg };
    // 결과가 없다고 답한 엔진이 하나라도 있으면 '결과 없음', 모두 실패했으면 오류
    let answered: SearchEngine | null = ddg ? 'DuckDuckGo' : null;
    for (const lang of ['ko', 'en'] as const) {
      const results = await this.wikipedia(query, lang);
      if (results === null) continue;
      const engine = lang === 'ko' ? '위키백과(한국어)' : '위키백과(영어)';
      if (results.length) return { engine, results };
      answered ??= engine;
    }
    if (answered) return { engine: answered, results: [] };
    throw new SearchUnavailableError('검색 엔진에 연결하지 못했어요');
  }

  /** 결과(빈 배열 포함) 또는 막힘·실패면 null */
  private async duckDuckGoWithRetry(query: string): Promise<WebSearchResult[] | null> {
    const first = await this.duckDuckGo(query);
    if (first !== 'BLOCKED') return first;
    // 막히면 한 번만 1~2초 쉬고 다시 한다
    await this.sleep(1000 + Math.floor(this.random() * 1000));
    const second = await this.duckDuckGo(query);
    if (second !== 'BLOCKED') return second;
    this.logger.warn('DuckDuckGo가 검색을 막아 위키백과로 찾아요');
    return null;
  }

  private async duckDuckGo(query: string): Promise<WebSearchResult[] | 'BLOCKED' | null> {
    try {
      const response = await this.fetch('https://html.duckduckgo.com/html/', {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'user-agent': BROWSER_USER_AGENT,
          referer: 'https://html.duckduckgo.com/',
          origin: 'https://html.duckduckgo.com',
          'accept-language': 'ko-KR,ko;q=0.9,en;q=0.8',
        },
        body: new URLSearchParams({ q: query, kl: 'kr-kr' }).toString(),
        signal: AbortSignal.timeout(SEARCH_REQUEST_TIMEOUT_MS),
      });
      const body = await response.text();
      if (isDuckDuckGoBlocked(response.status, body)) return 'BLOCKED';
      if (!response.ok) return null;
      return parseDuckDuckGoHtml(body);
    } catch (error) {
      this.logger.warn(`DuckDuckGo 검색 실패: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  /** 결과 또는 실패면 null */
  private async wikipedia(query: string, lang: 'ko' | 'en'): Promise<WebSearchResult[] | null> {
    try {
      const response = await this.fetch(wikipediaSearchUrl(lang, query), {
        method: 'GET',
        headers: { 'user-agent': WIKIPEDIA_USER_AGENT, accept: 'application/json' },
        signal: AbortSignal.timeout(SEARCH_REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) return null;
      return parseWikipediaSearch(await response.json(), lang);
    } catch (error) {
      this.logger.warn(`위키백과(${lang}) 검색 실패: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  private cached(key: string): WebSearchOutcome | null {
    const hit = this.cache.get(key);
    if (!hit) return null;
    if (this.now() - hit.at > SEARCH_CACHE_TTL_MS) {
      this.cache.delete(key);
      return null;
    }
    return hit.outcome;
  }

  private remember(key: string, outcome: WebSearchOutcome) {
    this.cache.set(key, { at: this.now(), outcome });
    // 가장 오래된 것부터 버린다 (Map은 넣은 순서)
    while (this.cache.size > SEARCH_CACHE_MAX) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }

  private takeQuota() {
    const now = this.now();
    while (this.sentAt.length && now - this.sentAt[0] >= 60_000) this.sentAt.shift();
    if (this.sentAt.length >= SEARCH_PER_MINUTE) throw new SearchRateLimitError('웹 검색이 잠시 많아요. 1분쯤 뒤에 다시 물어봐 주세요');
    this.sentAt.push(now);
  }

  private serialized<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }
}

/** 카카오 로컬 오류. 모델에 그대로 돌려준다 */
export class PlaceSearchError extends Error {}

/**
 * 카카오 로컬 키워드 검색 (장소·맛집). KAKAO_REST_API_KEY가 있을 때만 도구를 알린다.
 * 키는 developers.kakao.com → 내 애플리케이션 → 앱 키의 REST API 키. 앱의 '카카오맵' 사용 설정을 켜야 한다(끄면 401 OPEN_MAP_AND_LOCAL).
 */
export class KakaoPlaceClient {
  private readonly fetch: HttpFetch;
  private readonly now: () => number;
  private readonly cache = new Map<string, { at: number; places: KakaoPlace[] }>();

  constructor(
    private readonly apiKey: () => string | null,
    deps: { fetch?: HttpFetch; now?: () => number } = {},
  ) {
    this.fetch = deps.fetch ?? ((url, init) => fetch(url, init));
    this.now = deps.now ?? Date.now;
  }

  get enabled(): boolean {
    return this.apiKey() !== null;
  }

  async search(query: string, category: PlaceCategory): Promise<KakaoPlace[]> {
    const key = this.apiKey();
    if (!key) throw new PlaceSearchError('장소 검색이 설정되지 않았어요');
    const cacheKey = `${category}:${query.trim().toLowerCase()}`;
    const hit = this.cache.get(cacheKey);
    if (hit && this.now() - hit.at <= SEARCH_CACHE_TTL_MS) return hit.places;

    let response: Response;
    try {
      response = await this.fetch(kakaoKeywordUrl(query, category), {
        method: 'GET',
        headers: { authorization: `KakaoAK ${key}` },
        signal: AbortSignal.timeout(SEARCH_REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new PlaceSearchError('카카오 장소 검색에 연결하지 못했어요');
    }
    if (response.status === 401 || response.status === 403) {
      const body = await response.text().catch(() => '');
      throw new PlaceSearchError(
        body.includes('OPEN_MAP_AND_LOCAL')
          ? '카카오 앱에서 카카오맵 사용 설정이 꺼져 있어 장소를 찾지 못했어요. 관리자에게 알려 주세요'
          : '카카오 API 키가 맞지 않아 장소를 찾지 못했어요. 관리자에게 알려 주세요',
      );
    }
    if (!response.ok) throw new PlaceSearchError(`카카오 장소 검색이 ${response.status} 오류를 돌려줬어요`);
    const places = mapKakaoPlaces(await response.json());
    this.cache.set(cacheKey, { at: this.now(), places });
    if (this.cache.size > SEARCH_CACHE_MAX) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    return places;
  }
}
