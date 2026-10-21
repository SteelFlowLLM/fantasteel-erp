// AI 어시스턴트 훅. 답은 화면 토스트가 아니라 대화에 바로 보이므로 useAction이 아니라 대화 저장소에 직접 넣는다.
// LLM 연결 실패(COM-999)는 화면 오류 코드가 아니라 서버가 알려 준 이유(모델 미설정·응답 없음)가 그대로 보인다.
// 답은 스트림으로 받아 저장소에 쌓는다: 답을 기다리는 동안 패널을 닫아도 답이 대화에 남는다.
// 대화는 서버가 저장한다(이슈 #399): 질문에 대화 id를 보내면 서버가 지난 대화를 DB에서 읽고, 답이 끝나면 질문과 답을 저장한다.
import type { AiAgentControlCommand, AiAgentInput, AiAssistantImageInput, AiAssistantScreenContext, AiAssistantStreamEvent, AiReasoningLevel } from '@fantasteel/shared';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { aiAssistantApi, aiAssistantKeys } from '@/api/aiAssistant';
import { errorCodeOf, isAbortError } from '@/api/http';
import { useAction } from '@/hooks/useAction';
import { readAiChatThread, writeAiChatThread } from '@/lib/aiChatThread';
import { useMe } from '@/hooks/useMe';
import { hideAiCursor } from '@/lib/aiCursor';
import { aiLlmFailureCodeOf } from '@/lib/aiLlmFailure';
import { currentScreenMap, runUiAction, useAiScreenControlStore } from '@/lib/aiScreenAgent';
import { AI_CHAT_STOPPED_REASON, newAiChatId, useAiChatStore } from '@/stores/useAiChatStore';
import { errorMessageOf, toast } from '@/stores/useToastStore';

export function useAiSuggestedQuestions() {
  const me = useMe();
  return useQuery({
    queryKey: aiAssistantKeys.suggestedQuestions(me.employeeId),
    queryFn: aiAssistantApi.getSuggestedQuestions,
    staleTime: Infinity,
  });
}

/** 지금 모델이 사진을 보는지·생각 정도를 바꿀 수 있는지. 못 읽으면 data가 없어 화면은 '알 수 없음'(막지 않음)으로 다룬다 */
export function useAiCapabilities() {
  return useQuery({
    queryKey: aiAssistantKeys.capabilities,
    queryFn: aiAssistantApi.getCapabilities,
    // 서버에서 모델을 바꿔 불러도 곧 따라가게 짧게 둔다
    staleTime: 60_000,
    refetchOnWindowFocus: true,
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
  /** 이어 묻는 저장한 대화. 없으면(null) 서버가 새 대화로 저장한다 */
  threadId: number | null;
  reasoning?: AiReasoningLevel;
  /** 질문과 함께 보내는 사진. 저장하지 않는다 (사진 수만 남는다) */
  images?: AiAssistantImageInput[];
  /** 웹 검색을 켠 질문이면 true (이슈 #367). 끄면 필드를 보내지 않는다 */
  webSearch?: boolean;
  /** 브라우저 사용을 켠 질문이면 true (이슈 #373). 끄면 필드를 보내지 않는다 */
  browser?: boolean;
  /** 화면 조작을 켠 질문이면 true (이슈 #382, 시험 중). 끄면 필드를 보내지 않는다 */
  screenControl?: boolean;
  /** 심층 조사 보고서에 대해 묻는 질문이면 그 조사 id (이슈 #384) */
  researchRunId?: number;
  /** Notion을 켠 질문이면 true (이슈 #398). 끄면 필드를 보내지 않는다 */
  notion?: boolean;
  /** Drive를 켠 질문이면 true (이슈 #398 2단계). 끄면 필드를 보내지 않는다 */
  drive?: boolean;
  /** 입력칸에서 @로 붙인 Drive 문서 id (이슈 #398 2단계) */
  driveFileIds?: string[];
  /** 브라우저·화면 조작을 멈출 수 있게 답마다 만든 열쇠 (이슈 #425) */
  controlId?: string;
}

/**
 * 답하는 동안 브라우저·화면 조작을 멈추고(pause) 한 단계씩(step) 넘기거나 이어 간다(resume) (이슈 #425).
 * 보내기에 실패하면(답이 이미 끝남) 화면 상태만 되돌린다
 */
export async function controlAiAgent(command: AiAgentControlCommand): Promise<void> {
  const chat = useAiChatStore.getState();
  const questionId = chat.pendingId;
  const control = chat.live?.control;
  if (!questionId || !control) return;
  // 한 단계는 하나만 하고 다시 멈추므로 멈추기를 기다리는 상태로 둔다
  chat.setControlRequested(questionId, command !== 'resume');
  await aiAssistantApi.controlAgent(control.id, command).catch(() => useAiChatStore.getState().setControlRequested(questionId, false));
}

/**
 * 멈춘 동안 실시간 화면에서 서버 Chrome을 직접 조작한다 (이슈 #433). 보냈으면 true, 아니면 이유를 알리고 false.
 * 입력한 글은 이 탭 메모리에도 남기지 않는다(비밀번호일 수 있다) — 보내는 즉시 버린다
 */
export async function sendAiAgentInput(input: AiAgentInput): Promise<boolean> {
  const control = useAiChatStore.getState().live?.control;
  if (!control) return false;
  try {
    await aiAssistantApi.sendAgentInput(control.id, input);
    return true;
  } catch (error) {
    toast.error(errorMessageOf(error));
    return false;
  }
}

/**
 * 답하는 중에 말을 덧붙인다 (이슈 #430). 브라우저·화면 조작을 켠 답(열쇠가 있는 답)이 진행 중일 때만 보낼 수 있다.
 * 보냈으면 true, 보낼 수 없거나 실패했으면 false (실패하면 이유를 알린다)
 */
export async function sendAiAgentNote(text: string): Promise<boolean> {
  const chat = useAiChatStore.getState();
  const questionId = chat.pendingId;
  const control = chat.live?.control;
  const note = text.trim();
  if (!questionId || !control || !note) return false;
  try {
    await aiAssistantApi.addAgentNote(control.id, note);
  } catch (error) {
    toast.error(errorMessageOf(error));
    return false;
  }
  useAiChatStore.getState().addAgentNote(questionId, note);
  return true;
}

/** 서버가 보낸 화면 동작을 이 화면에서 실행하고 결과를 돌려준다. 보내기에 실패하면 서버가 시간 초과로 끝낸다 */
async function answerUiAction(event: Extract<AiAssistantStreamEvent, { type: 'ui_action' }>): Promise<void> {
  const result = await runUiAction(event);
  await aiAssistantApi.sendUiActionResult(event.actionId, result).catch(() => undefined);
}

/**
 * 브라우저 탭을 이어 쓰는 대화 열쇠 (이슈 #423). 서버는 같은 열쇠의 다음 질문에 열어 둔 탭을 준다.
 * 새 대화는 첫 답이 저장될 때까지 같은 열쇠를 쓰고, 저장되면 그 대화 id에 묶는다. 새 대화를 시작하면 새 열쇠다
 */
const browserKeys = new Map<number, string>();
let newConversationKey: string | null = null;
/** 새 대화의 열쇠를 [브라우저 창 열기]가 먼저 만들었는지. 그 창을 첫 질문이 이어 쓰도록 첫 질문에서 새 열쇠로 바꾸지 않는다 (이슈 #433) */
let keyFromWindow = false;

export function browserSessionIdFor(threadId: number | null, firstQuestion: boolean): string {
  if (threadId !== null) {
    const known = browserKeys.get(threadId) ?? crypto.randomUUID();
    browserKeys.set(threadId, known);
    return known;
  }
  if ((firstQuestion && !keyFromWindow) || newConversationKey === null) newConversationKey = crypto.randomUUID();
  keyFromWindow = false;
  return newConversationKey;
}

/** [브라우저 창 열기]가 쓰는 열쇠: 질문이 쓸 열쇠와 같다. 새 대화면 첫 질문이 이 열쇠를 이어 쓴다 (이슈 #433) */
export function browserWindowSessionId(threadId: number | null): string {
  if (threadId !== null) return browserSessionIdFor(threadId, false);
  if (newConversationKey === null) newConversationKey = crypto.randomUUID();
  keyFromWindow = true;
  return newConversationKey;
}

/** 새 대화의 첫 답이 저장되어 대화 id가 생기면 지금까지 쓰던 열쇠를 그 대화에 묶는다 */
export function bindBrowserSession(threadId: number): void {
  if (newConversationKey === null || browserKeys.has(threadId)) return;
  browserKeys.set(threadId, newConversationKey);
  newConversationKey = null;
  keyFromWindow = false;
}

/** [브라우저 창 열기]: 이 대화의 빈 탭을 미리 열어 둔다. 서버 컴퓨터에 창이 뜨면 거기 주소창에 주소를 넣은 뒤 이어서 물을 수 있다 (이슈 #433) */
export function useOpenBrowserWindow() {
  return useAction(() => aiAssistantApi.openBrowserWindow(browserWindowSessionId(useAiChatStore.getState().threadId)), {
    success: (view) => (view.opened ? '브라우저 창을 열었어요. 창의 주소창에 주소를 넣은 뒤 "이 화면에서 해 줘"라고 물어보세요' : '브라우저 창이 이미 열려 있어요'),
  });
}

/** 스트림으로 답을 받아 대화 저장소에 쌓는다. 이미 addQuestion을 한 질문에 대해 부른다. 실행 카드는 done 이벤트의 답에 담겨 온다 */
export async function runAiAsk({ questionId, question, screen, threadId, reasoning, images, webSearch, browser, screenControl, researchRunId, notion, drive, driveFileIds, controlId }: AiAskVariables): Promise<void> {
  const chat = () => useAiChatStore.getState();
  const controller = new AbortController();
  activeController = controller;
  let finished = false;
  // 대화를 비우거나 사원이 바뀌어 이 질문이 더는 대화에 없으면 서버 일도 그만두게 한다
  const unsubscribe = useAiChatStore.subscribe((state) => {
    if (!finished && state.pendingId !== questionId) controller.abort();
  });
  if (screenControl) useAiScreenControlStore.getState().setRunning(true);
  const firstQuestion = chat().entries.filter((entry) => entry.role === 'user').length <= 1;
  const browserSessionId = browser ? browserSessionIdFor(threadId, firstQuestion) : undefined;
  try {
    await aiAssistantApi.askStream(
      // 철강맨AI 패널만 이 함수를 쓰므로 실행 카드를 받는다 (사내 채팅 @AI는 카드 없음)
      // 지난 대화는 보내지 않는다: 서버가 저장한 대화에서 읽는다
      { question, screen, saveThread: true, ...(threadId !== null ? { threadId } : {}), actionCards: true, ...(reasoning ? { reasoning } : {}), ...(images?.length ? { images } : {}), ...(webSearch ? { webSearch: true } : {}), ...(browser ? { browser: true, browserSessionId } : {}), ...(controlId ? { agentControlId: controlId } : {}), ...(screenControl ? { screenControl: true, screenMap: currentScreenMap() } : {}), ...(researchRunId ? { researchRunId } : {}), ...(notion ? { notion: true } : {}), ...(drive ? { drive: true } : {}), ...(driveFileIds?.length ? { driveFileIds } : {}) },
      (event) => {
        if (event.type === 'ui_action') {
          void answerUiAction(event);
          return;
        }
        if (event.type === 'done' || event.type === 'error') finished = true;
        chat().applyStreamEvent(questionId, event);
        const savedThreadId = chat().threadId;
        if (event.type === 'done' && threadId === null && savedThreadId !== null) bindBrowserSession(savedThreadId);
      },
      controller.signal,
    );
    if (!finished) chat().addFailure(questionId, question, '답이 끝나기 전에 연결이 끊겼어요. 다시 물어봐 주세요');
  } catch (error) {
    const stopped = controller.signal.aborted || isAbortError(error);
    chat().addFailure(questionId, question, stopped ? AI_CHAT_STOPPED_REASON : errorMessageOf(error), stopped ? null : aiLlmFailureCodeOf(errorCodeOf(error)));
  } finally {
    unsubscribe();
    if (screenControl) {
      useAiScreenControlStore.getState().setRunning(false);
      hideAiCursor();
    }
    if (activeController === controller) activeController = null;
  }
}

/** 질문을 보내는 함수. `.stop()`은 받고 있는 답을 멈춘다 */
export function useAskAiAssistant() {
  const ask = (question: string, screen: AiAssistantScreenContext, reasoning?: AiReasoningLevel, images?: AiAssistantImageInput[], webSearch?: boolean, browser?: boolean, screenControl?: boolean, researchRunId?: number, notion?: boolean, extra: { drive?: boolean; driveFileIds?: string[] } = {}) => {
    const text = question.trim();
    const chat = useAiChatStore.getState();
    if (!text || chat.pendingId) return;
    const questionId = newAiChatId();
    const controlId = browser || screenControl ? crypto.randomUUID() : undefined;
    chat.addQuestion(questionId, text, reasoning, images, webSearch, browser, controlId);
    void runAiAsk({ questionId, question: text, screen, threadId: chat.threadId, reasoning, images, webSearch, browser, screenControl, researchRunId, notion, controlId, ...extra });
  };
  return Object.assign(ask, { stop: stopAiAssistant });
}

/** 저장한 대화 목록 (이슈 #399). 목록을 열 때마다 새로 읽는다 (그 사이 물은 대화가 맨 위로 온다) */
export function useAiChatThreads(enabled: boolean) {
  const me = useMe();
  return useInfiniteQuery({
    queryKey: aiAssistantKeys.threads(me.employeeId),
    queryFn: ({ pageParam }) => aiAssistantApi.listThreads(pageParam),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.size < last.total ? last.page + 1 : undefined),
    enabled,
    staleTime: 0,
  });
}

/** 저장한 대화를 열어 이 패널에 되살린다. 답을 기다리는 중이면 열지 않는다 */
export function useOpenAiChatThread() {
  return useAction(aiAssistantApi.getThread, { onSuccess: (thread) => useAiChatStore.getState().openThread(thread) });
}

/** 대화 지우기. 지금 보는 대화를 지우면 새 대화가 된다 (답을 기다리는 중이면 그 답은 저장되지 않는다) */
export function useDeleteAiChatThread() {
  return useAction(aiAssistantApi.deleteThread, {
    success: '대화를 지웠어요',
    onSuccess: (removed) => useAiChatStore.getState().forgetThread(removed.id),
  });
}

/**
 * 새로고침하면 이 탭에서 보던 저장한 대화를 다시 연다 (이슈 #399). 보는 대화가 바뀔 때마다 이 탭에 적어 둔다.
 * 그 사이 지웠거나 못 읽으면 조용히 새 대화로 둔다.
 */
export function useRememberAiChatThread() {
  const me = useMe();
  const threadId = useAiChatStore((state) => state.threadId);
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    const chat = useAiChatStore.getState();
    const saved = readAiChatThread(me.employeeId);
    if (saved === null || chat.threadId !== null || chat.entries.length || chat.pendingId) return;
    aiAssistantApi.getThread(saved).then(
      (thread) => {
        const now = useAiChatStore.getState();
        // 읽는 사이 사용자가 질문했거나 다른 대화를 열었으면 덮어쓰지 않는다
        if (now.threadId === null && !now.entries.length && !now.pendingId) now.openThread(thread);
      },
      () => writeAiChatThread(me.employeeId, null),
    );
  }, [me.employeeId]);
  const previous = useRef<number | null>(null);
  useEffect(() => {
    // 되살리기 전(처음 null)에는 지우지 않는다. 보던 대화가 있다가 비면(새 대화·지움) 지운다
    if (threadId !== null) writeAiChatThread(me.employeeId, threadId);
    else if (previous.current !== null) writeAiChatThread(me.employeeId, null);
    previous.current = threadId;
  }, [me.employeeId, threadId]);
}
