import { Logger, type OnModuleDestroy } from '@nestjs/common';
import { isAiAssistantBrowserTool, type AiAssistantStreamEvent, type AiBrowserCapabilities, type AiWebSource } from '@fantasteel/shared';
import type { Browser, BrowserContext, CDPSession, Locator, Page } from 'playwright-core';
import { randomBytes } from 'node:crypto';
import { LlmAbortedError, type LlmToolCall, type LlmToolDefinition } from '../../llm/llm.client';
import { optionalEnum, requiredString, ToolArgumentError } from '../tools/assistant-tool';
import { assertFetchableUrl, BlockedUrlError } from '../web/ssrf-guard';
import { cutText, redactQuery, stripInvisible, urlKey } from '../web/web-text';
import { decideBrowserRequest, installRequestGuard, type HostDecisionCache, type RequestGuardOptions } from './browser-guard';
import { BrowserPool, BrowserUnavailableError } from './browser-pool';
import {
  ACTION_SNAPSHOT_MAX_CHARS,
  BROWSER_TIME_PER_ANSWER_MS,
  BROWSER_TYPE_MAX,
  clickBlockReason,
  displayUrl,
  formatSnapshot,
  isPostFormSubmission,
  MAX_BROWSER_ACTIONS_PER_ANSWER,
  RefBook,
  SNAPSHOT_MAX_CHARS,
  SNAPSHOT_MAX_NODES,
  typeBlockReason,
  USER_MUST_DO_IT,
} from './browser-rules';
import { pageScript, type ElementInfo, type PageScriptArg, type PageSnapshot } from './page-script';

/**
 * 페이지로 보낼 함수 글. 빌드 도구(tsx·esbuild keepNames)가 함수에 __name(…) 호출을 끼워 넣기도 해서
 * 그 이름을 아무 일도 하지 않는 함수로 감싸 둔다(페이지에는 __name이 없다)
 */
const PAGE_SCRIPT_SOURCE = `((__name) => (${pageScript.toString()}))((target) => target)`;

export type BrowserFrame = Omit<Extract<AiAssistantStreamEvent, { type: 'browser_frame' }>, 'type'>;

/** 화면 사진: JPEG 품질 50, 너비 800 (결정값). 모델에는 보내지 않는다 */
const FRAME_QUALITY = 50;
const FRAME_WIDTH = 800;
const VIEWPORT = { width: 1280, height: 800 };
/** 동작마다 기다리는 시간 (가정값) */
const NAVIGATION_TIMEOUT_MS = 15_000;
const ACTION_TIMEOUT_MS = 5_000;
const SETTLE_MS = 400;
/** 화면 읽기에서 모으는 줄 수 상한 (글 길이 상한 전에 페이지에서 꺼내는 양을 묶는다) */
const SNAPSHOT_MAX_ITEMS = 600;
const TITLE_MAX = 200;
/**
 * 프록시를 거치지 않는 WebRTC·WebTransport(UDP)를 페이지에서 지운다 (보안 검토). 모든 프레임에서 문서보다 먼저 돈다.
 * Chrome 실행 인자(--force-webrtc-ip-handling-policy)와 함께 쓴다
 */
const NO_UDP_SCRIPT = `(() => {
  for (const name of ['RTCPeerConnection', 'webkitRTCPeerConnection', 'RTCDataChannel', 'RTCSessionDescription', 'WebTransport']) {
    try { delete globalThis[name]; } catch (e) {}
    try { Object.defineProperty(globalThis, name, { value: undefined, writable: false, configurable: false }); } catch (e) {}
  }
})();`;

const OPEN: LlmToolDefinition = {
  name: 'browser_open',
  description:
    '브라우저로 페이지를 연다. 이번 답의 web_search·search_places 결과에 있던 주소나 사용자가 질문에 적은 주소만 열 수 있다. 페이지 안에서 검색하거나 다음 쪽으로 넘기는 등 read_web_page로 모자랄 때만 쓴다. 결과는 화면 글(요소마다 [r번호])이다.',
  parameters: { type: 'object', properties: { url: { type: 'string', description: '검색 결과나 질문에 있던 주소 그대로' } }, required: ['url'] },
};
const SNAPSHOT: LlmToolDefinition = {
  name: 'browser_snapshot',
  description: '지금 브라우저 페이지의 제목·주소와 보이는 글·버튼·링크·입력칸을 [r번호]와 함께 읽는다.',
  parameters: { type: 'object', properties: {} },
};
const CLICK: LlmToolDefinition = {
  name: 'browser_click',
  description: '화면 글의 [r번호] 요소를 누른다. 로그인·가입·결제·구매·주문·삭제·송금 버튼과 정보를 보내는 폼 제출은 막혀 있다.',
  parameters: { type: 'object', properties: { ref: { type: 'string', description: '화면 글의 번호 (예: r12)' } }, required: ['ref'] },
};
const TYPE: LlmToolDefinition = {
  name: 'browser_type',
  description: `화면 글의 [r번호] 입력칸에 글을 넣는다(${BROWSER_TYPE_MAX}자까지). submit: true면 넣은 뒤 Enter를 누른다(검색칸 등). 비밀번호·카드·인증번호 칸과 개인정보·회사 내부 정보는 넣지 않는다.`,
  parameters: {
    type: 'object',
    properties: {
      ref: { type: 'string', description: '입력칸 번호 (예: r13)' },
      text: { type: 'string', description: '넣을 글' },
      submit: { type: 'boolean', description: '넣은 뒤 Enter를 누를지' },
    },
    required: ['ref', 'text'],
  },
};
const SCROLL: LlmToolDefinition = {
  name: 'browser_scroll',
  description: '페이지를 한 화면쯤 아래(down)나 위(up)로 움직인다.',
  parameters: { type: 'object', properties: { direction: { type: 'string', enum: ['down', 'up'] } }, required: ['direction'] },
};
const BACK: LlmToolDefinition = {
  name: 'browser_back',
  description: '브라우저에서 뒤로 간다.',
  parameters: { type: 'object', properties: {} },
};
const DEFINITIONS = [OPEN, SNAPSHOT, CLICK, TYPE, SCROLL, BACK];

export interface BrowserToolResult {
  content: string;
  /** 화면 사진 (열기·누르기·입력·스크롤·뒤로 뒤). 스트림 browser_frame으로만 보낸다 */
  frame: BrowserFrame | null;
  /** 지금 페이지 (tool_end.webSources) */
  webSources: AiWebSource[];
}

/** 한 답의 브라우저 도구. 서비스는 이것만 안다(시험은 가짜를 넣는다) */
export interface BrowserToolSessionLike {
  has(name: string): boolean;
  run(call: LlmToolCall, signal?: AbortSignal): Promise<BrowserToolResult>;
  close(): Promise<void>;
}

/** 브라우저 세션이 웹 세션에서 쓰는 것: 열어도 되는 주소, 본 페이지 기억, 회사 안 정보 막기 */
export interface BrowserWebLink {
  knows(url: string): boolean;
  rememberVisited(url: string, title: string): void;
  internalReference(text: string): string | null;
}

export interface BrowserSessionInput {
  question: string;
  web: BrowserWebLink;
  signal?: AbortSignal;
}

export interface BrowserToolboxOptions {
  /** 시험: 요청 확인 규칙(주소 풀기)과, 확인보다 먼저 걸 route(fixture) */
  guard?: RequestGuardOptions;
  prepareContext?: (context: BrowserContext) => Promise<void>;
  timeLimitMs?: number;
}

/**
 * 브라우저 도구 모음 (이슈 #373). AI_BROWSER_ENABLED=true이고 Chrome이 있을 때, 브라우저 사용을 켠 실시간 답에서만 알린다.
 * 승인 카드가 없으므로 위험한 동작(로그인·결제·삭제·개인정보 입력·POST 폼·파일)은 묻지 않고 막는다.
 */
export class AssistantBrowserToolbox implements OnModuleDestroy {
  constructor(
    private readonly pool: BrowserPool,
    private readonly options: BrowserToolboxOptions = {},
  ) {}

  capabilities(): AiBrowserCapabilities {
    return this.pool.availability();
  }

  definitions(): LlmToolDefinition[] {
    return DEFINITIONS;
  }

  session(input: BrowserSessionInput): BrowserToolSession {
    return new BrowserToolSession(this.pool, input, this.options);
  }

  async onModuleDestroy() {
    await this.pool.shutdown();
  }
}

/** 질문에 그대로 적힌 http(s) 주소 (키) */
function questionUrlKeys(question: string): Set<string> {
  const keys = new Set<string>();
  for (const match of question.matchAll(/\bhttps?:\/\/[^\s<>()[\]"'`]{1,2000}/gi)) {
    const key = urlKey(match[0].replace(/[.,;:!?。、]+$/, ''));
    if (key) keys.add(key);
  }
  return keys;
}

function failure(reason: string, extra: Record<string, unknown> = {}): BrowserToolResult {
  return { content: JSON.stringify({ 오류: reason, ...extra }), frame: null, webSources: [] };
}

const blocked = (reason: string) => failure(`막았어요: ${reason}`, { 안내: USER_MUST_DO_IT });

/** 한 답 동안의 브라우저: 컨텍스트 하나(시크릿), 페이지 하나, 요소 번호 장부, 횟수·시간 */
export class BrowserToolSession implements BrowserToolSessionLike {
  private readonly logger = new Logger(BrowserToolSession.name);
  private readonly refs = new RefBook();
  /** 번호 속성 이름. 답마다 달라 페이지가 미리 알고 심어 두기 어렵다(그래도 규칙은 누르기 직전 요소를 다시 읽어 본다) */
  private readonly attr = `data-fs-${randomBytes(4).toString('hex')}`;
  private readonly questionUrls: Set<string>;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private cdp: CDPSession | null = null;
  private actions = 0;
  private deadline: number | null = null;
  private deadlineTimer: NodeJS.Timeout | null = null;
  private closed: 'time' | 'abort' | 'done' | null = null;
  /** 지난 동작 뒤로 막은 요청 (모델에 알린다) */
  private blockedRequests: string[] = [];
  private fileChooserBlocked = false;
  /** 다음 화면 글에 붙일 안내 */
  private notes: string[] = [];
  /** 이 답(컨텍스트)의 호스트별 판단. 요청 확인과 페이지 주소 다시 확인이 함께 쓴다 */
  private readonly hostCache: HostDecisionCache = new Map();
  private readonly onAbort = () => void this.close('abort');

  constructor(
    private readonly pool: BrowserPool,
    private readonly input: BrowserSessionInput,
    private readonly options: BrowserToolboxOptions = {},
  ) {
    this.questionUrls = questionUrlKeys(input.question);
    input.signal?.addEventListener('abort', this.onAbort, { once: true });
  }

  has(name: string): boolean {
    return isAiAssistantBrowserTool(name);
  }

  async run(call: LlmToolCall, signal?: AbortSignal): Promise<BrowserToolResult> {
    let args: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(call.arguments || '{}');
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return failure('인자는 객체여야 해요');
      args = parsed as Record<string, unknown>;
    } catch {
      return failure('인자가 JSON이 아니에요');
    }
    if (this.closed === 'time' || (this.deadline !== null && Date.now() >= this.deadline)) {
      await this.close('time');
      return failure(`브라우저는 한 답에 ${BROWSER_TIME_PER_ANSWER_MS / 60_000}분까지만 써요`, { 안내: '지금까지 본 내용으로 답해요' });
    }
    if (this.closed) return failure('브라우저를 닫았어요');
    if (++this.actions > MAX_BROWSER_ACTIONS_PER_ANSWER) return failure(`이번 질문에서는 브라우저 동작을 ${MAX_BROWSER_ACTIONS_PER_ANSWER}번까지만 해요`, { 안내: '지금까지 본 내용으로 답해요' });
    try {
      switch (call.name) {
        case 'browser_open':
          return await this.open(requiredString(args, 'url', 2000));
        case 'browser_snapshot':
          return await this.withPage(async (page) => {
            const unsafe = await this.closeIfUnsafe(page);
            if (unsafe) return unsafe;
            return { content: await this.snapshotText(page, SNAPSHOT_MAX_CHARS), frame: null, webSources: [] };
          });
        case 'browser_click':
          return await this.click(args.ref);
        case 'browser_type':
          return await this.type(args);
        case 'browser_scroll': {
          const direction = optionalEnum(args, 'direction', ['down', 'up'] as const) ?? 'down';
          return await this.withPage(async (page) => {
            await page.evaluate(`window.scrollBy(0, ${(direction === 'down' ? 1 : -1) * Math.round(VIEWPORT.height * 0.8)})`);
            return this.afterAction(page);
          });
        }
        case 'browser_back':
          return await this.withPage(async (page) => {
            const before = page.url();
            const response = await page.goBack({ waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS }).catch(() => null);
            if (!response && page.url() === before) return failure('뒤로 갈 페이지가 없어요');
            return this.afterAction(page);
          });
        default:
          return failure(`없는 도구예요: ${call.name}`);
      }
    } catch (error) {
      if (error instanceof ToolArgumentError) return failure(error.message);
      if (error instanceof BrowserUnavailableError) return failure(error.message, { 안내: '브라우저를 쓰지 못했다고 알리고 검색 결과로 답해요' });
      if (signal?.aborted || this.closed === 'abort') throw new LlmAbortedError();
      if (this.closed === 'time') return failure(`브라우저는 한 답에 ${BROWSER_TIME_PER_ANSWER_MS / 60_000}분까지만 써요`, { 안내: '지금까지 본 내용으로 답해요' });
      this.logger.warn(`브라우저 도구 실패 (${call.name}): ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
      return failure('브라우저에서 이 동작을 하지 못했어요', { 안내: 'browser_snapshot으로 지금 화면을 다시 보거나, 지금까지 본 내용으로 답해요' });
    }
  }

  async close(reason: 'time' | 'abort' | 'done' = 'done'): Promise<void> {
    this.closed = reason === 'abort' ? 'abort' : (this.closed ?? reason);
    if (this.deadlineTimer) clearTimeout(this.deadlineTimer);
    this.deadlineTimer = null;
    this.input.signal?.removeEventListener('abort', this.onAbort);
    const context = this.context;
    this.context = null;
    this.page = null;
    this.cdp = null;
    if (context) await this.pool.release(context);
  }

  private async open(url: string): Promise<BrowserToolResult> {
    const key = urlKey(url);
    if (!key || (!this.input.web.knows(url) && !this.questionUrls.has(key)))
      return failure('이번 답의 검색 결과나 질문에 없던 주소라 열지 않았어요', { 안내: 'web_search 결과의 주소나 사용자가 적은 주소를 그대로 넘겨요. 페이지 안의 링크는 browser_click으로 눌러요' });
    const internal = this.input.web.internalReference(url);
    if (internal) return blocked(`주소에 회사 안 정보(${internal})가 있어요`);
    try {
      assertFetchableUrl(url);
    } catch (error) {
      if (error instanceof BlockedUrlError) return failure(error.message);
      throw error;
    }
    const page = await this.ensurePage();
    if (!page) return failure('지금은 브라우저가 바빠요', { 안내: '잠시 뒤 다시 하거나 검색 결과로 답해요' });
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS });
    } catch (error) {
      if (this.closed) throw error;
      this.logger.debug(`페이지를 열지 못했어요: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
      const reason = this.blockedRequests.at(-1);
      this.blockedRequests = [];
      await this.resetToBlank(page);
      return failure(reason ? `페이지를 열지 않았어요: ${reason}` : '페이지를 열지 못했어요', { 안내: '열지 못했다고 알리고 검색 결과로 답해요' });
    }
    return this.afterAction(page);
  }

  private async click(rawRef: unknown): Promise<BrowserToolResult> {
    return this.withPage(async (page) => {
      const target = await this.locate(page, rawRef);
      if ('content' in target) return target;
      const reason = clickBlockReason(target.info);
      if (reason) return blocked(reason);
      if (target.info.disabled) return failure('누를 수 없는 요소예요');
      // 누른 뒤 이동을 기다리지 않는다(막은 이동은 끝나지 않는다). 기다림은 afterAction이 한다
      await target.locator.click({ timeout: ACTION_TIMEOUT_MS, noWaitAfter: true });
      return this.afterAction(page);
    });
  }

  private async type(args: Record<string, unknown>): Promise<BrowserToolResult> {
    const text = requiredString(args, 'text', BROWSER_TYPE_MAX);
    const submit = args.submit === true || args.submit === 'true';
    return this.withPage(async (page) => {
      const target = await this.locate(page, args.ref);
      if ('content' in target) return target;
      const { info, locator } = target;
      const reason = typeBlockReason(info);
      if (reason) return blocked(reason);
      // 입력한 글은 그 사이트(회사 밖)로 나간다: 검색어와 같은 규칙으로 막는다
      const internal = this.input.web.internalReference(text);
      if (internal) return blocked(`입력할 글에 회사 안 정보(${internal})가 있어요`);
      const { removed } = redactQuery(text);
      if (removed.length) return blocked(`입력할 글에 ${removed.join('·')}로 보이는 개인정보가 있어요`);
      if (submit && info.inForm && isPostFormSubmission(info.formMethod)) return blocked('정보를 보내는 폼(POST)은 제출하지 않아요');
      if (info.tag === 'select') await locator.selectOption({ label: text }, { timeout: ACTION_TIMEOUT_MS });
      else if (info.editable) await locator.fill(text, { timeout: ACTION_TIMEOUT_MS });
      else return failure('글을 넣을 수 있는 칸이 아니에요', { 안내: '화면 글에서 textbox·searchbox·combobox 번호를 골라요' });
      if (submit) await locator.press('Enter', { timeout: ACTION_TIMEOUT_MS, noWaitAfter: true });
      return this.afterAction(page);
    });
  }

  /** 번호로 요소 찾기 + 지금 상태 다시 읽기 */
  private async locate(page: Page, rawRef: unknown): Promise<{ locator: Locator; info: ElementInfo } | BrowserToolResult> {
    const check = this.refs.check(rawRef);
    if (!check.ok) return failure(check.reason);
    const selector = `[${this.attr}="${check.id}"]`;
    const arg: PageScriptArg = { op: 'describe' };
    const found = (await this.evaluateIsolated(
      page,
      `(() => { const list = document.querySelectorAll(${JSON.stringify(selector)}); return list.length === 1 ? { count: 1, info: (${PAGE_SCRIPT_SOURCE})(list[0], ${JSON.stringify(arg)}) } : { count: list.length }; })()`,
    )) as { count: number; info?: ElementInfo };
    if (found.count !== 1 || !found.info) return failure(`r${check.id} 요소를 찾지 못했어요`, { 안내: 'browser_snapshot으로 지금 화면을 다시 읽어요' });
    return { locator: page.locator(selector), info: found.info };
  }

  private async withPage(task: (page: Page) => Promise<BrowserToolResult>): Promise<BrowserToolResult> {
    if (!this.page) return failure('아직 연 페이지가 없어요', { 안내: '먼저 browser_open으로 검색 결과의 주소를 열어요' });
    return task(this.page);
  }

  private async ensurePage(): Promise<Page | null> {
    if (this.page) return this.page;
    const context = await this.pool.openContext((browser) => this.newContext(browser));
    if (!context) return null;
    // 닫는 사이에 멈췄으면 바로 돌려준다
    if (this.closed) {
      await this.pool.release(context);
      throw new Error('브라우저를 닫았어요');
    }
    this.context = context;
    const page = await context.newPage();
    // 새 창(팝업)은 바로 닫는다. 한 답에 페이지는 하나
    context.on('page', (popup) => {
      if (popup !== page) void popup.close().catch(() => undefined);
    });
    page.on('dialog', (dialog) => void dialog.dismiss().catch(() => undefined));
    // 듣고 있으면 파일 고르기 창이 뜨지 않는다. 파일은 넣지 않고 버린다
    page.on('filechooser', () => {
      this.fileChooserBlocked = true;
    });
    page.on('download', (download) => void download.cancel().catch(() => undefined));
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) this.refs.startDocument();
    });
    page.setDefaultTimeout(ACTION_TIMEOUT_MS);
    page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);
    this.page = page;
    const limit = this.options.timeLimitMs ?? BROWSER_TIME_PER_ANSWER_MS;
    this.deadline = Date.now() + limit;
    this.deadlineTimer = setTimeout(() => void this.close('time'), limit);
    this.deadlineTimer.unref();
    return page;
  }

  private async newContext(browser: Browser): Promise<BrowserContext> {
    const context = await browser.newContext({
      acceptDownloads: false,
      permissions: [],
      locale: 'ko-KR',
      timezoneId: 'Asia/Seoul',
      viewport: VIEWPORT,
      serviceWorkers: 'block',
    });
    try {
      await context.addInitScript(NO_UDP_SCRIPT);
      await this.options.prepareContext?.(context);
      await installRequestGuard(context, { ...this.options.guard, cache: this.hostCache, onBlocked: (reason) => this.blockedRequests.push(reason) });
    } catch (error) {
      await context.close().catch(() => undefined);
      throw error;
    }
    return context;
  }

  /**
   * 화면 글·사진 전에 지금 페이지와 모든 프레임의 주소를 다시 확인한다 (보안 검토: 리다이렉트로 들어간 주소 등).
   * 막을 주소면 about:blank로 비우고 막았다는 결과를, 괜찮으면 null
   */
  private async closeIfUnsafe(page: Page): Promise<BrowserToolResult | null> {
    let reason: string | null = null;
    for (const frame of page.frames()) {
      reason = await this.frameUrlProblem(frame.url(), frame === page.mainFrame());
      if (reason) break;
    }
    if (!reason) return null;
    this.logger.warn(`브라우저 페이지 주소를 다시 확인해 막았어요: ${reason}`);
    await this.resetToBlank(page);
    this.blockedRequests = [];
    this.notes = [];
    return failure(`막았어요: 페이지가 열 수 없는 주소로 이동해서 비웠어요 (${reason})`, { 안내: '이 페이지는 열 수 없다고 알리고 다른 결과로 답해요' });
  }

  private async frameUrlProblem(raw: string, main: boolean): Promise<string | null> {
    if (raw === '' || raw.startsWith('about:') || raw.startsWith('data:') || raw.startsWith('blob:')) return null;
    // 막은 iframe은 오류 페이지로 남는다(내용 없음). 본 문서가 오류 페이지면 되돌리지 못한 것이다
    if (raw.startsWith('chrome-error:')) return main ? '열지 못한 페이지' : null;
    const decision = await decideBrowserRequest({ url: raw, method: 'GET', isNavigation: true }, { ...this.options.guard, cache: this.hostCache });
    return decision.allow ? null : decision.reason;
  }

  /**
   * 빈 페이지로 비운다. 실패한 이동은 goto가 끝난 뒤에 오류 페이지를 올리기도 해서(다음 열기가 끊긴다) 잠깐씩 보며 몇 번 다시 비운다
   */
  private async resetToBlank(page: Page) {
    for (let i = 0; i < 3; i += 1) {
      await page.waitForTimeout(150);
      if (page.url() === 'about:blank') return;
      await page.goto('about:blank', { timeout: ACTION_TIMEOUT_MS }).catch(() => undefined);
    }
  }

  /** 막은 이동으로 Chrome 오류 페이지가 되었으면 뒤로 가서 이전 페이지로 되돌린다. 되돌렸으면 true */
  private async leaveErrorPage(page: Page): Promise<boolean> {
    if (!page.url().startsWith('chrome-error:')) return false;
    await page.goBack({ waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS }).catch(() => null);
    return !page.url().startsWith('chrome-error:');
  }

  /** 동작 뒤: 잠깐 기다리고, 짧은 화면 글 + 화면 사진 */
  private async afterAction(page: Page): Promise<BrowserToolResult> {
    await page.waitForTimeout(SETTLE_MS);
    await page.waitForLoadState('domcontentloaded', { timeout: NAVIGATION_TIMEOUT_MS }).catch(() => undefined);
    const blockedMove = this.blockedRequests.at(-1);
    if (await this.leaveErrorPage(page)) this.notes.push(`막은 이동(${blockedMove ?? '막힌 주소'}) 때문에 이전 페이지로 돌아왔어요. 페이지를 다시 불러 번호가 바뀌었어요`);
    const unsafe = await this.closeIfUnsafe(page);
    if (unsafe) return unsafe;
    const content = await this.snapshotText(page, ACTION_SNAPSHOT_MAX_CHARS);
    const url = page.url();
    const title = cutText(stripInvisible(await page.title().catch(() => '')), TITLE_MAX);
    const isWeb = /^https?:/i.test(url);
    if (isWeb) this.input.web.rememberVisited(url, title || displayUrl(url));
    return { content, frame: await this.frame(page, title), webSources: isWeb ? [{ title: title || displayUrl(url), url }] : [] };
  }

  private async snapshotText(page: Page, maxChars: number): Promise<string> {
    const { docStart, next } = this.refs.range;
    const arg: PageScriptArg = { op: 'snapshot', attr: this.attr, docStart, next, maxNodes: SNAPSHOT_MAX_NODES, maxItems: SNAPSHOT_MAX_ITEMS };
    const snapshot = (await this.evaluateIsolated(page, `(${PAGE_SCRIPT_SOURCE})(document.documentElement, ${JSON.stringify(arg)})`)) as PageSnapshot;
    this.refs.advance(snapshot.next);
    const notes: string[] = [];
    if (this.blockedRequests.length) notes.push(`(브라우저가 이 페이지의 요청 ${this.blockedRequests.length}개를 막았어요: ${[...new Set(this.blockedRequests)].slice(0, 3).join(' / ')})`);
    if (this.fileChooserBlocked) notes.push('(파일 고르기 창은 막았어요. 파일 올리기는 사용자가 직접 해야 해요)');
    notes.push(...this.notes.map((note) => `(${note})`));
    this.blockedRequests = [];
    this.fileChooserBlocked = false;
    this.notes = [];
    const remaining = Math.max(0, MAX_BROWSER_ACTIONS_PER_ANSWER - this.actions);
    return [formatSnapshot(snapshot, maxChars), ...notes, `(브라우저 동작 ${remaining}번 남음)`].join('\n');
  }

  private async cdpFor(page: Page): Promise<CDPSession> {
    if (!this.context) throw new Error('브라우저를 닫았어요');
    this.cdp ??= await this.context.newCDPSession(page);
    return this.cdp;
  }

  /**
   * 페이지 글 읽기·번호 붙이기는 본 문서의 격리된 실행 공간(isolated world)에서 돌린다 (보안 검토):
   * 페이지 스크립트가 getAttribute·innerText 같은 DOM 함수를 바꿔 로그인 버튼을 "다음"으로 속이지 못하게 한다(DOM은 같이 본다).
   * Playwright locator.evaluate는 끝나지 않은 이동을 기다리며 멈추기도 해서 CDP로 바로 묻는다
   */
  private async evaluateIsolated(page: Page, expression: string): Promise<unknown> {
    const cdp = await this.cdpFor(page);
    const { frameTree } = await cdp.send('Page.getFrameTree');
    const { executionContextId } = await cdp.send('Page.createIsolatedWorld', { frameId: frameTree.frame.id, worldName: 'fantasteel-browser' });
    const result = await cdp.send('Runtime.evaluate', { expression, contextId: executionContextId, returnByValue: true, timeout: ACTION_TIMEOUT_MS });
    if (result.exceptionDetails) throw new Error(`페이지 읽기 실패: ${result.exceptionDetails.exception?.description?.split('\n')[0] ?? result.exceptionDetails.text}`);
    return result.result.value;
  }

  /** 화면 사진. Chrome DevTools 프로토콜로 줄여 찍는다(Playwright 사진은 크기를 줄이지 못함). 못 찍으면 null */
  private async frame(page: Page, title: string): Promise<BrowserFrame | null> {
    try {
      const cdp = await this.cdpFor(page);
      const metrics = (await cdp.send('Page.getLayoutMetrics')) as { cssVisualViewport: { pageX: number; pageY: number; clientWidth: number; clientHeight: number } };
      const view = metrics.cssVisualViewport;
      const shot = await cdp.send('Page.captureScreenshot', {
        format: 'jpeg',
        quality: FRAME_QUALITY,
        clip: { x: view.pageX, y: view.pageY, width: view.clientWidth, height: view.clientHeight, scale: Math.min(1, FRAME_WIDTH / view.clientWidth) },
      });
      return { url: displayUrl(page.url()), title, imageBase64: shot.data, at: new Date().toISOString() };
    } catch {
      return null;
    }
  }
}
