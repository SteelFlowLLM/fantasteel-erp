// 메시지 메뉴(답장·수정·삭제·업무 등록)에서 고른 메시지. 메뉴는 고르자마자 닫혀서, 입력창 위 답장 줄·수정 창·삭제 확인 창이 이 값을 보고 그린다.
import { create } from 'zustand';
import type { MessageView } from '@/api/messenger';

interface MessageComposeState {
  /** 답장할 메시지 (그 방의 입력창 위에 보인다) */
  replyTo: MessageView | null;
  editing: MessageView | null;
  deleting: MessageView | null;
  /** 업무로 등록할 메시지 (16번) */
  tasking: MessageView | null;
  setReplyTo: (message: MessageView | null) => void;
  setEditing: (message: MessageView | null) => void;
  setDeleting: (message: MessageView | null) => void;
  setTasking: (message: MessageView | null) => void;
}

export const useMessageComposeStore = create<MessageComposeState>((set) => ({
  replyTo: null,
  editing: null,
  deleting: null,
  tasking: null,
  setReplyTo: (replyTo) => set({ replyTo }),
  setEditing: (editing) => set({ editing }),
  setDeleting: (deleting) => set({ deleting }),
  setTasking: (tasking) => set({ tasking }),
}));
