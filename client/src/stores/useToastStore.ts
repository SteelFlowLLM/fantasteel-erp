// 화면 아래 가운데에 잠깐 뜨는 안내 (옛 stores/toast.ts를 옮김).
import { create } from 'zustand';
import { ApiError } from '@/api/errors';

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

/** 오류를 사람이 읽을 문구로 바꾼다. 업무 오류는 코드를 함께 보인다 (예: "해당 업무 권한 없음 · 기준정보 관리 사용 권한이 필요해요 (COM-002)"). */
/**
 * 9.3에 전용 코드가 없어 다른 코드를 빌려 쓰는 오류의 제목 (#531). 서버 덧붙임(detail)이 이 말로 시작하면 코드 제목 대신 쓴다.
 * 예: 원료 LOT 잔량 부족은 INV-001('예약·배정 가능한 매수 부족')을 빌려 쓴다 (production.md 8장)
 */
const BORROWED_TITLES: { code: string; detailPrefix: string; title: string }[] = [{ code: 'INV-001', detailPrefix: '원료 LOT 잔량이 부족해요', title: '원료 재고 부족' }];

/** 오류 안내 제목: 빌려 쓴 코드면 그 상황의 제목, 아니면 9.3 문구 */
export function errorTitleOf(error: ApiError): string {
  return BORROWED_TITLES.find((b) => b.code === error.code && error.detail?.startsWith(b.detailPrefix))?.title ?? error.message;
}

export function errorMessageOf(error: unknown): string {
  if (error instanceof ApiError) return `${errorTitleOf(error)}${error.detail ? ` · ${error.detail}` : ''} (${error.code})`;
  if (error instanceof Error) return error.message;
  return '알 수 없는 오류가 생겼어요';
}

export const toast = {
  info: (text: string) => useToastStore.getState().push('info', text),
  ok: (text: string) => useToastStore.getState().push('ok', text),
  error: (text: string) => useToastStore.getState().push('error', text),
  apiError: (error: unknown) => useToastStore.getState().push('error', errorMessageOf(error)),
};
