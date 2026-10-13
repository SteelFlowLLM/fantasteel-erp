// AI 어시스턴트 (REQ-AST, API-262·263). LLM 연결 설정(api/llm.ts)처럼 가짜 DB 모드에서도 늘 실제 서버를 부른다:
// LLM은 서버가 LM Studio를 불러야 쓸 수 있어 브라우저 안 가짜 DB로 흉내 낼 수 없다.
import type { AiAssistantMessageInput, AiAssistantReplyView, AiAssistantSuggestedQuestionsView } from '@fantasteel/shared';
import { serverRequest } from '@/api/http';

export const aiAssistantKeys = {
  suggestedQuestions: (employeeId: number) => ['ai-assistant', 'suggested-questions', employeeId] as const,
};

export const aiAssistantApi = {
  ask: (input: AiAssistantMessageInput): Promise<AiAssistantReplyView> => serverRequest('POST', '/ai-assistant/messages', { body: input }),
  getSuggestedQuestions: (): Promise<AiAssistantSuggestedQuestionsView> => serverRequest('GET', '/ai-assistant/suggested-questions'),
};
