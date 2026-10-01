import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/api/queryKeys';
import { sessionApi } from '@/api/session';
import { useAction } from '@/hooks/useAction';
import { useSessionStore } from '@/stores/useSessionStore';

/** 계정 선택 목록 */
export function useAccountList() {
  return useQuery({ queryKey: queryKeys.accounts(), queryFn: sessionApi.listAccounts });
}

/** 계정을 고르면 이 탭의 세션에 사원 id를 둔다 */
export function useSelectAccount(onSelected?: (employeeId: number) => void) {
  const signIn = useSessionStore((state) => state.signIn);
  return useAction((employeeId: number) => sessionApi.selectAccount(employeeId), {
    invalidate: [['employees'], ['session']],
    toastOnError: false,
    onSuccess: (user) => {
      signIn(user.employeeId);
      onSelected?.(user.employeeId);
    },
  });
}
