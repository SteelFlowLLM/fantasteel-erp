// 요청한 사원: 서버 로그인 사원과 비교할 이 탭의 사원번호 (권한 확인은 서버가 한다, BP-AUTH-01).
import { readSessionEmployeeNo } from '@/lib/sessionEmployee';

/** undefined = 이 탭의 세션을 쓴다. 테스트에서만 바꾼다. 테스트는 사원번호로 정한다(서버 로그인과 같은 값). */
let testActingEmployeeNo: string | null | undefined;

/** 테스트에서 '이 사원이 요청했다'를 흉내 낸다. undefined를 넘기면 세션으로 돌아간다. */
export function setActingEmployeeNoForTest(employeeNo: string | null | undefined): void {
  testActingEmployeeNo = employeeNo;
}

/** 요청한 사원의 사원번호 (서버 로그인용, 없으면 null) */
export function actingEmployeeNo(): string | null {
  return testActingEmployeeNo !== undefined ? testActingEmployeeNo : readSessionEmployeeNo();
}
