// LLM 연결 설정 (문서에 없는 기능, 2026-10-07 추가). 지금은 LM Studio 로컬 서버, 나중에 API 키를 쓰는 외부 LLM.
// 둘 다 OpenAI 호환 API(/v1/models, /v1/chat/completions)라 주소·API 키만 바꿔 쓴다.

/** LM Studio 로컬 서버 기본 주소. LM Link로 다른 컴퓨터의 모델을 쓸 때도 같은 주소다 */
export const LLM_DEFAULT_BASE_URL = 'http://127.0.0.1:1234/v1';

export interface LlmSettingsView {
  baseUrl: string;
  /** 고른 모델 id. 아직 안 골랐으면 null */
  model: string | null;
  /** API 키는 돌려주지 않고 있는지만 알린다 */
  hasApiKey: boolean;
}

export interface LlmSettingsInput {
  baseUrl: string;
  model: string | null;
  /** 보내지 않으면 그대로 두고, 빈 문자열이면 지운다 */
  apiKey?: string;
}

export interface LlmConnectionTestInput {
  baseUrl: string;
  /** 보내지 않으면 저장된 API 키를 쓴다 */
  apiKey?: string;
}

export interface LlmModelView {
  id: string;
  ownedBy: string | null;
  /** LM Studio만 알려 준다: 'llm' | 'vlm' | 'embeddings'. 외부 LLM이면 null */
  type: string | null;
  /** LM Studio만 알려 준다: 지금 메모리에 올라가 있는지. 외부 LLM이면 null */
  loaded: boolean | null;
}

export interface LlmConnectionView {
  connected: boolean;
  baseUrl: string;
  /** 응답까지 걸린 시간(ms). 연결 실패면 null */
  latencyMs: number | null;
  models: LlmModelView[];
  /** 연결 실패 이유 (화면에 그대로 보인다) */
  error: string | null;
}

export interface LlmChatTestView {
  ok: boolean;
  model: string | null;
  reply: string | null;
  latencyMs: number | null;
  error: string | null;
}
