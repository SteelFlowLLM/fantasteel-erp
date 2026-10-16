// AI 어시스턴트 (REQ-AST, API-262·263). 서버가 LM Studio를 불러 답한다 (LLM 연결 설정은 api/llm.ts).
import type { AiActionCardExecuteInput, AiActionCardExecuteResult, AiAssistantMessageInput, AiAssistantReplyView, AiAssistantSuggestedQuestionsView } from '@fantasteel/shared';
import { serverRequest } from '@/api/http';

export const aiAssistantKeys = {
  suggestedQuestions: (employeeId: number) => ['ai-assistant', 'suggested-questions', employeeId] as const,
};

export const aiAssistantApi = {
  ask: (input: AiAssistantMessageInput): Promise<AiAssistantReplyView> => serverRequest('POST', '/ai-assistant/messages', { body: input }),
  /** 실행 카드의 [실행]. 사용자가 확인·수정한 값을 보내면 서버가 다시 검증해 업무·일정·구매요청 초안을 만든다 */
  executeActionCard: (input: AiActionCardExecuteInput): Promise<AiActionCardExecuteResult> => serverRequest('POST', '/ai-assistant/action-cards/execute', { body: input }),
  getSuggestedQuestions: (): Promise<AiAssistantSuggestedQuestionsView> => serverRequest('GET', '/ai-assistant/suggested-questions'),
};
