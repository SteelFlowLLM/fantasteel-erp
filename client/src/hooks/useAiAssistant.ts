// AI 어시스턴트 훅. 답은 화면 토스트가 아니라 대화에 바로 보이므로 useAction이 아니라 useMutation을 쓴다.
// LLM 연결 실패(COM-999)는 화면 오류 코드가 아니라 서버가 알려 준 이유(모델 미설정·응답 없음)가 그대로 보인다.
// 결과는 훅 옵션의 콜백에서 대화 저장소에 넣는다: 답을 기다리는 동안 패널을 닫아도 답이 대화에 남는다.
import type { AiAssistantScreenContext, AiAssistantTurn } from '@fantasteel/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { aiAssistantApi, aiAssistantKeys } from '@/api/aiAssistant';
import { useMe } from '@/hooks/useMe';
import { aiChatHistory, newAiChatId, useAiChatStore } from '@/stores/useAiChatStore';
import { errorMessageOf } from '@/stores/useToastStore';

export function useAiSuggestedQuestions() {
  const me = useMe();
  return useQuery({
    queryKey: aiAssistantKeys.suggestedQuestions(me.employeeId),
    queryFn: aiAssistantApi.getSuggestedQuestions,
    staleTime: Infinity,
  });
}

interface AskVariables {
  questionId: string;
  question: string;
  screen: AiAssistantScreenContext;
  history: AiAssistantTurn[];
}

export function useAskAiAssistant() {
  const mutation = useMutation({
    mutationFn: ({ question, screen, history }: AskVariables) => aiAssistantApi.ask({ question, screen, history, actionCards: true }),
    onSuccess: (reply, { questionId }) => useAiChatStore.getState().addAnswer(questionId, reply.answer, reply.sources, reply.actionCards),
    onError: (error, { questionId, question }) => useAiChatStore.getState().addFailure(questionId, question, errorMessageOf(error)),
  });

  return (question: string, screen: AiAssistantScreenContext) => {
    const text = question.trim();
    const chat = useAiChatStore.getState();
    if (!text || chat.pendingId) return;
    const history = aiChatHistory(chat.entries);
    const questionId = newAiChatId();
    chat.addQuestion(questionId, text);
    mutation.mutate({ questionId, question: text, screen, history });
  };
}

