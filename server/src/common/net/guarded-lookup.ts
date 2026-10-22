import { lookup as dnsLookup, type LookupAddress, type LookupOptions } from 'node:dns';

/**
 * 이름을 풀 때 막을 주소를 정하는 규칙 중 lookup이 쓰는 부분. 웹 페이지 읽기(ssrf-guard의 FetchPolicy)와
 * LLM·음성 서버 연결(common/net/guarded-agent.ts의 메타데이터 규칙)이 같은 lookup을 쓴다
 */
export interface AddressPolicy {
  /** 연결해도 되는 IP인지 */
  isAllowedAddress(address: string): boolean;
}

type LookupCallback = (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;
export type LookupFunction = (hostname: string, options: LookupOptions, callback: LookupCallback) => void;

/** 실제 DNS 조회. 시험은 이름을 정해진 주소로 푸는 함수를 넣는다 */
export const systemLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (error, addresses) => callback(error, addresses));
};

/** lookup이 내부 주소라 막았을 때의 오류 코드 */
export const BLOCKED_LOOKUP_CODE = 'EBLOCKED';

/**
 * 연결에 쓰는 lookup (net·tls의 lookup 옵션). 푼 주소가 하나라도 막을 주소면 연결하지 않는다.
 * Node는 autoSelectFamily(기본 켜짐)일 때 all: true로 묻고 배열을 기대하고, 아니면 주소 하나를 기대한다. 둘 다 맞춰 돌려준다.
 */
export function guardedLookup(policy: AddressPolicy, resolve: LookupFunction = systemLookup): LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname, { ...options, all: true }, (error, result) => {
      if (error) return callback(error, options.all ? [] : '');
      const addresses: LookupAddress[] = typeof result === 'string' ? [{ address: result, family: result.includes(':') ? 6 : 4 }] : result;
      if (!addresses.length) return callback(dnsError(hostname, 'ENOTFOUND', '주소를 찾지 못했어요'), options.all ? [] : '');
      if (firstBlockedAddress(addresses.map((entry) => entry.address), policy) !== null) return callback(dnsError(hostname, BLOCKED_LOOKUP_CODE, '사내망·내부 주소는 읽을 수 없어요'), options.all ? [] : '');
      if (options.all) return callback(null, addresses);
      const wanted = options.family === 6 ? 6 : options.family === 4 ? 4 : null;
      const first = addresses.find((entry) => wanted === null || entry.family === wanted) ?? addresses[0];
      return callback(null, first.address, first.family);
    });
  };
}

/** 푼 주소 중 연결하면 안 되는 첫 주소. 모두 괜찮으면 null */
export function firstBlockedAddress(addresses: readonly string[], policy: AddressPolicy): string | null {
  return addresses.find((address) => !policy.isAllowedAddress(address)) ?? null;
}

function dnsError(hostname: string, code: string, message: string): NodeJS.ErrnoException {
  const error: NodeJS.ErrnoException = new Error(`${message} (${hostname})`);
  error.code = code;
  return error;
}
