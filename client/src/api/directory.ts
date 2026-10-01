// 조직 조회: 사원·부서(트리)·직급·역할과 권한 (REQ-AUTH-002·003, REQ-ORG-001~004).
// 등록·수정은 2단계(조직·기준정보 화면)에서 더한다.
import type { Permission, PermissionLevel, RoleCode } from '@/codes';
import { PERMISSIONS } from '@/codes';
import { mockQuery } from '@/api/client';
import { compareEmployees, employeeBasicsOf, headDepartmentIdsOf, orderDepartments } from '@/api/orgViews';
import type { EmployeeListQuery } from '@/api/queryKeys';
import type { MockTables } from '@/mock/schema';

export interface EmployeeView {
  id: number;
  employeeNo: string;
  employeeName: string;
  departmentId: number;
  departmentName: string;
  jobGradeId: number;
  jobGradeName: string;
  roleId: number;
  roleCode: RoleCode;
  roleName: string;
  isActive: boolean;
  lastLoginAt: string | null;
  /** 부서장으로 지정된 부서 (부서장은 역할이 아니다) */
  headDepartmentIds: number[];
  createdAt: string;
  updatedAt: string;
}

export interface DepartmentView {
  id: number;
  departmentCode: string;
  departmentName: string;
  parentId: number | null;
  parentName: string | null;
  headEmployeeId: number | null;
  headEmployeeName: string | null;
  sortOrder: number;
  /** 트리 깊이 (최상위 = 0) */
  depth: number;
  /** 소속 사원 수 (사용 중) */
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}

/** 조직도: 부서 트리와 부서별 인원(이름, 직급, 부서장 여부) — REQ-ORG-003 */
export interface OrgChartNode {
  id: number;
  departmentCode: string;
  departmentName: string;
  head: { id: number; employeeName: string; jobGradeName: string } | null;
  members: { id: number; employeeName: string; jobGradeName: string; isHead: boolean }[];
  children: OrgChartNode[];
}

export interface JobGradeView {
  id: number;
  jobGradeCode: string;
  jobGradeName: string;
  sortOrder: number;
  employeeCount: number;
  /** 수정 시각 (화면을 연 뒤 다른 곳에서 바뀌었는지 확인, COM-001) */
  updatedAt: string;
}

export interface RoleView {
  id: number;
  roleCode: RoleCode;
  roleName: string;
  /** 권한 표 순서. 권한이 없으면 넣지 않는다. */
  permissions: { permission: Permission; permissionLevel: PermissionLevel }[];
  employeeCount: number;
  /** 수정 시각. 권한을 저장하면 바뀐다 (COM-001 확인용) */
  updatedAt: string;
}

function toEmployeeView(tables: Readonly<MockTables>, employeeId: number): EmployeeView | null {
  const employee = tables.employee.find((e) => e.id === employeeId);
  if (!employee) return null;
  const basics = employeeBasicsOf(tables, employee);
  return {
    id: employee.id,
    employeeNo: employee.employeeNo,
    employeeName: employee.employeeName,
    departmentId: employee.departmentId,
    departmentName: basics.departmentName,
    jobGradeId: employee.jobGradeId,
    jobGradeName: basics.jobGradeName,
    roleId: employee.roleId,
    roleCode: basics.roleCode,
    roleName: basics.roleName,
    isActive: employee.isActive,
    lastLoginAt: employee.lastLoginAt,
    headDepartmentIds: headDepartmentIdsOf(tables, employee.id),
    createdAt: employee.createdAt,
    updatedAt: employee.updatedAt,
  };
}

function listEmployeeViews(tables: Readonly<MockTables>, query: EmployeeListQuery): EmployeeView[] {
  const keyword = query.keyword?.trim().toLowerCase() ?? '';
  const roleId = query.roleCode ? tables.role.find((r) => r.roleCode === query.roleCode)?.id : undefined;
  return tables.employee
    .filter((e) => query.departmentId === undefined || e.departmentId === query.departmentId)
    .filter((e) => query.roleCode === undefined || e.roleId === roleId)
    .filter((e) => query.isActive === undefined || e.isActive === query.isActive)
    .filter((e) => !keyword || e.employeeName.toLowerCase().includes(keyword) || e.employeeNo.includes(keyword))
    .sort(compareEmployees(tables))
    .flatMap((e) => {
      const view = toEmployeeView(tables, e.id);
      return view ? [view] : [];
    });
}

function buildOrgChart(tables: Readonly<MockTables>, parentId: number | null): OrgChartNode[] {
  const gradeOf = (jobGradeId: number) => tables.jobGrade.find((g) => g.id === jobGradeId)?.jobGradeName ?? '-';
  const compareMembers = compareEmployees(tables);
  return orderDepartments(tables)
    .filter(({ department }) => department.parentId === parentId)
    .map(({ department }) => {
      const head = tables.employee.find((e) => e.id === department.headEmployeeId);
      return {
        id: department.id,
        departmentCode: department.departmentCode,
        departmentName: department.departmentName,
        head: head ? { id: head.id, employeeName: head.employeeName, jobGradeName: gradeOf(head.jobGradeId) } : null,
        members: tables.employee
          .filter((e) => e.isActive && e.departmentId === department.id)
          .sort(compareMembers)
          .map((e) => ({ id: e.id, employeeName: e.employeeName, jobGradeName: gradeOf(e.jobGradeId), isHead: e.id === department.headEmployeeId })),
        children: buildOrgChart(tables, department.id),
      };
    });
}

export const directoryApi = {
  listEmployees: (query: EmployeeListQuery = {}): Promise<EmployeeView[]> => mockQuery((tables) => listEmployeeViews(tables, query)),

  listDepartments: (): Promise<DepartmentView[]> =>
    mockQuery((tables) =>
      orderDepartments(tables).map(({ department, depth }) => {
        const parent = tables.department.find((d) => d.id === department.parentId);
        const head = tables.employee.find((e) => e.id === department.headEmployeeId);
        return {
          id: department.id,
          departmentCode: department.departmentCode,
          departmentName: department.departmentName,
          parentId: department.parentId,
          parentName: parent?.departmentName ?? null,
          headEmployeeId: department.headEmployeeId,
          headEmployeeName: head?.employeeName ?? null,
          sortOrder: department.sortOrder,
          depth,
          memberCount: tables.employee.filter((e) => e.isActive && e.departmentId === department.id).length,
          createdAt: department.createdAt,
          updatedAt: department.updatedAt,
        };
      }),
    ),

  getOrgChart: (): Promise<OrgChartNode[]> => mockQuery((tables) => buildOrgChart(tables, null)),

  listJobGrades: (): Promise<JobGradeView[]> =>
    mockQuery((tables) =>
      [...tables.jobGrade]
        .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
        .map((g) => ({
          id: g.id,
          jobGradeCode: g.jobGradeCode,
          jobGradeName: g.jobGradeName,
          sortOrder: g.sortOrder,
          employeeCount: tables.employee.filter((e) => e.jobGradeId === g.id).length,
          updatedAt: g.updatedAt,
        })),
    ),

  listRoles: (): Promise<RoleView[]> =>
    mockQuery((tables) =>
      tables.role.map((role) => {
        const rows = tables.rolePermission.filter((p) => p.roleId === role.id);
        return {
          id: role.id,
          roleCode: role.roleCode,
          roleName: role.roleName,
          permissions: PERMISSIONS.flatMap((permission) => {
            const row = rows.find((p) => p.permission === permission);
            return row ? [{ permission, permissionLevel: row.permissionLevel }] : [];
          }),
          employeeCount: tables.employee.filter((e) => e.roleId === role.id).length,
          updatedAt: role.updatedAt,
        };
      }),
    ),
};
