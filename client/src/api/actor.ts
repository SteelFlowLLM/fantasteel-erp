// 요청한 사원 확인과 권한 재확인 (BP-AUTH-01 "각 API에서 권한 재확인", 컨벤션 6장 권한 가드).
// 실제 서버는 JWT 쿠키에서 사원을 읽는다. 가짜 API는 이 탭의 계정 선택(sessionStorage)을 그 자리에 쓴다.
// 모든 변경 함수는 트랜잭션 안에서 requireActor(tx.tables, { use: [...] })로 시작한다.
import type { Permission } from '@/codes';
import { ApiError } from '@/api/client';
import { headDepartmentIdsOf, permissionMapOf } from '@/api/orgViews';
import { canUse, canView, permissionNeedText, type PermissionMap } from '@/lib/permissions';
import { isServerDataSource } from '@/api/http';
import { readSessionEmployeeId, readSessionEmployeeNo } from '@/lib/sessionEmployee';
import { getMockDb } from '@/mock/db';
import type { EmployeeRow, MockTables } from '@/mock/schema';

/** undefined = 이 탭의 세션을 쓴다. 테스트에서만 바꾼다. 테스트는 가짜 DB 사원 id로 정한다. */
let testActingEmployeeId: number | null | undefined;

/** 테스트에서 '이 사원이 요청했다'를 흉내 낸다. undefined를 넘기면 세션으로 돌아간다. */
export function setActingEmployeeForTest(employeeId: number | null | undefined): void {
  testActingEmployeeId = employeeId;
}

/** 사원번호가 같은 가짜 DB 사원 id. 서버에서 새로 등록한 사원은 가짜 DB에 없어 null */
export function mockEmployeeIdByNo(employeeNo: string | null): number | null {
  if (!employeeNo) return null;
  return getMockDb().read((tables) => tables.employee.find((e) => e.employeeNo === employeeNo)?.id) ?? null;
}

/** 요청한 사원의 가짜 DB id (없으면 null). 서버 모드의 세션 id는 서버 id라 사원번호로 찾는다 */
export function actingEmployeeId(): number | null {
  if (testActingEmployeeId !== undefined) return testActingEmployeeId;
  return isServerDataSource() ? mockEmployeeIdByNo(readSessionEmployeeNo()) : readSessionEmployeeId();
}

/** 요청한 사원의 사원번호 (서버 로그인용, 없으면 null) */
export function actingEmployeeNo(): string | null {
  if (testActingEmployeeId === undefined) return readSessionEmployeeNo();
  const employeeId = testActingEmployeeId;
  return employeeId === null ? null : (getMockDb().read((tables) => tables.employee.find((e) => e.id === employeeId)?.employeeNo) ?? null);
}

export interface Actor {
  employee: EmployeeRow;
  permissions: PermissionMap;
  headDepartmentIds: number[];
}

export interface ActorRule {
  /** 이 중 하나라도 사용(USE) 권한이 있어야 한다 */
  use?: readonly Permission[];
  /** 이 중 하나라도 조회(VIEW) 이상 권한이 있어야 한다 */
  view?: readonly Permission[];
}

/**
 * 요청한 사원을 확인한다. 로그인(계정 선택)이 없거나, 없는 사원이거나, 사용 안 함(is_active = false)이면 COM-002.
 * rule의 권한이 없어도 COM-002 (해당 업무 권한 없음).
 */
export function requireActor(tables: Readonly<MockTables>, rule: ActorRule = {}): Actor {
  const employeeId = actingEmployeeId();
  const employee = employeeId === null ? undefined : tables.employee.find((e) => e.id === employeeId);
  if (!employee || !employee.isActive) throw new ApiError('COM-002');
  const actor: Actor = {
    employee,
    permissions: permissionMapOf(tables, employee.roleId),
    headDepartmentIds: headDepartmentIdsOf(tables, employee.id),
  };
  if (rule.use && rule.use.length > 0 && !canUse(actor, ...rule.use)) throw new ApiError('COM-002', permissionNeedText(rule.use, 'USE'));
  if (rule.view && rule.view.length > 0 && !canView(actor, ...rule.view)) throw new ApiError('COM-002', permissionNeedText(rule.view, 'VIEW'));
  return actor;
}

/** 부서장만 할 수 있는 일 (구매요청 승인 등, REQ-AUTH-004). 부서장이 아니면 COM-002. */
export function requireDepartmentHead(tables: Readonly<MockTables>): Actor {
  const actor = requireActor(tables);
  if (actor.headDepartmentIds.length === 0) throw new ApiError('COM-002', '부서장만 할 수 있어요');
  return actor;
}
