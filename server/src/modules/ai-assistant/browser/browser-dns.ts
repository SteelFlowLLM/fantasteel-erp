import { Resolver } from 'node:dns/promises';
import { Semaphore } from '../web/assistant-web-toolbox';
import type { LookupFunction } from '../web/ssrf-guard';

/**
 * 브라우저 요청의 이름 풀기 (보안 검토, 이슈 #373). dns.lookup(getaddrinfo)은 libuv 스레드 풀(기본 4개)을 써서
 * 페이지가 수많은 이름으로 요청을 보내면 서버의 다른 파일·DNS 작업까지 막힌다. 그래서 c-ares Resolver로
 * A·AAAA를 직접 묻고(2초·한 번), 동시에 4개까지만 묻는다. /etc/hosts는 보지 않는다(localhost 같은 이름은 그 전에 막힌다).
 */
export const BROWSER_DNS_TIMEOUT_MS = 2_000;
export const BROWSER_DNS_CONCURRENCY = 4;

export interface DnsResolverLike {
  resolve4(hostname: string): Promise<string[]>;
  resolve6(hostname: string): Promise<string[]>;
}

export function resolverLookup(options: { resolver?: DnsResolverLike; concurrency?: number } = {}): LookupFunction {
  const resolver = options.resolver ?? new Resolver({ timeout: BROWSER_DNS_TIMEOUT_MS, tries: 1 });
  const slots = new Semaphore(options.concurrency ?? BROWSER_DNS_CONCURRENCY);
  return (hostname, _options, callback) => {
    slots
      .run(async () => {
        const [v4, v6] = await Promise.all([resolver.resolve4(hostname).catch((): string[] => []), resolver.resolve6(hostname).catch((): string[] => [])]);
        return [...v4.map((address) => ({ address, family: 4 })), ...v6.map((address) => ({ address, family: 6 }))];
      })
      .then(
        (addresses) => (addresses.length ? callback(null, addresses) : callback(Object.assign(new Error(`주소를 찾지 못했어요 (${hostname})`), { code: 'ENOTFOUND' }), [])),
        (error: unknown) => callback(error instanceof Error ? error : new Error(String(error)), []),
      );
  };
}

/** 서버에 하나: 요청 확인(route)과 프록시가 함께 쓴다 */
export const BROWSER_LOOKUP: LookupFunction = resolverLookup();
