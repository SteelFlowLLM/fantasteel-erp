// 조직 데이터로 화면용 값을 만드는 순수 함수 (session.ts·directory.ts가 함께 쓴다).
import type { RoleCode } from '@/codes';
import type { PermissionMap } from '@/lib/permissions';
import type { DepartmentRow, EmployeeRow, MockTables } from '@/mock/schema';

export interface OrderedDepartment {
  department: DepartmentRow;
  depth: number;
}

const byOrder = (a: DepartmentRow, b: DepartmentRow) => a.sortOrder - b.sortOrder || a.id - b.id;

/** 부서를 트리 순서(상위 → 하위, 같은 상위 안에서는 정렬 순서)로 편다 */
export function orderDepartments(tables: Readonly<MockTables>): OrderedDepartment[] {
  const result: OrderedDepartment[] = [];
  const visit = (parentId: number | null, depth: number) => {
    for (const department of tables.department.filter((d) => d.parentId === parentId).sort(byOrder)) {
      result.push({ department, depth });
      visit(department.id, depth + 1);
    }
  };
  visit(null, 0);
  return result;
}

/** 이 사원이 부서장인 부서 id (부서장은 역할이 아니다) */
export function headDepartmentIdsOf(tables: Readonly<MockTables>, employeeId: number): number[] {
  return tables.department.filter((d) => d.headEmployeeId === employeeId).map((d) => d.id);
}

export function permissionMapOf(tables: Readonly<MockTables>, roleId: number): PermissionMap {
  const map: PermissionMap = {};
  for (const row of tables.rolePermission) if (row.roleId === roleId) map[row.permission] = row.permissionLevel;
  return map;
}

export interface EmployeeBasics {
  departmentName: string;
  jobGradeName: string;
  jobGradeSortOrder: number;
  roleCode: RoleCode;
  roleName: string;
}

export function employeeBasicsOf(tables: Readonly<MockTables>, employee: EmployeeRow): EmployeeBasics {
  const department = tables.department.find((d) => d.id === employee.departmentId);
  const jobGrade = tables.jobGrade.find((g) => g.id === employee.jobGradeId);
  const role = tables.role.find((r) => r.id === employee.roleId);
  if (!role) throw new Error(`역할이 없는 사원이에요: ${employee.employeeNo}`);
  return {
    departmentName: department?.departmentName ?? '-',
    jobGradeName: jobGrade?.jobGradeName ?? '-',
    jobGradeSortOrder: jobGrade?.sortOrder ?? Number.MAX_SAFE_INTEGER,
    roleCode: role.roleCode,
    roleName: role.roleName,
  };
}

/** 사원 정렬: 부서 트리 순서 → 부서장 먼저 → 직급 표시 순서 → 사원번호 */
export function compareEmployees(tables: Readonly<MockTables>): (a: EmployeeRow, b: EmployeeRow) => number {
  const departmentIndex = new Map(orderDepartments(tables).map((entry, index) => [entry.department.id, index]));
  const isHeadOfOwn = (e: EmployeeRow) => tables.department.some((d) => d.id === e.departmentId && d.headEmployeeId === e.id);
  const gradeOrder = new Map(tables.jobGrade.map((g) => [g.id, g.sortOrder]));
  return (a, b) =>
    (departmentIndex.get(a.departmentId) ?? 0) - (departmentIndex.get(b.departmentId) ?? 0) ||
    Number(isHeadOfOwn(b)) - Number(isHeadOfOwn(a)) ||
    (gradeOrder.get(a.jobGradeId) ?? 0) - (gradeOrder.get(b.jobGradeId) ?? 0) ||
    a.employeeNo.localeCompare(b.employeeNo);
}

/** 이 부서 아래의 모든 하위 부서 id (자기 자신은 빼고) */
export function descendantDepartmentIds(tables: Readonly<MockTables>, departmentId: number): Set<number> {
  const result = new Set<number>();
  const visit = (parentId: number) => {
    for (const child of tables.department.filter((d) => d.parentId === parentId)) {
      if (result.has(child.id)) continue;
      result.add(child.id);
      visit(child.id);
    }
  };
  visit(departmentId);
  return result;
}

/** 조직도 인원 정렬: 직급 표시 순서 → 사원번호 (REQ-ORG-003, TRM-036) */
export function compareByJobGrade(tables: Readonly<MockTables>): (a: EmployeeRow, b: EmployeeRow) => number {
  const gradeOrder = new Map(tables.jobGrade.map((g) => [g.id, g.sortOrder]));
  return (a, b) =>
    (gradeOrder.get(a.jobGradeId) ?? Number.MAX_SAFE_INTEGER) - (gradeOrder.get(b.jobGradeId) ?? Number.MAX_SAFE_INTEGER) ||
    a.employeeNo.localeCompare(b.employeeNo);
}
