// 웹 검색 켜기 저장, 엔진 안내 글, 도구 줄 요약.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AI_WEB_SEARCH_KEY, AI_WEB_SEARCH_NO_ENGINE_HINT, parseAiWebSearchPreference, readAiWebSearchPreference, webSearchEngineHint, webToolDoneText, webToolRunningText, writeAiWebSearchPreference } from '@/lib/aiWebSearch';

afterEach(() => vi.unstubAllGlobals());

describe('웹 검색 켜기 저장', () => {
  it('저장된 값이 없거나 깨졌으면 꺼짐이다', () => {
    expect(parseAiWebSearchPreference(null)).toBe(false);
    expect(parseAiWebSearchPreference('yes')).toBe(false);
    expect(parseAiWebSearchPreference('true')).toBe(true);
  });

  it('localStorage를 못 쓰는 환경에서도 오류 없이 꺼짐으로 동작한다', () => {
    vi.stubGlobal('window', {
      get localStorage(): never {
        throw new Error('blocked');
      },
    });
    expect(readAiWebSearchPreference()).toBe(false);
    expect(() => writeAiWebSearchPreference(true)).not.toThrow();
  });

  it('쓴 값을 다시 읽는다', () => {
    const data = new Map<string, string>();
    vi.stubGlobal('window', { localStorage: { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) } });
    writeAiWebSearchPreference(true);
    expect(data.get(AI_WEB_SEARCH_KEY)).toBe('true');
    expect(readAiWebSearchPreference()).toBe(true);
    writeAiWebSearchPreference(false);
    expect(readAiWebSearchPreference()).toBe(false);
  });
});

describe('webSearchEngineHint', () => {
  it('엔진 목록을 모르면 빈 글', () => {
    expect(webSearchEngineHint(undefined)).toBe('');
  });

  it('네이버가 있으면 엔진을 이어 보이고, 없으면 키가 없다고 알린다', () => {
    expect(webSearchEngineHint({ engines: ['naver', 'wikipedia'], placeSearch: false })).toBe('네이버·위키백과');
    expect(webSearchEngineHint({ engines: ['wikipedia'], placeSearch: false })).toBe('위키백과만 (네이버 키 없음)');
    expect(webSearchEngineHint({ engines: ['duckduckgo', 'wikipedia'], placeSearch: false })).toBe('DuckDuckGo·위키백과 (네이버 키 없음)');
  });

  it('장소 검색이 되면 덧붙이고, 엔진이 없으면 없다고 알린다', () => {
    expect(webSearchEngineHint({ engines: ['kakao', 'duckduckgo', 'wikipedia'], placeSearch: false })).toBe('다음(카카오)·DuckDuckGo·위키백과 (네이버 키 없음)');
    expect(webSearchEngineHint({ engines: ['naver', 'wikipedia'], placeSearch: true })).toBe('네이버·위키백과 · 장소 검색 가능');
    expect(webSearchEngineHint({ engines: [], placeSearch: true })).toBe(AI_WEB_SEARCH_NO_ENGINE_HINT);
  });
});

describe('웹 도구 줄 요약', () => {
  it('진행 중 문구는 웹 도구에만 있다', () => {
    expect(webToolRunningText('web_search')).toBe(' … 검색 중');
    expect(webToolRunningText('search_places')).toBe(' … 검색 중');
    expect(webToolRunningText('read_web_page')).toBe(' … 읽는 중');
    expect(webToolRunningText('get_inventory')).toBeNull();
  });

  it('검색은 결과 수, 페이지 읽기는 호스트(제목은 쓰지 않는다)', () => {
    const sources = [
      { title: '<b>제목</b>', url: 'https://www.a.com/x' },
      { title: '둘', url: 'https://b.com' },
    ];
    expect(webToolDoneText('web_search', sources)).toBe('결과 2건');
    expect(webToolDoneText('web_search', [])).toBe('결과 없음');
    expect(webToolDoneText('read_web_page', sources.slice(0, 1))).toBe('a.com');
    expect(webToolDoneText('read_web_page', [])).toBe('읽지 못함');
    expect(webToolDoneText('read_web_page', [{ title: 'x', url: 'javascript:1' }])).toBe('읽지 못함');
    expect(webToolDoneText('get_inventory', sources)).toBeNull();
  });
});
