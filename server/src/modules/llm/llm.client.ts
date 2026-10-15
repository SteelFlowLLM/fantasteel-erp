import { Injectable } from '@nestjs/common';
import type { LlmModelView } from '@fantasteel/shared';

/** 모델 목록은 바로 와야 하고, 첫 대화는 LM Studio가 모델을 메모리에 올리느라 오래 걸릴 수 있다 */
const MODELS_TIMEOUT_MS = 5_000;
const CHAT_TIMEOUT_MS = 120_000;

export interface LlmEndpoint {
  baseUrl: string;
  apiKey: string | null;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** 모델이 부를 수 있는 함수 (OpenAI 호환 tools). parameters는 JSON Schema */
export interface LlmToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface LlmToolCall {
  id: string;
  name: string;
  /** 모델이 만든 JSON 문자열 그대로. 형식이 틀릴 수 있어 부르는 쪽이 검증한다 */
  arguments: string;
}

/** 도구를 쓰는 대화: 모델의 도구 호출과 그 결과(tool)가 끼어든다 */
export type LlmToolMessage =
  | ChatMessage
  | { role: 'assistant'; content: string | null; toolCalls: LlmToolCall[] }
  | { role: 'tool'; toolCallId: string; content: string };

export interface LlmToolReply {
  content: string;
  /** 비어 있으면 모델이 답을 끝낸 것 */
  toolCalls: LlmToolCall[];
}

interface WireToolCall {
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
}

/** 화면에 그대로 보일 연결 실패 이유 */
export class LlmRequestError extends Error {
  constructor(
    message: string,
    /** LLM 서버가 돌려준 HTTP 상태. 연결 실패·시간 초과면 없다 */
    readonly status?: number,
  ) {
    super(message);
  }
}

/** JSON 형식을 강제해 답을 받는 호출의 옵션 */
export interface LlmJsonSchema {
  name: string;
  schema: Record<string, unknown>;
}

export interface LlmJsonOptions {
  timeoutMs: number;
  maxTokens?: number;
}

/**
 * OpenAI 호환 API 호출 (LM Studio 로컬 서버·LM Link, 나중에 API 키를 쓰는 외부 LLM).
 * 브라우저가 아니라 서버가 부르므로 LM Studio의 CORS 설정이 필요 없고, LM Link는 이 서버 컴퓨터에만 연결하면 된다.
 */
@Injectable()
export class LlmClient {
  async listModels(endpoint: LlmEndpoint): Promise<LlmModelView[]> {
    const body = await this.request<{ data?: { id: string; owned_by?: string }[] }>(endpoint, 'GET', '/models', undefined, MODELS_TIMEOUT_MS);
    const details = await this.lmStudioModelDetails(endpoint);
    return (body.data ?? []).map((m) => ({
      id: m.id,
      ownedBy: m.owned_by ?? null,
      type: details.get(m.id)?.type ?? null,
      loaded: details.has(m.id) ? details.get(m.id)?.state === 'loaded' : null,
    }));
  }

  /**
   * LM Studio 고유 API(/api/v0/models)의 모델 종류·로드 상태. 임베딩 모델을 고르지 않게 하고 로드된 모델을 표시하려고 쓴다.
   * OpenAI 호환 API에는 이 정보가 없고 외부 LLM에는 이 경로가 없으므로, 실패하면 빈 값으로 넘어간다.
   */
  private async lmStudioModelDetails(endpoint: LlmEndpoint): Promise<Map<string, { type?: string; state?: string }>> {
    const root = normalizeBaseUrl(endpoint.baseUrl).replace(/\/v1$/, '');
    try {
      const body = await this.request<{ data?: { id: string; type?: string; state?: string }[] }>(
        { ...endpoint, baseUrl: root },
        'GET',
        '/api/v0/models',
        undefined,
        MODELS_TIMEOUT_MS,
      );
      return new Map((body.data ?? []).map((m) => [m.id, { type: m.type, state: m.state }]));
    } catch {
      return new Map();
    }
  }

  /** timeoutMs: 사용자가 답을 기다리는 짧은 작업(Message → ERP 추출)은 기본 120초보다 짧게 준다 */
  async chat(endpoint: LlmEndpoint, model: string, messages: ChatMessage[], maxTokens?: number, timeoutMs = CHAT_TIMEOUT_MS): Promise<string> {
    const body = await this.request<{ choices?: { message?: { content?: string | null } }[] }>(
      endpoint,
      'POST',
      '/chat/completions',
      { model, messages, stream: false, ...(maxTokens === undefined ? {} : { max_tokens: maxTokens }) },
      timeoutMs,
    );
    return body.choices?.[0]?.message?.content?.trim() ?? '';
  }

  /**
   * JSON 스키마로 답 모양을 강제해 받는다 (회의록 AI 분석). 모델이 쓴 값은 믿을 수 없으므로 `unknown`으로 돌려주고 부르는 쪽이 검증한다.
   * 서버가 response_format을 지원하지 않아 400을 주면 형식 강제 없이 한 번 더 부른다(프롬프트가 JSON만 달라고 요구한다).
   */
  async chatJson(endpoint: LlmEndpoint, model: string, messages: ChatMessage[], format: LlmJsonSchema, options: LlmJsonOptions): Promise<unknown> {
    const base = { model, messages, stream: false, temperature: 0, ...(options.maxTokens === undefined ? {} : { max_tokens: options.maxTokens }) };
    type Reply = { choices?: { message?: { content?: string | null; reasoning_content?: string | null } }[] };
    let body: Reply;
    try {
      body = await this.request<Reply>(
        endpoint,
        'POST',
        '/chat/completions',
        { ...base, response_format: { type: 'json_schema', json_schema: { name: format.name, strict: true, schema: format.schema } } },
        options.timeoutMs,
      );
    } catch (error) {
      if (!(error instanceof LlmRequestError) || error.status !== 400) throw error;
      body = await this.request<Reply>(endpoint, 'POST', '/chat/completions', base, options.timeoutMs);
    }
    const message = body.choices?.[0]?.message;
    // LM Studio의 추론 모델은 형식을 강제해도 JSON을 content가 아니라 reasoning_content에 담아 content를 비우기도 한다
    return parseJsonContent(message?.content?.trim() ? message.content : (message?.reasoning_content ?? ''));
  }

  /**
   * 도구를 함께 넘기는 대화 (AI 어시스턴트 데이터 조회). 모델이 도구를 고르면 toolCalls로 돌려주고, 실행은 부르는 쪽이 한다.
   * tools가 비면 도구 없이 답만 받는다(도구 호출 횟수를 다 쓴 뒤 마지막 답).
   */
  async chatWithTools(endpoint: LlmEndpoint, model: string, messages: LlmToolMessage[], tools: LlmToolDefinition[]): Promise<LlmToolReply> {
    const body = await this.request<{ choices?: { message?: { content?: string | null; tool_calls?: WireToolCall[] } }[] }>(
      endpoint,
      'POST',
      '/chat/completions',
      {
        model,
        messages: messages.map(toWireMessage),
        stream: false,
        ...(tools.length ? { tools: tools.map((tool) => ({ type: 'function', function: tool })), tool_choice: 'auto' } : {}),
      },
      CHAT_TIMEOUT_MS,
    );
    const message = body.choices?.[0]?.message;
    const toolCalls = (message?.tool_calls ?? [])
      .filter((call) => call.function?.name)
      .map((call, index) => ({ id: call.id || `call-${index}`, name: call.function?.name ?? '', arguments: call.function?.arguments ?? '{}' }));
    return { content: message?.content?.trim() ?? '', toolCalls };
  }

  private async request<T>(endpoint: LlmEndpoint, method: 'GET' | 'POST', path: string, payload: unknown, timeoutMs: number): Promise<T> {
    const url = `${normalizeBaseUrl(endpoint.baseUrl)}${path}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: {
          ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
          ...(endpoint.apiKey ? { authorization: `Bearer ${endpoint.apiKey}` } : {}),
        },
        body: payload === undefined ? undefined : JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new LlmRequestError(`${timeoutMs / 1000}초 안에 응답이 없어요. LM Studio 서버와 모델 상태를 확인해 주세요`);
      }
      throw new LlmRequestError(`${url}에 연결할 수 없어요. LM Studio의 Developer 탭에서 서버를 켰는지, 주소가 맞는지 확인해 주세요`);
    }
    if (res.status === 401 || res.status === 403) throw new LlmRequestError('API 키가 맞지 않거나 권한이 없어요');
    if (!res.ok) throw new LlmRequestError(`LLM 서버 오류 (HTTP ${res.status}): ${await errorMessageOf(res)}`, res.status);
    try {
      return (await res.json()) as T;
    } catch {
      throw new LlmRequestError('LLM 서버 응답을 읽을 수 없어요. OpenAI 호환 주소(…/v1)가 맞는지 확인해 주세요');
    }
  }
}

function toWireMessage(message: LlmToolMessage): Record<string, unknown> {
  if (message.role === 'tool') return { role: 'tool', tool_call_id: message.toolCallId, content: message.content };
  if (message.role === 'assistant' && 'toolCalls' in message) {
    return {
      role: 'assistant',
      content: message.content,
      tool_calls: message.toolCalls.map((call) => ({ id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments } })),
    };
  }
  return { role: message.role, content: message.content };
}

/** 추론 모델의 <think> 블록과 ```json 울타리를 벗기고 JSON으로 읽는다 */
export function parseJsonContent(content: string): unknown {
  let text = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fenced) text = fenced[1].trim();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new LlmRequestError('AI 응답을 JSON으로 읽지 못했어요');
  }
}

/** 끝의 / 를 떼어 경로를 붙일 수 있게 한다 */
export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

async function errorMessageOf(res: Response): Promise<string> {
  const text = await res.text().catch(() => '');
  try {
    const json = JSON.parse(text) as { error?: string | { message?: string } };
    if (typeof json.error === 'string') return json.error;
    if (json.error?.message) return json.error.message;
  } catch {
    // JSON이 아니면 본문 앞부분을 그대로 보인다
  }
  return text.slice(0, 200) || res.statusText;
}
