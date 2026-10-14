import { PROCESS_STEPS } from './process.generated';
import type { ProcessStep } from './process.types';

/** 업무 순서·흐름을 묻는 말. 용어 사전에는 절차가 없어서 이때만 업무 프로세스 표를 넘긴다 */
const FLOW_QUESTION = /순서|흐름|절차|프로세스|단계|과정/;

/** 순서를 묻는 질문이면 표 전체를 표 순서대로 돌려준다(16줄뿐이라 거르지 않는다). 아니면 빈 목록 */
export function findProcessSteps(text: string, steps: readonly ProcessStep[] = PROCESS_STEPS): ProcessStep[] {
  return FLOW_QUESTION.test(text) ? [...steps] : [];
}
