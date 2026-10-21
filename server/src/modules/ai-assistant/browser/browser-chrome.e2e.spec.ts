// 철강맨AI 브라우저 사용 (이슈 #373): 설치된 Chrome으로 끝에서 끝까지. BROWSER_E2E=1일 때만 돈다(평소 test:unit에서는 건너뜀).
//   BROWSER_E2E=1 npx jest src/modules/ai-assistant/browser/browser-chrome   (server 폴더에서)
// 네트워크는 쓰지 않는다: https://example.test/ 는 context.route로 fixture를 돌려주고, 이름 풀기도 가짜 주소로 한다.
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import type { BrowserContext } from 'playwright-core';
import { extractPdfIsolated } from '../web/page-extract';
import type { LookupFunction } from '../web/ssrf-guard';
import { tinyPdf } from '../web/fixtures/tiny-pdf';
import { internalReferenceIn } from '../web/web-text';
import { AssistantBrowserToolbox, type BrowserLiveFrame, type BrowserToolResult, type BrowserWebLink } from './assistant-browser-toolbox';
import { BrowserPool } from './browser-pool';

const e2e = process.env.BROWSER_E2E === '1' ? describe : describe.skip;
const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', name), 'utf8');

/** 막은 요청을 세려고 fixture 서버가 받은 요청을 적는다 */
const served: string[] = [];
/** 리다이렉트로 노리는 사내 서버 대신 (127.0.0.1). 요청이 오면 안 된다 */
const internalHits: string[] = [];
let internalPort = 0;
async function serveFixtures(context: BrowserContext) {
  await context.route(
    (url) => url.hostname === 'example.test',
    async (route) => {
      const url = new URL(route.request().url());
      served.push(`${route.request().method()} ${url.pathname}`);
      const html = (body: string) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body });
      if (url.pathname === '/') return html(fixture('home.html'));
      if (url.pathname === '/page/2') return html(fixture('page2.html'));
      // 리다이렉트는 route가 첫 주소만 보므로 다음 주소는 브라우저 프록시가 막아야 한다 (보안 검토)
      if (url.pathname === '/redirect') return route.fulfill({ status: 302, headers: { location: `http://127.0.0.1:${internalPort}/meta` } });
      if (url.pathname === '/redirect-metadata') return route.fulfill({ status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } });
      if (url.pathname === '/redirect-name') return route.fulfill({ status: 302, headers: { location: 'http://internal.test/meta' } });
      if (url.pathname === '/redirect-https') return route.fulfill({ status: 302, headers: { location: 'https://internal.test/meta' } });
      if (url.pathname === '/rtc') return html(`<!doctype html><title>rtc</title><p id="o">x</p><script>document.getElementById('o').textContent = 'RTC:' + typeof RTCPeerConnection + ' WT:' + typeof WebTransport</script>`);
      // 페이지가 DOM 함수를 바꿔 로그인 버튼을 "다음"으로 속이려 한다
      if (url.pathname === '/tamper')
        return html(
          `<!doctype html><title>tamper</title><button>로그인</button><script>for (const [proto, key] of [[HTMLElement.prototype, 'innerText'], [Node.prototype, 'textContent']]) Object.defineProperty(proto, key, { get() { return '다음'; } }); Element.prototype.getAttribute = () => null;</script>`,
        );
      // 누르면 글만 바뀌고 이동하지 않는 버튼: 보이는 마우스가 그 자리에 남아 있어야 한다 (이슈 #425)
      if (url.pathname === '/cursor') return html(`<!doctype html><title>cursor</title><button id="b" onclick="this.textContent = '눌렀어요'">누르기</button>`);
      // PDF·문서 링크가 있는 페이지 (이슈 #427). 노란 표가 잘 보이게 글자만 둔다
      if (url.pathname === '/docs')
        return html(
          `<!doctype html><title>자료실</title><h1>자료실</h1><p><a href="/files/report.pdf">2026 철강 보고서 (PDF)</a></p><p><a href="mailto:help@example.test">문의 메일</a></p><p><button>목록</button></p>`,
        );
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
/** 문서 읽기는 웹 세션이 한다(네트워크 fetch). 시험은 기억한 주소만 시험용 PDF로 읽는다 (이슈 #427) */
const web = (): BrowserWebLink & { visited: string[]; reads: string[] } => {
  const visited: string[] = [];
  const reads: string[] = [];
  return {
    visited,
    reads,
    knows: () => false,
    rememberVisited: (url) => void visited.push(url),
    internalReference: (text) => internalReferenceIn(text, ['대한강재']),
    readKnownPage: async (url) => {
      reads.push(url);
      if (!visited.includes(url)) return { ok: false, reason: '기억하지 않은 주소', hint: '', url: null };
      const page = await extractPdfIsolated(await tinyPdf(['Steel report page one', 'Tensile 410 MPa'], 'Steel Report 2026'), url);
      return { ok: true, url, title: page.title, text: page.text, truncated: false };
    },
  };
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
  /** 브라우저 프록시가 막은 주소 */
  const proxyBlocked: string[] = [];
  // 프록시의 이름 풀기도 가짜: internal.test → 127.0.0.1 (사내 주소처럼)
  const proxyLookup: LookupFunction = (hostname, _options, callback) =>
    hostname === 'internal.test' ? callback(null, [{ address: '127.0.0.1', family: 4 }]) : callback(Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }), []);
  const pool = new BrowserPool({ env: { ...process.env, AI_BROWSER_ENABLED: 'true' }, proxy: { lookup: proxyLookup, onBlocked: (target) => void proxyBlocked.push(target) } });
  let internal: Server;

  beforeAll(async () => {
    internal = createServer((req, res) => {
      internalHits.push(req.url ?? '');
      res.end('<title>INTERNAL</title>internal secret');
    });
    await new Promise<void>((resolve) => internal.listen(0, '127.0.0.1', () => resolve()));
    internalPort = (internal.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((resolve) => internal.close(() => resolve())));
  /** 세션이 연 컨텍스트들 (밖에서 페이지 DOM을 보거나 탭을 닫으려고 모은다) */
  const contexts: BrowserContext[] = [];
  const toolbox = (timeLimitMs?: number, maxActions?: number) =>
    new AssistantBrowserToolbox(pool, {
      guard: { resolve },
      prepareContext: async (context) => {
        contexts.push(context);
        await serveFixtures(context);
      },
      timeLimitMs,
      maxActions,
    });
  const until = async (done: () => boolean, ms = 6_000) => {
    for (const start = Date.now(); !done() && Date.now() - start < ms; ) await new Promise((r) => setTimeout(r, 100));
  };

  afterAll(() => pool.shutdown());

  it('화면 읽기와 실패한 동작은 동작 수에 세지 않고, 상한을 넘는 동작은 막는다 (이슈 #430)', async () => {
    const session = toolbox(undefined, 2).session({ question: 'https://example.test/ 봐줘', web: web() });
    try {
      expect((await session.run(call('browser_open', { url: 'https://example.test/' }))).content).toContain('(브라우저 동작 1번 남음)');
      expect((await session.run(call('browser_snapshot'))).content).toContain('(브라우저 동작 1번 남음)');
      // 없는 번호를 눌러 실패해도 세지 않는다
      expect(JSON.parse((await session.run(call('browser_click', { ref: 'r99999' }))).content).오류).toContain('없는 번호');
      expect((await session.run(call('browser_snapshot'))).content).toContain('(브라우저 동작 1번 남음)');
      expect((await session.run(call('browser_scroll', { direction: 'down' }))).content).toContain('[브라우저 화면]');
      expect(JSON.parse((await session.run(call('browser_scroll', { direction: 'up' }))).content).오류).toContain('2번까지만');
    } finally {
      await session.close();
    }
  });

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

  it('리다이렉트로 사내 주소(IP·이름·https)에 가지 못하고, WebRTC·WebTransport는 없고, 바꾼 DOM 함수에 속지 않는다', async () => {
    const session = toolbox().session({ question: 'https://example.test/redirect https://example.test/redirect-metadata https://example.test/redirect-name https://example.test/redirect-https https://example.test/rtc https://example.test/tamper', web: web() });
    try {
      for (const path of ['/redirect', '/redirect-metadata', '/redirect-name', '/redirect-https']) {
        const result = await session.run(call('browser_open', { url: `https://example.test${path}` }));
        expect(result.frame).toBeNull();
        expect(errorOf(result)).toMatch(/^(막았어요|페이지를 열지)/);
      }
      expect(internalHits).toEqual([]);
      // route가 아니라 프록시가 막았다 (리다이렉트 다음 주소는 route를 지나지 않는다)
      expect(proxyBlocked).toEqual(expect.arrayContaining([`http://127.0.0.1:${internalPort}/meta`, 'http://169.254.169.254/latest/meta-data/', 'http://internal.test/meta', 'internal.test']));
      const rtc = await session.run(call('browser_open', { url: 'https://example.test/rtc' }));
      expect(rtc.content).toContain('RTC:undefined WT:undefined');
      // 화면 읽기·규칙은 격리된 실행 공간에서 돌아 페이지가 바꾼 DOM 함수에 속지 않는다
      const tamper = await session.run(call('browser_open', { url: 'https://example.test/tamper' }));
      expect(tamper.content).toMatch(/\[r\d+\] button "로그인"/);
      expect(errorOf(await session.run(call('browser_click', { ref: refOf(tamper, 'button "로그인"') })))).toContain('막았어요');
    } finally {
      await session.close();
    }
  });

  it('답이 끝나도 탭을 열어 두고 같은 열쇠의 다음 질문이 이어 쓴다. 멈추면 닫고, 자리가 모자라면 가장 오래 쉰 탭부터 닫는다 (이슈 #423)', async () => {
    const box = toolbox();
    const first = box.session({ question: 'https://example.test/ 에서 시세 봐줘', web: web() }, 'k1');
    const opened = await first.run(call('browser_open', { url: 'https://example.test/' }));
    expect(opened.content).toContain('heading "오늘의 강판 시세"');
    await box.finish(first, 'k1', false);
    expect(pool.activeContexts).toBe(1);
    expect(box.openPage('k1')).toEqual({ title: '강판 시세 안내', url: 'https://example.test/' });

    // 다음 질문: 같은 세션, browser_open 없이 지금 화면을 읽고 이어서 누른다. 새 질문의 횟수·시간은 새로 센다
    const link = web();
    const second = box.session({ question: '다음 쪽으로 가줘', web: link }, 'k1');
    expect(second).toBe(first);
    expect(link.visited).toEqual(['https://example.test/']);
    const snap = await second.run(call('browser_snapshot'));
    expect(snap.content).toContain('heading "오늘의 강판 시세"');
    const next = await second.run(call('browser_click', { ref: refOf(snap, 'link "다음"') }));
    expect(next.content).toContain('heading "두 번째 쪽이에요"');
    // 이전 답에서 본 주소는 질문에 없어도 다시 열 수 있고, 처음 보는 주소는 막는다
    const reopened = await second.run(call('browser_open', { url: 'https://example.test/' }));
    expect(reopened.content).toContain('heading "오늘의 강판 시세"');
    expect(errorOf(await second.run(call('browser_open', { url: 'https://example.test/never-seen' })))).toContain('시작 사이트에 없는 주소');
    await box.finish(second, 'k1', false);

    // 두 번째 대화 탭, 세 번째가 필요하면 가장 오래 쉰 k1이 닫힌다
    const other = box.session({ question: 'https://example.test/page/2 봐줘', web: web() }, 'k2');
    await other.run(call('browser_open', { url: 'https://example.test/page/2' }));
    await box.finish(other, 'k2', false);
    expect(pool.activeContexts).toBe(2);
    const third = box.session({ question: 'https://example.test/ 봐줘', web: web() }, 'k3');
    const thirdOpened = await third.run(call('browser_open', { url: 'https://example.test/' }));
    expect(thirdOpened.content).toContain('heading "오늘의 강판 시세"');
    expect(box.openPage('k1')).toBeNull();
    expect(box.openPage('k2')).not.toBeNull();
    expect(pool.activeContexts).toBe(2);

    // 멈춘 답은 열어 두지 않고 닫는다
    await box.finish(third, 'k3', true);
    expect(box.openPage('k3')).toBeNull();
    expect(pool.activeContexts).toBe(1);
    const parked = box.session({ question: '봐줘', web: web() }, 'k2');
    await box.finish(parked, 'k2', true);
    expect(pool.activeContexts).toBe(0);
  });

  it('누르기 전에 보이는 마우스를 그리고, 이동 없는 클릭 뒤에도 그 마우스가 화면 사진에 남는다 (이슈 #425)', async () => {
    const session = toolbox().session({ question: 'https://example.test/cursor 눌러줘', web: web() });
    try {
      const opened = await session.run(call('browser_open', { url: 'https://example.test/cursor' }));
      // 읽기·열기만으로는 마우스를 그리지 않는다
      const page = contexts.at(-1)?.pages()[0];
      if (!page) throw new Error('페이지 없음');
      const cursorCount = () => page.evaluate('document.querySelectorAll(\'[id$="-cursor"]\').length');
      expect(await cursorCount()).toBe(0);

      const clicked = await session.run(call('browser_click', { ref: refOf(opened, 'button "누르기"') }));
      expect(clicked.content).toContain('눌렀어요');
      expect(clicked.frame?.url).toBe('example.test/cursor');

      // 페이지 글 읽기(body 아래)에 끼지 않게 html 바로 아래, 열린 shadow root, 마우스 이벤트는 받지 않는다
      // 서버 tsconfig에는 DOM 형식이 없어 페이지에서 돌 글을 문자열로 보낸다
      const cursor = (await page.evaluate(`(() => {
        const host = document.documentElement.querySelector(':scope > [id$="-cursor"]');
        if (!host) return null;
        const path = host.shadowRoot && host.shadowRoot.querySelector('path');
        return { id: host.id, parent: host.parentElement.tagName, hasShadow: host.shadowRoot !== null, pointerEvents: host.style.pointerEvents, ariaHidden: host.getAttribute('aria-hidden'), fill: path ? path.getAttribute('fill') : null, inBody: document.body.contains(host) };
      })()`)) as { id: string; parent: string; hasShadow: boolean; pointerEvents: string; ariaHidden: string; fill: string | null; inBody: boolean } | null;
      expect(cursor).toMatchObject({ parent: 'HTML', hasShadow: true, pointerEvents: 'none', ariaHidden: 'true', fill: '#f97316', inBody: false });
      expect(cursor?.id).toMatch(/^data-fs-[0-9a-f]{8}-cursor$/);
      // 같은 요소를 다시 그리지 않고 쓴다
      await session.run(call('browser_snapshot'));
      expect(await cursorCount()).toBe(1);
      // 화면 읽기 글에는 마우스가 나오지 않는다
      expect((await session.run(call('browser_snapshot'))).content).not.toMatch(/-cursor|f97316/);

      // 화면 사진에 주황(#f97316) 마우스가 찍혔다: 브라우저 밖의 빈 탭에서 JPEG를 풀어 주황 픽셀을 센다.
      // 누르기 전 사진에는 없던 주황이 누른 뒤 사진에 생겼는지 견준다 (화살표가 작아 픽셀 수의 절대값은 타이밍에 따라 달라진다)
      const decoder = await (page.context().browser() as NonNullable<ReturnType<BrowserContext['browser']>>).newContext();
      try {
        const blank = await decoder.newPage();
        const orangeIn = async (base64: string) =>
          (await blank.evaluate(`(async () => {
            const image = new Image();
            image.src = 'data:image/jpeg;base64,${base64}';
            await image.decode();
            const canvas = document.createElement('canvas');
            canvas.width = image.width;
            canvas.height = image.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(image, 0, 0);
            const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
            let count = 0;
            for (let i = 0; i < data.length; i += 4) if (data[i] > 200 && data[i + 1] > 70 && data[i + 1] < 170 && data[i + 2] < 100) count += 1;
            return count;
          })()`)) as number;
        expect(await orangeIn(opened.frame?.imageBase64 ?? '')).toBe(0);
        expect(await orangeIn(clicked.frame?.imageBase64 ?? '')).toBeGreaterThanOrEqual(5);
      } finally {
        await decoder.close();
      }
    } finally {
      await session.close();
    }
  });

  it('PDF 링크는 번호로 읽고, 모델용 사진에만 노란 번호 표가 있고 사람에게 보내는 사진·실시간 화면에는 없다 (이슈 #427)', async () => {
    const link = web();
    const live: BrowserLiveFrame[] = [];
    const session = toolbox().session({ question: 'https://example.test/docs 자료 읽어줘', web: link, markedImages: true, onLive: (frame) => void live.push(frame) });
    const page = () => contexts.at(-1)?.pages()[0];
    try {
      const opened = await session.run(call('browser_open', { url: 'https://example.test/docs' }));
      expect(opened.modelImage?.mediaType).toBe('image/jpeg');
      expect(jpegWidth(opened.modelImage?.dataBase64 ?? '')).toBe(1024);
      expect(jpegWidth(opened.frame?.imageBase64 ?? '')).toBe(800);
      // 찍은 뒤 표를 지웠다
      expect(await page()?.evaluate('document.querySelectorAll(\'[id$="-marks"]\').length')).toBe(0);

      const read = await session.run(call('browser_read_file', { ref: refOf(opened, 'link "2026 철강 보고서 (PDF)"') }));
      expect(link.reads).toEqual(['https://example.test/files/report.pdf']);
      expect(link.visited).toContain('https://example.test/files/report.pdf');
      expect(read.content).toContain('[웹 문서] example.test');
      expect(read.content).toContain('Tensile 410 MPa');
      expect(read.webSources).toEqual([{ title: 'Steel Report 2026', url: 'https://example.test/files/report.pdf' }]);
      expect(read.frame).toBeNull();
      // 읽기는 페이지를 옮기지 않는다
      expect(page()?.url()).toBe('https://example.test/docs');
      expect(errorOf(await session.run(call('browser_read_file', { ref: refOf(opened, 'link "문의 메일"') })))).toBe('http(s) 문서 링크가 아니에요');

      const scrolled = await session.run(call('browser_scroll', { direction: 'down' }));
      expect(scrolled.modelImage).toBeDefined();
      await until(() => live.length >= 3);

      // 노란(#facc15) 픽셀을 센다: 브라우저 밖의 빈 탭에서 JPEG를 푼다
      const decoder = await (page()?.context().browser() as NonNullable<ReturnType<BrowserContext['browser']>>).newContext();
      try {
        const blank = await decoder.newPage();
        const yellowIn = async (base64: string) =>
          (await blank.evaluate(`(async () => {
            const image = new Image();
            image.src = 'data:image/jpeg;base64,${base64}';
            await image.decode();
            const canvas = document.createElement('canvas');
            canvas.width = image.width;
            canvas.height = image.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(image, 0, 0);
            const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
            let count = 0;
            for (let i = 0; i < data.length; i += 4) if (data[i] > 220 && data[i + 1] > 170 && data[i + 2] < 90) count += 1;
            return count;
          })()`)) as number;
        expect(await yellowIn(opened.modelImage?.dataBase64 ?? '')).toBeGreaterThanOrEqual(100);
        expect(await yellowIn(opened.frame?.imageBase64 ?? '')).toBe(0);
        expect(await yellowIn(scrolled.frame?.imageBase64 ?? '')).toBe(0);
        for (const frame of live) expect(await yellowIn(frame.imageBase64)).toBe(0);
      } finally {
        await decoder.close();
      }
    } finally {
      await session.close();
    }

    // markedImages가 없으면 모델용 사진을 찍지 않는다
    const plain = toolbox().session({ question: 'https://example.test/docs 봐줘', web: web() });
    try {
      expect((await plain.run(call('browser_open', { url: 'https://example.test/docs' }))).modelImage).toBeUndefined();
    } finally {
      await plain.close();
    }
  });

  it('onLive를 주면 페이지를 연 뒤 실시간 화면 사진이 오고, 탭을 열어 두거나 닫으면 멈추고, 이어 받으면 다시 온다 (이슈 #425)', async () => {
    const box = toolbox();
    const frames: BrowserLiveFrame[] = [];
    const session = box.session({ question: 'https://example.test/ 봐줘', web: web(), onLive: (frame) => void frames.push(frame) }, 'live');
    await session.run(call('browser_open', { url: 'https://example.test/' }));
    await until(() => frames.some((f) => f.url === 'example.test'));
    const shown = frames.find((f) => f.url === 'example.test');
    expect(shown).toBeDefined();
    expect(shown?.imageBase64.startsWith('/9j/')).toBe(true);
    expect(jpegWidth(shown?.imageBase64 ?? '')).toBeLessThanOrEqual(800);
    expect(Number.isNaN(Date.parse(shown?.at ?? ''))).toBe(false);

    // 답이 끝나 탭을 열어 두면 사진 보내기를 멈춘다
    await box.finish(session, 'live', false);
    await new Promise((resolve) => setTimeout(resolve, 600));
    const settled = frames.length;
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    expect(frames.length).toBe(settled);

    // 다음 질문이 이어 받으면 새 질문의 받는 곳으로 다시 온다
    const next: BrowserLiveFrame[] = [];
    const second = box.session({ question: '다시 봐줘', web: web(), onLive: (frame) => void next.push(frame) }, 'live');
    expect(second).toBe(session);
    await second.run(call('browser_scroll', { direction: 'down' }));
    await until(() => next.length > 0);
    expect(next.length).toBeGreaterThan(0);
    expect(frames.length).toBe(settled);
    await box.finish(second, 'live', true);

    // onLive가 없으면 사진을 찍지 않는다
    const quiet = toolbox().session({ question: 'https://example.test/ 봐줘', web: web() });
    try {
      await quiet.run(call('browser_open', { url: 'https://example.test/' }));
      expect((quiet as unknown as { live: boolean }).live).toBe(false);
    } finally {
      await quiet.close();
    }
    expect(pool.activeContexts).toBe(0);
  });

  it('탭이 밖에서 닫히면(사람이 창을 닫음) 컨텍스트를 놓고, 다음 browser_open이 새 탭을 연다 (이슈 #425)', async () => {
    const session = toolbox().session({ question: 'https://example.test/ 봐줘', web: web() });
    try {
      await session.run(call('browser_open', { url: 'https://example.test/' }));
      expect(pool.activeContexts).toBe(1);
      const before = contexts.length;
      const page = contexts.at(-1)?.pages()[0];
      await page?.close();
      await until(() => pool.activeContexts === 0, 3_000);
      expect(pool.activeContexts).toBe(0);

      // 닫힌 탭을 읽거나 누르려 하면 열라고 안내하고, 열면 새 탭이다
      expect(errorOf(await session.run(call('browser_snapshot')))).toBe('아직 연 페이지가 없어요');
      const reopened = await session.run(call('browser_open', { url: 'https://example.test/' }));
      expect(reopened.content).toContain('heading "오늘의 강판 시세"');
      expect(reopened.content).toContain('브라우저 탭이 닫혀서');
      expect(contexts.length).toBe(before + 1);
      expect(pool.activeContexts).toBe(1);
    } finally {
      await session.close();
    }
    expect(pool.activeContexts).toBe(0);
  });

  it('열어 둔 탭이 밖에서 닫히면 같은 열쇠의 다음 질문은 이어 받지 않고 새 세션이다 (이슈 #425)', async () => {
    const box = toolbox();
    const first = box.session({ question: 'https://example.test/ 봐줘', web: web() }, 'closing');
    await first.run(call('browser_open', { url: 'https://example.test/' }));
    await box.finish(first, 'closing', false);
    expect(box.openPage('closing')).not.toBeNull();
    await contexts.at(-1)?.pages()[0]?.close();
    await until(() => box.openPage('closing') === null, 3_000);
    expect(box.openPage('closing')).toBeNull();
    const second = box.session({ question: '다시 열어줘', web: web() }, 'closing');
    expect(second).not.toBe(first);
    await second.close();
    await box.finish(first, 'closing', true);
    await until(() => pool.activeContexts === 0, 3_000);
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
