// 이 탭에서 고른 계정(사원 id). 탭마다 다른 사원으로 들어갈 수 있게 sessionStorage에 둔다 (PLAN 2장).
// 사원 정보·권한은 서버 데이터라 TanStack Query로 읽는다 (useSessionUser).
import { create } from 'zustand';
import { readSessionEmployeeId, writeSessionEmployeeId } from '@/lib/sessionEmployee';

interface SessionState {
  /** sessionStorage를 읽었는지 (서버 렌더링 중에는 false) */
  hydrated: boolean;
  employeeId: number | null;
  /** 사용자가 직접 나간 경우(계정 바꾸기). 이때는 계정 선택 뒤 원래 화면으로 돌아가지 않는다. */
  signedOut: boolean;
  hydrate: () => void;
  signIn: (employeeId: number) => void;
  signOut: () => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  hydrated: false,
  employeeId: null,
  signedOut: false,
  hydrate: () => set({ hydrated: true, employeeId: readSessionEmployeeId(), signedOut: false }),
  signIn: (employeeId) => {
    writeSessionEmployeeId(employeeId);
    set({ hydrated: true, employeeId, signedOut: false });
  },
  signOut: () => {
    writeSessionEmployeeId(null);
    set({ hydrated: true, employeeId: null, signedOut: true });
  },
}));
