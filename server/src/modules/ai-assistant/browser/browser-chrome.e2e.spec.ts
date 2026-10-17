// 철강맨AI 브라우저 사용 (이슈 #373): 설치된 Chrome으로 끝에서 끝까지. BROWSER_E2E=1일 때만 돈다(평소 test:unit에서는 건너뜀).
//   BROWSER_E2E=1 npx jest src/modules/ai-assistant/browser/browser-chrome   (server 폴더에서)
// 네트워크는 쓰지 않는다: https://example.test/ 는 context.route로 fixture를 돌려주고, 이름 풀기도 가짜 주소로 한다.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BrowserContext } from 'playwright-core';
import type { LookupFunction } from '../web/ssrf-guard';
import { internalReferenceIn } from '../web/web-text';
import { AssistantBrowserToolbox, type BrowserToolResult, type BrowserWebLink } from './assistant-browser-toolbox';
import { BrowserPool } from './browser-pool';

const e2e = process.env.BROWSER_E2E === '1' ? describe : describe.skip;
const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', name), 'utf8');

/** 막은 요청을 세려고 fixture 서버가 받은 요청을 적는다 */
const served: string[] = [];
async function serveFixtures(context: BrowserContext) {
  await context.route(
    (url) => url.hostname === 'example.test',
    async (route) => {
      const url = new URL(route.request().url());
      served.push(`${route.request().method()} ${url.pathname}`);
      const html = (body: string) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body });
      if (url.pathname === '/') return html(fixture('home.html'));
      if (url.pathname === '/page/2') return html(fixture('page2.html'));
      if (url.pathname === '/search') return html(`<!doctype html><title>검색</title><h1>검색 결과: ${url.searchParams.get('q')?.replace(/[<&]/g, '') ?? ''}</h1>`);
      return html(`<!doctype html><title>${url.pathname}</title><p>도착: ${url.pathname}</p>`);
    },
  );
}
/** example.test만 공용 주소로 푼다 (네트워크 없음) */
const resolve: LookupFunction = (hostname, _options, callback) => {
  if (hostname === 'example.test') return callback(null, [{ address: '93.184.215.14', family: 4 }]);
  callback(Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }), []);
};
const web = (): BrowserWebLink & { visited: string[] } => {
  const visited: string[] = [];
  return { visited, knows: () => false, rememberVisited: (url) => void visited.push(url), internalReference: (text) => internalReferenceIn(text, ['대한강재']) };
};
const call = (name: string, args: unknown = {}) => ({ id: 'c1', name, arguments: JSON.stringify(args) });
const refOf = (result: BrowserToolResult, line: string): string => {
  const found = new RegExp(`\\[(r\\d+)\\] ${line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).exec(result.content);
  if (!found) throw new Error(`${line} 없음:\n${result.content}`);
  return found[1];
};
const errorOf = (result: BrowserToolResult): string => (JSON.parse(result.content) as { 오류: string }).오류;
/** JPEG SOF에서 너비 */
function jpegWidth(base64: string): number {
  const bytes = Buffer.from(base64, 'base64');
  for (let i = 2; i < bytes.length - 9; ) {
    if (bytes[i] !== 0xff) return -1;
    const marker = bytes[i + 1];
    const length = bytes.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xc3) return bytes.readUInt16BE(i + 7);
    i += 2 + length;
  }
  return -1;
}

e2e('브라우저 사용 — 설치된 Chrome (BROWSER_E2E=1)', () => {
  jest.setTimeout(90_000);
  const pool = new BrowserPool({ env: { ...process.env, AI_BROWSER_ENABLED: 'true' } });
  const toolbox = (timeLimitMs?: number) => new AssistantBrowserToolbox(pool, { guard: { resolve }, prepareContext: serveFixtures, timeLimitMs });

  afterAll(() => pool.shutdown());

  it('열기·화면 읽기, 막을 것(로그인·파일·비밀번호·POST 폼·회사 안 정보·사내망 요청·새 창)은 막는다', async () => {
    const link = web();
    const session = toolbox().session({ question: 'https://example.test/ 에서 시세 봐줘', web: link });
    try {
      const opened = await session.run(call('browser_open', { url: 'https://example.test/' }));
      expect(opened.content).toContain('[브라우저 화면] example.test');
      expect(opened.content).toContain('heading "오늘의 강판 시세"');
      expect(opened.content).toContain('text "SS275 열연강판 시세를 알려 드려요."');
      expect(opened.content).toMatch(/\[r\d+\] searchbox "검색어"/);
      expect(opened.content).toMatch(/\[r\d+\] link "다음" → \/page\/2/);
      expect(opened.content).toMatch(/\[r\d+\] password "비밀번호" \(비어 있음\)/);
      expect(opened.content).not.toContain('숨은 글');
      // 사내망 그림 요청은 막았다
      expect(opened.content).toContain('요청 1개를 막았어요: 사내망·내부 주소는 읽을 수 없어요');
      expect(served).not.toContain('GET /track.png');
      expect(opened.frame?.url).toBe('example.test');
      expect(opened.frame?.title).toBe('강판 시세 안내');
      expect(opened.frame?.imageBase64.startsWith('/9j/')).toBe(true);
      expect(jpegWidth(opened.frame?.imageBase64 ?? '')).toBe(800);
      expect(opened.webSources).toEqual([{ title: '강판 시세 안내', url: 'https://example.test/' }]);
      expect(link.visited).toEqual(['https://example.test/']);

      // 로그인 버튼·파일 칸·비밀번호 칸·POST 폼은 막는다
      expect(errorOf(await session.run(call('browser_click', { ref: refOf(opened, 'button "로그인"') })))).toContain('막았어요');
      expect(errorOf(await session.run(call('browser_click', { ref: refOf(opened, 'file "첨부"') })))).toContain('파일 올리기');
      expect(errorOf(await session.run(call('browser_type', { ref: refOf(opened, 'password "비밀번호"'), text: 'secret' })))).toContain('비밀번호');
      expect(errorOf(await session.run(call('browser_type', { ref: refOf(opened, 'textbox "메모"'), text: '안녕', submit: true })))).toContain('POST');
      expect(errorOf(await session.run(call('browser_click', { ref: refOf(opened, 'button "보내기"') })))).toContain('POST');
      // 회사 안 정보·개인정보는 입력하지 않는다
      expect(errorOf(await session.run(call('browser_type', { ref: refOf(opened, 'searchbox "검색어"'), text: '대한강재 납품' })))).toContain('거래처 이름');
      expect(errorOf(await session.run(call('browser_type', { ref: refOf(opened, 'searchbox "검색어"'), text: 'a@b.co' })))).toContain('이메일');
      // 스크립트가 POST 폼을 보내도 요청 확인이 막는다
      const sneaky = await session.run(call('browser_click', { ref: refOf(opened, 'button "다음 단계"') }));
      expect(sneaky.content).toContain('정보를 보내는 폼(POST)은 제출하지 않아요');
      expect(served.some((s) => s.startsWith('POST'))).toBe(false);
      expect(served.filter((s) => s === 'GET /login')).toEqual([]);
      // 막은 이동은 오류 페이지가 되므로 뒤로 가서 되돌렸고, 다시 불러 번호가 바뀌었다
      expect(sneaky.content).toContain('이전 페이지로 돌아왔어요');
      expect(sneaky.frame?.url).toBe('example.test');
      expect(errorOf(await session.run(call('browser_click', { ref: refOf(opened, 'link "다음"') })))).toContain('이전 페이지');

      // 새 창은 닫는다
      const popup = await session.run(call('browser_click', { ref: refOf(sneaky, 'link "새 창으로"') }));
      expect(popup.frame?.url).toBe('example.test');
    } finally {
      await session.close();
    }
    expect(pool.activeContexts).toBe(0);
  });

  it('검색칸 입력 + Enter(GET)·뒤로·링크 누르기·스크롤 (한 답 동작 수는 새로 센다)', async () => {
    const session = toolbox().session({ question: 'https://example.test/ 에서 강판 찾아줘', web: web() });
    try {
      const home = await session.run(call('browser_open', { url: 'https://example.test/' }));
      // GET 검색칸 입력 + Enter → 이동, 이전 번호는 쓸 수 없다
      const searchRef = refOf(home, 'searchbox "검색어"');
      const searched = await session.run(call('browser_type', { ref: searchRef, text: '강판', submit: true }));
      expect(searched.content).toContain('heading "검색 결과: 강판"');
      expect(searched.frame?.url).toBe('example.test/search');
      expect(errorOf(await session.run(call('browser_click', { ref: searchRef })))).toContain('이전 페이지');

      const back = await session.run(call('browser_back'));
      expect(back.content).toContain('오늘의 강판 시세');
      const next = await session.run(call('browser_click', { ref: refOf(back, 'link "다음"') }));
      expect(next.content).toContain('heading "두 번째 쪽이에요"');
      await session.run(call('browser_back'));
      const scrolled = await session.run(call('browser_scroll', { direction: 'down' }));
      expect(scrolled.content).toMatch(/스크롤: 위에서 \d+%/);
      expect(scrolled.content).not.toContain('위에서 0%');
      const full = await session.run(call('browser_snapshot'));
      expect(full.frame).toBeNull();
    } finally {
      await session.close();
    }
    expect(pool.activeContexts).toBe(0);
  });

  it('한 답 시간 상한이 지나면 컨텍스트를 닫고, 멈추면 바로 닫는다', async () => {
    const timed = toolbox(1_000).session({ question: 'https://example.test/', web: web() });
    await timed.run(call('browser_open', { url: 'https://example.test/' }));
    await new Promise((resolve) => setTimeout(resolve, 1_300));
    expect(pool.activeContexts).toBe(0);
    expect(errorOf(await timed.run(call('browser_snapshot')))).toContain('분까지만');

    const abort = new AbortController();
    const stopped = toolbox().session({ question: 'https://example.test/', web: web(), signal: abort.signal });
    await stopped.run(call('browser_open', { url: 'https://example.test/' }));
    expect(pool.activeContexts).toBe(1);
    abort.abort();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(pool.activeContexts).toBe(0);
  });
});
