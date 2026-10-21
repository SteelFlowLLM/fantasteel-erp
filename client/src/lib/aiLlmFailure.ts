// 철강맨AI가 AI 서버(LLM)에 닿지 못했을 때 서버가 주는 오류 코드(AST-002~005, 이슈 #462)별 안내.
// 정의서 9.3에 없는 코드라 공통 오류 코드표(codes/errors.ts)에 넣지 않고 여기서만 쓴다.
import { AI_LLM_FAILURE_CODES, type AiLlmFailureCode } from '@fantasteel/shared';

export interface AiLlmFailureGuide {
  /** 실패 줄 머리글 (기본 '답을 받지 못했어요' 대신) */
  title: string;
  /** 무엇을 하면 되는지 */
  hint: string;
  /** 고치는 곳이 AI 연결 화면이면 true (그 화면을 열 수 있는 사원에게만 링크를 보인다) */
  needsSettings: boolean;
}

export const AI_LLM_FAILURE_GUIDE: Record<AiLlmFailureCode, AiLlmFailureGuide> = {
  'AST-002': { title: 'AI 모델이 정해지지 않았어요', hint: '관리자가 AI 연결 화면에서 모델을 골라야 철강맨AI가 답할 수 있어요.', needsSettings: true },
  'AST-003': { title: 'AI 서버에 연결하지 못했어요', hint: 'AI 서버(LM Studio 등)가 꺼져 있거나 주소가 바뀌었을 수 있어요. 잠시 뒤 다시 묻고, 계속되면 관리자에게 알려 주세요.', needsSettings: true },
  'AST-004': { title: 'AI 서버가 시간 안에 답하지 않았어요', hint: '질문이 길거나 서버가 바쁠 수 있어요. 질문을 줄이거나 잠시 뒤 다시 물어봐 주세요.', needsSettings: false },
  'AST-005': { title: 'AI 서버가 요청을 처리하지 못했어요', hint: '아래 이유를 확인하고, 모델 설정에 문제가 없는지 관리자에게 알려 주세요.', needsSettings: true },
};

/** 서버 오류 코드가 LLM 실패 코드면 그 코드, 아니면 null */
export function aiLlmFailureCodeOf(code: string | null | undefined): AiLlmFailureCode | null {
  return AI_LLM_FAILURE_CODES.find((known) => known === code) ?? null;
}

/** AI 연결 화면 (AiPanel 실패 줄의 링크) */
export const AI_LLM_SETTINGS_HREF = '/admin/llm';
