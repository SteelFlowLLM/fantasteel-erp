// 아직 서버(또는 가짜 DB)에 저장되지 않은 내 메시지 (보내는 중·실패). 저장되면 지우고, 그 뒤로는 조회 결과(TanStack Query)만 쓴다.
// 실패한 메시지는 다시 보내거나 지울 때까지 남는다. 새로고침하면 사라진다 (브라우저 메모리에만 둔다).
// 메시지마다 보내기 id(clientMessageId)를 붙여, 응답 직전에 끊겨 다시 보내도 서버가 두 번 저장하지 않는다 (#151).
import { create } from 'zustand';
import type { SendMessageInput } from '@/api/messenger';
import { errorMessageOf } from '@/stores/useToastStore';

export type OutboxStatus = 'sending' | 'failed';

export interface OutboxItem {
  localId: string;
  input: SendMessageInput;
  status: OutboxStatus;
  /** 실패 이유 (실패일 때만) */
  errorText: string | null;
  createdAt: string;
}

interface OutboxState {
  items: OutboxItem[];
  add: (input: SendMessageInput) => string;
  markSending: (localId: string) => void;
  markFailed: (localId: string, errorText: string) => void;
  remove: (localId: string) => void;
}

let sequence = 0;

/** 보내기 id: 브라우저 UUID (없으면 시각·순번으로 만든다). 다시 보내기에도 같은 값을 쓴다 */
function newClientMessageId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now().toString(36)}-${sequence.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export const useOutboxStore = create<OutboxState>((set) => ({
  items: [],
  add: (input) => {
    sequence += 1;
    const localId = `local-${Date.now()}-${sequence}`;
    const withId: SendMessageInput = { ...input, clientMessageId: input.clientMessageId ?? newClientMessageId() };
    set((state) => ({ items: [...state.items, { localId, input: withId, status: 'sending', errorText: null, createdAt: new Date().toISOString() }] }));
    return localId;
  },
  markSending: (localId) => set((state) => ({ items: state.items.map((item) => (item.localId === localId ? { ...item, status: 'sending', errorText: null } : item)) })),
  markFailed: (localId, errorText) => set((state) => ({ items: state.items.map((item) => (item.localId === localId ? { ...item, status: 'failed', errorText } : item)) })),
  remove: (localId) => set((state) => ({ items: state.items.filter((item) => item.localId !== localId) })),
}));

/**
 * 보관함의 메시지를 보낸다. 성공하면 보관함에서 지우고 true, 실패하면 '실패'로 남기고 false.
 * 이미 보내는 중인 메시지를 다시 누르면 같은 메시지가 두 번 저장될 수 있어 건너뛴다.
 */
export async function deliverOutboxItem(localId: string, send: (input: SendMessageInput) => Promise<unknown>): Promise<boolean> {
  const store = useOutboxStore.getState();
  const item = store.items.find((i) => i.localId === localId);
  if (!item) return false;
  if (item.status === 'failed') store.markSending(localId);
  try {
    await send(item.input);
    useOutboxStore.getState().remove(localId);
    return true;
  } catch (error) {
    useOutboxStore.getState().markFailed(localId, errorMessageOf(error));
    return false;
  }
}

/** 실패한 메시지 다시 보내기. 보내는 중이면 아무것도 하지 않는다 */
export function retryOutboxItem(localId: string, send: (input: SendMessageInput) => Promise<unknown>): Promise<boolean> {
  const item = useOutboxStore.getState().items.find((i) => i.localId === localId);
  if (!item || item.status !== 'failed') return Promise.resolve(false);
  return deliverOutboxItem(localId, send);
}
