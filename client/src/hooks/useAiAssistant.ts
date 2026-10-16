// AI 어시스턴트 훅. 답은 화면 토스트가 아니라 대화에 바로 보이므로 useAction이 아니라 대화 저장소에 직접 넣는다.
// LLM 연결 실패(COM-999)는 화면 오류 코드가 아니라 서버가 알려 준 이유(모델 미설정·응답 없음)가 그대로 보인다.
// 답은 스트림으로 받아 저장소에 쌓는다: 답을 기다리는 동안 패널을 닫아도 답이 대화에 남는다.
import type { AiAssistantScreenContext, AiAssistantTurn, AiReasoningLevel } from '@fantasteel/shared';
import { useQuery } from '@tanstack/react-query';
import { aiAssistantApi, aiAssistantKeys } from '@/api/aiAssistant';
import { isAbortError } from '@/api/http';
import { useMe } from '@/hooks/useMe';
import { AI_CHAT_STOPPED_REASON, aiChatHistory, newAiChatId, useAiChatStore } from '@/stores/useAiChatStore';
import { errorMessageOf } from '@/stores/useToastStore';

export function useAiSuggestedQuestions() {
  const me = useMe();
  return useQuery({
    queryKey: aiAssistantKeys.suggestedQuestions(me.employeeId),
    queryFn: aiAssistantApi.getSuggestedQuestions,
    staleTime: Infinity,
  });
}

/** 지금 받고 있는 답의 연결. 패널을 닫아도 이어 받아야 해서 컴포넌트가 아니라 모듈에 둔다 */
let activeController: AbortController | null = null;

/** 받고 있는 답을 멈춘다 (서버도 하던 일을 그만둔다). 실패 줄은 '멈췄어요'로 남는다 */
export function stopAiAssistant(): void {
  activeController?.abort();
}

export interface AiAskVariables {
  questionId: string;
  question: string;
  screen: AiAssistantScreenContext;
  history: AiAssistantTurn[];
  reasoning?: AiReasoningLevel;
}

/** 스트림으로 답을 받아 대화 저장소에 쌓는다. 이미 addQuestion을 한 질문에 대해 부른다 */
export async function runAiAsk({ questionId, question, screen, history, reasoning }: AiAskVariables): Promise<void> {
  const chat = () => useAiChatStore.getState();
  const controller = new AbortController();
  activeController = controller;
  let finished = false;
  // 대화를 비우거나 사원이 바뀌어 이 질문이 더는 대화에 없으면 서버 일도 그만두게 한다
  const unsubscribe = useAiChatStore.subscribe((state) => {
    if (!finished && state.pendingId !== questionId) controller.abort();
  });
  try {
    await aiAssistantApi.askStream(
      { question, screen, history, ...(reasoning ? { reasoning } : {}) },
      (event) => {
        if (event.type === 'done' || event.type === 'error') finished = true;
        chat().applyStreamEvent(questionId, event);
      },
      controller.signal,
    );
    if (!finished) chat().addFailure(questionId, question, '답이 끝나기 전에 연결이 끊겼어요. 다시 물어봐 주세요');
  } catch (error) {
    chat().addFailure(questionId, question, controller.signal.aborted || isAbortError(error) ? AI_CHAT_STOPPED_REASON : errorMessageOf(error));
  } finally {
    unsubscribe();
    if (activeController === controller) activeController = null;
  }
}

/** 질문을 보내는 함수. `.stop()`은 받고 있는 답을 멈춘다 */
export function useAskAiAssistant() {
  const ask = (question: string, screen: AiAssistantScreenContext, reasoning?: AiReasoningLevel) => {
    const text = question.trim();
    const chat = useAiChatStore.getState();
    if (!text || chat.pendingId) return;
    const history = aiChatHistory(chat.entries);
    const questionId = newAiChatId();
    chat.addQuestion(questionId, text, reasoning);
    void runAiAsk({ questionId, question: text, screen, history, reasoning });
  };
  return Object.assign(ask, { stop: stopAiAssistant });
}
