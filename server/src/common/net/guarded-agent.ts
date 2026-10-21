import { Agent, fetch as undiciFetch } from 'undici';
import { BLOCKED_LOOKUP_CODE, guardedLookup, type FetchPolicy, type LookupFunction } from '../../modules/ai-assistant/web/ssrf-guard';
import { isBlockedServerAddress } from './server-url';

/**
 * 클라우드 메타데이터 주소만 막는 규칙 (이슈 #497). 웹 페이지 읽기(ssrf-guard의 DEFAULT_FETCH_POLICY)와 달리 사설망·루프백·Tailscale은 허용한다:
 * LLM·음성 서버는 관리자가 넣은 로컬·사내 서버다. 포트 목록은 이 규칙에서 쓰지 않는다.
 */
const METADATA_ONLY_POLICY: FetchPolicy = { isAllowedAddress: (address) => !isBlockedServerAddress(address), allowedPorts: [] };

/**
 * LLM·음성 서버를 부르는 연결용 undici Agent. 이름(localhost·MagicDNS·사내 이름)을 푼 주소가 하나라도 메타데이터 주소(링크 로컬 등)면 연결하지 않는다.
 * 문자열 검사(isBlockedServerHost)는 IP를 그대로 적은 주소만 잡으므로 169.254.169.254.nip.io 같은 이름은 이 lookup이 연결할 때 막는다.
 * IP를 그대로 적은 주소는 lookup을 거치지 않아 요청 전 문자열 검사가 맡는다.
 * options를 주지 않으면 undici 기본 대기 시간(헤더·본문 300초)이라 전역 fetch와 같다. 오래 걸리는 요청은 부르는 쪽이 headersTimeout·bodyTimeout을 맞춘다.
 */
export function createMetadataGuardedAgent(options: Agent.Options = {}, resolve?: LookupFunction): Agent {
  return new Agent({ ...options, connect: { lookup: guardedLookup(METADATA_ONLY_POLICY, resolve) } });
}

/** fetch 실패가 메타데이터 주소를 막은 lookup 때문인지. 연결 오류는 cause·errors로 여러 겹 싸여 오므로 안쪽까지 본다 */
export function isBlockedLookupError(error: unknown, depth = 0): boolean {
  if (depth > 5 || typeof error !== 'object' || error === null) return false;
  if ((error as { code?: unknown }).code === BLOCKED_LOOKUP_CODE) return true;
  const inner = (error as { errors?: unknown }).errors;
  if (Array.isArray(inner) && inner.some((entry) => isBlockedLookupError(entry, depth + 1))) return true;
  return isBlockedLookupError((error as { cause?: unknown }).cause, depth + 1);
}

type UndiciInit = NonNullable<Parameters<typeof undiciFetch>[1]>;

/**
 * LLM·음성 서버를 부르는 fetch. 이 파일의 Agent는 npm undici 8의 것이라 **같은 undici의 fetch로만** 쓸 수 있다:
 * Node에 들어 있는 전역 fetch에 넘기면 Node 22·24에서 UND_ERR_INVALID_ARG로 모든 요청이 실패한다(Node 26만 된다).
 * 본문의 FormData도 undici의 것이어야 한다(전역 FormData를 넘기면 글 "[object FormData]"로 간다).
 * 시험은 `jest.spyOn(netFetch, 'run')`으로 가로챈다.
 */
export const netFetch = {
  run: (url: string, init: UndiciInit): Promise<Response> => undiciFetch(url, init) as unknown as Promise<Response>,
};
