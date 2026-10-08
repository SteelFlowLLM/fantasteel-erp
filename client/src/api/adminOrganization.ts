// 부서·직급·역할 권한 관리와 조직도 (REQ-AUTH-002·003, REQ-ORG-001~003, BP-AUTH-01).
// 목록 조회는 directory.ts(directoryApi.listDepartments·listJobGrades·listRoles)를 쓴다.
// 두 데이터 모드 모두 실제 서버를 부른다 (api/server/organization.ts). 권한(부서·권한 관리, 직급은 사원 관리)과 참조 확인은 서버가 한다.
// - 부서장은 그 부서의 사용 중인 사원 1명 (REQ-ORG-002). 부서장은 역할이 아니다.
// - 부서 정렬 순서·직급 코드는 ERD에 없어 서버에 보내지 않는다. 부서 코드는 등록 뒤 바꾸지 않는다.
import type { Permission, PermissionLevel } from '@/codes';
import { isServerDataSource } from '@/api/http';
import { serverOrganizationApi } from '@/api/server/organization';

/** 서버 모드: ERD·API 명세에 없는 화면 칸(부서 정렬 순서, 직급 코드, 최근 접속)을 숨기고 사원 등록에 비밀번호를 받는다 */
export const isOrgServerMode = (): boolean => isServerDataSource();

export const adminOrgKeys = {
  orgChart: () => ['departments', 'admin-org-chart'] as const,
};

// ── 입력 모양 ─────────────────────────────────────────────

export interface DepartmentCreateInput {
  departmentCode: string;
  departmentName: string;
  parentId: number | null;
  sortOrder: number | string;
}

export interface DepartmentUpdateInput extends DepartmentCreateInput {
  id: number;
  headEmployeeId: number | null;
  expectedUpdatedAt?: string | null;
}

export interface DeleteInput {
  id: number;
  expectedUpdatedAt?: string | null;
}

export interface JobGradeCreateInput {
  jobGradeCode: string;
  jobGradeName: string;
  sortOrder: number | string;
}

export interface JobGradeUpdateInput extends JobGradeCreateInput {
  id: number;
  expectedUpdatedAt?: string | null;
}

export interface RolePermissionsInput {
  roleId: number;
  /** 사용·조회만 보낸다. 없는 권한은 행을 두지 않는다. */
  permissions: { permission: Permission; permissionLevel: PermissionLevel }[];
  expectedUpdatedAt?: string | null;
}

export interface SavedRef {
  id: number;
  name: string;
}

// ── 조직도 (REQ-ORG-003) ──────────────────────────────────

export interface OrgChartMemberView {
  id: number;
  employeeNo: string;
  employeeName: string;
  jobGradeName: string;
  isHead: boolean;
}

export interface OrgChartDepartmentView {
  id: number;
  departmentCode: string;
  departmentName: string;
  depth: number;
  head: { id: number; employeeName: string; jobGradeName: string } | null;
  /** 사용 중인 소속 사원. 직급 표시 순서 → 사원번호 순 */
  members: OrgChartMemberView[];
  /** 하위 부서까지 더한 인원 */
  totalMemberCount: number;
  children: OrgChartDepartmentView[];
}

export const adminOrgApi = {
  /** 조직도: 부서 트리와 부서별 인원(이름, 직급, 부서장 여부). 사용 중인 사원만, 직급 표시 순서대로. */
  getOrgChart: (): Promise<OrgChartDepartmentView[]> => serverOrganizationApi.getOrgChart(),
};

export const departmentAdminApi = {
  /** 부서 만들기. 부서장은 소속 사원이 생긴 뒤 수정에서 지정한다. */
  create: (input: DepartmentCreateInput): Promise<SavedRef> => serverOrganizationApi.createDepartment(input),

  /** 부서 수정: 부서명·상위 부서·부서장 */
  update: (input: DepartmentUpdateInput): Promise<SavedRef> => serverOrganizationApi.updateDepartment(input),

  /** 부서 삭제: 하위 부서·소속 사원(퇴사자 포함)이 없을 때만 */
  remove: (input: DeleteInput): Promise<SavedRef> => serverOrganizationApi.deleteDepartment(input),
};

export const jobGradeAdminApi = {
  create: (input: JobGradeCreateInput): Promise<SavedRef> => serverOrganizationApi.createJobGrade(input),

  /** 직급 수정: 직급명·표시 순서 */
  update: (input: JobGradeUpdateInput): Promise<SavedRef> => serverOrganizationApi.updateJobGrade(input),

  /** 직급 삭제: 이 직급의 사원(퇴사자 포함)이 없을 때만 */
  remove: (input: DeleteInput): Promise<SavedRef> => serverOrganizationApi.deleteJobGrade(input),
};

export const roleAdminApi = {
  /**
   * 역할의 권한을 통째로 바꾼다 (REQ-AUTH-003). 보내지 않은 권한은 행을 지운다(= 없음).
   * 저장하면 그 역할 사원의 메뉴·버튼이 바로 바뀐다 (이 탭은 조회 무효화, 다른 탭은 BroadcastChannel).
   */
  replacePermissions: (input: RolePermissionsInput): Promise<SavedRef> => serverOrganizationApi.replaceRolePermissions(input),
};
