import { create } from 'zustand';
import type { AuthUser, Permission } from '@fantasteel/shared';

// 창(탭)마다 다른 사원으로 로그인할 수 있게 sessionStorage에 둔다.
const KEY = 'fantasteel.session';
interface Session { accessToken: string; user: AuthUser }

function load(): Session | null {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) ?? 'null') as Session | null;
  } catch {
    return null;
  }
}

interface AuthState {
  session: Session | null;
  setSession: (s: Session | null) => void;
  setUser: (u: AuthUser) => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  session: load(),
  setSession: (session) => {
    if (session) sessionStorage.setItem(KEY, JSON.stringify(session));
    else sessionStorage.removeItem(KEY);
    set({ session });
  },
  setUser: (user) => {
    const s = get().session;
    if (!s) return;
    const next = { ...s, user };
    sessionStorage.setItem(KEY, JSON.stringify(next));
    set({ session: next });
  },
}));

export const getAccessToken = () => useAuthStore.getState().session?.accessToken ?? null;

/** 로그인 사원. 셸 안쪽(로그인 후) 화면에서만 쓴다. */
export function useMe(): AuthUser {
  const user = useAuthStore((s) => s.session?.user);
  if (!user) throw new Error('로그인이 필요합니다');
  return user;
}

/** 변경 권한(USE)이 있는지 — 버튼 활성화에 쓴다. 서버가 다시 검사한다. */
export function canUse(user: AuthUser, ...anyOf: Permission[]): boolean {
  return anyOf.some((p) => user.permissions[p] === 'USE');
}
/** 조회 권한(VIEW 이상)이 있는지 — 메뉴·화면 접근에 쓴다. */
export function canView(user: AuthUser, ...anyOf: Permission[]): boolean {
  return anyOf.some((p) => !!user.permissions[p]);
}
export const isDepartmentHead = (user: AuthUser) => user.headDepartmentIds.length > 0;
