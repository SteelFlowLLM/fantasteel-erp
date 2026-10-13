// AI 어시스턴트 (REQ-AST, API-262·263). 서버가 LM Studio를 불러 답한다 (LLM 연결 설정은 api/llm.ts).
import type { AiAssistantMessageInput, AiAssistantReplyView, AiAssistantSuggestedQuestionsView } from '@fantasteel/shared';
import { serverRequest } from '@/api/http';

export const aiAssistantKeys = {
  suggestedQuestions: (employeeId: number) => ['ai-assistant', 'suggested-questions', employeeId] as const,
};

export const aiAssistantApi = {
  ask: (input: AiAssistantMessageInput): Promise<AiAssistantReplyView> => serverRequest('POST', '/ai-assistant/messages', { body: input }),
  getSuggestedQuestions: (): Promise<AiAssistantSuggestedQuestionsView> => serverRequest('GET', '/ai-assistant/suggested-questions'),
};
