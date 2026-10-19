import { isIP } from 'node:net';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import type { Readable } from 'node:stream';
import { Agent, buildConnector, request } from 'undici';
import { assertFetchableUrl, BLOCKED_LOOKUP_CODE, BlockedUrlError, DEFAULT_FETCH_POLICY, guardedLookup, type FetchPolicy, type LookupFunction } from './ssrf-guard';

/** 웹 페이지 읽기 한도 (이슈 #367 결정값) */
export const PAGE_FETCH_TIMEOUT_MS = 10_000;
export const PAGE_MAX_BYTES = 2 * 1024 * 1024;
export const PAGE_MAX_REDIRECTS = 5;

/** 브라우저처럼 보이는 User-Agent. 많은 사이트가 낯선 프로그램에는 빈 페이지·403을 준다 */
export const BROWSER_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export interface FetchedPage {
  /** 이동(redirect) 뒤 최종 주소 */
  url: string;
  contentType: string;
  body: Buffer;
  /** 2MB를 넘어 앞부분만 읽었는지 */
  truncated: boolean;
}

/** 읽지 못한 이유. 모델에 그대로 돌려준다 */
export class WebFetchError extends Error {}

export interface SafeFetcherOptions {
  /** 시험만 바꾼다: 127.0.0.1 시험 서버를 허용하는 규칙. 운영은 기본값(공용 주소·80/443) */
  policy?: FetchPolicy;
  /** 시험만 바꾼다: 이름을 정해진 주소로 푸는 함수 */
  resolve?: LookupFunction;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
}

const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);
const READABLE_TYPES = ['text/html', 'application/xhtml+xml', 'text/plain'];

/**
 * SSRF를 막고 웹 페이지를 읽는다. 연결은 전용 undici Agent로만 한다:
 * - 연결할 때의 DNS 조회(lookup)에서 내부 주소면 끊고, IP를 그대로 적은 주소는 연결 직전에도 다시 본다
 * - 이동(redirect)은 직접 따라가며 단계마다 주소를 다시 확인한다(최대 5번)
 * - 전체 10초, 본문은 2MB까지만 읽고 끊는다(압축을 푼 크기 기준)
 */
export class SafePageFetcher {
  private readonly policy: FetchPolicy;
  private readonly agent: Agent;
  private readonly timeoutMs: number;
  private readonly maxBytes: number;
  private readonly maxRedirects: number;

  constructor(options: SafeFetcherOptions = {}) {
    this.policy = options.policy ?? DEFAULT_FETCH_POLICY;
    this.timeoutMs = options.timeoutMs ?? PAGE_FETCH_TIMEOUT_MS;
    this.maxBytes = options.maxBytes ?? PAGE_MAX_BYTES;
    this.maxRedirects = options.maxRedirects ?? PAGE_MAX_REDIRECTS;
    const base = buildConnector({ lookup: guardedLookup(this.policy, options.resolve), timeout: this.timeoutMs });
    const policy = this.policy;
    this.agent = new Agent({
      headersTimeout: this.timeoutMs,
      bodyTimeout: this.timeoutMs,
      // IP를 그대로 적은 주소는 lookup을 거치지 않으므로 연결 직전에 한 번 더 본다
      connect: (options, callback) => {
        const host = options.hostname.startsWith('[') ? options.hostname.slice(1, -1) : options.hostname;
        if (isIP(host) && !policy.isAllowedAddress(host)) {
          callback(new BlockedUrlError('사내망·내부 주소는 읽을 수 없어요'), null);
          return;
        }
        base(options, callback);
      },
    });
  }

  async fetch(rawUrl: string, signal?: AbortSignal): Promise<FetchedPage> {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let current = rawUrl;
    try {
      for (let hop = 0; ; hop += 1) {
        const url = assertFetchableUrl(current, this.policy);
        const response = await request(url, {
          dispatcher: this.agent,
          method: 'GET',
          headers: {
            'user-agent': BROWSER_USER_AGENT,
            accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1',
            'accept-language': 'ko-KR,ko;q=0.9,en;q=0.8',
            'accept-encoding': 'gzip, deflate, br',
          },
          signal: combined,
        });
        const status = response.statusCode;
        if (REDIRECT_STATUS.has(status)) {
          discard(response.body);
          const location = header(response.headers, 'location');
          if (!location) throw new WebFetchError(`페이지가 이동(${status})하라고 했지만 갈 곳이 없어요`);
          if (hop >= this.maxRedirects) throw new WebFetchError(`이동이 ${this.maxRedirects}번을 넘어 읽지 않았어요`);
          current = new URL(location, url).toString();
          continue;
        }
        if (status >= 400) {
          discard(response.body);
          throw new WebFetchError(`페이지가 ${status} 오류를 돌려줬어요`);
        }
        const contentType = (header(response.headers, 'content-type') ?? '').toLowerCase();
        const mediaType = contentType.split(';')[0].trim();
        if (mediaType === 'application/pdf') {
          discard(response.body);
          throw new WebFetchError('PDF는 아직 못 읽어요');
        }
        // 형식을 알리지 않은 페이지는 HTML로 보고 읽어 본다
        if (mediaType && !READABLE_TYPES.includes(mediaType)) {
          discard(response.body);
          throw new WebFetchError(`읽을 수 없는 형식이에요 (${mediaType})`);
        }
        const { body, truncated } = await readCapped(response.body, header(response.headers, 'content-encoding'), this.maxBytes);
        return { url: url.toString(), contentType: contentType || 'text/html', body, truncated };
      }
    } catch (error) {
      throw toFetchError(error, timeout.aborted, signal?.aborted === true);
    }
  }

  async close(): Promise<void> {
    await this.agent.close();
  }
}

type Headers = Record<string, string | string[] | undefined>;

/** 읽지 않을 본문을 버리고 연결을 닫는다. 끊으면 본문이 abort 오류를 내므로 받아 둔다(처리하지 않은 오류가 되지 않게) */
function discard(body: Readable) {
  body.on('error', () => undefined);
  body.destroy();
}

function header(headers: Headers, name: string): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/** 본문을 maxBytes까지만 읽는다. 넘으면 그 자리에서 끊고(나머지를 받지 않음) 앞부분을 돌려준다. 압축은 푼 크기로 센다 */
async function readCapped(body: Readable, encoding: string | undefined, maxBytes: number): Promise<{ body: Buffer; truncated: boolean }> {
  // 상한에서 끊으면 본문이 abort 오류를 낸다. 이미 읽은 앞부분을 쓰므로 받아 둔다
  body.on('error', () => undefined);
  const decoder = decompressorFor(encoding);
  decoder?.on('error', () => undefined);
  const source: Readable = decoder ? body.pipe(decoder) : body;
  const chunks: Buffer[] = [];
  let size = 0;
  let truncated = false;
  try {
    for await (const chunk of source) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      if (size + buffer.length > maxBytes) {
        chunks.push(buffer.subarray(0, maxBytes - size));
        size = maxBytes;
        truncated = true;
        break;
      }
      chunks.push(buffer);
      size += buffer.length;
    }
  } finally {
    // 다 읽었거나 넘쳐서 멈췄으면 연결을 닫아 나머지를 받지 않는다
    if (truncated || !body.readableEnded) body.destroy();
    decoder?.destroy();
  }
  return { body: Buffer.concat(chunks, size), truncated };
}

function decompressorFor(encoding: string | undefined) {
  switch (encoding?.trim().toLowerCase()) {
    case 'gzip':
    case 'x-gzip':
      return createGunzip();
    case 'deflate':
      return createInflate();
    case 'br':
      return createBrotliDecompress();
    default:
      return null;
  }
}

function toFetchError(error: unknown, timedOut: boolean, cancelled: boolean): Error {
  if (error instanceof WebFetchError) return error;
  if (error instanceof BlockedUrlError) return new WebFetchError(error.message);
  if (cancelled) return error instanceof Error ? error : new WebFetchError('멈췄어요');
  if (timedOut) return new WebFetchError(`${PAGE_FETCH_TIMEOUT_MS / 1000}초 안에 페이지를 읽지 못했어요`);
  const code = errorCode(error);
  if (code === BLOCKED_LOOKUP_CODE || hasBlockedCause(error)) return new WebFetchError('사내망·내부 주소는 읽을 수 없어요');
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return new WebFetchError('주소를 찾지 못했어요');
  if (code === 'UND_ERR_HEADERS_TIMEOUT' || code === 'UND_ERR_BODY_TIMEOUT' || code === 'UND_ERR_CONNECT_TIMEOUT') return new WebFetchError(`${PAGE_FETCH_TIMEOUT_MS / 1000}초 안에 페이지를 읽지 못했어요`);
  return new WebFetchError('페이지를 읽지 못했어요');
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const own = (error as { code?: unknown }).code;
  if (typeof own === 'string') return own;
  const cause = (error as { cause?: unknown }).cause;
  return cause === undefined ? undefined : errorCode(cause);
}

/** 연결 오류가 여러 겹(AggregateError·cause)으로 싸여 와도 막힘을 찾는다 */
function hasBlockedCause(error: unknown, depth = 0): boolean {
  if (depth > 5 || typeof error !== 'object' || error === null) return false;
  if (error instanceof BlockedUrlError || (error as { code?: unknown }).code === BLOCKED_LOOKUP_CODE) return true;
  const inner = (error as { errors?: unknown }).errors;
  if (Array.isArray(inner) && inner.some((e) => hasBlockedCause(e, depth + 1))) return true;
  return hasBlockedCause((error as { cause?: unknown }).cause, depth + 1);
}
