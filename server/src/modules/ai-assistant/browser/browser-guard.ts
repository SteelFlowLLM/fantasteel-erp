import type { BrowserContext } from 'playwright-core';
import { assertFetchableUrl, BlockedUrlError, checkHostAddresses, DEFAULT_FETCH_POLICY, type FetchPolicy, type LookupFunction } from '../web/ssrf-guard';
import { BROWSER_LOOKUP } from './browser-dns';

/**
 * 브라우저의 모든 요청 확인 (이슈 #373). 페이지 읽기(web/ssrf-guard.ts)와 같은 규칙을 쓴다:
 * http·https만(그림 같은 하위 요청은 data:·blob:도), 80·443 포트, 막을 호스트, 이름을 푼 주소가 모두 공용 주소.
 * 그리고 페이지 이동(문서 요청)이 POST면 막는다(폼 보내기). 웹소켓은 모두 막는다.
 * route는 리다이렉트의 첫 주소만 보므로 이것은 앞쪽 확인이고, 모든 연결은 브라우저 프록시(browser-proxy.ts)가 다시 확인한다.
 */

/** 한 컨텍스트(한 답)에서 요청하는 서로 다른 호스트 수 (보안 검토: 이름 풀기를 넘치게 하지 못하게) */
export const MAX_HOSTS_PER_CONTEXT = 100;

/** 한 답 동안 호스트별 판단 */
export type HostDecisionCache = Map<string, Promise<string | null>>;

export interface BrowserRequestInfo {
  url: string;
  method: string;
  /** 문서(페이지·iframe) 이동 요청인지 */
  isNavigation: boolean;
}

export type RequestDecision = { allow: true } | { allow: false; reason: string };

export interface RequestGuardOptions {
  policy?: FetchPolicy;
  /** 시험은 이름을 정해진 주소로 푸는 함수를 넣는다 */
  resolve?: LookupFunction;
}

/** 요청 하나를 보낼지 (Chrome 없이 시험한다) */
export async function decideBrowserRequest(request: BrowserRequestInfo, options: RequestGuardOptions & { cache?: HostDecisionCache } = {}): Promise<RequestDecision> {
  const policy = options.policy ?? DEFAULT_FETCH_POLICY;
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return { allow: false, reason: '주소 형식이 틀렸어요' };
  }
  if (url.protocol === 'data:' || url.protocol === 'blob:') return request.isNavigation ? { allow: false, reason: 'data·blob 주소로는 이동하지 않아요' } : { allow: true };
  const method = request.method.toUpperCase();
  if (request.isNavigation && method !== 'GET' && method !== 'HEAD') return { allow: false, reason: '정보를 보내는 폼(POST)은 제출하지 않아요' };
  try {
    assertFetchableUrl(request.url, policy);
  } catch (error) {
    if (error instanceof BlockedUrlError) return { allow: false, reason: error.message };
    throw error;
  }
  const host = url.hostname.toLowerCase();
  // 한 페이지가 같은 호스트에 하위 요청을 많이 보내므로 한 답(컨텍스트) 동안 판단을 기억한다
  let pending = options.cache?.get(host);
  if (!pending) {
    if (options.cache && options.cache.size >= MAX_HOSTS_PER_CONTEXT) return { allow: false, reason: `한 페이지에서 ${MAX_HOSTS_PER_CONTEXT}개가 넘는 사이트로 요청해서 막았어요` };
    pending = checkHostAddresses(host, policy, options.resolve ?? BROWSER_LOOKUP);
    options.cache?.set(host, pending);
  }
  const reason = await pending;
  return reason ? { allow: false, reason } : { allow: true };
}

/**
 * 컨텍스트의 모든 요청에 확인을 건다. 가장 나중에 건 route가 먼저 돌므로 다른 route(시험 fixture)보다 뒤에 건다.
 * 허락한 요청은 fallback으로 넘겨 다음 route나 네트워크로 보낸다.
 */
export async function installRequestGuard(context: BrowserContext, options: RequestGuardOptions & { cache: HostDecisionCache; onBlocked?: (reason: string, url: string) => void }): Promise<void> {
  const { cache } = options;
  await context.routeWebSocket(/.*/, (ws) => ws.close({ code: 1008, reason: 'blocked' }));
  await context.route('**/*', async (route) => {
    const request = route.request();
    let decision: RequestDecision;
    try {
      decision = await decideBrowserRequest({ url: request.url(), method: request.method(), isNavigation: request.isNavigationRequest() }, { ...options, cache });
    } catch {
      decision = { allow: false, reason: '요청을 확인하지 못했어요' };
    }
    try {
      if (decision.allow) await route.fallback();
      else {
        options.onBlocked?.(decision.reason, request.url());
        // 막은 페이지 이동은 Chrome 오류 페이지(chrome-error://)가 된다. 세션이 뒤로 가서 되돌린다
        // (204로 답하면 페이지는 남지만 Playwright가 끝나지 않은 이동을 계속 기다려 다음 동작이 멈춘다)
        await route.abort('blockedbyclient');
      }
    } catch {
      // 페이지가 이미 닫혔으면 할 일이 없다
    }
  });
}
