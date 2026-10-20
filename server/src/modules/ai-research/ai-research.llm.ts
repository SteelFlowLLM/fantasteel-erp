import { LlmJsonParseError, type ChatMessage, type LlmClient, type LlmEndpoint, type LlmJsonSchema } from '../llm/llm.client';
import { LLM_PROFILE } from '../llm/llm-profiles';
import { isRecord, parseLenientJson } from './ai-research.rules';

export const JSON_MAX_TOKENS = 4000;
const RETRY_MAX_TOKENS_CAP = 16000;
const NO_THINK_HINT = '지금은 생각 과정 없이 바로 답만 써요. /no_think';

export const retryMaxTokens = (base: number): number => Math.min(base * 2, RETRY_MAX_TOKENS_CAP);

/** 마지막 user 메시지 끝에 '생각하지 말고 바로 답' 지시를 붙인다 (/no_think는 Qwen 외 모델에는 그냥 글) */
export function withNoThinkHint(messages: ChatMessage[]): ChatMessage[] {
  const index = messages.map((m) => m.role).lastIndexOf('user');
  if (index < 0) return [...messages, { role: 'user', content: NO_THINK_HINT }];
  return messages.map((m, i) => (i === index ? { ...m, content: `${m.content}\n\n${NO_THINK_HINT}` } : m));
}

/**
 * JSON 형식을 강제해 묻고 너그럽게 읽는다(RESEARCH_JSON 프로필): 형식대로 왔으면 그 값, 아니면 답 글·생각 글에서 조건에 맞는 마지막 객체.
 * 그래도 없으면 null (부르는 쪽이 대신값을 쓴다). 연결 실패·시간 초과(LlmRequestError)·끊김은 던진다.
 * 일꾼(조사)과 계획 말로 고치기(이슈 #416)가 함께 쓴다.
 */
export async function askResearchJson(
  llmClient: LlmClient,
  endpoint: LlmEndpoint & { model: string },
  messages: ChatMessage[],
  schema: LlmJsonSchema,
  accept: (v: Record<string, unknown>) => boolean,
  options: { timeoutMs: number; signal?: AbortSignal },
): Promise<Record<string, unknown> | null> {
  const ask = async (msgs: ChatMessage[], maxTokens: number): Promise<{ value: Record<string, unknown> | null; empty: boolean }> => {
    try {
      const reply = await llmClient.chatJsonWithText(endpoint, endpoint.model, msgs, schema, { timeoutMs: options.timeoutMs, maxTokens, profile: LLM_PROFILE.RESEARCH_JSON, signal: options.signal });
      if (isRecord(reply.value) && accept(reply.value)) return { value: reply.value, empty: false };
      return { value: parseLenientJson([reply.rawText, reply.thinking], accept), empty: !reply.rawText.trim() };
    } catch (error) {
      if (error instanceof LlmJsonParseError && !options.signal?.aborted) return { value: parseLenientJson([error.rawText, error.thinking], accept), empty: !error.rawText.trim() };
      throw error;
    }
  };
  const first = await ask(messages, JSON_MAX_TOKENS);
  if (first.value || !first.empty) return first.value;
  // content가 빈 답(생각에 예산을 다 씀)이면 한 번만 더 크게·생각 없이 부탁한다
  return (await ask(withNoThinkHint(messages), retryMaxTokens(JSON_MAX_TOKENS))).value;
}
