import { createContext, useContext } from 'react';
import type { SessionUser } from '@/api/session';

/** 로그인한 사원. (main) 레이아웃이 사원 정보를 읽은 뒤에 채운다. */
export const MeContext = createContext<SessionUser | null>(null);

/** 로그인한 사원. 셸 안쪽((main) 라우트) 화면에서만 쓴다. */
export function useMe(): SessionUser {
  const me = useContext(MeContext);
  if (!me) throw new Error('로그인한 사원 정보가 없어요. (main) 화면 안에서만 쓸 수 있어요.');
  return me;
}
