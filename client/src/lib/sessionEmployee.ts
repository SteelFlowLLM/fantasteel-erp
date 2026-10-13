// 이 탭에 로그인한 사원의 id와 사원번호 (탭마다 따로, sessionStorage — PLAN 2장).
// 화면 상태(useSessionStore)와 서버 요청의 사원 확인(api/actor.ts)이 함께 쓴다.
// 사원 id는 서버 id다.

export const SESSION_EMPLOYEE_KEY = 'fantasteel.session.employee-id';
export const SESSION_EMPLOYEE_NO_KEY = 'fantasteel.session.employee-no';

export interface SessionAccount {
  employeeId: number;
  employeeNo: string;
}

function read(key: string): string | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

export function readSessionEmployeeId(): number | null {
  const value = Number(read(SESSION_EMPLOYEE_KEY));
  return Number.isInteger(value) && value > 0 ? value : null;
}

export function readSessionEmployeeNo(): string | null {
  return read(SESSION_EMPLOYEE_NO_KEY) || null;
}

export function writeSessionAccount(account: SessionAccount | null): void {
  try {
    if (account === null) {
      window.sessionStorage.removeItem(SESSION_EMPLOYEE_KEY);
      window.sessionStorage.removeItem(SESSION_EMPLOYEE_NO_KEY);
    } else {
      window.sessionStorage.setItem(SESSION_EMPLOYEE_KEY, String(account.employeeId));
      window.sessionStorage.setItem(SESSION_EMPLOYEE_NO_KEY, account.employeeNo);
    }
  } catch {
    // sessionStorage를 쓸 수 없는 환경이면 이 탭의 메모리에만 둔다
  }
}
