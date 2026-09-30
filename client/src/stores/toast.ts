import { create } from 'zustand';
import { ApiError } from '@/api/client';

export interface ToastItem { id: number; kind: 'info' | 'ok' | 'error'; text: string }
let seq = 0;

export const useToastStore = create<{ items: ToastItem[]; push: (kind: ToastItem['kind'], text: string) => void }>((set) => ({
  items: [],
  push: (kind, text) => {
    const id = ++seq;
    set((s) => ({ items: [...s.items, { id, kind, text }] }));
    setTimeout(() => set((s) => ({ items: s.items.filter((t) => t.id !== id) })), kind === 'error' ? 6000 : 3500);
  },
}));

export const toast = {
  info: (text: string) => useToastStore.getState().push('info', text),
  ok: (text: string) => useToastStore.getState().push('ok', text),
  error: (text: string) => useToastStore.getState().push('error', text),
  /** 서버 오류를 코드와 함께 보여준다. */
  apiError: (e: unknown) => useToastStore.getState().push('error', e instanceof ApiError ? `${e.message}${e.code && !e.code.startsWith('NETWORK') ? ` (${e.code})` : ''}` : e instanceof Error ? e.message : '알 수 없는 오류가 발생했습니다'),
};
