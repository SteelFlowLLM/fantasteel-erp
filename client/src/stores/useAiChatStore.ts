// AI 어시스턴트 대화. 대화 기록은 서버에 저장하지 않으므로(저장 여부 미결정, 요구사항 21장) 이 탭 메모리에만 둔다.
// 패널을 닫았다 열어도 남고, 새로고침하거나 다른 사원으로 들어오면 사라진다.
import type { AiApprovalDecision, AiAssistantImageInput, AiAssistantReplyView, AiAssistantSource, AiAssistantStreamEvent, AiAssistantTurn, AiReasoningLevel, AiWebSource } from '@fantasteel/shared';
import { create } from 'zustand';
import { reduceAiApprovals, setAiApprovalSending, settleAiApprovalsOnDisconnect, type AiApprovalCard } from '@/lib/aiApproval';

/** 서버로 함께 보내는 지난 대화 수. 서버도 최근 10개만 쓴다 */
export const AI_CHAT_HISTORY_LIMIT = 10;

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
  /** 쓰기 도구의 승인 카드 (approvalId마다 하나, 도구 줄은 toolId로 찾는다) */
  approvals: AiApprovalCard[];
}

export type AiChatEntry =
  /** images는 화면에 보이고 다시 물을 때 쓰려고 이 탭 메모리에만 둔다 (지난 대화로 서버에 보내지 않는다) */
  | { id: string; role: 'user'; content: string; images?: AiAssistantImageInput[]; webSearch?: boolean }
  /** steps는 접어 두는 '생각 과정', requestedReasoning·reasoningApplied는 생각 정도 안내용 (생각 정도를 보낸 질문만 담는다) */
  | { id: string; role: 'assistant'; content: string; sources: AiAssistantSource[]; steps?: AiTimelineStep[]; requestedReasoning?: AiReasoningLevel; reasoningApplied?: boolean; approvals?: AiApprovalCard[]; webSources?: AiWebSource[] }
  /** 답을 받지 못한 질문. content는 화면에 보일 실패 이유, reasoning은 다시 물을 때 쓸 생각 정도 */
  | { id: string; role: 'failure'; content: string; question: string; reasoning?: AiReasoningLevel; images?: AiAssistantImageInput[]; webSearch?: boolean; approvals?: AiApprovalCard[] };

/** 사용자가 멈췄을 때 실패 줄에 보이는 이유 */
export const AI_CHAT_STOPPED_REASON = '멈췄어요';

export const emptyAiChatLive = (reasoning: AiReasoningLevel | null = null): AiChatLive => ({ steps: [], answer: '', reasoning, approvals: [] });

/** 생각 중인 마지막 단계를 닫는다 (생각이 아닌 다음 이벤트가 오면 생각이 끝난 것) */
function closeThinking(steps: AiTimelineStep[], now: number): AiTimelineStep[] {
  const last = steps.at(-1);
  if (last?.kind !== 'thinking' || last.endedAt !== null) return steps;
  return [...steps.slice(0, -1), { ...last, endedAt: now }];
}

/** 진행 중 이벤트(thinking·answer·tool_start·tool_end·승인 카드)를 진행 상황에 반영한다. done·error는 호출하는 쪽이 따로 다룬다 */
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
    case 'approval_required':
      return { ...live, steps: closeThinking(live.steps, now), approvals: reduceAiApprovals(live.approvals, event) };
    case 'approval_resolved':
    case 'tool_execution':
      return { ...live, approvals: reduceAiApprovals(live.approvals, event) };
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

/** done 이벤트로 받은 최종 답을 대화 줄로 만든다. 최종 답이 지금까지 받은 글을 대신한다 */
export function aiAnswerEntryFromReply(live: AiChatLive, reply: AiAssistantReplyView, now: number, id: string): AiChatEntry {
  const liveSteps = closeThinking(live.steps, now);
  return {
    id,
    role: 'assistant',
    content: reply.answer,
    sources: reply.sources,
    steps: liveSteps.length ? liveSteps : stepsFromReply(reply),
    ...(reply.webSources ? { webSources: reply.webSources } : {}),
    ...(live.reasoning ? { requestedReasoning: live.reasoning, reasoningApplied: reply.reasoningApplied } : {}),
    ...(live.approvals.length ? { approvals: settleAiApprovalsOnDisconnect(live.approvals) } : {}),
  };
}

/** 실패 줄: 다시 물을 때 같은 생각 정도·사진으로 묻도록 질문 때의 값을 담는다 */
function failureEntry(state: Pick<AiChatState, 'entries' | 'live'>, questionId: string, question: string, reason: string): AiChatEntry {
  const asked = state.entries.find((entry) => entry.id === questionId);
  const images = asked?.role === 'user' ? asked.images : undefined;
  const webSearch = asked?.role === 'user' ? asked.webSearch : undefined;
  const reasoning = state.live?.reasoning;
  // 멈추거나 끊겨도 이미 만든 일정·초안으로 가는 링크는 남기고, 고르던 카드는 서버가 거부로 끝낸 대로 거부됨으로 닫는다
  const approvals = state.live?.approvals.length ? settleAiApprovalsOnDisconnect(state.live.approvals) : undefined;
  return {
    id: newAiChatId(),
    role: 'failure',
    content: reason,
    question,
    ...(reasoning ? { reasoning } : {}),
    ...(images ? { images } : {}),
    ...(webSearch ? { webSearch } : {}),
    ...(approvals ? { approvals } : {}),
  };
}

interface AiChatState {
  /** 이 대화의 사원. 다른 사원으로 들어오면 대화를 비운다 */
  ownerEmployeeId: number | null;
  entries: AiChatEntry[];
  /** 답을 기다리는 질문의 id */
  pendingId: string | null;
  /** 답을 기다리는 동안의 진행 상황 (생각·조회·받은 답 글) */
  live: AiChatLive | null;
  claim: (employeeId: number) => void;
  /** reasoning: 이 질문에 보내는 생각 정도 (없으면 보내지 않는다), images: 질문과 함께 보내는 사진 */
  addQuestion: (id: string, question: string, reasoning?: AiReasoningLevel, images?: AiAssistantImageInput[], webSearch?: boolean) => void;
  addAnswer: (questionId: string, answer: string, sources: AiAssistantSource[]) => void;
  addFailure: (questionId: string, question: string, reason: string) => void;
  /** 스트림 이벤트 하나를 반영한다. done은 답 줄을, error는 실패 줄을 더한다 */
  applyStreamEvent: (questionId: string, event: AiAssistantStreamEvent, now?: number) => void;
  /** 승인 카드의 허용·거부를 보내는 중이면 보낸 값, 보내기가 끝났거나 실패했으면 null. 카드를 끝내는 건 서버 이벤트뿐이다 */
  setApprovalSending: (approvalId: string, decision: AiApprovalDecision | null) => void;
  /** 실패한 질문과 실패 줄을 지운다 (다시 물을 때) */
  removeFailure: (failureId: string) => void;
  clear: () => void;
}

let sequence = 0;
export const newAiChatId = (): string => `ai-${Date.now()}-${(sequence += 1)}`;

export const useAiChatStore = create<AiChatState>((set) => ({
  ownerEmployeeId: null,
  entries: [],
  pendingId: null,
  live: null,
  claim: (employeeId) =>
    set((state) => (state.ownerEmployeeId === employeeId ? state : { ownerEmployeeId: employeeId, entries: [], pendingId: null, live: null })),
  addQuestion: (id, question, reasoning, images, webSearch) =>
    set((state) => ({
      entries: [...state.entries, { id, role: 'user', content: question, ...(images?.length ? { images } : {}), ...(webSearch ? { webSearch } : {}) }],
      pendingId: id,
      live: emptyAiChatLive(reasoning ?? null),
    })),
  // 그사이 대화를 비웠거나 사원이 바뀌었으면 늦게 온 답은 버린다
  addAnswer: (questionId, answer, sources) =>
    set((state) =>
      state.pendingId === questionId
        ? { entries: [...state.entries, { id: newAiChatId(), role: 'assistant', content: answer, sources }], pendingId: null, live: null }
        : state,
    ),
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
        return { entries: [...state.entries, aiAnswerEntryFromReply(state.live, event.reply, now, newAiChatId())], pendingId: null, live: null };
      }
      if (event.type === 'error') {
        const question = state.entries.find((entry) => entry.id === questionId)?.content ?? '';
        return { entries: [...state.entries, failureEntry(state, questionId, question, event.message)], pendingId: null, live: null };
      }
      return { live: reduceAiChatLive(state.live, event, now) };
    }),
  setApprovalSending: (approvalId, decision) =>
    set((state) => (state.live ? { live: { ...state.live, approvals: setAiApprovalSending(state.live.approvals, approvalId, decision) } } : state)),
  removeFailure: (failureId) =>
    set((state) => {
      const index = state.entries.findIndex((entry) => entry.id === failureId);
      if (index < 0) return state;
      const before = state.entries[index - 1];
      const from = before?.role === 'user' ? index - 1 : index;
      return { entries: [...state.entries.slice(0, from), ...state.entries.slice(index + 1)] };
    }),
  clear: () => set({ entries: [], pendingId: null, live: null }),
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
