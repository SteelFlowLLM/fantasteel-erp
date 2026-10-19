// AI 어시스턴트 대화. 답을 받은 질문은 서버가 대화(thread)로 저장하고(이슈 #399, 문서에 없는 기능), 이 탭 메모리에는 지금 보는 대화를 둔다.
// 생각 과정·도구 기록·사진·브라우저 화면 사진·실패 줄은 저장하지 않아 이 탭 메모리에만 있고, 저장한 대화를 다시 열면 보이지 않는다.
import type {
  AiActionCard,
  AiActionCardExecuteResult,
  AiAssistantImageInput,
  AiAssistantReplyView,
  AiAssistantSource,
  AiAssistantStreamEvent,
  AiAssistantTurn,
  AiChatThreadRef,
  AiChatThreadView,
  AiReasoningLevel,
  AiWebSource,
} from '@fantasteel/shared';
import { create } from 'zustand';
import { appendBrowserFrame, toBrowserFrame, type AiBrowserFrame } from '@/lib/aiBrowser';

/** 서버로 함께 보내는 지난 대화 수 (회의 질문). 서버도 최근 10개만 쓴다. 철강맨AI 패널은 서버가 저장한 대화에서 읽는다 */
export const AI_CHAT_HISTORY_LIMIT = 10;

/**
 * 답에 붙은 실행 카드 한 장 (REQ-AST-005). 서버는 처음 카드와 실행 여부만 저장한다(이슈 #399).
 * card는 사용자가 고친 값을 담고(고친 값은 저장하지 않음), done이면 result가 만든 업무다. dismissed는 사용자가 닫은 카드(저장하지 않음).
 */
export interface AiChatCard {
  card: AiActionCard;
  status: 'ready' | 'dismissed' | 'done';
  result?: AiActionCardExecuteResult['registered'];
}

const readyCards = (cards: readonly AiActionCard[]): { cards?: AiChatCard[] } =>
  cards.length ? { cards: cards.map((card): AiChatCard => ({ card, status: 'ready' })) } : {};

/** 답을 만드는 과정의 한 단계. 일어난 순서대로 쌓는다 */
export type AiTimelineStep =
  /** 모델의 생각 글. endedAt이 null이면 아직 생각 중 */
  | { kind: 'thinking'; text: string; startedAt: number; endedAt: number | null }
  /** 조회 도구를 부르기 전에 모델이 남긴 중간 글 (최종 답이 아니다) */
  | { kind: 'note'; text: string }
  /** 조회 도구 한 번. result가 null이면 조회 중 */
  | { kind: 'tool'; id: string; name: string; arguments: string; result: AiToolResult | null };

export interface AiToolResult {
  label: string | null;
  resultPreview: string;
  durationMs: number;
  /** 웹 도구일 때만: 찾은 결과·읽은 페이지 (이슈 #367). 제목은 웹에서 온 글이라 글로만 보인다 */
  webSources?: AiWebSource[];
}

/** 답을 기다리는 동안 보이는 진행 상황 */
export interface AiChatLive {
  steps: AiTimelineStep[];
  /** 지금까지 받은 답 글 (최종 답이 오면 그것으로 바뀐다) */
  answer: string;
  /** 이 질문에 보낸 생각 정도. 보내지 않았으면 null */
  reasoning: AiReasoningLevel | null;
  /** 브라우저 도구가 찍은 화면 사진 (이슈 #373). 오래된 것부터 최대 AI_BROWSER_MAX_FRAMES장 */
  browserFrames: AiBrowserFrame[];
}

export type AiChatEntry =
  /** images는 화면에 보이고 다시 물을 때 쓰려고 이 탭 메모리에만 둔다 (저장하지 않는다). 저장한 대화를 열면 imageCount(보낸 사진 수)만 있다 */
  | { id: string; role: 'user'; content: string; images?: AiAssistantImageInput[]; imageCount?: number; webSearch?: boolean; browser?: boolean }
  /**
   * steps는 접어 두는 '생각 과정', requestedReasoning·reasoningApplied는 생각 정도 안내용 (생각 정도를 보낸 질문만 담는다), cards는 실행 카드.
   * messageId는 서버에 저장한 답의 id (카드를 실행할 때 보낸다), unsaved는 저장하지 못한 답
   */
  | { id: string; role: 'assistant'; content: string; sources: AiAssistantSource[]; steps?: AiTimelineStep[]; requestedReasoning?: AiReasoningLevel; reasoningApplied?: boolean; cards?: AiChatCard[]; webSources?: AiWebSource[]; browserFrames?: AiBrowserFrame[]; messageId?: number; unsaved?: boolean }
  /** 답을 받지 못한 질문. content는 화면에 보일 실패 이유, reasoning은 다시 물을 때 쓸 생각 정도 */
  | { id: string; role: 'failure'; content: string; question: string; reasoning?: AiReasoningLevel; images?: AiAssistantImageInput[]; webSearch?: boolean; browser?: boolean };

/** 사용자가 멈췄을 때 실패 줄에 보이는 이유 */
export const AI_CHAT_STOPPED_REASON = '멈췄어요';

export const emptyAiChatLive = (reasoning: AiReasoningLevel | null = null): AiChatLive => ({ steps: [], answer: '', reasoning, browserFrames: [] });

/** 생각 중인 마지막 단계를 닫는다 (생각이 아닌 다음 이벤트가 오면 생각이 끝난 것) */
function closeThinking(steps: AiTimelineStep[], now: number): AiTimelineStep[] {
  const last = steps.at(-1);
  if (last?.kind !== 'thinking' || last.endedAt !== null) return steps;
  return [...steps.slice(0, -1), { ...last, endedAt: now }];
}

/** 진행 중 이벤트(thinking·answer·tool_start·tool_end·browser_frame)를 진행 상황에 반영한다. done·error는 호출하는 쪽이 따로 다룬다 */
export function reduceAiChatLive(live: AiChatLive, event: AiAssistantStreamEvent, now: number): AiChatLive {
  switch (event.type) {
    case 'thinking': {
      const last = live.steps.at(-1);
      if (last?.kind === 'thinking' && last.endedAt === null) {
        return { ...live, steps: [...live.steps.slice(0, -1), { ...last, text: last.text + event.text }] };
      }
      return { ...live, steps: [...live.steps, { kind: 'thinking', text: event.text, startedAt: now, endedAt: null }] };
    }
    case 'answer':
      return { ...live, steps: closeThinking(live.steps, now), answer: live.answer + event.text };
    case 'tool_start': {
      const steps = closeThinking(live.steps, now);
      // 답 글 뒤에 도구를 부르면 그 글은 최종 답이 아니라 중간 글이다
      const note = live.answer.trim();
      const withNote: AiTimelineStep[] = note ? [...steps, { kind: 'note', text: note }] : steps;
      return { ...live, steps: [...withNote, { kind: 'tool', id: event.id, name: event.name, arguments: event.arguments, result: null }], answer: '' };
    }
    case 'tool_end': {
      const steps = closeThinking(live.steps, now).map((step): AiTimelineStep =>
        step.kind === 'tool' && step.id === event.id
          ? { ...step, result: { label: event.label, resultPreview: event.resultPreview, durationMs: event.durationMs, ...(event.webSources ? { webSources: event.webSources } : {}) } }
          : step,
      );
      return { ...live, steps };
    }
    case 'browser_frame': {
      // 사진이 규칙에 맞지 않으면 버린다 (도구 줄은 그대로 보인다)
      const frame = toBrowserFrame(event);
      return frame ? { ...live, browserFrames: appendBrowserFrame(live.browserFrames, frame) } : live;
    }
    default:
      return live;
  }
}

/** 이벤트 없이 done만 온 경우를 위해, 답에 담긴 조회 기록과 생각 글로 단계를 만든다 */
function stepsFromReply(reply: AiAssistantReplyView): AiTimelineStep[] {
  return [
    ...(reply.thinking ? [{ kind: 'thinking' as const, text: reply.thinking, startedAt: 0, endedAt: 0 }] : []),
    ...reply.toolCalls.map((call, index) => ({
      kind: 'tool' as const,
      id: `reply-${index}`,
      name: call.name,
      arguments: call.arguments,
      result: { label: null, resultPreview: call.resultPreview, durationMs: call.durationMs },
    })),
  ];
}

/**
 * done 이벤트로 받은 최종 답을 대화 줄로 만든다. 최종 답이 지금까지 받은 글을 대신한다.
 * thread: 저장한 대화 (저장을 요청하지 않았으면 undefined, 저장에 실패했으면 null)
 */
export function aiAnswerEntryFromReply(live: AiChatLive, reply: AiAssistantReplyView, now: number, id: string, thread?: AiChatThreadRef | null): AiChatEntry {
  const liveSteps = closeThinking(live.steps, now);
  return {
    id,
    role: 'assistant',
    content: reply.answer,
    sources: reply.sources,
    steps: liveSteps.length ? liveSteps : stepsFromReply(reply),
    ...(reply.webSources ? { webSources: reply.webSources } : {}),
    ...(live.browserFrames.length ? { browserFrames: live.browserFrames } : {}),
    ...(live.reasoning ? { requestedReasoning: live.reasoning, reasoningApplied: reply.reasoningApplied } : {}),
    ...readyCards(reply.actionCards),
    ...(thread ? { messageId: thread.assistantMessageId } : thread === null ? { unsaved: true } : {}),
  };
}

/** 저장한 대화를 대화 줄로 되살린다. 생각 과정·사진·브라우저 화면 사진은 저장하지 않아 없다 */
export function aiChatEntriesFromThread(thread: AiChatThreadView): AiChatEntry[] {
  return thread.messages.map((message): AiChatEntry => {
    const id = `saved-${message.id}`;
    if (message.role === 'user') {
      return { id, role: 'user', content: message.content, ...(message.imageCount ? { imageCount: message.imageCount } : {}), ...(message.webSearch ? { webSearch: true } : {}), ...(message.browser ? { browser: true } : {}) };
    }
    return {
      id,
      role: 'assistant',
      content: message.content,
      sources: message.sources,
      messageId: message.id,
      ...(message.webSources ? { webSources: message.webSources } : {}),
      ...(message.reasoning ? { requestedReasoning: message.reasoning, reasoningApplied: message.reasoningApplied } : {}),
      ...(message.actionCards.length ? { cards: message.actionCards.map((item): AiChatCard => ({ card: item.card, status: item.status, ...(item.result ? { result: item.result } : {}) })) } : {}),
    };
  });
}

/** 실패 줄: 다시 물을 때 같은 생각 정도·사진으로 묻도록 질문 때의 값을 담는다 */
function failureEntry(state: Pick<AiChatState, 'entries' | 'live'>, questionId: string, question: string, reason: string): AiChatEntry {
  const asked = state.entries.find((entry) => entry.id === questionId);
  const images = asked?.role === 'user' ? asked.images : undefined;
  const webSearch = asked?.role === 'user' ? asked.webSearch : undefined;
  const browser = asked?.role === 'user' ? asked.browser : undefined;
  const reasoning = state.live?.reasoning;
  return { id: newAiChatId(), role: 'failure', content: reason, question, ...(reasoning ? { reasoning } : {}), ...(images ? { images } : {}), ...(webSearch ? { webSearch } : {}), ...(browser ? { browser } : {}) };
}

interface AiChatState {
  /** 이 대화의 사원. 다른 사원으로 들어오면 대화를 비운다 */
  ownerEmployeeId: number | null;
  /** 서버에 저장한 대화 id (이슈 #399). 첫 답을 저장하기 전이면 null */
  threadId: number | null;
  entries: AiChatEntry[];
  /** 답을 기다리는 질문의 id */
  pendingId: string | null;
  /** 답을 기다리는 동안의 진행 상황 (생각·조회·받은 답 글) */
  live: AiChatLive | null;
  claim: (employeeId: number) => void;
  /** reasoning: 이 질문에 보내는 생각 정도 (없으면 보내지 않는다), images: 질문과 함께 보내는 사진 */
  addQuestion: (id: string, question: string, reasoning?: AiReasoningLevel, images?: AiAssistantImageInput[], webSearch?: boolean, browser?: boolean) => void;
  addAnswer: (questionId: string, answer: string, sources: AiAssistantSource[], cards?: AiActionCard[]) => void;
  /** 카드 한 장을 바꾼다 (고치기·닫기·실행 결과). 답이 사라졌으면 아무 일도 하지 않는다 */
  updateCard: (entryId: string, key: string, patch: Partial<AiChatCard>) => void;
  addFailure: (questionId: string, question: string, reason: string) => void;
  /** 스트림 이벤트 하나를 반영한다. done은 답 줄을, error는 실패 줄을 더한다 */
  applyStreamEvent: (questionId: string, event: AiAssistantStreamEvent, now?: number) => void;
  /** 실패한 질문과 실패 줄을 지운다 (다시 물을 때) */
  removeFailure: (failureId: string) => void;
  /** 저장한 대화를 연다 (답을 기다리는 중이면 열지 않는다) */
  openThread: (thread: AiChatThreadView) => void;
  /** 지운 대화가 지금 보는 대화면 새 대화로. 답을 기다리는 중이면 대화 id만 잊는다 (다음 질문은 새 대화) */
  forgetThread: (threadId: number) => void;
  /** 새 대화. 저장한 대화는 서버에 남는다 */
  clear: () => void;
}

let sequence = 0;
export const newAiChatId = (): string => `ai-${Date.now()}-${(sequence += 1)}`;

export const useAiChatStore = create<AiChatState>((set) => ({
  ownerEmployeeId: null,
  threadId: null,
  entries: [],
  pendingId: null,
  live: null,
  claim: (employeeId) =>
    set((state) => (state.ownerEmployeeId === employeeId ? state : { ownerEmployeeId: employeeId, threadId: null, entries: [], pendingId: null, live: null })),
  addQuestion: (id, question, reasoning, images, webSearch, browser) =>
    set((state) => ({
      entries: [...state.entries, { id, role: 'user', content: question, ...(images?.length ? { images } : {}), ...(webSearch ? { webSearch } : {}), ...(browser ? { browser } : {}) }],
      pendingId: id,
      live: emptyAiChatLive(reasoning ?? null),
    })),
  // 그사이 대화를 비웠거나 사원이 바뀌었으면 늦게 온 답은 버린다
  addAnswer: (questionId, answer, sources, cards = []) =>
    set((state) =>
      state.pendingId === questionId
        ? { entries: [...state.entries, { id: newAiChatId(), role: 'assistant', content: answer, sources, ...readyCards(cards) }], pendingId: null, live: null }
        : state,
    ),
  updateCard: (entryId, key, patch) =>
    set((state) => ({
      entries: state.entries.map((entry) =>
        entry.id === entryId && entry.role === 'assistant' && entry.cards
          ? { ...entry, cards: entry.cards.map((item) => (item.card.key === key ? { ...item, ...patch } : item)) }
          : entry,
      ),
    })),
  addFailure: (questionId, question, reason) =>
    set((state) =>
      state.pendingId === questionId
        ? {
            entries: [...state.entries, failureEntry(state, questionId, question, reason)],
            pendingId: null,
            live: null,
          }
        : state,
    ),
  applyStreamEvent: (questionId, event, now = Date.now()) =>
    set((state) => {
      if (state.pendingId !== questionId || !state.live) return state;
      if (event.type === 'done') {
        return {
          entries: [...state.entries, aiAnswerEntryFromReply(state.live, event.reply, now, newAiChatId(), event.thread)],
          pendingId: null,
          live: null,
          ...(event.thread ? { threadId: event.thread.id } : {}),
        };
      }
      if (event.type === 'error') {
        const question = state.entries.find((entry) => entry.id === questionId)?.content ?? '';
        return { entries: [...state.entries, failureEntry(state, questionId, question, event.message)], pendingId: null, live: null };
      }
      return { live: reduceAiChatLive(state.live, event, now) };
    }),
  removeFailure: (failureId) =>
    set((state) => {
      const index = state.entries.findIndex((entry) => entry.id === failureId);
      if (index < 0) return state;
      const before = state.entries[index - 1];
      const from = before?.role === 'user' ? index - 1 : index;
      return { entries: [...state.entries.slice(0, from), ...state.entries.slice(index + 1)] };
    }),
  openThread: (thread) => set((state) => (state.pendingId ? state : { threadId: thread.id, entries: aiChatEntriesFromThread(thread), live: null })),
  forgetThread: (threadId) =>
    set((state) => (state.threadId !== threadId ? state : state.pendingId ? { threadId: null } : { threadId: null, entries: [], live: null })),
  clear: () => set({ threadId: null, entries: [], pendingId: null, live: null }),
}));

/** 서버로 보낼 지난 대화: 답을 받은 질문과 답만, 최근 것부터 AI_CHAT_HISTORY_LIMIT개 */
export function aiChatHistory(entries: readonly AiChatEntry[]): AiAssistantTurn[] {
  const turns: AiAssistantTurn[] = [];
  entries.forEach((entry, index) => {
    const next = entries[index + 1];
    if (entry.role === 'user' && next?.role === 'assistant') turns.push({ role: 'user', content: entry.content }, { role: 'assistant', content: next.content });
  });
  return turns.slice(-AI_CHAT_HISTORY_LIMIT);
}
