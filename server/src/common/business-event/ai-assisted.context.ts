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
