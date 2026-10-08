import { createContext, useContext, useMemo } from 'react';
import { mockEmployeeIdByNo } from '@/api/actor';
import { isServerDataSource } from '@/api/http';
import type { SessionUser } from '@/api/session';

/** 로그인한 사원. (main) 레이아웃이 사원 정보를 읽은 뒤에 채운다. */
export const MeContext = createContext<SessionUser | null>(null);

/** 로그인한 사원. 셸 안쪽((main) 라우트) 화면에서만 쓴다. */
export function useMe(): SessionUser {
  const me = useContext(MeContext);
  if (!me) throw new Error('로그인한 사원 정보가 없어요. (main) 화면 안에서만 쓸 수 있어요.');
  return me;
}

/**
 * 가짜 DB만 쓰는 화면(승인함 배지·Message → ERP 초안 등)과 비교하거나 넘길 내 사원 id. 메신저·업무방은 서버에 연결돼 useMe().employeeId를 쓴다.
 * 서버 모드의 useMe().employeeId는 서버 id라, 사원번호가 같은 가짜 DB 사원을 찾는다 (서버에서 새로 등록한 사원은 0).
 */
export function useMockEmployeeId(): number {
  const me = useMe();
  return useMemo(() => (isServerDataSource() ? (mockEmployeeIdByNo(me.employeeNo) ?? 0) : me.employeeId), [me.employeeId, me.employeeNo]);
}
