// 메신저 실시간 상태 (서버 모드): 접속 중인 사원, 방별 입력 중인 사원. 서버 데이터가 아니라 소켓으로만 오는 잠깐의 상태라 스토어에 둔다.
// 가짜 DB 모드에는 소켓이 없어 비어 있고, 화면은 표시하지 않는다.
import { create } from 'zustand';
import { TYPING_SHOW_MS } from '@fantasteel/shared';

export interface TypingMember {
  employeeId: number;
  employeeName: string;
  /** 이 시각(ms)까지 보인다 */
  until: number;
}

interface MessengerLiveState {
  /** 소켓에 연결됐는지. 끊겼으면 접속 표시를 믿을 수 없어 숨긴다 */
  connected: boolean;
  online: ReadonlySet<number>;
  /** 방 id → 입력 중인 사원 */
  typing: Readonly<Record<number, readonly TypingMember[]>>;
  /** 소켓 훅이 넣어 두는 '입력 중' 보내기 함수 (연결 전에는 null) */
  sendTyping: ((chatRoomId: number) => void) | null;
  setConnected: (connected: boolean) => void;
  setOnline: (employeeIds: readonly number[]) => void;
  setPresence: (employeeId: number, online: boolean) => void;
  addTyping: (chatRoomId: number, member: { employeeId: number; employeeName: string }, now?: number) => void;
  /** 그 방에서 이 사원의 입력 중 표시를 지운다 (메시지를 보냈을 때) */
  clearTyping: (chatRoomId: number, employeeId: number) => void;
  /** 시간이 지난 입력 중 표시를 지운다 */
  pruneTyping: (now?: number) => void;
  setSendTyping: (send: ((chatRoomId: number) => void) | null) => void;
  reset: () => void;
}

const empty = { connected: false, online: new Set<number>() as ReadonlySet<number>, typing: {}, sendTyping: null };

export const useMessengerLiveStore = create<MessengerLiveState>((set) => ({
  ...empty,
  setConnected: (connected) => set(connected ? { connected } : { connected, online: new Set(), typing: {} }),
  setOnline: (employeeIds) => set({ online: new Set(employeeIds) }),
  setPresence: (employeeId, online) =>
    set((state) => {
      const next = new Set(state.online);
      if (online) next.add(employeeId);
      else next.delete(employeeId);
      return { online: next };
    }),
  addTyping: (chatRoomId, member, now = Date.now()) =>
    set((state) => {
      const others = (state.typing[chatRoomId] ?? []).filter((t) => t.employeeId !== member.employeeId);
      return { typing: { ...state.typing, [chatRoomId]: [...others, { ...member, until: now + TYPING_SHOW_MS }] } };
    }),
  clearTyping: (chatRoomId, employeeId) =>
    set((state) => ({ typing: { ...state.typing, [chatRoomId]: (state.typing[chatRoomId] ?? []).filter((t) => t.employeeId !== employeeId) } })),
  pruneTyping: (now = Date.now()) =>
    set((state) => {
      const next: Record<number, readonly TypingMember[]> = {};
      let changed = false;
      for (const [roomId, members] of Object.entries(state.typing)) {
        const alive = members.filter((m) => m.until > now);
        if (alive.length !== members.length) changed = true;
        if (alive.length > 0) next[Number(roomId)] = alive;
      }
      return changed ? { typing: next } : state;
    }),
  setSendTyping: (sendTyping) => set({ sendTyping }),
  reset: () => set(empty),
}));

/** 방에서 입력 중인 사람 문구. 없으면 null */
export function typingText(members: readonly TypingMember[]): string | null {
  if (members.length === 0) return null;
  if (members.length === 1) return `${members[0].employeeName}님이 입력 중…`;
  if (members.length === 2) return `${members[0].employeeName}님, ${members[1].employeeName}님이 입력 중…`;
  return `${members[0].employeeName}님 외 ${members.length - 1}명이 입력 중…`;
}
