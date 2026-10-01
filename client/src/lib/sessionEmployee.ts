// 이 탭에서 고른 계정의 사원 id (탭마다 따로, sessionStorage — PLAN 2장).
// 화면 상태(useSessionStore)와 가짜 API의 요청 사원 확인(api/actor.ts)이 함께 쓴다.
// 실제 API로 바꾸면 서버가 JWT 쿠키에서 사원을 읽으므로 api 쪽 사용은 없어진다.

export const SESSION_EMPLOYEE_KEY = 'fantasteel.session.employee-id';

export function readSessionEmployeeId(): number | null {
  try {
    if (typeof window === 'undefined') return null;
    const value = Number(window.sessionStorage.getItem(SESSION_EMPLOYEE_KEY));
    return Number.isInteger(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

export function writeSessionEmployeeId(employeeId: number | null): void {
  try {
    if (employeeId === null) window.sessionStorage.removeItem(SESSION_EMPLOYEE_KEY);
    else window.sessionStorage.setItem(SESSION_EMPLOYEE_KEY, String(employeeId));
  } catch {
    // sessionStorage를 쓸 수 없는 환경이면 이 탭의 메모리에만 둔다
  }
}
