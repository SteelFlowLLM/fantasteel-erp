// 제출 잠금 (이슈 #510): 응답을 기다리는 중의 두 번째 제출을 무시한다.
// 버튼의 disabled·mutation의 isPending은 다음 렌더 뒤에 바뀌어서, 렌더 사이에 들어온 아주 빠른 두 번째 제출(Enter 연타·비밀번호 관리자 자동 제출)을 못 막는다.
// 잠금은 변수라 바로 바뀐다. 로그인은 서버가 확인 중인 시도도 실패 횟수에 세므로 같은 요청을 동시에 두 번 보내면 둘째가 한도 밖으로 잠긴 것처럼 보일 수 있다.

export interface SubmitLock {
  /** 잠그고 true. 이미 잠겨 있으면 false (두 번째 제출은 보내지 않는다) */
  tryEnter(): boolean;
  /** 응답이 끝나면(성공·실패 모두) 푼다 */
  release(): void;
}

export function createSubmitLock(): SubmitLock {
  let busy = false;
  return {
    tryEnter() {
      if (busy) return false;
      busy = true;
      return true;
    },
    release() {
      busy = false;
    },
  };
}
