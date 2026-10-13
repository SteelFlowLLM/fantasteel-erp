import { sessionApi } from '@/api/session';
import { useAction } from '@/hooks/useAction';
import { useSessionStore } from '@/stores/useSessionStore';

/** 로그인: 이 탭의 세션에 서버 사원 id·사원번호를 둔다. 실패 문구는 로그인 화면이 보인다 */
export function useLogin() {
  const signIn = useSessionStore((state) => state.signIn);
  return useAction((input: { employeeNo: string; password: string }) => sessionApi.login(input.employeeNo, input.password), {
    invalidate: [['session']],
    toastOnError: false,
    onSuccess: (account) => signIn(account),
  });
}
