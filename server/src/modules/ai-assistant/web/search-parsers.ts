import { parseHTML } from 'linkedom';
import { htmlToText } from './html-text';
import { decodeEntities, tidyText } from './web-text';

/** 웹 검색 결과 한 줄 */
export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

/** 한 번 검색에 넘기는 결과 수 */
export const WEB_SEARCH_RESULT_LIMIT = 5;

/**
 * DuckDuckGo HTML 결과 페이지(html.duckduckgo.com/html/) 읽기. 공식 API가 아니라 화면용 HTML이라 모양이 바뀔 수 있다.
 * div.result마다 a.result__a(주소·제목)와 .result__snippet(요약)을 읽는다. 광고(result--ad, duckduckgo.com/y.js)는 뺀다.
 * 결과 주소가 //duckduckgo.com/l/?uddg=… 로 감싸여 있으면 uddg를 풀어 실제 주소를 쓴다.
 */
export function parseDuckDuckGoHtml(html: string, limit = WEB_SEARCH_RESULT_LIMIT): WebSearchResult[] {
  const { document } = parseHTML(html);
  const results: WebSearchResult[] = [];
  const seen = new Set<string>();
  for (const block of document.querySelectorAll('div.result')) {
    if (results.length >= limit) break;
    if (block.classList.contains('result--ad')) continue;
    const anchor = block.querySelector('a.result__a');
    const href = anchor?.getAttribute('href');
    if (!anchor || !href) continue;
    const url = resolveDuckDuckGoHref(href);
    if (!url || seen.has(url)) continue;
    const title = tidyText(anchor.textContent ?? '');
    if (!title) continue;
    seen.add(url);
    results.push({ title, url, snippet: tidyText(block.querySelector('.result__snippet')?.textContent ?? '') });
  }
  return results;
}

/** 결과 링크 → 실제 주소. 광고·DuckDuckGo 안 주소·http(s)가 아닌 주소는 null */
export function resolveDuckDuckGoHref(href: string): string | null {
  let url: URL;
  try {
    url = new URL(href.startsWith('//') ? `https:${href}` : href, 'https://duckduckgo.com');
  } catch {
    return null;
  }
  if (isDuckDuckGoHost(url.hostname)) {
    if (url.pathname === '/y.js') return null;
    const target = url.searchParams.get('uddg');
    if (!target) return null;
    return resolveDuckDuckGoHref(target);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  return url.toString();
}

const isDuckDuckGoHost = (host: string) => host === 'duckduckgo.com' || host.endsWith('.duckduckgo.com');

/**
 * DuckDuckGo가 봇으로 보고 막았는지: 202(확인 화면), 403·429, 또는 결과 없이 anomaly(사람 확인) 화면.
 * 결과 요약에 'anomaly'라는 낱말이 있을 수 있어 결과 링크가 있는 페이지는 막힘으로 보지 않는다.
 */
export function isDuckDuckGoBlocked(status: number, body: string): boolean {
  if (status === 202 || status === 403 || status === 429) return true;
  return /anomaly/i.test(body) && !body.includes('result__a');
}

interface WikipediaSearchJson {
  query?: { search?: { title?: unknown; snippet?: unknown }[] };
}

/** 위키백과 검색 API(action=query&list=search) 응답 → 결과. 요약의 <span class="searchmatch"> 같은 태그를 지운다 */
export function parseWikipediaSearch(json: unknown, lang: 'ko' | 'en', limit = WEB_SEARCH_RESULT_LIMIT): WebSearchResult[] {
  const rows = (json as WikipediaSearchJson | null)?.query?.search;
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((row): row is { title: string; snippet?: unknown } => typeof row?.title === 'string' && row.title.trim() !== '')
    .slice(0, limit)
    .map((row) => ({
      title: decodeEntities(row.title),
      url: wikipediaArticleUrl(lang, row.title),
      snippet: typeof row.snippet === 'string' ? htmlToText(row.snippet) : '',
    }));
}

/** 위키백과 검색에서 뜻 없는 낱말 (짧은 영어 검색어가 이것 때문에 0건이 되는 일을 줄인다) */
const WIKI_STOPWORDS = new Set(['vs', 'and', 'or', 'the', 'a', 'an', 'of', 'for', 'in', 'on', 'to', 'with', 'by', 'per', 'plan', 'recent', 'news', 'comparison', 'challenges', '계획', '비교', '최근']);
const WIKI_RETRY_TERMS = 3;
const splitTerms = (query: string): string[] => query.split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** 뜻 있는 낱말만 앞에서 3개. 위키백과가 0건일 때 한 번 더 찾는 짧은 검색어. 줄일 것이 없으면(낱말 3개 이하·같은 결과) null */
export function shortenWikipediaQuery(query: string): string | null {
  if (query.trim().split(/\s+/).length <= WIKI_RETRY_TERMS) return null;
  const kept = splitTerms(query).filter((t) => !WIKI_STOPWORDS.has(t.toLowerCase()));
  const shortened = kept.slice(0, WIKI_RETRY_TERMS).join(' ');
  return shortened && shortened !== query.trim() ? shortened : null;
}

/**
 * 위키백과 결과가 검색어와 정말 닿는지 (제목·요약에 검색어의 뜻 있는 낱말이 하나라도). 약어(EAF 같은 대문자 4자 이하)와 짧은 낱말은 우연히 맞기 쉬워 뺀다
 * (한글은 2자부터 셈, 영어판에서는 한글 낱말을 세지 않는다). 셀 낱말이 하나도 없으면 거르지 않는다.
 */
export function filterRelevantWikipedia(results: WebSearchResult[], query: string, lang: 'ko' | 'en' = 'ko'): WebSearchResult[] {
  const terms = splitTerms(query)
    .filter((t) => lang === 'ko' || !/\p{Script=Hangul}/u.test(t))
    .filter((t) => !WIKI_STOPWORDS.has(t.toLowerCase()))
    .filter((t) => (/\p{Script=Hangul}/u.test(t) ? t.length >= 2 : t.length >= 3) && !/^\p{Lu}{1,4}$/u.test(t))
    .map((t) => t.toLowerCase());
  if (!terms.length) return results;
  return results.filter((r) => {
    const text = `${r.title} ${r.snippet ?? ''}`.toLowerCase();
    return terms.some((t) => text.includes(t));
  });
}

export function wikipediaArticleUrl(lang: 'ko' | 'en', title: string): string {
  const path = encodeURIComponent(title.replace(/ /g, '_')).replace(/%2F/g, '/').replace(/%3A/g, ':');
  return `https://${lang}.wikipedia.org/wiki/${path}`;
}

export function wikipediaSearchUrl(lang: 'ko' | 'en', query: string, limit = WEB_SEARCH_RESULT_LIMIT): string {
  const params = new URLSearchParams({ action: 'query', list: 'search', srsearch: query, srlimit: String(limit), format: 'json', utf8: '1' });
  return `https://${lang}.wikipedia.org/w/api.php?${params.toString()}`;
}

/** 장소 검색 종류 → 카카오 카테고리 그룹 코드 (FD6 음식점, CE7 카페) */
export const PLACE_CATEGORIES = ['restaurant', 'cafe', 'any'] as const;
export type PlaceCategory = (typeof PLACE_CATEGORIES)[number];
export const KAKAO_CATEGORY_CODE: Record<PlaceCategory, string | null> = { restaurant: 'FD6', cafe: 'CE7', any: null };

/** 장소 검색 결과 한 곳 (카카오·네이버 공통) */
export interface Place {
  name: string;
  category: string;
  address: string;
  phone: string | null;
  url: string;
  /** 기준 좌표를 줬을 때만 (미터) */
  distanceM: number | null;
}

interface KakaoDocument {
  place_name?: unknown;
  category_name?: unknown;
  road_address_name?: unknown;
  address_name?: unknown;
  phone?: unknown;
  place_url?: unknown;
  distance?: unknown;
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/** 카카오 로컬 키워드 검색 응답(documents[]) → 장소. 도로명 주소가 없으면 지번 주소, 주소(place_url)가 없는 줄은 뺀다 */
export function mapKakaoPlaces(json: unknown, limit = 10): Place[] {
  const documents = (json as { documents?: KakaoDocument[] } | null)?.documents;
  if (!Array.isArray(documents)) return [];
  return documents
    .map((doc) => {
      const distance = Number(text(doc.distance));
      return {
        name: text(doc.place_name),
        category: text(doc.category_name),
        address: text(doc.road_address_name) || text(doc.address_name),
        phone: text(doc.phone) || null,
        url: text(doc.place_url),
        distanceM: text(doc.distance) !== '' && Number.isFinite(distance) ? distance : null,
      };
    })
    .filter((place) => place.name && /^https?:\/\//.test(place.url))
    .slice(0, limit);
}

export function kakaoKeywordUrl(query: string, category: PlaceCategory, size = 10): string {
  const params = new URLSearchParams({ query, size: String(Math.min(Math.max(size, 1), 15)) });
  const code = KAKAO_CATEGORY_CODE[category];
  if (code) params.set('category_group_code', code);
  return `https://dapi.kakao.com/v2/local/search/keyword.json?${params.toString()}`;
}

/**
 * 네이버 검색 API (공식, developers.naver.com/docs/serviceapi/search/web/web.md).
 * webkr.json 응답 items[]의 title·link·description. 제목·요약에서 검색어는 <b>로 감싸 오므로 태그를 지운다.
 */
export function naverWebSearchUrl(query: string, display = WEB_SEARCH_RESULT_LIMIT): string {
  return `https://openapi.naver.com/v1/search/webkr.json?${new URLSearchParams({ query, display: String(display) }).toString()}`;
}

interface NaverItem {
  title?: unknown;
  link?: unknown;
  description?: unknown;
  category?: unknown;
  telephone?: unknown;
  address?: unknown;
  roadAddress?: unknown;
}

const naverItems = (json: unknown): NaverItem[] => {
  const items = (json as { items?: unknown } | null)?.items;
  return Array.isArray(items) ? (items as NaverItem[]) : [];
};

/** 태그(<b>)·엔티티를 지운 한 줄 */
const naverText = (value: unknown): string => (typeof value === 'string' ? htmlToText(value).replace(/\s+/g, ' ').trim() : '');

export function parseNaverWebSearch(json: unknown, limit = WEB_SEARCH_RESULT_LIMIT): WebSearchResult[] {
  const results: WebSearchResult[] = [];
  for (const item of naverItems(json)) {
    if (results.length >= limit) break;
    const title = naverText(item.title);
    const link = typeof item.link === 'string' ? item.link.trim() : '';
    if (!title || !/^https?:\/\//i.test(link) || results.some((r) => r.url === link)) continue;
    results.push({ title, url: link, snippet: naverText(item.description) });
  }
  return results;
}

/**
 * 카카오 다음 웹 검색 (공식, developers.kakao.com/docs/latest/ko/daum-search/dev-guide).
 * GET /v2/search/web 응답 documents[]의 title·contents·url. 제목·요약에는 검색어 <b> 태그와 엔티티가 섞여 온다.
 */
export function kakaoWebSearchUrl(query: string, size = WEB_SEARCH_RESULT_LIMIT): string {
  return `https://dapi.kakao.com/v2/search/web?${new URLSearchParams({ query, sort: 'accuracy', size: String(size) }).toString()}`;
}

export function parseKakaoWebSearch(json: unknown, limit = WEB_SEARCH_RESULT_LIMIT): WebSearchResult[] {
  const documents = (json as { documents?: unknown } | null)?.documents;
  const results: WebSearchResult[] = [];
  if (!Array.isArray(documents)) return results;
  for (const item of documents as { title?: unknown; contents?: unknown; url?: unknown }[]) {
    if (results.length >= limit) break;
    const title = naverText(item.title);
    const link = typeof item.url === 'string' ? item.url.trim() : '';
    if (!title || !/^https?:\/\//i.test(link) || results.some((r) => r.url === link)) continue;
    results.push({ title, url: link, snippet: naverText(item.contents) });
  }
  return results;
}

/** 네이버 지역 검색은 한 번에 5곳까지 (display 최댓값 5, local.md) */
export const NAVER_LOCAL_DISPLAY_MAX = 5;

export function naverLocalSearchUrl(query: string): string {
  return `https://openapi.naver.com/v1/search/local.json?${new URLSearchParams({ query, display: String(NAVER_LOCAL_DISPLAY_MAX) }).toString()}`;
}

/**
 * 네이버 지역 검색(local.json) → 장소. link(상세 주소)는 비어 올 때가 많아 그때는 이름·주소로 네이버 지도 검색 주소를 만든다.
 * telephone은 문서상 '값을 반환하지 않는 요소'라 대개 비어 있다.
 */
export function mapNaverPlaces(json: unknown, limit = NAVER_LOCAL_DISPLAY_MAX): Place[] {
  return naverItems(json)
    .map((item) => {
      const name = naverText(item.title);
      const address = naverText(item.roadAddress) || naverText(item.address);
      const link = typeof item.link === 'string' ? item.link.trim() : '';
      return {
        name,
        category: naverText(item.category),
        address,
        phone: naverText(item.telephone) || null,
        url: /^https?:\/\//i.test(link) ? link : `https://map.naver.com/p/search/${encodeURIComponent([name, address].filter(Boolean).join(' '))}`,
        distanceM: null,
      };
    })
    .filter((place) => place.name)
    .slice(0, limit);
}
