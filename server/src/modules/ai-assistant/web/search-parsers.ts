import { parseHTML } from 'linkedom';
import { decodeEntities, htmlToText, tidyText } from './web-text';

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

export interface KakaoPlace {
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
export function mapKakaoPlaces(json: unknown, limit = 10): KakaoPlace[] {
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
