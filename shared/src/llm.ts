// LLM 연결 설정 (문서에 없는 기능, 2026-10-07 추가). LM Studio 로컬 서버, Unsloth Studio(이슈 #465), API 키를 쓰는 외부 LLM.
// 모두 OpenAI 호환 API(/v1/models, /v1/chat/completions)라 주소·API 키만 바꿔 쓴다.

/** LM Studio 로컬 서버 기본 주소. LM Link로 다른 컴퓨터의 모델을 쓸 때도 같은 주소다 */
export const LLM_DEFAULT_BASE_URL = 'http://127.0.0.1:1234/v1';

/** Unsloth Studio 기본 주소 (이 Mac에서 켰을 때). API 키가 꼭 있어야 한다 */
export const LLM_UNSLOTH_BASE_URL = 'http://127.0.0.1:8888/v1';

/**
 * 철강맨AI 첫 요청(시스템 지시 + 도구 설명)이 들어가려면 필요한 문맥 길이(토큰, 가정값). 이보다 작으면 AI 연결 화면이 경고한다.
 * 2026-10-21 측정: 조회 도구 28개 설명 13,445자 + 시스템 지시 3,766자(웹·브라우저·Notion·Drive를 켜면 더 는다)에 지난 대화·도구 결과·답 자리를 더했다
 */
export const LLM_MIN_CONTEXT_TOKENS = 16_384;

/**
 * 연결한 서버 종류. LM Studio는 고유 API(/api/v1/models), Unsloth Studio는 /v1/status 모양으로 알아낸다.
 * 둘 다 아니면 그 밖의 OpenAI 호환 서버(외부 LLM)
 */
export type LlmServerKind = 'lmstudio' | 'unsloth' | 'openai';

export interface LlmSettingsView {
  baseUrl: string;
  /** 고른 모델 id. 아직 안 골랐으면 null */
  model: string | null;
  /** API 키는 돌려주지 않고 있는지만 알린다 */
  hasApiKey: boolean;
  /**
   * 관리자가 정한 사진 지원 여부 (LM Studio가 아닐 때만 쓴다). null이면 모름: 사진 첨부를 막지 않는다.
   * Unsloth Studio가 모델 정보를 알려 주면 그 값이 먼저다
   */
  visionSupport: boolean | null;
  /** 관리자가 정한 생각 정도 지원 여부 (LM Studio가 아닐 때만 쓴다). true일 때만 reasoning_effort를 보낸다 */
  reasoningSupport: boolean | null;
  /** 관리자가 넣은 문맥 길이(토큰, LM Studio가 아닐 때 모델 정보가 없으면 쓴다). null이면 모름: 대화 기억·심층 조사가 기본 몫을 쓴다 */
  contextLength: number | null;
}

export interface LlmSettingsInput {
  baseUrl: string;
  model: string | null;
  /** 보내지 않으면 그대로 두고, 빈 문자열이면 지운다 */
  apiKey?: string;
  /** 보내지 않으면 그대로, null이면 모름으로 */
  visionSupport?: boolean | null;
  reasoningSupport?: boolean | null;
  contextLength?: number | null;
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
  /** LM Studio·Unsloth Studio만 알려 준다: 지금 메모리에 올라가 있는지. 외부 LLM이면 null */
  loaded: boolean | null;
  /**
   * 생각 정도(reasoning_effort)를 받는지. LM Studio는 모델마다, Unsloth Studio는 불러온 모델만 알려 준다.
   * 모르면(외부 LLM·옛 LM Studio·불러오지 않은 Unsloth 모델) null
   */
  reasoning: boolean | null;
  /** 문맥 길이(토큰). LM Studio는 불러온 인스턴스 값(없으면 최대값), Unsloth Studio는 불러온 모델의 Context Length. 모르면 null */
  contextLength: number | null;
}

export interface LlmConnectionView {
  connected: boolean;
  baseUrl: string;
  /** 응답까지 걸린 시간(ms). 연결 실패면 null */
  latencyMs: number | null;
  models: LlmModelView[];
  /** 연결 실패 이유 (화면에 그대로 보인다) */
  error: string | null;
  /** 연결한 서버 종류. 연결 실패면 null */
  serverKind: LlmServerKind | null;
  /** Unsloth Studio의 Settings > API > Model auto-switch가 켜져 있는지. Unsloth가 아니거나 못 읽으면 null */
  autoSwitch: boolean | null;
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
