import { PROCESS_STEPS } from './process.generated';
import type { ProcessStep } from './process.types';

/** 전체 업무 순서를 묻는 말. 표 전체를 표 순서대로 넘긴다 */
const WHOLE_FLOW_QUESTION = /순서|흐름|프로세스|전체|부터|까지/;
/** 업무 하나의 진행 방법을 묻는 말 */
const HOW_QUESTION = /어떻게|방법|절차|과정|단계/;

export const PROCESS_MATCH_LIMIT = 3;

/** 업무 이름 조각 중 너무 흔해서 다른 업무 질문에도 들어가는 말 */
const COMMON_WORDS = new Set(['등록', '승인', '계획', '조회', '확정', '관리']);
const MIN_TOKEN_LENGTH = 2;

/**
 * 업무 순서·진행 방법을 묻는 질문일 때만 업무 프로세스 표에서 근거를 고른다 (용어 사전에는 절차가 없다).
 * - 전체 순서(수주부터 출하까지, 순서·흐름): 표 전체를 표 순서대로, 업무별 정상 흐름 없이 핵심 흐름만(16줄).
 * - 업무 하나(구매요청은 어떻게 등록해?): 업무 이름 조각이 질문에 들어 있는 업무를 많이 맞는 순으로 3개까지, 정상 흐름과 함께.
 * - 진행 방법을 묻는데 맞는 업무가 없으면 표 전체.
 */
export function findProcessSteps(text: string, steps: readonly ProcessStep[] = PROCESS_STEPS): ProcessStep[] {
  const wholeFlow = WHOLE_FLOW_QUESTION.test(text);
  if (!wholeFlow && !HOW_QUESTION.test(text)) return [];
  if (!wholeFlow) {
    const matched = matchByName(text, steps);
    if (matched.length) return matched;
  }
  return steps.map((step) => ({ ...step, normalFlow: null }));
}

function matchByName(text: string, steps: readonly ProcessStep[]): ProcessStep[] {
  const haystack = normalize(text);
  return steps
    .map((step, index) => ({ step, index, score: scoreOf(step, haystack) }))
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, PROCESS_MATCH_LIMIT)
    .map((match) => match.step);
}

function scoreOf(step: ProcessStep, haystack: string): number {
  return tokensOf(step.name)
    .filter((token) => haystack.includes(token))
    .reduce((sum, token) => sum + token.length, 0);
}

function tokensOf(name: string): string[] {
  return name
    .split(/[·\s()]+/)
    .map(normalize)
    .filter((token) => token.length >= MIN_TOKEN_LENGTH && !COMMON_WORDS.has(token));
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[\s·]+/g, '');
}
