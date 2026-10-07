// 조직 조회 응답 타입 (REQ-AUTH-002·003, REQ-ORG-001~004, docs/backend/organization.md). 비밀번호 해시는 내보내지 않는다.
import type { Permission, PermissionLevel, Role } from './codes';

export interface EmployeeView {
  id: number;
  employeeNo: string;
  employeeName: string;
  departmentId: number;
  departmentName: string;
  jobGradeId: number;
  jobGradeName: string;
  roleId: number;
  roleCode: Role;
  roleName: string;
  isActive: boolean;
  /** 부서장으로 지정된 부서 (부서장은 역할이 아니다, REQ-ORG-002) */
  headDepartmentIds: number[];
  createdAt: string;
  updatedAt: string;
}

/** 조직도 인원: 사용 중인 사원만 (REQ-ORG-003) */
export interface DepartmentMemberView {
  id: number;
  employeeNo: string;
  employeeName: string;
  jobGradeId: number;
  jobGradeName: string;
  isHead: boolean;
}

/** 부서 트리 노드. 메신저 멤버·알림 대상 선택에도 쓴다 (REQ-ORG-004) */
export interface DepartmentNode {
  id: number;
  departmentCode: string;
  departmentName: string;
  parentId: number | null;
  headEmployeeId: number | null;
  headEmployeeName: string | null;
  /** 직급 표시 순서 → 사원번호 순 */
  members: DepartmentMemberView[];
  children: DepartmentNode[];
  createdAt: string;
  updatedAt: string;
}

/** 부서 등록·수정 응답 (트리·인원 없이 부서 한 건) */
export interface DepartmentView {
  id: number;
  departmentCode: string;
  departmentName: string;
  parentId: number | null;
  headEmployeeId: number | null;
  headEmployeeName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface JobGradeView {
  id: number;
  jobGradeName: string;
  sortOrder: number;
  /** 사용 중인 사원 수 */
  employeeCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface RoleView {
  id: number;
  roleCode: Role;
  roleName: string;
  /** 공통 코드 PERMISSION 순서. 권한이 없으면 넣지 않는다 */
  permissions: { permission: Permission; permissionLevel: PermissionLevel }[];
  /** 사용 중인 사원 수 */
  employeeCount: number;
  createdAt: string;
  updatedAt: string;
}
