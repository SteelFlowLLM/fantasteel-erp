import { AI_RESEARCH_LIMITS } from '@fantasteel/shared';

/**
 * 심층 조사 예산·글자 상한 (이슈 #384). 환경 변수로 바꾸고, 잘못된 값·상한을 넘는 값은 기본값·상한으로 둔다.
 * 문맥 창이 큰 모델(LM Studio에서 Context Length를 늘려 로드)일수록 AI_RESEARCH_PROMPT_CHARS를 함께 늘린다 (docs/backend/ai-research.md).
 */
export interface ResearchLimits {
  /** 새 조사의 기본 단계 수 */
  maxSteps: number;
  /** 새 조사의 기본 출처 수 */
  maxSources: number;
  /** 더 조사하기로 늘려도 이 단계까지 = min(30, 기본 단계 × 2) */
  maxTotalSteps: number;
  /** 한 번의 LLM 요청(시스템 지시 + 사용자 글)의 글자 수 */
  promptChars: number;
  /** 다음 행동을 물을 때 보이는 최근 출처 본문 수 */
  evidenceSources: number;
  /** 점검·보고서·차트에 보이는 출처 본문 수 상한. 기본은 모두(글자 상한 안에서) */
  reportSources: number;
}

export const RESEARCH_CAPS = {
  maxSteps: AI_RESEARCH_LIMITS.maxStepsCap,
  maxSources: AI_RESEARCH_LIMITS.maxSourcesCap,
  promptChars: 400_000,
  evidenceSources: 30,
  reportSources: AI_RESEARCH_LIMITS.maxSourcesCap,
} as const;

/** 프롬프트가 지시·메모만으로 차지 않게 두는 바닥 */
const PROMPT_CHARS_MIN = 8_000;

export const DEFAULT_RESEARCH_LIMITS: ResearchLimits = {
  maxSteps: AI_RESEARCH_LIMITS.defaultMaxSteps,
  maxSources: AI_RESEARCH_LIMITS.defaultMaxSources,
  maxTotalSteps: Math.min(RESEARCH_CAPS.maxSteps, AI_RESEARCH_LIMITS.defaultMaxSteps * 2),
  promptChars: 24_000,
  evidenceSources: 6,
  reportSources: RESEARCH_CAPS.reportSources,
};

function intEnv(raw: string | undefined, fallback: number, min: number, max: number): number {
  const text = raw?.trim();
  if (!text || !/^\d+$/.test(text)) return fallback;
  return Math.min(Math.max(Number(text), min), max);
}

/** 부를 때마다 환경 변수를 읽는다 (시험이 값을 바꿔 볼 수 있게) */
export function researchLimits(env: NodeJS.ProcessEnv = process.env): ResearchLimits {
  const maxSteps = intEnv(env.AI_RESEARCH_MAX_STEPS, DEFAULT_RESEARCH_LIMITS.maxSteps, 1, RESEARCH_CAPS.maxSteps);
  return {
    maxSteps,
    maxSources: intEnv(env.AI_RESEARCH_MAX_SOURCES, DEFAULT_RESEARCH_LIMITS.maxSources, 1, RESEARCH_CAPS.maxSources),
    maxTotalSteps: Math.min(RESEARCH_CAPS.maxSteps, maxSteps * 2),
    promptChars: intEnv(env.AI_RESEARCH_PROMPT_CHARS, DEFAULT_RESEARCH_LIMITS.promptChars, PROMPT_CHARS_MIN, RESEARCH_CAPS.promptChars),
    evidenceSources: intEnv(env.AI_RESEARCH_EVIDENCE_SOURCES, DEFAULT_RESEARCH_LIMITS.evidenceSources, 1, RESEARCH_CAPS.evidenceSources),
    reportSources: intEnv(env.AI_RESEARCH_REPORT_SOURCES, DEFAULT_RESEARCH_LIMITS.reportSources, 1, RESEARCH_CAPS.reportSources),
  };
}
