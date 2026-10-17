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

/** 보고서 한 번의 출력 토큰 상한 (문맥이 작으면 줄인다) */
export const REPORT_MAX_TOKENS = 16_384;
/** 문맥 길이 중 프롬프트에 쓰는 몫 (나머지는 출력·여유) */
export const CONTEXT_PROMPT_SHARE = 0.7;
/**
 * 토큰 → 글자 환산. 프롬프트는 한국어 지시·메모와 영어·숫자가 섞인 웹 글이라 1토큰 ≈ 2자로 본다
 * (한국어만이면 1자 ≈ 1토큰까지 늘 수 있어 넘치면 AI_RESEARCH_PROMPT_CHARS로 줄인다)
 */
export const CHARS_PER_TOKEN = 2;
const DERIVED_PROMPT_CHARS_MIN = 4_000;

export interface ModelBudget {
  promptChars: number;
  reportMaxTokens: number;
  /** 알아낸 문맥 길이(토큰). 모르면 null */
  contextLength: number | null;
}

/** 환경 변수로 정한 프롬프트 글자 수 (없거나 잘못됐으면 null) */
export function envPromptChars(env: NodeJS.ProcessEnv = process.env): number | null {
  const text = env.AI_RESEARCH_PROMPT_CHARS?.trim();
  if (!text || !/^\d+$/.test(text)) return null;
  return Math.min(Math.max(Number(text), PROMPT_CHARS_MIN), RESEARCH_CAPS.promptChars);
}

/**
 * 모델 문맥 길이로 프롬프트 글자 수·보고서 출력 토큰을 정한다 (이슈 #384).
 * 출력 몫 = min(16,384, 문맥/2)을 남기고, 프롬프트 = min(문맥 × 70%, 문맥 − 출력 몫)토큰 × 2자. AI_RESEARCH_PROMPT_CHARS가 있으면 그 값을 넘지 않는다.
 * 문맥을 모르면(외부 LLM·옛 LM Studio) AI_RESEARCH_PROMPT_CHARS 또는 24,000자, 보고서 16,384토큰.
 */
export function modelBudget(contextLength: number | null, env: NodeJS.ProcessEnv = process.env): ModelBudget {
  const fromEnv = envPromptChars(env);
  if (!contextLength || contextLength <= 0) return { promptChars: fromEnv ?? DEFAULT_RESEARCH_LIMITS.promptChars, reportMaxTokens: REPORT_MAX_TOKENS, contextLength: null };
  const reserve = Math.min(REPORT_MAX_TOKENS, Math.floor(contextLength / 2));
  const promptTokens = Math.min(Math.floor(contextLength * CONTEXT_PROMPT_SHARE), contextLength - reserve);
  const derived = Math.min(Math.max(DERIVED_PROMPT_CHARS_MIN, promptTokens * CHARS_PER_TOKEN), RESEARCH_CAPS.promptChars);
  const promptChars = fromEnv === null ? derived : Math.min(fromEnv, derived);
  const reportMaxTokens = Math.min(REPORT_MAX_TOKENS, Math.max(1024, contextLength - Math.ceil(promptChars / CHARS_PER_TOKEN)));
  return { promptChars, reportMaxTokens, contextLength };
}

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
