import { Injectable, Logger } from '@nestjs/common';
import type { Agent } from 'undici';
import type { LlmModelView, LlmServerKind } from '@fantasteel/shared';
import { createMetadataGuardedAgent, isBlockedLookupError, netFetch } from '../../common/net/guarded-agent';
import { isBlockedServerHost, redactUrl } from '../../common/net/server-url';
import type { LlmProfile, LlmReasoning } from './llm-profiles';

/** 모델 목록은 바로 와야 하고, 첫 대화는 LM Studio가 모델을 메모리에 올리느라 오래 걸릴 수 있다 */
const MODELS_TIMEOUT_MS = 5_000;
const CHAT_TIMEOUT_MS = 120_000;
/** 모델의 생각 설정 지원 여부는 요청마다 묻지 않는다. 모델을 바꾸거나 새로 받으면 이 시간 안에 반영된다 */
const MODEL_INFO_TTL_MS = 60_000;
/** 스트리밍은 전체 시간이 아니라 조각 사이를 잰다: 긴 생각도 조각은 계속 온다 */
const STREAM_IDLE_TIMEOUT_MS = 120_000;
/** reasoning_effort가 받는 단계 (가까운 단계를 고를 때 순서로 쓴다) */
const REASONING_LEVELS = ['minimal', 'low', 'medium', 'high', 'xhigh'] as const;
/** 관리자가 생각 정도 지원을 켰을 때 쓰는 값: 끄기('none')와 단계를 그대로 보낸다 */
const MANUAL_REASONING_OPTIONS = ['off', 'on'] as const;
/** Unsloth Studio의 top_k 상한 (ChatCompletionRequest 스키마) */
const UNSLOTH_TOP_K_MAX = 100;

export interface LlmEndpoint {
  baseUrl: string;
  apiKey: string | null;
  /** 관리자가 AI 연결 화면에서 정한 사진·생각 정도 지원 (LM Studio가 아닐 때만 쓴다). 없거나 null이면 모름 */
  visionSupport?: boolean | null;
  reasoningSupport?: boolean | null;
  /** 관리자가 넣은 문맥 길이(토큰). LM Studio가 아니고 모델 정보가 없을 때만 쓴다 */
  contextLength?: number | null;
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

/** 질문과 함께 보내는 사진 (OpenAI 호환 image_url의 data URL로 보낸다) */
export interface LlmImage {
  mediaType: string;
  dataBase64: string;
}

/** 도구를 쓰는 대화: 모델의 도구 호출과 그 결과(tool)가 끼어든다 */
export type LlmToolMessage =
  | ChatMessage
  | { role: 'user'; content: string; images: LlmImage[] }
  | { role: 'assistant'; content: string | null; toolCalls: LlmToolCall[] }
  | { role: 'tool'; toolCallId: string; content: string };

export interface LlmToolReply {
  content: string;
  /** 비어 있으면 모델이 답을 끝낸 것 */
  toolCalls: LlmToolCall[];
  /** LM Studio 추론 모델이 content와 따로 주는 생각 글. 없으면 비어 있다 */
  reasoning?: string | null;
  /** 기능 설정의 생각 정도를 모델에 보냈는지 (모델이 생각 설정을 받지 않으면 false) */
  reasoningApplied?: boolean;
}

/** 스트리밍으로 받는 글 조각. 답 글 안의 <think> 블록은 생각 글로 넘긴다 */
export interface LlmStreamHandlers {
  onThinking(text: string): void;
  onAnswer(text: string): void;
}

/** JSON 답과 함께 모델이 실제로 쓴 글 (AI 실행 기록) */
export interface LlmJsonReply {
  value: unknown;
  /** JSON을 읽은 원문 (<think> 블록을 뺀 것) */
  rawText: string;
  /** <think> 블록이나 reasoning_content의 생각 글. 없으면 null */
  thinking: string | null;
}

interface WireToolCall {
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
}

/**
 * LLM 실패의 종류. 철강맨AI 등이 오류 코드(AST-002~005)로 나눌 때 쓴다 (이슈 #462).
 * NO_MODEL 모델이 정해지지 않았거나 LLM 서버에 불러와 있지 않음(Unsloth Studio, 이슈 #465) / CONNECT 연결할 수 없음 / TIMEOUT 시간 안에 답이 없음 / SERVER 그 밖(HTTP 오류·API 키·읽을 수 없는 응답)
 */
export type LlmFailureKind = 'NO_MODEL' | 'CONNECT' | 'TIMEOUT' | 'SERVER';

/** 화면에 그대로 보일 연결 실패 이유. 내부 LLM 주소(사설망·Tailscale)는 문구에 넣지 않는다(서버 로그에만 남긴다) */
export class LlmRequestError extends Error {
  constructor(
    message: string,
    /** LLM 서버가 돌려준 HTTP 상태. 연결 실패·시간 초과면 없다 */
    readonly status?: number,
    readonly kind: LlmFailureKind = 'SERVER',
  ) {
    super(message);
  }
}

/** Unsloth Studio에 고른 모델이 불러와 있지 않다 (모델 없음 NO_MODEL → AST-002). 고치는 방법이 문구에 있어 철강맨AI에도 그대로 보인다 */
export class LlmModelNotLoadedError extends LlmRequestError {
  constructor(message: string, status?: number) {
    super(message, status, 'NO_MODEL');
  }
}

/**
 * Unsloth Studio에 모델이 없을 때 화면에 보일 안내. Unsloth는 요청의 model을 보지 않고 불러온 모델로 답하므로
 * 다른 모델이 불러와 있어도 고른 모델로 답하지 않는다 (auto-switch를 켜면 고른 모델을 불러온다)
 */
export function unslothNotLoadedMessage(model: string | null, loaded: readonly string[]): string {
  const fix = 'Unsloth Studio에서 모델을 불러오거나 Settings > API > Model auto-switch를 켜 주세요';
  if (!model || loaded.length === 0) return `Unsloth Studio에 불러온 모델이 없어요. ${fix}`;
  return `고른 모델(${model})이 Unsloth Studio에 불러와 있지 않아요 (지금 불러온 모델: ${loaded.join(', ')}). ${fix}`;
}

/** 부른 쪽(사용자 멈춤)이 요청을 끊었다. 화면에 알릴 실패가 아니다 */
export class LlmAbortedError extends LlmRequestError {
  constructor() {
    super('요청을 멈췄어요');
  }
}

/** 모델이 답은 냈지만 JSON으로 읽지 못함. 실행 기록에 남기려고 원문을 들고 있다 */
export class LlmJsonParseError extends LlmRequestError {
  constructor(
    message: string,
    readonly rawText: string,
    readonly thinking: string | null,
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
  profile: LlmProfile;
  /** 부른 쪽이 끊으면(심층 조사 취소) 요청도 끊고 LlmAbortedError를 던진다 */
  signal?: AbortSignal;
}

/** LM Studio 고유 API(/api/v1/models)가 알려 주는 모델 정보. 외부 LLM이면 서버 전체가 null이다 */
interface LmStudioModelInfo {
  /** 생각 설정을 받는 모델만 있다. 예: ['off', 'on'], ['off', 'low', 'medium', 'xhigh', 'on'] */
  reasoningOptions: string[] | null;
  vision: boolean;
  /** 불러온 인스턴스의 문맥 길이(토큰), 불러오지 않았으면 모델의 최대 문맥 길이. 모르면 null */
  contextLength: number | null;
}

/** Unsloth Studio가 알려 주는 것 (이슈 #465) */
interface UnslothInfo {
  /** /v1/models의 loaded가 true인 모델 id */
  loaded: string[];
  /** Settings > API > Model auto-switch. 못 읽으면 null */
  autoSwitch: boolean | null;
  /**
   * 불러온 모델이 하나일 때 /v1/status가 알려 주는 그 모델의 정보. 없거나 여럿이면 null (status가 어느 모델 것인지 모른다).
   * Unsloth는 한 모델을 별칭(`Qwen3.8-Flash-Next-GGUF`)과 전체 이름(`unsloth/Qwen3.8-Flash-Next-GGUF`)으로 함께 loaded로 줄 수 있어 ids에 모두 둔다
   */
  active: (LmStudioModelInfo & { ids: string[] }) | null;
}

/** 서버 종류와 종류별 모델 정보. 종류마다 하나만 채운다 */
interface LlmServerInfo {
  kind: LlmServerKind;
  lmStudio: Map<string, LmStudioModelInfo> | null;
  unsloth: UnslothInfo | null;
}

/** Unsloth Studio GET /v1/status 중 쓰는 칸 */
interface UnslothStatusWire {
  supports_reasoning?: unknown;
  reasoning_style?: unknown;
  reasoning_effort_levels?: unknown;
  reasoning_always_on?: unknown;
  is_vision?: unknown;
  /** 불러올 때 정한 Context Length. 모델이 받을 수 있는 최대는 max_context_length·native_context_length */
  context_length?: unknown;
  max_context_length?: unknown;
}

/** 모델이 할 수 있는 것. 알 수 없으면 null */
export interface LlmModelCapabilities {
  vision: boolean | null;
  reasoning: boolean | null;
}

/**
 * OpenAI 호환 API 호출 (LM Studio 로컬 서버·LM Link, Unsloth Studio, API 키를 쓰는 외부 LLM).
 * 브라우저가 아니라 서버가 부르므로 LM Studio의 CORS 설정이 필요 없고, LM Link는 이 서버 컴퓨터에만 연결하면 된다.
 */
@Injectable()
export class LlmClient {
  private readonly logger = new Logger(LlmClient.name);
  /** 이름을 푼 주소가 클라우드 메타데이터면 연결하지 않는 연결용 Agent. 처음 부를 때 만들고 계속 쓴다 (대기 시간은 undici 기본 300초로 전역 fetch와 같다) */
  private guardedAgent: Agent | undefined;
  private readonly serverInfoCache = new Map<string, { at: number; info: LlmServerInfo }>();
  /** Unsloth Studio의 모델별 사진 지원·임베딩 여부 (/api/models/check-vision·check-embedding). 열쇠는 `경로|서버 루트|모델` */
  private readonly unslothCheckCache = new Map<string, { at: number; value: boolean | null }>();

  async listModels(endpoint: LlmEndpoint): Promise<LlmModelView[]> {
    const body = await this.request<{ data?: { id: string; owned_by?: string; loaded?: unknown }[] }>(endpoint, 'GET', '/models', undefined, MODELS_TIMEOUT_MS);
    // 연결 확인은 새로 받은 모델 정보를 보여야 하므로 기억해 둔 값을 쓰지 않는다
    const server = await this.serverInfo(endpoint, { refresh: true });
    const details = server.kind === 'lmstudio' ? await this.lmStudioModelDetails(endpoint) : new Map<string, { type?: string; state?: string }>();
    // Unsloth는 /v1/models에 종류가 없어 모델마다 임베딩인지 묻는다 (임베딩 모델을 고르지 않게)
    const unslothTypes = server.unsloth
      ? new Map(
          await Promise.all(
            (body.data ?? []).map(async (m) => {
              const embedding = await this.unslothCheck(endpoint, 'check-embedding', 'is_embedding', m.id);
              return [m.id, embedding === null ? null : embedding ? 'embeddings' : 'llm'] as const;
            }),
          ),
        )
      : null;
    return (body.data ?? []).map((m) => ({
      id: m.id,
      ownedBy: m.owned_by ?? null,
      type: unslothTypes?.get(m.id) ?? details.get(m.id)?.type ?? null,
      loaded: server.unsloth ? m.loaded === true : details.has(m.id) ? details.get(m.id)?.state === 'loaded' : null,
      reasoning: server.lmStudio ? reasoningSupported(findModelInfo(server.lmStudio, m.id)) : reasoningSupported(unslothActive(server, m.id)),
      contextLength: (server.lmStudio ? findModelInfo(server.lmStudio, m.id)?.contextLength : unslothActive(server, m.id)?.contextLength) ?? null,
    }));
  }

  /** 기억해 둔 서버·모델 정보를 버린다 (연결 확인·설정 저장 때: Unsloth에서 모델을 바꾼 직후 옛 정보로 부르지 않게) */
  forgetServerInfo(): void {
    this.serverInfoCache.clear();
    this.unslothCheckCache.clear();
  }

  /** 서버 종류와 Unsloth auto-switch (연결 확인 결과에 싣는다). listModels 바로 뒤에 부르면 다시 묻지 않는다 */
  async serverSummary(endpoint: LlmEndpoint): Promise<{ kind: LlmServerKind; autoSwitch: boolean | null }> {
    const server = await this.serverInfo(endpoint);
    return { kind: server.kind, autoSwitch: server.unsloth?.autoSwitch ?? null };
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
  async chat(endpoint: LlmEndpoint, model: string, messages: ChatMessage[], profile: LlmProfile, maxTokens?: number, timeoutMs = CHAT_TIMEOUT_MS): Promise<string> {
    const body = await this.request<{ choices?: { message?: { content?: string | null } }[] }>(
      endpoint,
      'POST',
      '/chat/completions',
      { model, messages, stream: false, ...(await this.profileFields(endpoint, model, profile)).fields, ...(maxTokens === undefined ? {} : { max_tokens: maxTokens }) },
      timeoutMs,
    );
    return body.choices?.[0]?.message?.content?.trim() ?? '';
  }

  /**
   * 긴 글 답 (심층 조사 보고서, 이슈 #378). 길이 상한에 걸려 끊겼는지(finish_reason=length)와 생각 글을 함께 돌려준다.
   * 닫히지 않은 <think>만 있으면 답 글이 비고 끊긴 것으로 본다.
   */
  async chatText(endpoint: LlmEndpoint, model: string, messages: ChatMessage[], options: LlmJsonOptions): Promise<{ text: string; thinking: string | null; truncated: boolean }> {
    type Reply = { choices?: { finish_reason?: string | null; message?: { content?: string | null; reasoning_content?: string | null } }[] };
    const body = await this.request<Reply>(
      endpoint,
      'POST',
      '/chat/completions',
      { model, messages, stream: false, ...(await this.profileFields(endpoint, model, options.profile)).fields, ...(options.maxTokens === undefined ? {} : { max_tokens: options.maxTokens }) },
      options.timeoutMs,
      options.signal,
    );
    const choice = body.choices?.[0];
    const split = splitThinking(choice?.message?.content ?? '');
    const thinking = [choice?.message?.reasoning_content?.trim() || null, split.thinking].filter((t): t is string => Boolean(t)).join('\n\n') || null;
    return { text: split.text, thinking, truncated: choice?.finish_reason === 'length' };
  }

  /**
   * JSON 스키마로 답 모양을 강제해 받는다 (회의록 AI 분석). 모델이 쓴 값은 믿을 수 없으므로 `unknown`으로 돌려주고 부르는 쪽이 검증한다.
   * 서버가 response_format을 지원하지 않아 400을 주면 형식 강제 없이 한 번 더 부른다(프롬프트가 JSON만 달라고 요구한다).
   */
  async chatJson(endpoint: LlmEndpoint, model: string, messages: ChatMessage[], format: LlmJsonSchema, options: LlmJsonOptions): Promise<unknown> {
    return (await this.chatJsonWithText(endpoint, model, messages, format, options)).value;
  }

  /** chatJson과 같고, 모델이 쓴 원문과 생각 글도 돌려준다 (회의록 AI 실행 기록) */
  async chatJsonWithText(endpoint: LlmEndpoint, model: string, messages: ChatMessage[], format: LlmJsonSchema, options: LlmJsonOptions): Promise<LlmJsonReply> {
    const base = {
      model,
      messages,
      stream: false,
      ...(await this.profileFields(endpoint, model, options.profile)).fields,
      ...(options.maxTokens === undefined ? {} : { max_tokens: options.maxTokens }),
    };
    type Reply = { choices?: { message?: { content?: string | null; reasoning_content?: string | null } }[] };
    let body: Reply;
    try {
      body = await this.request<Reply>(
        endpoint,
        'POST',
        '/chat/completions',
        { ...base, response_format: { type: 'json_schema', json_schema: { name: format.name, strict: true, schema: format.schema } } },
        options.timeoutMs,
        options.signal,
      );
    } catch (error) {
      // 모델 없음(Unsloth No model loaded)은 형식을 바꿔 다시 불러도 소용없다
      if (!(error instanceof LlmRequestError) || error.status !== 400 || error.kind === 'NO_MODEL') throw error;
      body = await this.request<Reply>(endpoint, 'POST', '/chat/completions', base, options.timeoutMs, options.signal);
    }
    const message = body.choices?.[0]?.message;
    // LM Studio의 추론 모델은 형식을 강제해도 JSON을 content가 아니라 reasoning_content에 담아 content를 비우기도 한다
    const fromContent = Boolean(message?.content?.trim());
    const split = splitThinking(fromContent ? (message?.content ?? '') : (message?.reasoning_content ?? ''));
    const reasoning = fromContent ? message?.reasoning_content?.trim() || null : null;
    const thinking = [reasoning, split.thinking].filter((t): t is string => Boolean(t)).join('\n\n') || null;
    try {
      return { value: parseJsonText(split.text), rawText: split.text, thinking };
    } catch (error) {
      if (error instanceof LlmRequestError) throw new LlmJsonParseError(error.message, split.text, thinking);
      throw error;
    }
  }

  /**
   * 도구를 함께 넘기는 대화 (AI 어시스턴트 데이터 조회). 모델이 도구를 고르면 toolCalls로 돌려주고, 실행은 부르는 쪽이 한다.
   * tools가 비면 도구 없이 답만 받는다(도구 호출 횟수를 다 쓴 뒤 마지막 답).
   */
  async chatWithTools(endpoint: LlmEndpoint, model: string, messages: LlmToolMessage[], tools: LlmToolDefinition[], profile: LlmProfile): Promise<LlmToolReply> {
    const profiled = await this.profileFields(endpoint, model, profile);
    const body = await this.request<{ choices?: { message?: { content?: string | null; reasoning_content?: string | null; tool_calls?: WireToolCall[] } }[] }>(
      endpoint,
      'POST',
      '/chat/completions',
      {
        model,
        messages: messages.map(toWireMessage),
        stream: false,
        ...profiled.fields,
        ...toolFields(tools),
      },
      CHAT_TIMEOUT_MS,
    );
    const message = body.choices?.[0]?.message;
    const toolCalls = (message?.tool_calls ?? [])
      .filter((call) => call.function?.name)
      .map((call, index) => ({ id: call.id || `call-${index}`, name: call.function?.name ?? '', arguments: call.function?.arguments ?? '{}' }));
    return { content: message?.content?.trim() ?? '', toolCalls, reasoning: message?.reasoning_content?.trim() || null, reasoningApplied: profiled.reasoningApplied };
  }

  /**
   * chatWithTools와 같고, 생각 글·답 글을 오는 대로 handlers에 넘긴다 (AI 어시스턴트 실시간 표시).
   * signal이 끊기면(사용자가 멈춤) LLM 요청도 끊고 LlmAbortedError를 던진다.
   */
  async streamWithTools(
    endpoint: LlmEndpoint,
    model: string,
    messages: LlmToolMessage[],
    tools: LlmToolDefinition[],
    profile: LlmProfile,
    handlers: LlmStreamHandlers,
    signal?: AbortSignal,
  ): Promise<LlmToolReply> {
    const profiled = await this.profileFields(endpoint, model, profile);
    const idle = new AbortController();
    let timer = setTimeout(() => idle.abort(idleTimeout()), STREAM_IDLE_TIMEOUT_MS);
    const resetTimer = () => {
      clearTimeout(timer);
      timer = setTimeout(() => idle.abort(idleTimeout()), STREAM_IDLE_TIMEOUT_MS);
    };
    const combined = signal ? AbortSignal.any([signal, idle.signal]) : idle.signal;
    const payload = { model, messages: messages.map(toWireMessage), stream: true, ...profiled.fields, ...toolFields(tools) };

    let content = '';
    let reasoning = '';
    const calls = new Map<number, { id?: string; name: string; arguments: string }>();
    const splitter = createThinkSplitter(handlers);
    const onData = (data: string) => {
      if (data === '[DONE]') return;
      let chunk: StreamChunk;
      try {
        chunk = JSON.parse(data) as StreamChunk;
      } catch {
        return;
      }
      if (chunk.error) throw new LlmRequestError(`LLM 서버 오류: ${typeof chunk.error === 'string' ? chunk.error : (chunk.error.message ?? '알 수 없음')}`);
      const delta = chunk.choices?.[0]?.delta;
      if (!delta) return;
      if (delta.reasoning_content) {
        reasoning += delta.reasoning_content;
        handlers.onThinking(delta.reasoning_content);
      }
      if (delta.content) {
        content += delta.content;
        splitter.push(delta.content);
      }
      for (const call of delta.tool_calls ?? []) {
        const index = call.index ?? 0;
        const entry = calls.get(index) ?? { name: '', arguments: '' };
        if (call.id) entry.id = call.id;
        if (call.function?.name) entry.name += call.function.name;
        if (call.function?.arguments) entry.arguments += call.function.arguments;
        calls.set(index, entry);
      }
    };

    try {
      const res = await this.send(endpoint, 'POST', '/chat/completions', payload, combined, STREAM_IDLE_TIMEOUT_MS);
      const reader = res.body?.getReader();
      if (!reader) throw new LlmRequestError('LLM 서버 응답을 읽을 수 없어요. OpenAI 호환 주소(…/v1)가 맞는지 확인해 주세요');
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read().catch((error: unknown) => {
          throw readError(error, combined, STREAM_IDLE_TIMEOUT_MS);
        });
        if (done) break;
        resetTimer();
        buffer += decoder.decode(value, { stream: true });
        for (let newline = buffer.indexOf('\n'); newline >= 0; newline = buffer.indexOf('\n')) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (line.startsWith('data:')) onData(line.slice(5).trim());
        }
      }
      const rest = (buffer + decoder.decode()).trim();
      if (rest.startsWith('data:')) onData(rest.slice(5).trim());
      splitter.flush();
    } finally {
      clearTimeout(timer);
    }

    const toolCalls = [...calls.entries()]
      .sort(([a], [b]) => a - b)
      .filter(([, call]) => call.name)
      .map(([index, call]) => ({ id: call.id || `call-${index}`, name: call.name, arguments: call.arguments || '{}' }));
    return { content: content.trim(), toolCalls, reasoning: reasoning.trim() || null, reasoningApplied: profiled.reasoningApplied };
  }

  /**
   * 기능별 샘플링 값과 생각 정도를 요청 필드로 바꾼다.
   * top_k·min_p·반복 벌점은 OpenAI 표준에 없어 외부 LLM이 거절할 수 있으므로 LM Studio(repeat_penalty)·Unsloth Studio(repetition_penalty)일 때만 보낸다.
   * 생각 설정을 모르는 모델에 reasoning_effort를 보내면 무시되거나 오류가 나므로, 모델이 받는다고 알렸거나 관리자가 지원한다고 정한 때만 보낸다.
   * Unsloth Studio는 고른 모델이 불러와 있지 않으면 부르기 전에 모델 없음(NO_MODEL) 오류를 던진다 (다른 모델로 답하지 않게).
   */
  private async profileFields(endpoint: LlmEndpoint, model: string, profile: LlmProfile): Promise<{ fields: Record<string, unknown>; reasoningApplied: boolean }> {
    const server = await this.readyServerInfo(endpoint, model);
    const s = profile.sampling;
    const effort = reasoningEffortFor(profile.reasoning, reasoningOptionsOf(server, endpoint, model));
    return {
      fields: {
        temperature: s.temperature,
        top_p: s.topP,
        presence_penalty: s.presencePenalty,
        ...(server.kind === 'lmstudio' ? { top_k: s.topK, min_p: s.minP, repeat_penalty: s.repeatPenalty } : {}),
        ...(server.kind === 'unsloth' ? { top_k: Math.min(s.topK, UNSLOTH_TOP_K_MAX), min_p: s.minP, repetition_penalty: s.repeatPenalty } : {}),
        ...(effort ? { reasoning_effort: effort } : {}),
        // Unsloth는 생각 켜기·끄기를 enable_thinking으로 받는 모델이 있다 (reasoning_style: enable_thinking)
        ...(effort && server.kind === 'unsloth' ? { enable_thinking: effort !== 'none' } : {}),
      },
      reasoningApplied: profile.reasoning === null || effort !== null,
    };
  }

  /**
   * Unsloth Studio(auto-switch 꺼짐)에 고른 모델이 없으면 알기 쉬운 이유로 막는다. 기억해 둔 정보가 '없음'이면
   * 그사이 불러왔을 수 있어 한 번 다시 묻는다. auto-switch를 못 읽었으면 막지 않고 서버의 400을 바꿔 보인다.
   */
  private async readyServerInfo(endpoint: LlmEndpoint, model: string): Promise<LlmServerInfo> {
    const notReady = (info: LlmServerInfo) => info.unsloth !== null && info.unsloth.autoSwitch === false && !info.unsloth.loaded.includes(model);
    let server = await this.serverInfo(endpoint);
    if (!notReady(server)) return server;
    server = await this.serverInfo(endpoint, { refresh: true });
    if (notReady(server)) throw new LlmModelNotLoadedError(unslothNotLoadedMessage(model, server.unsloth?.loaded ?? []));
    return server;
  }

  /**
   * 사진·생각 설정 지원 여부 (화면이 버튼을 켜고 끄는 데 쓴다).
   * LM Studio는 모델 정보만, Unsloth Studio는 모델 정보(불러온 모델: /v1/status, 안 불러온 모델의 사진: check-vision)가 먼저이고 모르면 관리자 설정,
   * 그 밖의 OpenAI 호환 서버는 관리자 설정만 쓴다.
   */
  async modelCapabilities(endpoint: LlmEndpoint, model: string): Promise<LlmModelCapabilities> {
    const server = await this.serverInfo(endpoint);
    if (server.lmStudio) {
      const info = findModelInfo(server.lmStudio, model);
      return info ? { vision: info.vision, reasoning: reasoningSupported(info) } : { vision: null, reasoning: null };
    }
    const manual = { vision: endpoint.visionSupport ?? null, reasoning: endpoint.reasoningSupport ?? null };
    if (!server.unsloth) return manual;
    const active = unslothActive(server, model);
    return {
      // 불러온 모델은 실제로 불러온 상태(mmproj 포함)를 아는 status가 먼저. check-vision은 불러오지 않은 GGUF를 false로 볼 때가 있다
      vision: active ? active.vision : ((await this.unslothCheck(endpoint, 'check-vision', 'is_vision', model)) ?? manual.vision),
      reasoning: active ? reasoningSupported(active) : manual.reasoning,
    };
  }

  /** Unsloth Studio가 이 모델을 사진 모델·임베딩 모델로 보는지 (불러오지 않아도 답한다). 못 읽으면 null */
  private async unslothCheck(endpoint: LlmEndpoint, path: 'check-vision' | 'check-embedding', field: 'is_vision' | 'is_embedding', model: string): Promise<boolean | null> {
    const root = normalizeBaseUrl(endpoint.baseUrl).replace(/\/v1$/, '');
    const key = `${path}|${root}|${model}`;
    const cached = this.unslothCheckCache.get(key);
    if (cached && Date.now() - cached.at < MODEL_INFO_TTL_MS) return cached.value;
    const value = await this.request<Record<string, unknown>>({ ...endpoint, baseUrl: root }, 'GET', `/api/models/${path}/${encodeURIComponent(model)}`, undefined, MODELS_TIMEOUT_MS)
      .then((body) => (typeof body[field] === 'boolean' ? (body[field] as boolean) : null))
      .catch(() => null);
    this.unslothCheckCache.set(key, { at: Date.now(), value });
    return value;
  }

  /**
   * LM Studio가 알려 주는 이 모델의 문맥 길이(토큰). 불러온 인스턴스의 값(여럿이면 가장 작은 것)이 먼저, 없으면 최대 문맥 길이.
   * 외부 LLM·옛 LM Studio·모르는 모델이면 null (심층 조사가 프롬프트 글자 수를 정할 때 쓴다, 이슈 #384)
   */
  async modelContextLength(endpoint: LlmEndpoint, model: string): Promise<number | null> {
    const server = await this.serverInfo(endpoint);
    if (server.lmStudio) return findModelInfo(server.lmStudio, model)?.contextLength ?? null;
    // Unsloth는 불러온 모델의 Context Length가 먼저, 모르면(외부 LLM 포함) 관리자가 넣은 값
    return unslothActive(server, model)?.contextLength ?? (positiveInt(endpoint.contextLength) ? endpoint.contextLength : null);
  }

  /**
   * 서버 종류와 모델 정보. LM Studio 고유 API가 답하면 LM Studio, 아니면 /v1/status가 Unsloth 모양이면 Unsloth Studio, 둘 다 아니면 외부 LLM.
   * 실패(외부 LLM, /api/v1이 없는 옛 LM Studio)도 잠시 기억해 요청마다 다시 묻지 않는다
   */
  private async serverInfo(endpoint: LlmEndpoint, { refresh = false } = {}): Promise<LlmServerInfo> {
    const root = normalizeBaseUrl(endpoint.baseUrl).replace(/\/v1$/, '');
    const cached = this.serverInfoCache.get(root);
    if (!refresh && cached && Date.now() - cached.at < MODEL_INFO_TTL_MS) return cached.info;
    const lmStudio = await this.lmStudioModelInfo(endpoint, root);
    const unsloth = lmStudio ? null : await this.unslothInfo(endpoint, root);
    const info: LlmServerInfo = { kind: lmStudio ? 'lmstudio' : unsloth ? 'unsloth' : 'openai', lmStudio, unsloth };
    this.serverInfoCache.set(root, { at: Date.now(), info });
    return info;
  }

  /** Unsloth Studio의 불러온 모델·auto-switch·불러온 모델 정보. /v1/status가 Unsloth 모양이 아니면 null */
  private async unslothInfo(endpoint: LlmEndpoint, root: string): Promise<UnslothInfo | null> {
    const status = await this.request<UnslothStatusWire>(endpoint, 'GET', '/status', undefined, MODELS_TIMEOUT_MS).catch(() => null);
    if (!status || typeof status.supports_reasoning !== 'boolean' || typeof status.reasoning_style !== 'string') return null;
    const models = await this.request<{ data?: { id: string; loaded?: unknown }[] }>(endpoint, 'GET', '/models', undefined, MODELS_TIMEOUT_MS).catch(() => ({ data: [] }));
    const loaded = (models.data ?? []).filter((m) => m.loaded === true).map((m) => m.id);
    const autoSwitch = await this.request<{ enabled?: unknown }>({ ...endpoint, baseUrl: root }, 'GET', '/api/settings/openai-auto-switch', undefined, MODELS_TIMEOUT_MS)
      .then((body) => (typeof body.enabled === 'boolean' ? body.enabled : null))
      .catch(() => null);
    const active =
      loaded.length > 0 && new Set(loaded.map(unslothBaseName)).size === 1
        ? { ids: loaded, reasoningOptions: unslothReasoningOptions(status), vision: status.is_vision === true, contextLength: unslothContextLength(status) }
        : null;
    return { loaded, autoSwitch, active };
  }

  /** LM Studio 고유 API(/api/v1/models)의 모델 정보. LM Studio가 아니면 null */
  private async lmStudioModelInfo(endpoint: LlmEndpoint, root: string): Promise<Map<string, LmStudioModelInfo> | null> {
    let models: Map<string, LmStudioModelInfo> | null;
    try {
      type Wire = {
        models?: {
          key: string;
          variants?: string[];
          max_context_length?: number;
          loaded_instances?: { config?: { context_length?: number } }[];
          capabilities?: { vision?: boolean; reasoning?: { allowed_options?: string[] } };
        }[];
      };
      const body = await this.request<Wire>({ ...endpoint, baseUrl: root }, 'GET', '/api/v1/models', undefined, MODELS_TIMEOUT_MS);
      models = Array.isArray(body.models) ? new Map() : null;
      for (const m of body.models ?? []) {
        const info = { reasoningOptions: m.capabilities?.reasoning?.allowed_options ?? null, vision: m.capabilities?.vision === true, contextLength: contextLengthOf(m) };
        for (const id of [m.key, ...(m.variants ?? [])]) models?.set(id, info);
      }
    } catch {
      models = null;
    }
    return models;
  }

  private async request<T>(endpoint: LlmEndpoint, method: 'GET' | 'POST', path: string, payload: unknown, timeoutMs: number, abort?: AbortSignal): Promise<T> {
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = abort ? AbortSignal.any([abort, timeout]) : timeout;
    const res = await this.send(endpoint, method, path, payload, signal, timeoutMs);
    try {
      return (await res.json()) as T;
    } catch {
      if (abort?.aborted) throw new LlmAbortedError();
      throw new LlmRequestError('LLM 서버 응답을 읽을 수 없어요. OpenAI 호환 주소(…/v1)가 맞는지 확인해 주세요');
    }
  }

  /** 요청을 보내고 상태 코드까지 확인한다. 본문은 부르는 쪽이 JSON이나 스트림으로 읽는다 */
  private async send(endpoint: LlmEndpoint, method: 'GET' | 'POST', path: string, payload: unknown, signal: AbortSignal, timeoutMs: number): Promise<Response> {
    const url = `${normalizeBaseUrl(endpoint.baseUrl)}${path}`;
    // 저장할 때 막지만, 이 검사 전에 저장된 주소·.env 주소도 클라우드 메타데이터로는 요청을 보내지 않는다 (이슈 #497)
    if (isBlockedServerHost(url)) {
      this.logger.warn(`LLM 주소가 링크 로컬·클라우드 메타데이터라 요청하지 않았어요: ${redactUrl(url)}`);
      throw new LlmRequestError('AI 연결 설정의 주소는 AI 서버로 쓸 수 없는 주소(링크 로컬·클라우드 메타데이터)예요. 주소를 바꿔 주세요', undefined, 'CONNECT');
    }
    let res: Response;
    try {
      res = await netFetch.run(url, {
        method,
        headers: {
          ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
          ...(endpoint.apiKey ? { authorization: `Bearer ${endpoint.apiKey}` } : {}),
        },
        body: payload === undefined ? undefined : JSON.stringify(payload),
        // 리다이렉트로 메타데이터 같은 다른 곳에 키·질문이 가지 않게 한다 (음성 서버 호출과 같다)
        redirect: 'error',
        // 이름이 메타데이터 주소로 풀려도 연결하지 않는다 (이슈 #497)
        dispatcher: (this.guardedAgent ??= createMetadataGuardedAgent()),
        signal,
      });
    } catch (error) {
      const known = readError(error, signal, timeoutMs);
      if (known instanceof LlmRequestError) throw known;
      if (isBlockedLookupError(error)) {
        this.logger.warn(`LLM 주소의 이름이 링크 로컬·클라우드 메타데이터 주소로 풀려 연결하지 않았어요: ${redactUrl(url)}`);
        throw new LlmRequestError('AI 연결 설정의 주소가 가리키는 곳은 AI 서버로 쓸 수 없는 주소(링크 로컬·클라우드 메타데이터)예요. 주소를 바꿔 주세요', undefined, 'CONNECT');
      }
      // 내부 LLM 주소(사설망·Tailscale)는 사용자에게 가는 문구에 넣지 않고 서버 로그에만 남긴다 (이슈 #497)
      this.logger.warn(`LLM 서버에 연결할 수 없어요: ${redactUrl(url)}${causeCodeOf(error)}`);
      throw new LlmRequestError('LLM 서버에 연결할 수 없어요. LLM 서버(LM Studio의 Developer 탭 서버, Unsloth Studio)를 켰는지, 설정한 주소가 맞는지 확인해 주세요', undefined, 'CONNECT');
    }
    if (res.status === 401 || res.status === 403) throw new LlmRequestError('API 키가 맞지 않거나 권한이 없어요');
    if (!res.ok) {
      const message = await errorMessageOf(res);
      // Unsloth Studio: "No model loaded. Call POST /inference/load first. Or enable Model auto-switch …"
      if (res.status === 400 && /no model loaded/i.test(message)) throw new LlmModelNotLoadedError(unslothNotLoadedMessage(null, []), res.status);
      throw new LlmRequestError(`LLM 서버 오류 (HTTP ${res.status}): ${message}`, res.status);
    }
    return res;
  }
}

/** OpenAI 호환 스트리밍의 한 조각 (data: 줄의 JSON) */
interface StreamChunk {
  choices?: { delta?: { content?: string | null; reasoning_content?: string | null; tool_calls?: (WireToolCall & { index?: number })[] } }[];
  error?: string | { message?: string };
}

function toolFields(tools: LlmToolDefinition[]): Record<string, unknown> {
  return tools.length ? { tools: tools.map((tool) => ({ type: 'function', function: tool })), tool_choice: 'auto' } : {};
}

function idleTimeout(): DOMException {
  return new DOMException('stream idle', 'TimeoutError');
}

/**
 * fetch 실패의 원인(error.cause)을 서버 로그에 덧붙일 글로: 원인 코드(예: ECONNREFUSED), 코드가 없으면 원인 글.
 * 리다이렉트 거절(redirect: 'error')은 코드 없는 Error('unexpected redirect')라 글이 있어야 이유가 남는다. 없으면 빈 글
 */
function causeCodeOf(error: unknown): string {
  // instanceof Error는 쓰지 않는다: 다른 실행 공간(jest 등)에서 온 오류는 Error가 아니라고 나온다
  const cause = typeof error === 'object' && error !== null ? (error as { cause?: unknown }).cause : undefined;
  if (typeof cause !== 'object' || cause === null) return '';
  const { code, message } = cause as { code?: unknown; message?: unknown };
  if (typeof code === 'string') return ` (${code})`;
  return typeof message === 'string' && message ? ` (${message})` : '';
}

/** fetch·읽기 실패를 화면에 보일 이유로 바꾼다. 시간 초과·멈춤이 아니면 원래 오류를 돌려준다 */
function readError(error: unknown, signal: AbortSignal, timeoutMs: number): unknown {
  if (error instanceof LlmRequestError) return error;
  const reason: unknown = signal.aborted ? signal.reason : error;
  if (reason instanceof Error && reason.name === 'TimeoutError') {
    return new LlmRequestError(`${timeoutMs / 1000}초 안에 응답이 없어요. LLM 서버(LM Studio·Unsloth Studio)와 모델 상태를 확인해 주세요`, undefined, 'TIMEOUT');
  }
  if (signal.aborted) return new LlmAbortedError();
  return error;
}

/**
 * 답 글 조각 안의 <think>…</think>를 생각 글로 넘긴다. 태그가 조각 사이에서 잘려 와도 맞게 나누도록
 * 태그의 앞부분일 수 있는 끝 글자는 다음 조각이 올 때까지 들고 있는다.
 * 여는 태그 없이 닫는 태그만 오는 모델은 그 앞 글이 이미 답으로 나갔으므로 태그만 지운다 (최종 답은 done에서 다시 다듬는다).
 */
export function createThinkSplitter(handlers: LlmStreamHandlers): { push(text: string): void; flush(): void } {
  const inner = createTagSplitter(handlers);
  // Gemma 4 계열은 생각 구간을 <|channel>thought … <channel|>로 감싸는데, LM Studio가 표시만 남기고 보낼 때가 있다.
  // 닫는 표시는 </think>로 바꿔 앞 글을 생각으로 보내고, 여는 표시는 지운다.
  // 짧은 <|channel>까지 지우면 글자가 하나씩 올 때 뒤의 thought가 남으므로 스트리밍에서는 전체 표시만 바꾼다
  const markers = createMarkerRewriter([
    [GEMMA_CHANNEL_OPEN, ''],
    [GEMMA_CHANNEL_CLOSE, '</think>'],
  ]);
  return {
    push(text) {
      inner.push(markers.push(text));
    },
    flush() {
      inner.push(markers.flush());
      inner.flush();
    },
  };
}

const GEMMA_CHANNEL_OPEN = '<|channel>thought';
const GEMMA_CHANNEL_OPEN_BARE = '<|channel>';
const GEMMA_CHANNEL_CLOSE = '<channel|>';

/** 조각 사이에서 잘려 올 수 있는 고정 표시를 다른 글로 바꾼다. 표시의 앞부분일 수 있는 끝 글자는 다음 조각까지 들고 있는다 */
export function createMarkerRewriter(rules: readonly (readonly [string, string])[]): { push(text: string): string; flush(): string } {
  const ordered = [...rules].sort((a, b) => b[0].length - a[0].length);
  let pending = '';
  const rewrite = (text: string) => ordered.reduce((out, [from, to]) => out.split(from).join(to), text);
  const holdFrom = (text: string) => {
    let hold = text.length;
    for (const [from] of ordered) {
      for (let size = Math.min(from.length - 1, text.length); size > 0; size -= 1) {
        if (from.startsWith(text.slice(-size))) {
          hold = Math.min(hold, text.length - size);
          break;
        }
      }
    }
    return hold;
  };
  return {
    push(text) {
      const joined = rewrite(pending + text);
      const cut = holdFrom(joined);
      pending = joined.slice(cut);
      return joined.slice(0, cut);
    },
    flush() {
      const rest = rewrite(pending);
      pending = '';
      return rest;
    },
  };
}

function createTagSplitter(handlers: LlmStreamHandlers): { push(text: string): void; flush(): void } {
  const OPEN = '<think>';
  const CLOSE = '</think>';
  let inThink = false;
  let pending = '';
  const emit = (text: string) => {
    if (!text) return;
    if (inThink) handlers.onThinking(text);
    else handlers.onAnswer(text);
  };
  const keepFrom = (text: string, tag: string) => {
    for (let size = Math.min(tag.length - 1, text.length); size > 0; size -= 1) {
      if (tag.startsWith(text.slice(-size))) return text.length - size;
    }
    return text.length;
  };
  return {
    push(text) {
      pending += text;
      for (;;) {
        const tag = inThink ? CLOSE : OPEN;
        const at = pending.indexOf(tag);
        const strayClose = inThink ? -1 : pending.indexOf(CLOSE);
        if (strayClose >= 0 && (at < 0 || strayClose < at)) {
          emit(pending.slice(0, strayClose));
          pending = pending.slice(strayClose + CLOSE.length);
          continue;
        }
        if (at < 0) break;
        emit(pending.slice(0, at));
        pending = pending.slice(at + tag.length);
        inThink = !inThink;
      }
      const cut = Math.min(keepFrom(pending, inThink ? CLOSE : OPEN), inThink ? pending.length : keepFrom(pending, CLOSE));
      emit(pending.slice(0, cut));
      pending = pending.slice(cut);
    },
    flush() {
      emit(pending);
      pending = '';
    },
  };
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
  if (message.role === 'user' && 'images' in message && message.images.length) {
    return {
      role: 'user',
      content: [
        { type: 'text', text: message.content },
        ...message.images.map((image) => ({ type: 'image_url', image_url: { url: `data:${image.mediaType};base64,${image.dataBase64}` } })),
      ],
    };
  }
  return { role: message.role, content: message.content };
}

/**
 * 추론 모델이 답 앞에 쓴 <think> 블록을 떼어 낸다. 여는 태그 없이 `…</think>`로 시작하는 모델도 있어 마지막 닫는 태그 앞을 모두 생각 글로 본다.
 * 닫히지 않은 <think>(답 길이 상한에 걸려 끊긴 경우)는 전부 생각 글이다.
 */
export function splitThinking(raw: string): { thinking: string | null; text: string } {
  const content = raw.split(GEMMA_CHANNEL_CLOSE).join('</think>').split(GEMMA_CHANNEL_OPEN).join('').split(GEMMA_CHANNEL_OPEN_BARE).join('');
  const closed = content.lastIndexOf('</think>');
  if (closed >= 0) {
    const thinking = content.slice(0, closed).replace(/<\/?think>/gi, '').trim();
    return { thinking: thinking || null, text: content.slice(closed + '</think>'.length).trim() };
  }
  const open = content.search(/<think>/i);
  if (open >= 0) return { thinking: content.slice(open + '<think>'.length).trim() || null, text: content.slice(0, open).trim() };
  return { thinking: null, text: content.trim() };
}

/** 추론 모델의 <think> 블록과 ```json 울타리를 벗기고 JSON으로 읽는다 */
export function parseJsonContent(content: string): unknown {
  return parseJsonText(splitThinking(content).text);
}

function parseJsonText(content: string): unknown {
  let text = content;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fenced) text = fenced[1].trim();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new LlmRequestError('AI 응답을 JSON으로 읽지 못했어요');
  }
}

/** 설정의 모델 이름은 /v1/models의 id다. LM Studio는 key나 `key@양자화` 변형 이름으로 준다 */
function contextLengthOf(m: { max_context_length?: number; loaded_instances?: { config?: { context_length?: number } }[] }): number | null {
  const loaded = (m.loaded_instances ?? []).map((i) => i.config?.context_length).filter(positiveInt);
  if (loaded.length) return Math.min(...loaded);
  return positiveInt(m.max_context_length) ? m.max_context_length : null;
}

/** 불러온 모델에 실제로 쓰이는 문맥 길이: 불러올 때 정한 값이 먼저, 없으면 최대값 */
function unslothContextLength(status: UnslothStatusWire): number | null {
  if (positiveInt(status.context_length)) return status.context_length;
  return positiveInt(status.max_context_length) ? status.max_context_length : null;
}

function positiveInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v > 0;
}

/** Unsloth에 불러온 단 하나의 모델이 이 모델이면 그 정보 */
function unslothActive(server: LlmServerInfo, model: string): UnslothInfo['active'] {
  const active = server.unsloth?.active ?? null;
  return active?.ids.includes(model) ? active : null;
}

/** 별칭과 전체 이름을 한 모델로 묶는 열쇠: 마지막 / 뒤를 소문자로 */
function unslothBaseName(id: string): string {
  return (id.split('/').pop() ?? id).toLowerCase();
}

/**
 * Unsloth /v1/status의 생각 설정을 LM Studio의 allowed_options 모양으로 바꾼다.
 * 생각을 못 하면 빈 목록, 늘 켜져 있으면 'off'를 빼고, 단계를 알리지 않으면(enable_thinking 방식) 켜기('on')만 둔다
 */
function unslothReasoningOptions(status: UnslothStatusWire): string[] {
  if (status.supports_reasoning !== true) return [];
  const levels = Array.isArray(status.reasoning_effort_levels) ? status.reasoning_effort_levels.filter((v): v is string => typeof v === 'string' && v !== 'none') : [];
  return [...(status.reasoning_always_on === true ? [] : ['off']), ...(levels.length ? levels : ['on'])];
}

/** reasoning_effort로 바꿀 이 모델의 생각 옵션. 모델 정보가 먼저이고, LM Studio가 아니면 관리자가 지원한다고 정한 때만 */
function reasoningOptionsOf(server: LlmServerInfo, endpoint: LlmEndpoint, model: string): readonly string[] | null {
  if (server.lmStudio) return findModelInfo(server.lmStudio, model)?.reasoningOptions ?? null;
  const active = unslothActive(server, model);
  if (active) return active.reasoningOptions;
  return endpoint.reasoningSupport === true ? MANUAL_REASONING_OPTIONS : null;
}

function findModelInfo(models: Map<string, LmStudioModelInfo>, model: string): LmStudioModelInfo | undefined {
  return models.get(model) ?? models.get(model.split('@')[0]);
}

/** 모르는 모델이면 null (지원 여부를 알 수 없다) */
function reasoningSupported(info: LmStudioModelInfo | null | undefined): boolean | null {
  return info ? Boolean(info.reasoningOptions?.length) : null;
}

/**
 * 원하는 생각 정도를 모델이 받는 reasoning_effort 값으로 바꾼다. 보내지 않을 때는 null.
 * - off: 모델이 'off'를 받을 때만 'none'
 * - 단계: 모델이 아는 단계 중 가장 가까운 것(같으면 높은 쪽). 단계 없이 켜기만 아는 모델('on')은 'none'이 아닌 값이면 켜지므로 그대로 보낸다
 */
export function reasoningEffortFor(want: LlmReasoning | null, allowedOptions: readonly string[] | null | undefined): string | null {
  if (!want || !allowedOptions?.length) return null;
  if (want === 'off') return allowedOptions.includes('off') ? 'none' : null;
  const levels = REASONING_LEVELS.filter((level) => allowedOptions.includes(level));
  if (levels.length === 0) return allowedOptions.includes('on') ? want : null;
  const wantIndex = REASONING_LEVELS.indexOf(want);
  const distance = (level: (typeof REASONING_LEVELS)[number]) => Math.abs(REASONING_LEVELS.indexOf(level) - wantIndex);
  return levels.reduce((best, level) => (distance(level) <= distance(best) ? level : best));
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
