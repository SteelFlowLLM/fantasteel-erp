// 조직(사원·부서·직급) 입력 규칙과 계산. api(가짜 서버)와 화면이 함께 쓴다.
// 형식 규칙은 문서에 없어서 옛 화면(B안)의 규칙을 가정값으로 따랐다 (docs/rework/areas/admin.md 가정값).

/** 사원번호: 숫자 7자리 (가정, seed-assumptions 1-4 "입사 연월 4자리 + 순번 3자리") */
export const EMPLOYEE_NO_PATTERN = /^\d{7}$/;
/** 부서 코드: 영문 대문자·숫자·하이픈 30자 이내 (가정, 옛 화면 규칙. ERD varchar(30)) */
export const DEPARTMENT_CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{0,29}$/;
/** 직급 코드: 영문 대문자·숫자·밑줄 30자 이내 (가정, 공통 코드처럼 대문자 스네이크. ERD varchar(30)) */
export const JOB_GRADE_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,29}$/;

export const EMPLOYEE_NO_RULE_TEXT = '사원번호는 숫자 7자리로 입력해 주세요';
export const DEPARTMENT_CODE_RULE_TEXT = '영문 대문자·숫자·하이픈으로 30자 이내로 입력해 주세요 (예: PRD-IRON)';
export const JOB_GRADE_CODE_RULE_TEXT = '영문 대문자·숫자·밑줄로 30자 이내로 입력해 주세요 (예: MANAGER)';

/** 사용 여부(employee.is_active) 표시 */
export function activeLabelOf(isActive: boolean): string {
  return isActive ? '사용' : '사용 안 함';
}

interface TreeNode {
  id: number;
  parentId: number | null;
}

/** 이 부서 아래의 모든 하위 부서 id (자기 자신은 빼고). 순환이 있어도 멈춘다. */
export function descendantIdsOf(departments: readonly TreeNode[], departmentId: number): Set<number> {
  const result = new Set<number>();
  const stack = [departmentId];
  while (stack.length > 0) {
    const parentId = stack.pop();
    for (const child of departments) {
      if (child.parentId !== parentId || result.has(child.id) || child.id === departmentId) continue;
      result.add(child.id);
      stack.push(child.id);
    }
  }
  return result;
}

/**
 * 상위 부서로 고를 수 없는 부서 id: 자기 자신과 모든 하위 부서 (부서 계층 순환 금지, BP-AUTH-01).
 * 새 부서(departmentId = null)는 막을 것이 없다.
 */
export function blockedParentIdsOf(departments: readonly TreeNode[], departmentId: number | null): Set<number> {
  if (departmentId === null) return new Set();
  const blocked = descendantIdsOf(departments, departmentId);
  blocked.add(departmentId);
  return blocked;
}

/** 이 부서와 모든 하위 부서의 인원 합계 */
export function totalMemberCountOf(departments: readonly (TreeNode & { memberCount: number })[], departmentId: number): number {
  const ids = descendantIdsOf(departments, departmentId);
  ids.add(departmentId);
  return departments.filter((d) => ids.has(d.id)).reduce((sum, d) => sum + d.memberCount, 0);
}
