// 철강맨AI 웹 검색 (이슈 #367, 문서에 없는 기능)의 화면 도우미: 켜기 설정 저장, 엔진 안내 글, 도구 줄 요약.
// 켜기는 사원별이 아니라 이 브라우저에 저장한다 (계정에 저장할 컬럼이 ERD에 없다).
import { AI_WEB_SEARCH_ENGINES, type AiWebSearchCapabilities, type AiWebSearchEngine, type AiWebSource } from '@fantasteel/shared';
import { webHostOf } from '@/lib/aiWebLinks';

export const AI_WEB_SEARCH_KEY = 'fantasteel.ai-web-search';

/** 켜기 단추 설명. 질문 글이 검색 엔진으로 나간다는 점을 늘 알린다 */
export const AI_WEB_SEARCH_TITLE = '켜면 이번 질문에 인터넷을 검색해요. 질문 글이 검색 엔진으로 나가요.';
export const AI_WEB_SEARCH_NO_ENGINE_HINT = '쓸 수 있는 검색 엔진이 없어요';
export const AI_WEB_SEARCH_UNAVAILABLE_HINT = 'AI 연결을 확인하지 못해 지금은 켤 수 없어요';

const ENGINE_LABEL: Record<AiWebSearchEngine, string> = { naver: '네이버', duckduckgo: 'DuckDuckGo', wikipedia: '위키백과' };

/** 저장된 글에서 켜기 설정을 읽는다. 깨졌거나 없으면 꺼짐 */
export function parseAiWebSearchPreference(raw: string | null): boolean {
  return raw === 'true';
}

export function readAiWebSearchPreference(): boolean {
  try {
    return parseAiWebSearchPreference(window.localStorage.getItem(AI_WEB_SEARCH_KEY));
  } catch {
    return false;
  }
}

export function writeAiWebSearchPreference(on: boolean): void {
  try {
    window.localStorage.setItem(AI_WEB_SEARCH_KEY, String(on));
  } catch {
    // localStorage를 쓸 수 없는 환경이면 이 화면을 열어 둔 동안만 유지한다
  }
}

/**
 * 쓸 수 있는 검색 엔진 안내: "네이버·위키백과" / "위키백과만 (네이버 키 없음)". 장소 검색이 되면 덧붙인다.
 * 엔진 목록을 모르면(아직 못 읽음) 빈 글
 */
export function webSearchEngineHint(capabilities: AiWebSearchCapabilities | undefined): string {
  if (!capabilities) return '';
  const engines = AI_WEB_SEARCH_ENGINES.filter((engine) => capabilities.engines.includes(engine));
  if (!engines.length) return AI_WEB_SEARCH_NO_ENGINE_HINT;
  const labels = engines.map((engine) => ENGINE_LABEL[engine]);
  const names = engines.length === 1 ? `${labels[0]}만` : labels.join('·');
  const naverNote = engines.includes('naver') ? '' : ' (네이버 키 없음)';
  return `${names}${naverNote}${capabilities.placeSearch ? ' · 장소 검색 가능' : ''}`;
}

/** 웹 도구가 진행 중일 때 줄에 붙는 말 */
export function webToolRunningText(name: string): string | null {
  if (name === 'web_search' || name === 'search_places') return ' … 검색 중';
  if (name === 'read_web_page') return ' … 읽는 중';
  return null;
}

/**
 * 끝난 웹 도구 줄에 붙는 요약: 검색·장소 검색은 "결과 N건", 페이지 읽기는 읽은 페이지의 호스트.
 * 웹 도구가 아니면 null (조회 도구는 기존 문구). 제목은 쓰지 않는다 (웹에서 온 글)
 */
export function webToolDoneText(name: string, webSources: readonly AiWebSource[] | undefined): string | null {
  if (name === 'web_search' || name === 'search_places') {
    const count = webSources?.length ?? 0;
    return count > 0 ? `결과 ${count}건` : '결과 없음';
  }
  if (name === 'read_web_page') {
    const host = webSources?.[0] ? webHostOf(webSources[0].url) : null;
    return host ?? '읽지 못함';
  }
  return null;
}
