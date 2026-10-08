// 조직 조회: 사원·부서(트리)·직급·역할과 권한 (REQ-AUTH-002·003, REQ-ORG-001~004).
// 관리 화면이 쓰는 조회(사원 목록·부서·직급·역할)와 조직도(getOrgChart: 메신저·업무방·업무 담당자 선택)는 두 데이터 모드 모두 서버를 읽는다.
// 사원 목록(GET employees)은 서버에서 관리자 전용이라 다른 화면의 사원 선택은 조직도를 쓴다.
import type { Permission, PermissionLevel, RoleCode } from '@/codes';
import type { EmployeeListQuery } from '@/api/queryKeys';
import { serverOrganizationApi } from '@/api/server/organization';

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

export const directoryApi = {
  /** 사원 관리·부서 화면용 (서버는 사원 관리 조회 권한 필요) */
  listManagedEmployees: (query: EmployeeListQuery = {}): Promise<EmployeeView[]> => serverOrganizationApi.listEmployees(query),

  listDepartments: (): Promise<DepartmentView[]> => serverOrganizationApi.listDepartments(),

  getOrgChart: (): Promise<OrgChartNode[]> => serverOrganizationApi.getOrgChart(),

  listJobGrades: (): Promise<JobGradeView[]> => serverOrganizationApi.listJobGrades(),

  listRoles: (): Promise<RoleView[]> => serverOrganizationApi.listRoles(),
};
