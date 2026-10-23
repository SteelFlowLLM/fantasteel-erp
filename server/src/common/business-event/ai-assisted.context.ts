import { AsyncLocalStorage } from 'node:async_hooks';

const aiAssisted = new AsyncLocalStorage<true>();

/**
 * 이 안에서 기록되는 작업 로그를 모두 'AI 경유'(is_ai_assisted)로 남긴다 (REQ-AST-010).
 * AI 어시스턴트 실행 카드가 기존 업무 service를 그대로 부를 때 쓴다: service가 AI 경유 표시를 받지 못해도 그 거래의 로그가 같이 표시된다.
 * 호출 흐름(await)을 따라가므로 같은 요청의 트랜잭션 안에서만 켜지고, 다른 요청에는 번지지 않는다.
 */
export function runAsAiAssisted<T>(run: () => Promise<T>): Promise<T> {
  return aiAssisted.run(true, run);
}

export const isInAiAssistedRun = (): boolean => aiAssisted.getStore() === true;

const voiceApproved = new AsyncLocalStorage<true>();

/** 말로 승인한 실행 카드의 작업 로그 사유에 붙는 말 (이슈 #457). 사유 코드(`CODE: …`)는 앞에 그대로 둔다 */
export const VOICE_APPROVED_REASON = '철강맨 말로 승인';

/**
 * 이 안에서 기록되는 작업 로그의 사유에 '말로 승인'을 붙인다 (이슈 #457, 철강맨 부르기).
 * 표시가 본 거래와 같은 트랜잭션의 로그에 남도록, 카드를 실행하는 service가 아니라 기록기가 붙인다 (runAsAiAssisted와 같은 방식).
 */
export function runAsVoiceApproved<T>(run: () => Promise<T>): Promise<T> {
  return voiceApproved.run(true, run);
}

export const isInVoiceApprovedRun = (): boolean => voiceApproved.getStore() === true;

/** 말로 승인 안이면 사유 끝에 표시를 붙인다. 밖이면 그대로 */
export function withVoiceApprovedReason(reason: string | null): string | null {
  if (!isInVoiceApprovedRun()) return reason;
  return reason ? `${reason} · ${VOICE_APPROVED_REASON}` : VOICE_APPROVED_REASON;
}
