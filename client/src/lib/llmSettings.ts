// AI 연결 화면(/admin/llm)의 모델 목록·Unsloth 안내·지원 여부 고르기 (이슈 #465). 화면 없이 시험하려고 따로 둔다.
import {
  LLM_DEFAULT_BASE_URL,
  LLM_MIN_CONTEXT_TOKENS,
  LLM_OLLAMA_BASE_URL,
  LLM_UNSLOTH_BASE_URL,
  type LlmApiKeyInput,
  type LlmApiKeyView,
  type LlmConnectionView,
} from '@fantasteel/shared';

/**
 * 받은 목록에서 대화용 모델만 (임베딩 모델은 답을 만들지 못한다). 불러온 모델을 앞에 둔다.
 * 생각 정도를 못 바꾸는 모델도 빠른 답에는 쓸 수 있어 숨기지 않고, 되는 모델에만 표시한다.
 * Unsloth Studio는 불러온 모델로만 답하므로 안 불러온 모델도 표시한다.
 * 지금 고른 모델이 목록에 없으면 따로 표시해 선택이 사라지지 않게 한다.
 */
export function llmModelOptions(result: LlmConnectionView | undefined, selected: string): { id: string; label: string }[] {
  const unsloth = result?.serverKind === 'unsloth';
  const models = (result?.models ?? []).filter((m) => m.type !== 'embeddings').sort((a, b) => Number(b.loaded === true) - Number(a.loaded === true));
  const options = models.map((m) => ({
    id: m.id,
    label: [m.id, m.reasoning ? '생각 가능' : null, m.loaded ? (unsloth ? '불러옴' : '로드됨') : unsloth && m.loaded === false ? '안 불러옴' : null].filter(Boolean).join(' · '),
  }));
  if (selected && !options.some((o) => o.id === selected)) options.unshift({ id: selected, label: `${selected} (지금 목록에 없음)` });
  return options;
}

/**
 * Unsloth Studio에 고른 모델이 안 불러와져 있으면 보일 안내. auto-switch가 켜져 있으면 Unsloth가 알아서 불러오므로 없다.
 * Unsloth는 요청의 모델 이름을 보지 않고 불러온 모델로 답하므로, 다른 모델이 불러와 있어도 알린다
 */
export function unslothModelWarning(result: LlmConnectionView | undefined, model: string): string | null {
  if (!result?.connected || result.serverKind !== 'unsloth' || !model || result.autoSwitch === true) return null;
  const chosen = result.models.find((m) => m.id === model);
  if (chosen?.loaded === true) return null;
  const loaded = result.models.filter((m) => m.loaded === true).map((m) => m.id);
  const now = loaded.length ? `지금 불러온 모델: ${loaded.join(', ')}` : '지금 불러온 모델이 없어요';
  return `고른 모델이 Unsloth Studio에 불러와 있지 않아요 (${now}). Unsloth Studio에서 모델을 불러오거나 Settings > API > Model auto-switch를 켜 주세요`;
}

/**
 * 고른 모델의 문맥 길이가 철강맨AI 첫 요청(지시·도구 설명)보다 작으면 보일 경고. 모델 정보가 먼저이고,
 * LM Studio가 아니면 모를 때 관리자가 넣은 값을 쓴다. 둘 다 모르면 경고하지 않는다
 */
export function contextLengthWarning(result: LlmConnectionView | undefined, model: string, manual: number | null): string | null {
  if (!result?.connected || !model) return null;
  const known = result.models.find((m) => m.id === model)?.contextLength ?? null;
  const length = known ?? (result.serverKind === 'lmstudio' ? null : manual);
  if (length === null || length >= LLM_MIN_CONTEXT_TOKENS) return null;
  const where = result.serverKind === 'unsloth' ? 'Unsloth Studio에서 Context Length를 늘려 주세요' : result.serverKind === 'lmstudio' ? 'LM Studio에서 모델을 불러올 때 Context Length를 늘려 주세요' : '더 긴 문맥을 받는 모델을 골라 주세요';
  return `문맥 길이가 ${length.toLocaleString('ko-KR')}토큰이라 철강맨AI의 지시·도구 설명(약 ${LLM_MIN_CONTEXT_TOKENS.toLocaleString('ko-KR')}토큰)이 다 들어가지 않을 수 있어요. ${where}`;
}

/** 문맥 길이 입력칸 글 → 저장할 값. 비우면 모름(null), 숫자가 아니면 undefined(저장 못 함) */
export function contextLengthValueOf(text: string): number | null | undefined {
  const trimmed = text.replace(/[,\s]/g, '');
  if (!trimmed) return null;
  const value = Number(trimmed);
  return Number.isInteger(value) && value >= 1024 ? value : undefined;
}

/** 사진·생각 정도 지원 고르기: 모름(null)·지원·지원 안 함 */
export type SupportChoice = '' | 'yes' | 'no';

export function supportChoiceOf(value: boolean | null): SupportChoice {
  return value === null ? '' : value ? 'yes' : 'no';
}

export function supportValueOf(choice: SupportChoice): boolean | null {
  return choice === '' ? null : choice === 'yes';
}

/** 지원 여부를 고르는 칸은 LM Studio가 아닐 때만 보인다 (LM Studio는 모델마다 알려 준다). 연결 확인 전에는 저장한 값이 있을 때만 */
export function showsSupportChoices(
  result: LlmConnectionView | undefined,
  saved: { visionSupport: boolean | null; reasoningSupport: boolean | null; contextLength: number | null },
): boolean {
  if (result?.connected) return result.serverKind !== 'lmstudio';
  return saved.visionSupport !== null || saved.reasoningSupport !== null || saved.contextLength !== null;
}

/** 서버 빠른 선택. 누르면 그 서버의 기본 주소와 그 서버에 저장한 키로 바로 연결을 확인한다. 외부 API는 주소를 직접 넣는다 */
export type LlmServerPreset = 'lmstudio' | 'unsloth' | 'ollama' | 'external';

export const LLM_SERVER_PRESETS: readonly { key: LlmServerPreset; label: string; baseUrl: string | null; hint: string }[] = [
  { key: 'lmstudio', label: 'LM Studio', baseUrl: LLM_DEFAULT_BASE_URL, hint: 'API 키 없이 연결해요 (인증을 켰을 때만 키)' },
  { key: 'unsloth', label: 'Unsloth Studio', baseUrl: LLM_UNSLOTH_BASE_URL, hint: 'Settings > API에서 만든 API 키가 꼭 있어야 해요' },
  { key: 'ollama', label: 'Ollama', baseUrl: LLM_OLLAMA_BASE_URL, hint: 'API 키 없이 연결해요' },
  { key: 'external', label: '외부 API', baseUrl: null, hint: 'OpenAI 호환 주소(…/v1)와 API 키를 넣어요' },
];

/** 키를 묶는 서버 단위 (scheme·호스트·포트). 서버와 같은 규칙. 주소가 잘못되면 null */
export function keyOriginOf(baseUrl: string): string | null {
  try {
    return new URL(baseUrl.trim()).origin;
  } catch {
    return null;
  }
}

/** 주소가 어느 빠른 선택에 해당하는지. 로컬 서버 셋의 주소가 아니면 외부 API */
export function presetOf(baseUrl: string): LlmServerPreset {
  const origin = keyOriginOf(baseUrl);
  const local = LLM_SERVER_PRESETS.find((p) => p.baseUrl !== null && keyOriginOf(p.baseUrl) === origin);
  return local?.key ?? 'external';
}

/** 외부 API를 누르면 넣을 주소: 키를 저장해 둔 외부 서버가 있으면 그 주소, 없으면 빈 칸 */
export function externalBaseUrlOf(savedOrigins: readonly string[]): string {
  const origin = savedOrigins.find((o) => presetOf(o) === 'external');
  return origin ? `${origin}/v1` : '';
}

/** 화면의 키 줄: 저장된 키(id·끝 4자리·상태) 또는 새로 넣은 키(value) */
export type LlmKeyRow = (LlmApiKeyView & { value?: undefined }) | { id?: undefined; value: string };

/** 서버로 보낼 키 목록. 저장된 키는 id로, 새 키는 값으로 (줄 순서가 쓰는 순서) */
export function apiKeyInputsOf(rows: readonly LlmKeyRow[]): LlmApiKeyInput[] {
  return rows.map((row) => (row.value !== undefined ? { value: row.value } : { id: row.id }));
}

export const API_KEY_STATE_LABEL = { ok: '정상', rejected: '거절됨', limited: '한도 걸림' } as const;
