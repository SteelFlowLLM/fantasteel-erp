import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { chromium, type Browser, type BrowserContext } from 'playwright-core';
import type { AiBrowserCapabilities } from '@fantasteel/shared';

/** 브라우저를 아무도 쓰지 않으면 닫는 시간 (결정값) */
export const BROWSER_IDLE_CLOSE_MS = 5 * 60_000;
/** 서버 전체에서 동시에 여는 컨텍스트 수 (결정값). 넘으면 기다리지 않고 "바빠요"를 돌려준다 */
export const MAX_BROWSER_CONTEXTS = 2;
/** Chrome을 띄우지 못했으면 이만큼은 다시 띄워 보지 않고 쓸 수 없다고 알린다 (가정값) */
const LAUNCH_RETRY_MS = 60_000;

/** 브라우저를 쓸 수 없을 때 (설정 꺼짐·Chrome 없음·띄우기 실패) */
export class BrowserUnavailableError extends Error {}

/**
 * Playwright가 channel: 'chrome'으로 찾는 곳과 같다 (playwright-core registry). 브라우저를 내려받지 않고
 * 설치된 Google Chrome만 쓴다.
 */
export function chromeCandidates(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string[] {
  if (platform === 'darwin') return ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
  if (platform === 'linux') return ['/opt/google/chrome/chrome'];
  if (platform === 'win32') {
    return [env.LOCALAPPDATA, env.PROGRAMFILES, env['PROGRAMFILES(X86)']].filter((p): p is string => !!p).map((prefix) => join(prefix, 'Google', 'Chrome', 'Application', 'chrome.exe'));
  }
  return [];
}

export interface BrowserPoolOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  exists?: (path: string) => boolean;
  /** 시험은 띄우는 함수를 바꾼다. executablePath가 null이면 channel: 'chrome' */
  launch?: (executablePath: string | null) => Promise<Browser>;
  idleMs?: number;
  maxContexts?: number;
  now?: () => number;
}

const launchChrome = (executablePath: string | null): Promise<Browser> =>
  chromium.launch({
    ...(executablePath ? { executablePath } : { channel: 'chrome' }),
    headless: true,
    // macOS·Windows는 Chrome 샌드박스를 켠다. Linux 서버(root·컨테이너)는 샌드박스가 뜨지 않는 일이 많아 Playwright 기본값(끔)을 둔다
    chromiumSandbox: process.platform !== 'linux',
    timeout: 30_000,
  });

/**
 * 서버에 브라우저 하나를 두고(처음 쓸 때 띄움, 5분 놀면 닫음) 답마다 새 시크릿 컨텍스트를 빌려준다.
 * 컨텍스트는 서버 전체 2개까지.
 */
export class BrowserPool {
  private readonly logger = new Logger(BrowserPool.name);
  private readonly env: NodeJS.ProcessEnv;
  private readonly platform: NodeJS.Platform;
  private readonly exists: (path: string) => boolean;
  private readonly launcher: (executablePath: string | null) => Promise<Browser>;
  private readonly idleMs: number;
  private readonly maxContexts: number;
  private readonly now: () => number;
  private browser: Promise<Browser> | null = null;
  private readonly contexts = new Set<BrowserContext>();
  /** 컨텍스트를 만드는 중인 수 (동시에 들어와 2개를 넘지 않게) */
  private opening = 0;
  private idleTimer: NodeJS.Timeout | null = null;
  private launchFailedAt: number | null = null;

  constructor(options: BrowserPoolOptions = {}) {
    this.env = options.env ?? process.env;
    this.platform = options.platform ?? process.platform;
    this.exists = options.exists ?? existsSync;
    this.launcher = options.launch ?? launchChrome;
    this.idleMs = options.idleMs ?? BROWSER_IDLE_CLOSE_MS;
    this.maxContexts = options.maxContexts ?? MAX_BROWSER_CONTEXTS;
    this.now = options.now ?? Date.now;
  }

  /** 띄울 Chrome. BROWSER_EXECUTABLE_PATH가 있으면 그것만 본다 */
  private executable(): { path: string | null; found: boolean } {
    const custom = this.env.BROWSER_EXECUTABLE_PATH?.trim();
    if (custom) return { path: custom, found: this.exists(custom) };
    return { path: null, found: chromeCandidates(this.platform, this.env).some((p) => this.exists(p)) };
  }

  /** 쓸 수 있는지 (설정과 Chrome 파일만 본다. 띄워 보지 않는다) */
  availability(): AiBrowserCapabilities {
    if (this.env.AI_BROWSER_ENABLED?.trim().toLowerCase() !== 'true') return { available: false, reason: '서버에서 브라우저 사용을 꺼 두었어요' };
    if (!this.executable().found) return { available: false, reason: '서버에 Google Chrome이 없어요' };
    if (this.launchFailedAt !== null && this.now() - this.launchFailedAt < LAUNCH_RETRY_MS) return { available: false, reason: 'Chrome을 띄우지 못했어요' };
    return { available: true };
  }

  /** 새 컨텍스트. 2개를 이미 쓰고 있으면 null. 쓸 수 없으면 BrowserUnavailableError */
  async openContext(configure: (browser: Browser) => Promise<BrowserContext>): Promise<BrowserContext | null> {
    const availability = this.availability();
    if (!availability.available) throw new BrowserUnavailableError(availability.reason ?? '브라우저를 쓸 수 없어요');
    if (this.contexts.size + this.opening >= this.maxContexts) return null;
    this.opening += 1;
    this.clearIdle();
    try {
      const browser = await this.launch();
      const context = await configure(browser);
      this.contexts.add(context);
      context.on('close', () => this.forget(context));
      return context;
    } finally {
      this.opening -= 1;
      this.scheduleIdle();
    }
  }

  /** 컨텍스트를 닫는다 (몇 번 불러도 된다) */
  async release(context: BrowserContext): Promise<void> {
    this.forget(context);
    await context.close().catch(() => undefined);
  }

  get activeContexts(): number {
    return this.contexts.size;
  }

  async shutdown(): Promise<void> {
    this.clearIdle();
    await Promise.all([...this.contexts].map((c) => c.close().catch(() => undefined)));
    this.contexts.clear();
    await this.closeBrowser();
  }

  private forget(context: BrowserContext) {
    if (this.contexts.delete(context)) this.scheduleIdle();
  }

  private launch(): Promise<Browser> {
    if (!this.browser) {
      const executable = this.executable();
      const launching = this.launcher(executable.path).then(
        (browser) => {
          this.launchFailedAt = null;
          browser.on('disconnected', () => {
            if (this.browser === launching) this.browser = null;
          });
          return browser;
        },
        (error: unknown) => {
          this.browser = null;
          this.launchFailedAt = this.now();
          this.logger.warn(`Chrome을 띄우지 못했어요: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
          throw new BrowserUnavailableError('Chrome을 띄우지 못했어요');
        },
      );
      this.browser = launching;
    }
    return this.browser;
  }

  private clearIdle() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  private scheduleIdle() {
    if (this.contexts.size || this.opening || !this.browser) return;
    this.clearIdle();
    this.idleTimer = setTimeout(() => void this.closeBrowser(), this.idleMs);
    this.idleTimer.unref();
  }

  private async closeBrowser() {
    const browser = this.browser;
    this.browser = null;
    if (!browser) return;
    await browser.then((b) => b.close()).catch(() => undefined);
  }
}
