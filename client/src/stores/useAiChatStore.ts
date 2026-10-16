// AI 어시스턴트 대화. 대화 기록은 서버에 저장하지 않으므로(저장 여부 미결정, 요구사항 21장) 이 탭 메모리에만 둔다.
// 패널을 닫았다 열어도 남고, 새로고침하거나 다른 사원으로 들어오면 사라진다.
import type { AiActionCard, AiActionCardExecuteResult, AiAssistantSource, AiAssistantToolTrace, AiAssistantTurn } from '@fantasteel/shared';
import { create } from 'zustand';

/** 서버로 함께 보내는 지난 대화 수. 서버도 최근 10개만 쓴다 */
export const AI_CHAT_HISTORY_LIMIT = 10;

/**
 * 답에 붙은 실행 카드 한 장 (REQ-AST-005). 카드는 서버에 저장하지 않아 이 탭 메모리에만 있다.
 * card는 사용자가 고친 값을 담고, done이면 result가 만든 업무다. dismissed는 사용자가 닫은 카드.
 */
export interface AiChatCard {
  card: AiActionCard;
  status: 'ready' | 'dismissed' | 'done';
  result?: AiActionCardExecuteResult['registered'];
}

export type AiChatEntry =
  | { id: string; role: 'user'; content: string }
  /** toolCalls·thinking은 회의 질문 카드만 담는다 (AI 실행 기록) */
  | { id: string; role: 'assistant'; content: string; sources: AiAssistantSource[]; cards?: AiChatCard[]; toolCalls?: AiAssistantToolTrace[]; thinking?: string | null }
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
  addAnswer: (questionId: string, answer: string, sources: AiAssistantSource[], cards?: AiActionCard[]) => void;
  /** 카드 한 장을 바꾼다 (고치기·닫기·실행 결과). 답이 사라졌으면 아무 일도 하지 않는다 */
  updateCard: (entryId: string, key: string, patch: Partial<AiChatCard>) => void;
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
  addAnswer: (questionId, answer, sources, cards = []) =>
    set((state) =>
      state.pendingId === questionId
        ? {
            entries: [...state.entries, { id: newAiChatId(), role: 'assistant', content: answer, sources, ...(cards.length ? { cards: cards.map((card): AiChatCard => ({ card, status: 'ready' })) } : {}) }],
            pendingId: null,
          }
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
