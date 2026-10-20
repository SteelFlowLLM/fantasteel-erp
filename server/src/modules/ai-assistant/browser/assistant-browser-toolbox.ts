import { Logger, type OnModuleDestroy } from '@nestjs/common';
import { isAiAssistantBrowserTool, type AiAssistantStreamEvent, type AiBrowserCapabilities, type AiWebSource } from '@fantasteel/shared';
import type { Browser, BrowserContext, CDPSession, Locator, Page } from 'playwright-core';
import { randomBytes } from 'node:crypto';
import { LlmAbortedError, type LlmImage, type LlmToolCall, type LlmToolDefinition } from '../../llm/llm.client';
import { optionalEnum, requiredString, ToolArgumentError } from '../tools/assistant-tool';
import { assertFetchableUrl, BlockedUrlError } from '../web/ssrf-guard';
import type { SessionReadOutcome } from '../web/assistant-web-toolbox';
import { PAGE_TEXT_MAX } from '../web/page-extract';
import { cutText, redactQuery, stripInvisible, UNTRUSTED_NOTE, urlKey, wrapUntrusted } from '../web/web-text';
import { decideBrowserRequest, installRequestGuard, type HostDecisionCache, type RequestGuardOptions } from './browser-guard';
import { BrowserPool, BrowserUnavailableError } from './browser-pool';
import {
  ACTION_SNAPSHOT_MAX_CHARS,
  BROWSER_TIME_PER_ANSWER_MS,
  BROWSER_TYPE_MAX,
  browserStartSites,
  clickBlockReason,
  isStartSiteUrl,
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
export type BrowserLiveFrame = Omit<Extract<AiAssistantStreamEvent, { type: 'browser_live' }>, 'type'>;

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
/** 실시간 화면: 사진 사이 간격(초당 2장쯤), 품질, 크기 (가정값, 이슈 #425). Chrome은 받았다고 알리기 전에는 다음 사진을 보내지 않는다 */
export const LIVE_FRAME_GAP_MS = 500;
const LIVE_QUALITY = 45;
const LIVE_MAX = { width: 800, height: 500 };
/** 보이는 마우스가 요소까지 움직이는 시간 (가정값, 이슈 #425) */
export const CURSOR_MOVE_MS = 350;
/**
 * 보이는 마우스를 그린다 (이슈 #425). 화면 사진·창에서 AI가 어디를 누르는지 보이게 할 뿐 누르기는 Playwright가 한다.
 * 페이지 글 읽기(body 아래)에 끼지 않게 html 바로 아래 shadow root에 그리고, 마우스 이벤트는 받지 않는다
 */
function cursorScript(id: string, from: { x: number; y: number }, to: { x: number; y: number }, ripple: boolean): string {
  return `((id, from, to, ripple, ms) => {
  let host = document.getElementById(id);
  if (!host || !host.shadowRoot) {
    host = document.createElement('div');
    host.id = id;
    host.setAttribute('aria-hidden', 'true');
    for (const [k, v] of [['position', 'fixed'], ['left', '0'], ['top', '0'], ['width', '0'], ['height', '0'], ['z-index', '2147483647'], ['pointer-events', 'none'], ['display', 'block']]) host.style.setProperty(k, v, 'important');
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<style>.c{position:absolute;left:0;top:0;width:24px;height:24px;filter:drop-shadow(0 1px 2px rgba(0,0,0,.45))}.r{position:absolute;left:0;top:0;width:36px;height:36px;margin:-18px 0 0 -18px;border-radius:50%;border:3px solid #f97316;opacity:0}</style><div class="r"></div><svg class="c" viewBox="0 0 24 24"><path d="M3 2l7.5 19 2.6-7.6L20.7 11z" fill="#f97316" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    document.documentElement.appendChild(host);
  }
  const c = host.shadowRoot.querySelector('.c');
  const r = host.shadowRoot.querySelector('.r');
  c.style.transition = 'none';
  c.style.transform = 'translate(' + from.x + 'px,' + from.y + 'px)';
  void c.getBoundingClientRect();
  c.style.transition = 'transform ' + ms + 'ms cubic-bezier(.2,.7,.3,1)';
  c.style.transform = 'translate(' + to.x + 'px,' + to.y + 'px)';
  if (ripple) setTimeout(() => {
    r.style.left = to.x + 'px';
    r.style.top = to.y + 'px';
    if (r.animate) r.animate([{ opacity: 0.9, transform: 'scale(0.3)' }, { opacity: 0, transform: 'scale(1.4)' }], { duration: 450, easing: 'ease-out' });
  }, ms);
})(${JSON.stringify(id)}, ${JSON.stringify(from)}, ${JSON.stringify(to)}, ${ripple}, ${CURSOR_MOVE_MS})`;
}
/** 모델에 보내는 화면 사진: 너비, JPEG 품질, 번호 표 수 상한 (가정값, 이슈 #427) */
const MODEL_IMAGE_WIDTH = 1024;
const MODEL_IMAGE_QUALITY = 60;
const MARK_MAX = 150;
/** 번호 표를 지운 뒤에도 잠깐은 실시간 화면 사진을 버린다 (표를 지우기 전에 찍힌 사진이 늦게 오기도 한다) */
const MARK_LIVE_GRACE_MS = 250;
/**
 * 화면 글로 번호를 붙인 요소 중 보이는 것에 노란 [r번호] 표를 그린다 (이슈 #427). 모델이 사진과 화면 글을 맞춰 보게 한다.
 * 보이는 마우스처럼 html 바로 아래 shadow root에 그리고 마우스 이벤트는 받지 않는다. 그린 표 수를 돌려준다
 */
function marksScript(id: string, attr: string, docStart: number): string {
  return `((id, attr, docStart, max) => {
  document.getElementById(id)?.remove();
  const host = document.createElement('div');
  host.id = id;
  host.setAttribute('aria-hidden', 'true');
  for (const [k, v] of [['position', 'fixed'], ['left', '0'], ['top', '0'], ['width', '0'], ['height', '0'], ['z-index', '2147483647'], ['pointer-events', 'none'], ['display', 'block']]) host.style.setProperty(k, v, 'important');
  const w = window.innerWidth;
  const h = window.innerHeight;
  let html = '<style>.m{position:absolute;padding:0 2px;font:bold 11px/13px monospace;color:#000;background:#facc15;border:1px solid #000;border-radius:2px;white-space:nowrap}</style>';
  let count = 0;
  for (const el of document.querySelectorAll('[' + attr + ']')) {
    const n = Number(el.getAttribute(attr));
    if (!Number.isInteger(n) || n < docStart) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1 || r.bottom < 0 || r.right < 0 || r.top > h || r.left > w) continue;
    const x = Math.round(Math.max(0, Math.min(w - 36, r.left)));
    const y = Math.round(Math.max(0, Math.min(h - 15, r.top)));
    html += '<div class="m" style="left:' + x + 'px;top:' + y + 'px">r' + n + '</div>';
    if (++count >= max) break;
  }
  host.attachShadow({ mode: 'open' }).innerHTML = html;
  document.documentElement.appendChild(host);
  return count;
})(${JSON.stringify(id)}, ${JSON.stringify(attr)}, ${docStart}, ${MARK_MAX})`;
}
/** 같은 대화의 다음 질문이 이어 쓰게 답이 끝난 탭을 열어 두는 시간, 한 탭을 쓰는 최대 시간 (가정값, 이슈 #423) */
export const BROWSER_KEEP_MS = 10 * 60_000;
export const BROWSER_SESSION_MAX_MS = 30 * 60_000;
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
    '브라우저로 페이지를 연다. 이번 답의 web_search·search_places 결과에 있던 주소, 사용자가 질문에 적은 주소, 시작 사이트(네이버·다음·위키백과·정부 go.kr 등)의 주소만 열 수 있다. 페이지 안에서 검색하거나 다음 쪽으로 넘기는 등 read_web_page로 모자랄 때만 쓴다. 결과는 화면 글(요소마다 [r번호])이다.',
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
const READ_FILE: LlmToolDefinition = {
  name: 'browser_read_file',
  description: `페이지의 PDF·문서 링크를 내려받아 제목과 글(${PAGE_TEXT_MAX}자까지)을 읽는다. 브라우저는 파일을 내려받지 않으므로 PDF 링크는 누르지 말고 이것으로 읽는다. ref(화면 글의 링크 번호)나 url(browser_open으로 열 수 있는 주소) 중 하나를 넘긴다.`,
  parameters: {
    type: 'object',
    properties: {
      ref: { type: 'string', description: '화면 글의 링크 번호 (예: r21)' },
      url: { type: 'string', description: 'ref가 없을 때: 검색 결과나 질문에 있던 주소 그대로' },
    },
  },
};
const DEFINITIONS = [OPEN, SNAPSHOT, CLICK, TYPE, SCROLL, BACK, READ_FILE];

export interface BrowserToolResult {
  content: string;
  /** 화면 사진 (열기·누르기·입력·스크롤·뒤로 뒤). 스트림 browser_frame으로만 보낸다 */
  frame: BrowserFrame | null;
  /** 지금 페이지 (tool_end.webSources) */
  webSources: AiWebSource[];
  /** 모델에 보내는 번호 표 붙은 화면 사진 (이슈 #427). 화면 이벤트로 보내거나 저장하지 않는다 */
  modelImage?: LlmImage;
}

/** 한 답의 브라우저 도구. 서비스는 이것만 안다(시험은 가짜를 넣는다) */
export interface BrowserToolSessionLike {
  has(name: string): boolean;
  run(call: LlmToolCall, signal?: AbortSignal): Promise<BrowserToolResult>;
  close(): Promise<void>;
  /** 사용자가 멈춘 동안 이 답의 시간 제한을 세지 않는다. 돌려준 함수를 부르면 남은 시간부터 다시 센다 (이슈 #425) */
  holdDeadline?(): () => void;
}

/** 브라우저 세션이 웹 세션에서 쓰는 것: 열어도 되는 주소, 본 페이지 기억, 회사 안 정보 막기, 문서 읽기(이슈 #427) */
export interface BrowserWebLink {
  knows(url: string): boolean;
  rememberVisited(url: string, title: string): void;
  internalReference(text: string): string | null;
  readKnownPage(url: string, signal?: AbortSignal): Promise<SessionReadOutcome>;
}

export interface BrowserSessionInput {
  question: string;
  web: BrowserWebLink;
  signal?: AbortSignal;
  /** 답하는 동안 실시간 화면을 받는 곳 (이슈 #425). 없으면 실시간 화면을 찍지 않는다 */
  onLive?: (frame: BrowserLiveFrame) => void;
  /** 동작 뒤 번호 표 붙은 화면 사진을 찍어 모델에 보낼지 (사진을 보는 모델이고 BROWSER_VISION이 켜졌을 때, 이슈 #427) */
  markedImages?: boolean;
}

export interface BrowserToolboxOptions {
  /** 시험: 요청 확인 규칙(주소 풀기)과, 확인보다 먼저 걸 route(fixture) */
  guard?: RequestGuardOptions;
  prepareContext?: (context: BrowserContext) => Promise<void>;
  timeLimitMs?: number;
}

/** 열어 둔 탭에서 지금 보고 있던 페이지 (다음 질문의 프롬프트에 알린다) */
export interface BrowserOpenPage {
  title: string;
  url: string;
}

/**
 * 브라우저 도구 모음 (이슈 #373). AI_BROWSER_ENABLED=true이고 Chrome이 있을 때, 브라우저 사용을 켠 실시간 답에서만 알린다.
 * 승인 카드가 없으므로 위험한 동작(로그인·결제·삭제·개인정보 입력·POST 폼·파일)은 묻지 않고 막는다.
 * 같은 대화(열쇠 = 사원 + 화면의 대화 열쇠)의 다음 질문은 열어 둔 탭을 이어 쓴다 (이슈 #423). 남의 대화 탭은 열쇠가 달라 쓰지 않는다.
 */
export class AssistantBrowserToolbox implements OnModuleDestroy {
  private readonly parked = new Map<string, { session: BrowserToolSession; timer: NodeJS.Timeout }>();

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

  /** 열쇠의 열어 둔 탭이 있으면 그 세션을 이어 쓰고, 없으면 새 세션 */
  session(input: BrowserSessionInput, key: string | null = null): BrowserToolSession {
    const kept = key ? this.parked.get(key) : undefined;
    if (key && kept) {
      clearTimeout(kept.timer);
      this.parked.delete(key);
      if (kept.session.attach(input)) return kept.session;
      void kept.session.close();
    }
    return new BrowserToolSession(this.pool, input, this.options, () => this.closeOldestParked());
  }

  /** 열쇠의 열어 둔 탭이 보고 있던 페이지. 없으면 null */
  openPage(key: string | null): BrowserOpenPage | null {
    return (key && this.parked.get(key)?.session.currentPage()) || null;
  }

  /**
   * 답이 끝났을 때: 열쇠가 있고 멈추지 않았고 연 페이지가 있으면 탭을 열어 두고(10분), 아니면 닫는다.
   * 쉬는 탭도 서버 전체 탭 수(2개)를 차지하므로, 새 탭이 필요하면 가장 오래 쉰 탭부터 닫는다(closeOldestParked)
   */
  async finish(session: BrowserToolSessionLike, key: string | null, aborted: boolean): Promise<void> {
    if (!key || aborted || !(session instanceof BrowserToolSession) || !session.park()) {
      await session.close();
      return;
    }
    const previous = this.parked.get(key);
    if (previous && previous.session !== session) {
      clearTimeout(previous.timer);
      void previous.session.close();
    }
    const timer = setTimeout(() => {
      if (this.parked.get(key)?.session === session) this.parked.delete(key);
      void session.close();
    }, BROWSER_KEEP_MS);
    timer.unref();
    this.parked.set(key, { session, timer });
  }

  /** 가장 오래 쉰 탭 하나를 닫는다. 닫았으면 true */
  private async closeOldestParked(): Promise<boolean> {
    const oldest = this.parked.entries().next();
    if (oldest.done) return false;
    const [key, { session, timer }] = oldest.value;
    clearTimeout(timer);
    this.parked.delete(key);
    await session.close();
    return true;
  }

  async onModuleDestroy() {
    for (const { session, timer } of this.parked.values()) {
      clearTimeout(timer);
      await session.close();
    }
    this.parked.clear();
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
  /** 이 탭에서 연 페이지 (다음 질문에서 다시 열 수 있다, 이슈 #423) */
  private readonly visited = new Set<string>();
  private lastPage: BrowserOpenPage | null = null;
  private readonly startedAt = Date.now();
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private cdp: CDPSession | null = null;
  private actions = 0;
  private deadline: number | null = null;
  private deadlineTimer: NodeJS.Timeout | null = null;
  private closed: 'time' | 'abort' | 'done' | null = null;
  /** 보이는 마우스의 마지막 자리 (페이지를 옮겨도 이어서 움직인다) */
  private cursor: { x: number; y: number } = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };
  /** 실시간 화면을 찍는 중인지 */
  private live = false;
  /** 모델용 번호 표를 그려 둔 동안(과 지운 뒤 잠깐)은 실시간 화면 사진을 버린다 */
  private marking = false;
  private marksClearedAt = 0;
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
    private input: BrowserSessionInput,
    private readonly options: BrowserToolboxOptions = {},
    /** 서버 전체 탭이 꽉 찼을 때 쉬는 탭을 닫아 자리를 만든다 */
    private readonly makeRoom?: () => Promise<boolean>,
  ) {
    this.questionUrls = questionUrlKeys(input.question);
    input.signal?.addEventListener('abort', this.onAbort, { once: true });
  }

  has(name: string): boolean {
    return isAiAssistantBrowserTool(name);
  }

  /** 지금 보고 있는 페이지 (열어 둔 탭을 다음 질문에 알릴 때) */
  currentPage(): BrowserOpenPage | null {
    return this.page && !this.closed ? this.lastPage : null;
  }

  /**
   * 답이 끝난 뒤 탭을 열어 둔다: 이 답의 멈춤 신호·시간 제한을 풀고 컨텍스트는 그대로 둔다.
   * 연 페이지가 없거나 이미 닫혔거나 너무 오래 썼으면 false (부르는 쪽이 닫는다)
   */
  park(): boolean {
    if (!this.page || this.closed || this.page.isClosed() || Date.now() - this.startedAt >= BROWSER_SESSION_MAX_MS) return false;
    this.input.signal?.removeEventListener('abort', this.onAbort);
    void this.stopLive();
    if (this.deadlineTimer) clearTimeout(this.deadlineTimer);
    this.deadlineTimer = null;
    this.deadline = null;
    return true;
  }

  /** 열어 둔 탭을 다음 질문에 붙인다: 새 질문의 주소·웹 세션·멈춤 신호, 횟수·시간 제한은 새로 센다. 닫혔으면 false */
  attach(input: BrowserSessionInput): boolean {
    if (!this.page || this.closed || this.page.isClosed()) return false;
    this.input = input;
    for (const key of questionUrlKeys(input.question)) this.questionUrls.add(key);
    input.signal?.addEventListener('abort', this.onAbort, { once: true });
    this.actions = 0;
    this.startDeadline();
    // 지난 답에서 본 페이지들은 이번 답의 링크·주소 허용 목록에도 넣는다
    if (this.lastPage) input.web.rememberVisited(this.lastPage.url, this.lastPage.title);
    this.notes.push('지난 질문에서 연 페이지를 이어서 써요');
    void this.startLive(this.page);
    return true;
  }

  holdDeadline(): () => void {
    if (this.deadline === null || this.closed) return () => undefined;
    const remaining = Math.max(0, this.deadline - Date.now());
    if (this.deadlineTimer) clearTimeout(this.deadlineTimer);
    this.deadlineTimer = null;
    this.deadline = null;
    return () => {
      if (this.closed || this.deadline !== null) return;
      this.deadline = Date.now() + remaining;
      this.deadlineTimer = setTimeout(() => void this.close('time'), remaining);
      this.deadlineTimer.unref();
    };
  }

  private startDeadline() {
    const limit = this.options.timeLimitMs ?? BROWSER_TIME_PER_ANSWER_MS;
    if (this.deadlineTimer) clearTimeout(this.deadlineTimer);
    this.deadline = Date.now() + limit;
    this.deadlineTimer = setTimeout(() => void this.close('time'), limit);
    this.deadlineTimer.unref();
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
        case 'browser_read_file':
          return await this.readFile(args, signal);
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
    this.live = false;
    const context = this.context;
    this.context = null;
    this.page = null;
    this.cdp = null;
    if (context) await this.pool.release(context);
  }

  /** browser_open으로 열 수 있는 주소: 이번 답의 웹 결과, 질문에 적힌 주소, 이 탭에서 연 페이지, 시작 사이트 */
  private mayOpen(url: string): boolean {
    const key = urlKey(url);
    return key !== null && (this.input.web.knows(url) || this.questionUrls.has(key) || this.visited.has(key) || isStartSiteUrl(url, browserStartSites()));
  }

  private async open(url: string): Promise<BrowserToolResult> {
    if (!this.mayOpen(url))
      return failure('이번 답의 검색 결과·질문·시작 사이트에 없는 주소라 열지 않았어요', {
        안내: `web_search 결과의 주소, 사용자가 적은 주소, 시작 사이트(${browserStartSites().join(', ')})만 열어요. 페이지 안의 링크는 browser_click으로 눌러요`,
      });
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

  /**
   * PDF·문서 링크를 웹 페이지 읽기와 같은 fetch(사내망 막기·크기·시간 제한)로 읽는다 (이슈 #427).
   * Chrome은 내려받기를 막아 PDF 링크를 눌러도 아무것도 되지 않는다. ref는 지금 화면의 http(s) 링크, url은 browser_open과 같은 주소만
   */
  private async readFile(args: Record<string, unknown>, signal?: AbortSignal): Promise<BrowserToolResult> {
    let url: string;
    let name = '';
    if (args.ref !== undefined && args.ref !== null && args.ref !== '') {
      if (!this.page) return failure('아직 연 페이지가 없어요', { 안내: 'ref 대신 url로 넘기거나 먼저 browser_open으로 페이지를 열어요' });
      const target = await this.locate(this.page, args.ref);
      if ('content' in target) return target;
      // 격리된 실행 공간에서 읽은 a.href라 이미 절대 주소다
      const href = target.info.href;
      if (!href || !/^https?:\/\//i.test(href)) return failure('http(s) 문서 링크가 아니에요', { 안내: '화면 글에서 link 번호를 골라요' });
      url = href;
      name = target.info.name;
    } else {
      url = requiredString(args, 'url', 2000);
      if (!this.mayOpen(url))
        return failure('이번 답의 검색 결과·질문·시작 사이트에 없는 주소라 읽지 않았어요', { 안내: '페이지 안의 문서 링크는 화면 글의 번호를 ref로 넘겨요' });
    }
    const internal = this.input.web.internalReference(url);
    if (internal) return blocked(`주소에 회사 안 정보(${internal})가 있어요`);
    try {
      assertFetchableUrl(url);
    } catch (error) {
      if (error instanceof BlockedUrlError) return failure(error.message);
      throw error;
    }
    // 웹 세션은 기억한 주소만 읽는다. 기억해 두면 답에 이 문서 링크도 남는다
    this.input.web.rememberVisited(url, name || displayUrl(url));
    const outcome = await this.input.web.readKnownPage(url, signal);
    if (!outcome.ok) return failure(outcome.reason, { ...(outcome.url ? { 주소: outcome.url } : {}), 안내: outcome.hint });
    const host = hostOf(outcome.url);
    const remaining = Math.max(0, MAX_BROWSER_ACTIONS_PER_ANSWER - this.actions);
    const content = [
      // 최종 주소는 사이트가 정한 값(이동)이라 감싼 안에 두고, 밖에는 호스트만
      `[웹 문서] ${host}`,
      UNTRUSTED_NOTE,
      wrapUntrusted(host, `주소: ${outcome.url}\n제목: ${outcome.title}\n\n${outcome.text}`),
      outcome.truncated ? `(문서가 길어 앞 ${PAGE_TEXT_MAX}자만 넘겼어요)` : null,
      `(브라우저 동작 ${remaining}번 남음)`,
    ]
      .filter(Boolean)
      .join('\n');
    return { content, frame: null, webSources: [{ title: outcome.title, url: outcome.url }] };
  }

  private async click(rawRef: unknown): Promise<BrowserToolResult> {
    return this.withPage(async (page) => {
      const target = await this.locate(page, rawRef);
      if ('content' in target) return target;
      const reason = clickBlockReason(target.info);
      if (reason) return blocked(reason);
      if (target.info.disabled) return failure('누를 수 없는 요소예요');
      await this.showCursor(page, target.locator);
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
      await this.showCursor(page, locator);
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

  private async dropPage(page: Page): Promise<void> {
    if (this.page !== page || this.closed) return;
    const context = this.context;
    this.page = null;
    this.context = null;
    this.cdp = null;
    this.live = false;
    this.lastPage = null;
    this.notes.push('브라우저 탭이 닫혀서 다음 browser_open 때 새로 열어요');
    if (context) await this.pool.release(context);
  }

  private async ensurePage(): Promise<Page | null> {
    if (this.page) return this.page;
    const context = await this.pool.openContext((browser) => this.newContext(browser), this.makeRoom);
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
    // 탭이 밖에서 닫히면(창을 띄웠을 때 사람이 닫는 등) 그 컨텍스트를 놓고, 다음 열기가 새 탭을 연다
    page.on('close', () => void this.dropPage(page));
    page.setDefaultTimeout(ACTION_TIMEOUT_MS);
    page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);
    this.page = page;
    this.startDeadline();
    await this.startLive(page);
    return page;
  }

  private async newContext(browser: Browser): Promise<BrowserContext> {
    const context = await browser.newContext({
      acceptDownloads: false,
      permissions: [],
      locale: 'ko-KR',
      timezoneId: 'Asia/Seoul',
      viewport: VIEWPORT,
      // 창을 띄우면(BROWSER_HEADLESS=false) 화면 배율(Retina 2배)을 따라가 사진이 두 배로 커진다. 사진 너비를 지키려고 1로 둔다
      deviceScaleFactor: 1,
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
    if (isWeb) {
      this.input.web.rememberVisited(url, title || displayUrl(url));
      const key = urlKey(url);
      if (key) this.visited.add(key);
      this.lastPage = { title: title || displayUrl(url), url };
    }
    // 사람에게 보내는 사진을 먼저 찍는다(번호 표 없이)
    const frame = await this.frame(page, title);
    const modelImage = this.input.markedImages ? await this.markedImage(page) : null;
    return { content, frame, webSources: isWeb ? [{ title: title || displayUrl(url), url }] : [], ...(modelImage ? { modelImage } : {}) };
  }

  /**
   * 모델에 보낼 화면 사진 (이슈 #427): 번호 표를 그려 찍고 바로 지운다. 그동안 실시간 화면 사진은 버린다.
   * 못 찍으면 null (모델은 화면 글만 본다)
   */
  private async markedImage(page: Page): Promise<LlmImage | null> {
    const host = `${this.attr}-marks`;
    this.marking = true;
    try {
      await this.evaluateIsolated(page, marksScript(host, this.attr, this.refs.range.docStart));
      return { mediaType: 'image/jpeg', dataBase64: await this.capture(page, MODEL_IMAGE_WIDTH, MODEL_IMAGE_QUALITY) };
    } catch (error) {
      this.logger.debug(`번호 붙은 화면 사진을 찍지 못했어요: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
      return null;
    } finally {
      await this.evaluateIsolated(page, `document.getElementById(${JSON.stringify(host)})?.remove()`).catch(() => undefined);
      this.marksClearedAt = Date.now();
      this.marking = false;
    }
  }

  private async snapshotText(page: Page, maxChars: number): Promise<string> {
    const { docStart, next } = this.refs.range;
    const arg: PageScriptArg = { op: 'snapshot', attr: this.attr, docStart, next, maxNodes: SNAPSHOT_MAX_NODES, maxItems: SNAPSHOT_MAX_ITEMS };
    const expression = `(${PAGE_SCRIPT_SOURCE})(document.documentElement, ${JSON.stringify(arg)})`;
    // Enter·누르기로 이동이 늦게 시작되면 새 문서가 아직 비어 있을 때 읽기도 한다. 문서가 뜨기를 기다려 한 번 더 읽는다
    const snapshot = (await this.evaluateIsolated(page, expression).catch(async () => {
      await page.waitForLoadState('domcontentloaded', { timeout: NAVIGATION_TIMEOUT_MS }).catch(() => undefined);
      await page.waitForTimeout(SETTLE_MS);
      return this.evaluateIsolated(page, expression);
    })) as PageSnapshot;
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
    if (!this.cdp) {
      const cdp = await this.context.newCDPSession(page);
      cdp.on('Page.screencastFrame', (event) => this.onScreencastFrame(cdp, event));
      this.cdp = cdp;
    }
    return this.cdp;
  }

  /**
   * 누르기·입력 전에 보이는 마우스를 그 요소 가운데로 움직이고 다 갈 때까지 기다린다 (이슈 #425).
   * 그리지 못해도(요소가 화면 밖·페이지가 막음) 동작은 그대로 한다
   */
  private async showCursor(page: Page, locator: Locator): Promise<void> {
    try {
      await locator.scrollIntoViewIfNeeded({ timeout: ACTION_TIMEOUT_MS });
      const box = await locator.boundingBox({ timeout: ACTION_TIMEOUT_MS });
      if (!box) return;
      const to = { x: Math.round(Math.min(Math.max(box.x + box.width / 2, 0), VIEWPORT.width)), y: Math.round(Math.min(Math.max(box.y + box.height / 2, 0), VIEWPORT.height)) };
      await this.evaluateIsolated(page, cursorScript(`${this.attr}-cursor`, this.cursor, to, true));
      this.cursor = to;
      await page.waitForTimeout(CURSOR_MOVE_MS);
    } catch (error) {
      this.logger.debug(`마우스를 그리지 못했어요: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
    }
  }

  /** 실시간 화면을 켠다 (받는 곳이 있을 때만). 못 켜도 답은 그대로 한다 */
  private async startLive(page: Page): Promise<void> {
    if (!this.input.onLive || this.live || this.closed) return;
    try {
      const cdp = await this.cdpFor(page);
      this.live = true;
      await cdp.send('Page.startScreencast', { format: 'jpeg', quality: LIVE_QUALITY, maxWidth: LIVE_MAX.width, maxHeight: LIVE_MAX.height });
    } catch {
      this.live = false;
    }
  }

  private async stopLive(): Promise<void> {
    if (!this.live) return;
    this.live = false;
    await this.cdp?.send('Page.stopScreencast').catch(() => undefined);
  }

  /** 사진 한 장을 보내고, 간격이 지난 뒤에 받았다고 알린다 (그래야 Chrome이 다음 사진을 보낸다 = 초당 2장쯤) */
  private onScreencastFrame(cdp: CDPSession, event: { data: string; sessionId: number }) {
    const page = this.page;
    const marked = this.marking || Date.now() - this.marksClearedAt < MARK_LIVE_GRACE_MS;
    if (this.live && page && this.input.onLive && !marked) this.input.onLive({ url: displayUrl(page.url()), imageBase64: event.data, at: new Date().toISOString() });
    const ack = setTimeout(() => {
      if (this.live && this.cdp === cdp) void cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => undefined);
    }, LIVE_FRAME_GAP_MS);
    ack.unref();
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

  /** 화면 사진. 못 찍으면 null */
  private async frame(page: Page, title: string): Promise<BrowserFrame | null> {
    try {
      return { url: displayUrl(page.url()), title, imageBase64: await this.capture(page, FRAME_WIDTH, FRAME_QUALITY), at: new Date().toISOString() };
    } catch {
      return null;
    }
  }

  /** 보이는 화면을 JPEG base64로. Chrome DevTools 프로토콜로 줄여 찍는다(Playwright 사진은 크기를 줄이지 못함) */
  private async capture(page: Page, width: number, quality: number): Promise<string> {
    const cdp = await this.cdpFor(page);
    const metrics = (await cdp.send('Page.getLayoutMetrics')) as { cssVisualViewport: { pageX: number; pageY: number; clientWidth: number; clientHeight: number } };
    const view = metrics.cssVisualViewport;
    const shot = await cdp.send('Page.captureScreenshot', {
      format: 'jpeg',
      quality,
      clip: { x: view.pageX, y: view.pageY, width: view.clientWidth, height: view.clientHeight, scale: Math.min(1, width / view.clientWidth) },
    });
    return shot.data;
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return 'web';
  }
}
