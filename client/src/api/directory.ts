// 조직 조회: 사원·부서(트리)·직급·역할과 권한 (REQ-AUTH-002·003, REQ-ORG-001~004).
// 관리 화면이 쓰는 조회(listManagedEmployees·부서·직급·역할)와 조직도(getOrgChart: 메신저·업무방 멤버 선택)는 두 데이터 모드 모두 서버를 읽는다.
// listEmployees는 서버에서 관리자 전용(GET employees)이라 가짜 DB를 읽는다(업무 담당자 선택의 가짜 DB 모드만 쓴다).
import type { Permission, PermissionLevel, RoleCode } from '@/codes';
import { mockQuery } from '@/api/client';
import { compareEmployees, employeeBasicsOf, headDepartmentIdsOf } from '@/api/orgViews';
import type { EmployeeListQuery } from '@/api/queryKeys';
import { serverOrganizationApi } from '@/api/server/organization';
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
  members: { id: number; employeeNo: string; employeeName: string; jobGradeName: string; isHead: boolean }[];
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

export const directoryApi = {
  /** 업무 담당자 선택(가짜 DB 모드)용. 서버의 사원 목록은 관리자 전용이라 가짜 DB를 읽는다 */
  listEmployees: (query: EmployeeListQuery = {}): Promise<EmployeeView[]> => mockQuery((tables) => listEmployeeViews(tables, query)),

  /** 사원 관리·부서 화면용 (서버는 사원 관리 조회 권한 필요) */
  listManagedEmployees: (query: EmployeeListQuery = {}): Promise<EmployeeView[]> => serverOrganizationApi.listEmployees(query),

  listDepartments: (): Promise<DepartmentView[]> => serverOrganizationApi.listDepartments(),

  getOrgChart: (): Promise<OrgChartNode[]> => serverOrganizationApi.getOrgChart(),

  listJobGrades: (): Promise<JobGradeView[]> => serverOrganizationApi.listJobGrades(),

  listRoles: (): Promise<RoleView[]> => serverOrganizationApi.listRoles(),
};
