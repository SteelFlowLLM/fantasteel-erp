// 화면 아래 가운데에 잠깐 뜨는 안내 (옛 stores/toast.ts를 옮김).
import { create } from 'zustand';
import { ApiError } from '@/api/client';

export type ToastKind = 'info' | 'ok' | 'error';

export interface ToastItem {
  id: number;
  kind: ToastKind;
  text: string;
}

interface ToastState {
  items: ToastItem[];
  push: (kind: ToastKind, text: string) => void;
  dismiss: (id: number) => void;
}

let sequence = 0;

export const useToastStore = create<ToastState>((set, get) => ({
  items: [],
  push: (kind, text) => {
    sequence += 1;
    const id = sequence;
    set((state) => ({ items: [...state.items, { id, kind, text }] }));
    setTimeout(() => get().dismiss(id), kind === 'error' ? 6000 : 3500);
  },
  dismiss: (id) => set((state) => ({ items: state.items.filter((t) => t.id !== id) })),
}));

/** 오류를 사람이 읽을 문구로 바꾼다. 업무 오류는 코드를 함께 보인다. */
export function errorMessageOf(error: unknown): string {
  if (error instanceof ApiError) return `${error.message} (${error.code})`;
  if (error instanceof Error) return error.message;
  return '알 수 없는 오류가 생겼어요';
}

export const toast = {
  info: (text: string) => useToastStore.getState().push('info', text),
  ok: (text: string) => useToastStore.getState().push('ok', text),
  error: (text: string) => useToastStore.getState().push('error', text),
  apiError: (error: unknown) => useToastStore.getState().push('error', errorMessageOf(error)),
};
