// 쓰기 도구 호출 규칙 (철강맨AI 승인 카드, 이슈 #362). 모두 정해진 값이다.
import { Prisma } from '../../../generated/prisma/client';
import { AppException } from '../../../common/errors/app.exception';

/** 한 질문에서 인자·사전 확인 실패를 모델이 고칠 수 있는 횟수. 처음 호출까지 3번 */
export const MAX_FIX_ATTEMPTS = 2;
/** 허용 뒤 일시 오류(연결·잠금 시간 초과)면 LLM 없이 같은 내용으로 다시 하는 횟수. 처음까지 3번 */
export const MAX_TRANSIENT_RETRIES = 2;
const RETRY_DELAY_MS = 300;

/** 같은 인자인지 볼 때 키 순서·공백은 무시한다 */
function canonicalArguments(raw: string): string {
  try {
    return JSON.stringify(sortKeys(JSON.parse(raw.trim() || '{}')));
  } catch {
    return raw.trim();
  }
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, sortKeys(v)]));
}

/**
 * 한 질문의 고칠 기회. 인자 형식이나 사전 확인이 틀리면 결과를 모델에 돌려줘 고치게 하는데, 2번까지만 고친다.
 * 실패한 호출과 같은 도구·같은 인자로 다시 부르면 고치지 못하는 것이라 바로 멈춘다.
 */
export class WriteFixBudget {
  private readonly failedCalls = new Set<string>();
  private failures = 0;

  /** 앞에서 실패한 것과 같은 도구·같은 인자인지 */
  isRepeat(name: string, rawArguments: string): boolean {
    return this.failedCalls.has(`${name}:${canonicalArguments(rawArguments)}`);
  }

  /** 실패를 적는다. 아직 고칠 기회가 남았으면 남은 횟수, 다 썼으면 0 */
  fail(name: string, rawArguments: string): number {
    this.failedCalls.add(`${name}:${canonicalArguments(rawArguments)}`);
    this.failures += 1;
    return Math.max(0, MAX_FIX_ATTEMPTS + 1 - this.failures);
  }
}

/**
 * 모델이 인자를 고쳐 다시 부르면 풀리는 실패인지. 형식(COM-004)·없는 대상(COM-003)·필수값(ACT-001)처럼 400·404만이다.
 * 권한 없음(COM-002)·승인권자 없음(PUR-001)·상태 충돌(409)은 모델이 고칠 수 없어 바로 멈추고 사용자에게 알린다.
 */
export function isFixableError(error: AppException): boolean {
  const status = error.getStatus();
  return status === 400 || status === 404;
}

/**
 * 일시 오류의 종류.
 * - SAFE: 쿼리를 보내기 전이거나 DB가 롤백을 보장하는 오류(연결 못 함·풀 시간 초과·직렬화 충돌·교착·잠금 시간 초과). 그대로 다시 해도 된다
 * - AMBIGUOUS: COMMIT 중이나 뒤에도 날 수 있는 오류(연결 끊김·응답 시간 초과·네트워크). 이미 저장됐을 수 있어
 *   같은 승인을 이미 실행했는지 먼저 확인하는(멱등) 실행만 다시 한다
 * 업무 오류(AppException)·버그는 일시 오류가 아니다(null)
 */
export type TransientKind = 'SAFE' | 'AMBIGUOUS';

const SAFE_PRISMA_CODES = new Set(['P1001', 'P2024', 'P2034']);
const SAFE_DB_STATES = ['40001', '40P01', '55P03'];
const AMBIGUOUS_PRISMA_CODES = new Set(['P1002', 'P1008', 'P1017', 'P2028']);
const AMBIGUOUS_NETWORK_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'EPIPE']);
const SAFE_NETWORK_CODES = new Set(['ECONNREFUSED', 'EAI_AGAIN']);

export function transientKind(error: unknown): TransientKind | null {
  if (error instanceof AppException) return null;
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (SAFE_PRISMA_CODES.has(error.code) || SAFE_DB_STATES.some((state) => error.message.includes(state))) return 'SAFE';
    return AMBIGUOUS_PRISMA_CODES.has(error.code) ? 'AMBIGUOUS' : null;
  }
  // 연결을 만들지 못한 것이라 아무것도 보내지 않았다
  if (error instanceof Prisma.PrismaClientInitializationError) return 'SAFE';
  if (error instanceof Error) {
    const code = (error as Error & { code?: unknown }).code;
    if (typeof code === 'string') {
      if (SAFE_DB_STATES.includes(code) || SAFE_NETWORK_CODES.has(code)) return 'SAFE';
      if (AMBIGUOUS_NETWORK_CODES.has(code)) return 'AMBIGUOUS';
    }
    if (/lock timeout|could not obtain lock|deadlock detected|could not serialize access/i.test(error.message)) return 'SAFE';
    if (/connection terminated|connection reset|socket hang up/i.test(error.message)) return 'AMBIGUOUS';
  }
  return null;
}

export const isTransientError = (error: unknown): boolean => transientKind(error) !== null;

export type RetryResult<T> = { ok: true; value: T; attempts: number } | { ok: false; error: unknown; attempts: number };

export interface RetryOptions {
  /** work가 같은 승인을 이미 실행했는지 먼저 확인하는지. 아니면 AMBIGUOUS 오류는 다시 하지 않는다 */
  idempotent: boolean;
  delayMs?: number;
}

/**
 * 허용한 실행을 한다. 일시 오류면 같은 내용으로 2번까지 다시 하고, 그 밖의 실패는 바로 돌려준다(LLM이 내용을 바꿔 다시 하지 않는다).
 * COMMIT 뒤에 났을 수 있는 오류(AMBIGUOUS)는 멱등 실행일 때만 다시 한다 — 두 번 저장되지 않게.
 */
export async function runWithTransientRetry<T>(work: () => Promise<T>, options: RetryOptions): Promise<RetryResult<T>> {
  const delayMs = options.delayMs ?? RETRY_DELAY_MS;
  for (let attempts = 1; ; attempts += 1) {
    try {
      return { ok: true, value: await work(), attempts };
    } catch (error) {
      const kind = transientKind(error);
      const retryable = kind === 'SAFE' || (kind === 'AMBIGUOUS' && options.idempotent);
      if (!retryable || attempts > MAX_TRANSIENT_RETRIES) return { ok: false, error, attempts };
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs * attempts));
    }
  }
}
