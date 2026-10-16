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

/** 일시 오류: DB 연결·풀 시간 초과·잠금 시간 초과·직렬화 충돌·교착, 네트워크 끊김. 업무 오류(AppException)는 아니다 */
const TRANSIENT_PRISMA_CODES = new Set(['P1001', 'P1002', 'P1008', 'P1017', 'P2024', 'P2028', 'P2034']);
const TRANSIENT_DB_STATES = ['55P03', '40001', '40P01', '57014'];
const TRANSIENT_NETWORK_CODES = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'EAI_AGAIN']);

export function isTransientError(error: unknown): boolean {
  if (error instanceof AppException) return false;
  if (error instanceof Prisma.PrismaClientKnownRequestError) return TRANSIENT_PRISMA_CODES.has(error.code) || TRANSIENT_DB_STATES.some((state) => error.message.includes(state));
  if (error instanceof Prisma.PrismaClientInitializationError || error instanceof Prisma.PrismaClientRustPanicError) return true;
  if (error instanceof Error) {
    const code = (error as Error & { code?: unknown }).code;
    if (typeof code === 'string' && (TRANSIENT_NETWORK_CODES.has(code) || TRANSIENT_DB_STATES.includes(code))) return true;
    return /lock timeout|could not obtain lock|deadlock detected|connection terminated/i.test(error.message);
  }
  return false;
}

export type RetryResult<T> = { ok: true; value: T; attempts: number } | { ok: false; error: unknown; attempts: number };

/** 허용한 실행을 한다. 일시 오류면 같은 내용으로 2번까지 다시 하고, 그 밖의 실패는 바로 돌려준다(LLM이 내용을 바꿔 다시 하지 않는다) */
export async function runWithTransientRetry<T>(work: () => Promise<T>, delayMs: number = RETRY_DELAY_MS): Promise<RetryResult<T>> {
  for (let attempts = 1; ; attempts += 1) {
    try {
      return { ok: true, value: await work(), attempts };
    } catch (error) {
      if (!isTransientError(error) || attempts > MAX_TRANSIENT_RETRIES) return { ok: false, error, attempts };
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs * attempts));
    }
  }
}
