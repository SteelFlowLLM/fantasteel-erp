import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/api/queryKeys';
import { sessionApi } from '@/api/session';
import { useAction } from '@/hooks/useAction';
import { useSessionStore } from '@/stores/useSessionStore';

/** 계정 선택 목록 */
export function useAccountList() {
  return useQuery({ queryKey: queryKeys.accounts(), queryFn: sessionApi.listAccounts });
}

/** 서버 모드 로그인: 이 탭의 세션에 서버 사원 id·사원번호를 둔다. 실패 문구는 로그인 화면이 보인다 */
export function useLogin() {
  const signIn = useSessionStore((state) => state.signIn);
  return useAction((input: { employeeNo: string; password: string }) => sessionApi.login(input.employeeNo, input.password), {
    invalidate: [['session']],
    toastOnError: false,
    onSuccess: (account) => signIn(account),
  });
}

/** 계정을 고르면 이 탭의 세션에 사원 id·사원번호를 둔다 (가짜 DB 모드) */
export function useSelectAccount(onSelected?: (employeeId: number) => void) {
  const signIn = useSessionStore((state) => state.signIn);
  return useAction((employeeId: number) => sessionApi.selectAccount(employeeId), {
    invalidate: [['employees'], ['session']],
    toastOnError: false,
    onSuccess: (user) => {
      signIn({ employeeId: user.employeeId, employeeNo: user.employeeNo });
      onSelected?.(user.employeeId);
    },
  });
}
