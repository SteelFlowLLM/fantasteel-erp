// AI 어시스턴트 대화. 대화 기록은 서버에 저장하지 않으므로(저장 여부 미결정, 요구사항 21장) 이 탭 메모리에만 둔다.
// 패널을 닫았다 열어도 남고, 새로고침하거나 다른 사원으로 들어오면 사라진다.
import type { AiAssistantSource, AiAssistantTurn } from '@fantasteel/shared';
import { create } from 'zustand';

/** 서버로 함께 보내는 지난 대화 수. 서버도 최근 10개만 쓴다 */
export const AI_CHAT_HISTORY_LIMIT = 10;

export type AiChatEntry =
  | { id: string; role: 'user'; content: string }
  | { id: string; role: 'assistant'; content: string; sources: AiAssistantSource[] }
  /** 답을 받지 못한 질문. content는 화면에 보일 실패 이유 */
  | { id: string; role: 'failure'; content: string; question: string };

interface AiChatState {
  /** 이 대화의 사원. 다른 사원으로 들어오면 대화를 비운다 */
  ownerEmployeeId: number | null;
  entries: AiChatEntry[];
  /** 답을 기다리는 질문의 id */
  pendingId: string | null;
  claim: (employeeId: number) => void;
  addQuestion: (id: string, question: string) => void;
  addAnswer: (questionId: string, answer: string, sources: AiAssistantSource[]) => void;
  addFailure: (questionId: string, question: string, reason: string) => void;
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
  claim: (employeeId) => set((state) => (state.ownerEmployeeId === employeeId ? state : { ownerEmployeeId: employeeId, entries: [], pendingId: null })),
  addQuestion: (id, question) => set((state) => ({ entries: [...state.entries, { id, role: 'user', content: question }], pendingId: id })),
  // 그사이 대화를 비웠거나 사원이 바뀌었으면 늦게 온 답은 버린다
  addAnswer: (questionId, answer, sources) =>
    set((state) =>
      state.pendingId === questionId
        ? { entries: [...state.entries, { id: newAiChatId(), role: 'assistant', content: answer, sources }], pendingId: null }
        : state,
    ),
  addFailure: (questionId, question, reason) =>
    set((state) =>
      state.pendingId === questionId ? { entries: [...state.entries, { id: newAiChatId(), role: 'failure', content: reason, question }], pendingId: null } : state,
    ),
  removeFailure: (failureId) =>
    set((state) => {
      const index = state.entries.findIndex((entry) => entry.id === failureId);
      if (index < 0) return state;
      const before = state.entries[index - 1];
      const from = before?.role === 'user' ? index - 1 : index;
      return { entries: [...state.entries.slice(0, from), ...state.entries.slice(index + 1)] };
    }),
  clear: () => set({ entries: [], pendingId: null }),
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
