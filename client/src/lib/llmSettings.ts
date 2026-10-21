// AI 연결 화면(/admin/llm)의 모델 목록·Unsloth 안내·지원 여부 고르기 (이슈 #465). 화면 없이 시험하려고 따로 둔다.
import type { LlmConnectionView } from '@fantasteel/shared';

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

/** 사진·생각 정도 지원 고르기: 모름(null)·지원·지원 안 함 */
export type SupportChoice = '' | 'yes' | 'no';

export function supportChoiceOf(value: boolean | null): SupportChoice {
  return value === null ? '' : value ? 'yes' : 'no';
}

export function supportValueOf(choice: SupportChoice): boolean | null {
  return choice === '' ? null : choice === 'yes';
}

/** 지원 여부를 고르는 칸은 LM Studio가 아닐 때만 보인다 (LM Studio는 모델마다 알려 준다). 연결 확인 전에는 저장한 값이 있을 때만 */
export function showsSupportChoices(result: LlmConnectionView | undefined, saved: { visionSupport: boolean | null; reasoningSupport: boolean | null }): boolean {
  if (result?.connected) return result.serverKind !== 'lmstudio';
  return saved.visionSupport !== null || saved.reasoningSupport !== null;
}
