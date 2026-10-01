import { skipToken, useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/api/queryKeys';
import { sessionApi } from '@/api/session';

/** 이 탭에서 고른 사원의 정보·권한. 관리자가 권한을 바꾸면 무효화로 다시 읽는다. */
export function useSessionUser(employeeId: number | null) {
  return useQuery({
    queryKey: queryKeys.session(employeeId ?? 0),
    queryFn: employeeId === null ? skipToken : () => sessionApi.getSessionUser(employeeId),
  });
}
