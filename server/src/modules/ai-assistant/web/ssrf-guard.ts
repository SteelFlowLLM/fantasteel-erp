import type { LookupAddress } from 'node:dns';
import ipaddr from 'ipaddr.js';
import { BLOCKED_LOOKUP_CODE, firstBlockedAddress as firstBlockedAddressOf, guardedLookup as guardedLookupOf, systemLookup, type LookupFunction } from '../../../common/net/guarded-lookup';

// lookup 본체는 LLM·음성 서버 연결도 같이 쓰도록 common/net/guarded-lookup.ts로 옮겼다(이슈 #510). 이 파일은 웹 페이지 읽기 규칙(FetchPolicy)을 넣어 부르고, 옛 import 경로를 위해 다시 내보낸다
export { BLOCKED_LOOKUP_CODE, type LookupFunction };

/**
 * 웹 페이지 읽기의 SSRF 막기 (이슈 #367). 모델이 고른 주소로 서버가 요청을 보내므로, 사내망·클라우드 메타데이터·
 * 서버 자신으로 가는 요청을 연결하기 전에 막는다. 이름은 DNS로 푼 실제 주소로 확인하고(연결에 쓰는 lookup 안에서),
 * IP 그대로 적은 주소는 lookup을 거치지 않으므로 주소를 볼 때 따로 확인한다.
 */

/** 웹 페이지를 읽을 때 지키는 규칙. 시험만 다른 값을 넣는다(운영은 늘 DEFAULT_FETCH_POLICY, 환경 변수로 바꾸지 않는다) */
export interface FetchPolicy {
  /** 연결해도 되는 IP인지 */
  isAllowedAddress(address: string): boolean;
  /** 허용 포트. 빈 문자열은 scheme 기본 포트 */
  allowedPorts: readonly string[];
  /** 읽지 않을 호스트 이름 (소문자). 없으면 막지 않는다 */
  isDeniedHost?(host: string): boolean;
}

/** 공용 인터넷 주소만 허용한다. IPv4는 unicast, IPv6는 전역 unicast(2000::/3)만. IPv4-mapped(::ffff:a.b.c.d)는 풀어서 본다 */
export function isPublicAddress(address: string): boolean {
  const raw = address.startsWith('[') && address.endsWith(']') ? address.slice(1, -1) : address;
  // fe80::1%eth0 같은 영역 표시가 붙은 주소는 링크 로컬이다
  if (raw.includes('%')) return false;
  if (!ipaddr.isValid(raw)) return false;
  let parsed: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    parsed = ipaddr.parse(raw);
  } catch {
    return false;
  }
  if (parsed.kind() === 'ipv6') {
    const v6 = parsed as ipaddr.IPv6;
    if (v6.isIPv4MappedAddress()) return isPublicV4(v6.toIPv4Address());
    // 옛 IPv4-compatible(::a.b.c.d)는 ipaddr가 unicast로 보지만 IPv4로 가는 길이 될 수 있어 막는다
    if (v6.match(IPV4_COMPATIBLE)) return false;
    return v6.range() === 'unicast' && v6.match(GLOBAL_UNICAST_V6);
  }
  return isPublicV4(parsed as ipaddr.IPv4);
}

// ipaddr의 IPv4 분류: unspecified(0/8)·broadcast·multicast·linkLocal(169.254/16)·loopback·carrierGradeNat(100.64/10)·private·reserved(192.0.0/24·문서용·198.18/15·240/4)
const isPublicV4 = (v4: ipaddr.IPv4): boolean => v4.range() === 'unicast';
const GLOBAL_UNICAST_V6 = ipaddr.parseCIDR('2000::/3') as [ipaddr.IPv6, number];
const IPV4_COMPATIBLE = ipaddr.parseCIDR('::/96') as [ipaddr.IPv6, number];

/**
 * 읽지 않을 호스트 (보안 검토): WEB_FETCH_DENY_HOSTS(쉼표 목록, 그 이름과 하위 도메인)와, 이 서버·화면 자신의 호스트
 * (SERVER_PUBLIC_URL·CLIENT_BASE_URL·CORS_ORIGIN에 적힌 주소). 공용 주소로 열린 우리 서버를 모델이 읽게 하지 않는다.
 * 부를 때마다 환경 변수를 읽는다.
 */
export function deniedHostsFromEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  const listed = (env.WEB_FETCH_DENY_HOSTS ?? '').split(',');
  const own = [env.SERVER_PUBLIC_URL, env.CLIENT_BASE_URL, ...(env.CORS_ORIGIN ?? '').split(',')].map((value) => {
    try {
      return value ? new URL(value.trim()).hostname : '';
    } catch {
      return '';
    }
  });
  return [...listed, ...own].map((host) => host.trim().toLowerCase().replace(/^\*?\./, '').replace(/\.$/, '')).filter(Boolean);
}

export function matchesDeniedHost(host: string, denied: readonly string[]): boolean {
  const name = host.toLowerCase().replace(/\.$/, '');
  return denied.some((d) => name === d || name.endsWith(`.${d}`));
}

export const DEFAULT_FETCH_POLICY: FetchPolicy = {
  isAllowedAddress: isPublicAddress,
  allowedPorts: ['', '80', '443'],
  isDeniedHost: (host) => matchesDeniedHost(host, deniedHostsFromEnv()),
};

/** 주소를 읽기 전에 막는 이유. 모델에 그대로 돌려준다 */
export class BlockedUrlError extends Error {}

/**
 * 연결하기 전 주소 확인: http·https만, 허용 포트만, 사용자 정보(user:pass@) 없이, IP를 그대로 적었으면 공용 주소만.
 * 이름은 여기서 풀지 않고 연결할 때 guardedLookup이 확인한다(확인과 연결 사이에 DNS가 바뀌는 것을 막는다).
 */
export function assertFetchableUrl(raw: string, policy: FetchPolicy = DEFAULT_FETCH_POLICY): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BlockedUrlError('주소 형식이 틀렸어요');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new BlockedUrlError('http·https 주소만 읽을 수 있어요');
  if (url.username || url.password) throw new BlockedUrlError('사용자 정보가 들어 있는 주소는 읽지 않아요');
  if (!policy.allowedPorts.includes(url.port)) throw new BlockedUrlError('80·443 포트의 주소만 읽을 수 있어요');
  const host = url.hostname.toLowerCase();
  if (!host) throw new BlockedUrlError('주소에 호스트가 없어요');
  if (policy.isDeniedHost?.(host.startsWith('[') ? host.slice(1, -1) : host)) throw new BlockedUrlError('이 주소는 읽지 않도록 막혀 있어요');
  // WHATWG URL이 2130706433·0x7f.1 같은 IPv4 표기를 127.0.0.1로 바꿔 주므로 바뀐 이름으로 본다
  const literal = host.startsWith('[') ? host.slice(1, -1) : host;
  if (ipaddr.isValid(literal)) {
    if (!policy.isAllowedAddress(literal)) throw new BlockedUrlError('사내망·내부 주소는 읽을 수 없어요');
  } else if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || !host.includes('.')) {
    throw new BlockedUrlError('사내망·내부 주소는 읽을 수 없어요');
  }
  return url;
}

/**
 * 연결에 쓰는 lookup (net·tls의 lookup 옵션). 푼 주소가 하나라도 내부 주소면 연결하지 않는다 (common/net/guarded-lookup.ts).
 */
export function guardedLookup(policy: FetchPolicy = DEFAULT_FETCH_POLICY, resolve: LookupFunction = systemLookup): LookupFunction {
  return guardedLookupOf(policy, resolve);
}

/** 푼 주소 중 연결하면 안 되는 첫 주소. 모두 괜찮으면 null. 페이지 읽기(guardedLookup)와 브라우저(이슈 #373)가 함께 쓴다 */
export function firstBlockedAddress(addresses: readonly string[], policy: FetchPolicy = DEFAULT_FETCH_POLICY): string | null {
  return firstBlockedAddressOf(addresses, policy);
}

/** 연결해도 되는 주소 하나, 또는 막을 이유 */
export type CheckedAddress = { address: string; family: 4 | 6 } | { blocked: string };

/**
 * 이름을 풀어 모든 주소가 공용 주소이면 연결할 주소 하나(IPv4 먼저)를 돌려준다 (브라우저 요청 확인·브라우저 프록시, 이슈 #373).
 * IP를 그대로 적은 이름은 풀지 않고 그 주소를 본다. 프록시는 여기서 확인한 주소로 바로 연결하므로 확인과 연결 사이 틈이 없다.
 */
export function resolvePublicAddress(hostname: string, policy: FetchPolicy = DEFAULT_FETCH_POLICY, resolve: LookupFunction = systemLookup): Promise<CheckedAddress> {
  const literal = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
  if (ipaddr.isValid(literal)) return Promise.resolve(policy.isAllowedAddress(literal) ? { address: literal, family: literal.includes(':') ? 6 : 4 } : { blocked: INTERNAL_ADDRESS });
  return new Promise((done) => {
    resolve(literal, { all: true }, (error, result) => {
      if (error) return done({ blocked: '주소를 찾지 못했어요' });
      const addresses: LookupAddress[] = typeof result === 'string' ? [{ address: result, family: result.includes(':') ? 6 : 4 }] : result;
      if (!addresses.length) return done({ blocked: '주소를 찾지 못했어요' });
      if (firstBlockedAddress(addresses.map((entry) => entry.address), policy) !== null) return done({ blocked: INTERNAL_ADDRESS });
      const first = addresses.find((entry) => entry.family === 4) ?? addresses[0];
      done({ address: first.address, family: first.family === 6 ? 6 : 4 });
    });
  });
}

const INTERNAL_ADDRESS = '사내망·내부 주소는 열 수 없어요';

/** 이름을 푼 주소가 모두 공용 주소인지. 막을 이유를 돌려주고, 괜찮으면 null */
export async function checkHostAddresses(hostname: string, policy: FetchPolicy = DEFAULT_FETCH_POLICY, resolve: LookupFunction = systemLookup): Promise<string | null> {
  const checked = await resolvePublicAddress(hostname, policy, resolve);
  return 'blocked' in checked ? checked.blocked : null;
}
