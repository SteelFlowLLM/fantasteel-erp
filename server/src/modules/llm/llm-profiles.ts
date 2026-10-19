/**
 * 기능별 LLM 요청 설정 (문서에 없는 기능, 2026-10-16 추가). 요청마다 실어 보내므로 LM Studio에서 모델을 다시 불러오지 않아도 된다.
 * 샘플링 값은 Qwen이 권하는 생각 모드·비생각 모드 값을 바탕으로 했다. JSON 추출은 같은 입력에 같은 답이 나오도록 temperature 0을 쓴다.
 */

export interface LlmSampling {
  temperature: number;
  topP: number;
  /** LM Studio만 보낸다 (OpenAI 표준에 없다) */
  topK: number;
  /** LM Studio만 보낸다 */
  minP: number;
  /** LM Studio만 보낸다 */
  repeatPenalty: number;
  presencePenalty: number;
}

/** 생각 정도. off는 생각을 끄고, 나머지는 켠다 (모델이 단계를 모르면 켜기만 한다) */
export type LlmReasoning = 'off' | 'low' | 'medium' | 'high';

export interface LlmProfile {
  sampling: LlmSampling;
  /** null이면 보내지 않고 모델 기본값을 쓴다 */
  reasoning: LlmReasoning | null;
}

const NON_THINKING: LlmSampling = { temperature: 0.7, topP: 0.8, topK: 20, minP: 0, repeatPenalty: 1, presencePenalty: 1.5 };
const THINKING: LlmSampling = { temperature: 1, topP: 0.95, topK: 20, minP: 0, repeatPenalty: 1, presencePenalty: 1.5 };
const EXTRACTION: LlmSampling = { temperature: 0, topP: 1, topK: 20, minP: 0, repeatPenalty: 1, presencePenalty: 0 };

export const LLM_PROFILE = {
  /** AI 연결 화면의 응답 확인: 짧은 인사라 생각하지 않는다 */
  CONNECTION_TEST: { sampling: NON_THINKING, reasoning: 'off' },
  /** AI 어시스턴트: 도구로 데이터를 찾아 답한다 */
  ASSISTANT: { sampling: THINKING, reasoning: 'medium' },
  /** Agent 상황 설명: 정해진 근거를 짧게 풀어 쓴다 */
  AGENT_EXPLAIN: { sampling: NON_THINKING, reasoning: 'off' },
  /** 회의록 1차 분석 (JSON) */
  MEETING_ANALYSIS: { sampling: EXTRACTION, reasoning: 'medium' },
  /** 회의록 2차 검토 (JSON) */
  MEETING_REVIEW: { sampling: EXTRACTION, reasoning: 'medium' },
  /** Message → ERP 초안 칸 채우기 (JSON): 사용자가 초안을 기다리므로 생각하지 않는다 */
  MESSAGE_EXTRACT: { sampling: EXTRACTION, reasoning: 'off' },
  /** 과거 사례 초안 (JSON) */
  PAST_CASE_DRAFT: { sampling: EXTRACTION, reasoning: 'low' },
  /** 심층 조사 계획·다음 행동·점검 (JSON, 이슈 #378): 단계가 많아 생각을 짧게 */
  RESEARCH_JSON: { sampling: EXTRACTION, reasoning: 'low' },
  /** 심층 조사 보고서 (마크다운, 이슈 #378): 근거는 점검 단계에서 정리했으므로 생각하지 않고 쓴다 */
  RESEARCH_REPORT: { sampling: NON_THINKING, reasoning: 'off' },
} as const satisfies Record<string, LlmProfile>;

/**
 * AI 어시스턴트에서 사용자가 고른 생각 정도. 고르지 않으면 기능 기본값.
 * 생각을 끄면 비생각 샘플링 값을 쓴다 (Qwen 권장: 모드마다 값이 다르다).
 */
export function assistantProfile(reasoning: LlmReasoning | undefined): LlmProfile {
  if (reasoning === undefined) return LLM_PROFILE.ASSISTANT;
  return { sampling: reasoning === 'off' ? NON_THINKING : THINKING, reasoning };
}
