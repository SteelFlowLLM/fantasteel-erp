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

/** 화면에 그대로 보일 연결 실패 이유 */
export class LlmRequestError extends Error {}

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

  async chat(endpoint: LlmEndpoint, model: string, messages: ChatMessage[], maxTokens?: number): Promise<string> {
    const body = await this.request<{ choices?: { message?: { content?: string | null } }[] }>(
      endpoint,
      'POST',
      '/chat/completions',
      { model, messages, stream: false, ...(maxTokens === undefined ? {} : { max_tokens: maxTokens }) },
      CHAT_TIMEOUT_MS,
    );
    return body.choices?.[0]?.message?.content?.trim() ?? '';
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
    if (!res.ok) throw new LlmRequestError(`LLM 서버 오류 (HTTP ${res.status}): ${await errorMessageOf(res)}`);
    try {
      return (await res.json()) as T;
    } catch {
      throw new LlmRequestError('LLM 서버 응답을 읽을 수 없어요. OpenAI 호환 주소(…/v1)가 맞는지 확인해 주세요');
    }
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
