import { Logger } from '@nestjs/common';
import type { AiWebSearchEngine } from '@fantasteel/shared';
import { BROWSER_USER_AGENT } from './safe-fetch';
import {
  isDuckDuckGoBlocked,
  kakaoKeywordUrl,
  mapKakaoPlaces,
  mapNaverPlaces,
  naverLocalSearchUrl,
  naverWebSearchUrl,
  parseDuckDuckGoHtml,
  parseNaverWebSearch,
  filterRelevantWikipedia,
  parseWikipediaSearch,
  shortenWikipediaQuery,
  wikipediaSearchUrl,
  type Place,
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

export type SearchEngine = '네이버' | 'DuckDuckGo' | '위키백과(한국어)' | '위키백과(영어)';

/** 네이버 검색 API 키 (developers.naver.com 애플리케이션의 Client ID·Secret). 없으면 네이버를 건너뛴다 */
export interface NaverCredentials {
  clientId: string;
  clientSecret: string;
}

/** 운영: 부를 때마다 환경 변수에서 읽는다(서버를 다시 띄우면 반영) */
export const naverCredentialsFromEnv = (): NaverCredentials | null => {
  const clientId = process.env.NAVER_CLIENT_ID?.trim();
  const clientSecret = process.env.NAVER_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
};

const naverHeaders = (credentials: NaverCredentials) => ({ 'x-naver-client-id': credentials.clientId, 'x-naver-client-secret': credentials.clientSecret, accept: 'application/json' });

/**
 * 네이버 검색 API 실패를 한 번만 남기는 기록기. 키 값은 남기지 않고 상태·오류 코드만 남긴다.
 * 401(키 틀림)·403(API 설정에 '검색' 없음)·429(하루 한도 25,000회 초과)는 같은 이유가 계속되므로 처음 한 번만.
 */
class NaverFailureLog {
  private readonly logged = new Set<string>();
  constructor(private readonly logger: Logger) {}

  async note(api: string, response: Response) {
    const reason = String(response.status);
    if (this.logged.has(`${api}:${reason}`)) return;
    this.logged.add(`${api}:${reason}`);
    const body: unknown = await response.json().catch(() => null);
    const code = typeof (body as { errorCode?: unknown } | null)?.errorCode === 'string' ? ` ${(body as { errorCode: string }).errorCode}` : '';
    const hint = response.status === 401 ? '키(Client ID·Secret)를 확인하세요' : response.status === 403 ? "애플리케이션 API 설정에 '검색'이 있는지 확인하세요" : response.status === 429 ? '하루 호출 한도를 넘었어요' : '잠시 뒤 다시 시도해요';
    this.logger.warn(`네이버 ${api} 실패 (HTTP ${response.status}${code}) — ${hint}. 다음 검색 방법으로 넘어가요`);
  }
}

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
  /** 네이버 검색 API 키. 기본은 환경 변수(NAVER_CLIENT_ID·NAVER_CLIENT_SECRET) */
  naver?: () => NaverCredentials | null;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  random?: () => number;
}

/**
 * 웹 검색. 네이버 검색 API(공식, 키가 있을 때) → DuckDuckGo HTML(비공식) → 막히면 1~2초 쉬고 한 번 더 → 그래도 막히거나 결과가 없으면 위키백과(한국어 → 영어).
 * DuckDuckGo가 봇으로 보지 않게 요청을 한 번에 하나씩 보내고(차례로), 같은 검색어는 10분 기억하고, 서버 전체 1분 10번으로 묶는다.
 */
export class WebSearchClient {
  private readonly logger = new Logger(WebSearchClient.name);
  private readonly fetch: HttpFetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly naver: () => NaverCredentials | null;
  private readonly naverFailures = new NaverFailureLog(this.logger);
  private readonly cache = new Map<string, { at: number; outcome: WebSearchOutcome }>();
  private readonly sentAt: number[] = [];
  private queue: Promise<unknown> = Promise.resolve();

  constructor(deps: WebSearchDeps = {}) {
    this.fetch = deps.fetch ?? ((url, init) => fetch(url, init));
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = deps.now ?? Date.now;
    this.random = deps.random ?? Math.random;
    this.naver = deps.naver ?? naverCredentialsFromEnv;
  }

  /** 지금 쓸 수 있는 검색 엔진(부르는 순서). 화면의 capabilities에 보인다 */
  engines(): AiWebSearchEngine[] {
    return this.naver() ? ['naver', 'duckduckgo', 'wikipedia'] : ['duckduckgo', 'wikipedia'];
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
    const naver = await this.naverWeb(query);
    if (naver?.length) return { engine: '네이버', results: naver };
    const ddg = await this.duckDuckGoWithRetry(query);
    if (ddg?.length) return { engine: 'DuckDuckGo', results: ddg };
    // 결과가 없다고 답한 엔진이 하나라도 있으면 '결과 없음', 모두 실패했으면 오류
    let answered: SearchEngine | null = naver ? '네이버' : ddg ? 'DuckDuckGo' : null;
    for (const lang of ['ko', 'en'] as const) {
      const results = await this.wikipediaWithRetry(query, lang);
      if (results === null) continue;
      const engine = lang === 'ko' ? '위키백과(한국어)' : '위키백과(영어)';
      if (results.length) return { engine, results };
      answered ??= engine;
    }
    if (answered) return { engine: answered, results: [] };
    throw new SearchUnavailableError('검색 엔진에 연결하지 못했어요');
  }

  /** 네이버 웹문서 검색. 키가 없거나 실패(401·403·429 등)면 null — 다음 엔진으로 넘어간다 */
  private async naverWeb(query: string): Promise<WebSearchResult[] | null> {
    const credentials = this.naver();
    if (!credentials) return null;
    try {
      const response = await this.fetch(naverWebSearchUrl(query), { method: 'GET', headers: naverHeaders(credentials), signal: AbortSignal.timeout(SEARCH_REQUEST_TIMEOUT_MS) });
      if (!response.ok) {
        await this.naverFailures.note('웹문서 검색', response);
        return null;
      }
      return parseNaverWebSearch(await response.json());
    } catch (error) {
      this.logger.warn(`네이버 웹문서 검색 실패: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
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

  /** 0건이고 검색어가 길면 뜻 있는 낱말 3개로 줄여 한 번 더 */
  private async wikipediaWithRetry(query: string, lang: 'ko' | 'en'): Promise<WebSearchResult[] | null> {
    const first = await this.wikipedia(query, lang);
    if (first === null || first.length) return first;
    const shortened = shortenWikipediaQuery(query);
    return shortened ? ((await this.wikipedia(shortened, lang)) ?? first) : first;
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
      return filterRelevantWikipedia(parseWikipediaSearch(await response.json(), lang), query, lang);
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
export class KakaoPlaceClient implements PlaceSearchProvider {
  private readonly fetch: HttpFetch;
  private readonly now: () => number;
  readonly provider = 'kakao' as const;
  private readonly cache = new Map<string, { at: number; places: Place[] }>();

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

  async search(query: string, category: PlaceCategory): Promise<Place[]> {
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

/**
 * 네이버 지역 검색 (local.json, 한 번에 5곳). 카카오 키가 없고 네이버 키가 있을 때 장소 검색에 쓴다.
 * 종류(음식점·카페)를 거르는 인자가 없어 category는 쓰지 않는다 — 모델이 검색어에 "맛집"·"카페"를 넣는다.
 */
export class NaverPlaceClient implements PlaceSearchProvider {
  readonly provider = 'naver' as const;
  private readonly logger = new Logger(NaverPlaceClient.name);
  private readonly failures = new NaverFailureLog(this.logger);
  private readonly fetch: HttpFetch;
  private readonly now: () => number;
  private readonly cache = new Map<string, { at: number; places: Place[] }>();

  constructor(
    private readonly credentials: () => NaverCredentials | null = naverCredentialsFromEnv,
    deps: { fetch?: HttpFetch; now?: () => number } = {},
  ) {
    this.fetch = deps.fetch ?? ((url, init) => fetch(url, init));
    this.now = deps.now ?? Date.now;
  }

  get enabled(): boolean {
    return this.credentials() !== null;
  }

  async search(query: string): Promise<Place[]> {
    const credentials = this.credentials();
    if (!credentials) throw new PlaceSearchError('장소 검색이 설정되지 않았어요');
    const cacheKey = query.trim().toLowerCase();
    const hit = this.cache.get(cacheKey);
    if (hit && this.now() - hit.at <= SEARCH_CACHE_TTL_MS) return hit.places;
    let response: Response;
    try {
      response = await this.fetch(naverLocalSearchUrl(query), { method: 'GET', headers: naverHeaders(credentials), signal: AbortSignal.timeout(SEARCH_REQUEST_TIMEOUT_MS) });
    } catch {
      throw new PlaceSearchError('네이버 장소 검색에 연결하지 못했어요');
    }
    if (!response.ok) {
      await this.failures.note('지역 검색', response);
      throw new PlaceSearchError(response.status === 429 ? '네이버 장소 검색의 하루 한도를 넘었어요' : `네이버 장소 검색이 ${response.status} 오류를 돌려줬어요. 관리자에게 알려 주세요`);
    }
    const places = mapNaverPlaces(await response.json());
    this.cache.set(cacheKey, { at: this.now(), places });
    if (this.cache.size > SEARCH_CACHE_MAX) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    return places;
  }
}

/** 장소 검색 제공자 (카카오·네이버) */
export interface PlaceSearchProvider {
  readonly provider: 'kakao' | 'naver';
  readonly enabled: boolean;
  search(query: string, category: PlaceCategory): Promise<Place[]>;
}

/** 키가 있는 첫 제공자를 쓴다: 카카오 → 네이버. 부를 때마다 고르므로 키를 넣고 서버를 다시 띄우면 바로 바뀐다 */
export class PlaceSearch {
  constructor(private readonly providers: readonly PlaceSearchProvider[]) {}

  private get active(): PlaceSearchProvider | null {
    return this.providers.find((p) => p.enabled) ?? null;
  }

  get enabled(): boolean {
    return this.active !== null;
  }

  /** 지금 쓰는 제공자 (없으면 null) */
  get provider(): 'kakao' | 'naver' | null {
    return this.active?.provider ?? null;
  }

  search(query: string, category: PlaceCategory): Promise<Place[]> {
    const active = this.active;
    if (!active) return Promise.reject(new PlaceSearchError('장소 검색이 설정되지 않았어요'));
    return active.search(query, category);
  }
}
