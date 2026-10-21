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
  /** LM Studio만 알려 준다: 생각 정도(reasoning_effort)를 받는지. 외부 LLM·옛 LM Studio면 null */
  reasoning: boolean | null;
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

/** 철강맨AI 브라우저의 열 수 있는 주소 설정 (문서에 없는 기능, 이슈 #430). AI 연결 설정과 같은 권한 */
export interface LlmBrowserSettingsView {
  /** 관리자가 저장한 시작 사이트. 저장한 적이 없으면 null (서버 기본값·BROWSER_START_SITES를 쓴다) */
  startSites: string[] | null;
  /** 지금 실제로 쓰는 시작 사이트 */
  effectiveStartSites: string[];
  /** 저장한 목록이 없을 때 쓰는 서버 기본 목록(BROWSER_START_SITES 또는 기본 목록) */
  defaultStartSites: string[];
  /** 켜면 검색 결과·질문·시작 사이트에 없는 주소도 연다. 사내 주소·로그인·결제 막기는 그대로 */
  openAllSites: boolean;
}

export interface LlmBrowserSettingsInput {
  /** null이면 저장한 목록을 지우고 서버 기본값으로 돌아간다 */
  startSites: string[] | null;
  openAllSites: boolean;
}

/** 시작 사이트 목록에 넣을 수 있는 호스트 모양: 소문자 도메인, 점 하나 이상 */
export const LLM_START_SITE_PATTERN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;
export const LLM_START_SITES_MAX = 50;
