// AI 어시스턴트의 생각 정도 선택. 고른 값과 '이번 질문만' 여부는 사원별이 아니라 이 브라우저에 저장한다 (계정에 저장할 컬럼이 ERD에 없다).
import { AI_REASONING_DEFAULT, AI_REASONING_LEVELS, type AiReasoningLevel } from '@fantasteel/shared';

export interface AiReasoningPreference {
  level: AiReasoningLevel;
  /** 켜면 질문을 보낸 뒤 생각 정도가 기본값으로 돌아간다 */
  oneShot: boolean;
}

export const AI_REASONING_KEY = 'fantasteel.ai-reasoning';

export const DEFAULT_AI_REASONING_PREFERENCE: AiReasoningPreference = { level: AI_REASONING_DEFAULT, oneShot: true };

export function isAiReasoningLevel(value: unknown): value is AiReasoningLevel {
  return typeof value === 'string' && (AI_REASONING_LEVELS as readonly string[]).includes(value);
}

/** 저장된 글에서 설정을 읽는다. 깨졌거나 없으면 기본값 */
export function parseAiReasoningPreference(raw: string | null): AiReasoningPreference {
  if (!raw) return DEFAULT_AI_REASONING_PREFERENCE;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return DEFAULT_AI_REASONING_PREFERENCE;
    const level = 'level' in value && isAiReasoningLevel(value.level) ? value.level : DEFAULT_AI_REASONING_PREFERENCE.level;
    const oneShot = 'oneShot' in value && typeof value.oneShot === 'boolean' ? value.oneShot : DEFAULT_AI_REASONING_PREFERENCE.oneShot;
    return { level, oneShot };
  } catch {
    return DEFAULT_AI_REASONING_PREFERENCE;
  }
}

export function readAiReasoningPreference(): AiReasoningPreference {
  try {
    return parseAiReasoningPreference(window.localStorage.getItem(AI_REASONING_KEY));
  } catch {
    return DEFAULT_AI_REASONING_PREFERENCE;
  }
}

export function writeAiReasoningPreference(preference: AiReasoningPreference): void {
  try {
    window.localStorage.setItem(AI_REASONING_KEY, JSON.stringify(preference));
  } catch {
    // localStorage를 쓸 수 없는 환경이면 이 화면을 열어 둔 동안만 유지한다
  }
}

/** 질문을 보낸 뒤의 생각 정도: '이번 질문만'이면 기본값으로 돌아가고, 아니면 그대로 */
export function reasoningAfterSend(level: AiReasoningLevel, oneShot: boolean): AiReasoningLevel {
  return oneShot ? AI_REASONING_DEFAULT : level;
}
