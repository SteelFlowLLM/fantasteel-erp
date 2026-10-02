// 계정 선택과 로그인 사원 정보. 사원번호·비밀번호 로그인은 나중에 넣는다 (SPEC 5장 결정 1).
import type { RoleCode } from '@/codes';
import type { PermissionMap } from '@/lib/permissions';
import type { MockTables } from '@/mock/schema';
import { findRow, updateRow } from '@/mock/store';
import { ApiError, mockMutation, mockQuery } from '@/api/client';
import { compareEmployees, employeeBasicsOf, headDepartmentIdsOf, permissionMapOf } from '@/api/orgViews';

/** 계정 선택 화면의 한 줄 */
export interface AccountView {
  employeeId: number;
  employeeNo: string;
  employeeName: string;
  departmentName: string;
  jobGradeName: string;
  roleCode: RoleCode;
  roleName: string;
  /** 부서장으로 지정된 부서 이름 (부서장은 역할이 아니다) */
  headDepartmentNames: string[];
}

/** 로그인한 사원 (탭마다 sessionStorage에 사원 id만 둔다) */
export interface SessionUser {
  employeeId: number;
  employeeNo: string;
  employeeName: string;
  departmentId: number;
  departmentName: string;
  jobGradeName: string;
  roleId: number;
  roleCode: RoleCode;
  roleName: string;
  headDepartmentIds: number[];
  headDepartmentNames: string[];
  permissions: PermissionMap;
}

function buildSessionUser(tables: Readonly<MockTables>, employeeId: number): SessionUser {
  const employee = findRow(tables, 'employee', employeeId);
  if (!employee) throw new ApiError('COM-003');
  if (!employee.isActive) throw new ApiError('COM-002');
  const basics = employeeBasicsOf(tables, employee);
  const headDepartmentIds = headDepartmentIdsOf(tables, employee.id);
  return {
    employeeId: employee.id,
    employeeNo: employee.employeeNo,
    employeeName: employee.employeeName,
    departmentId: employee.departmentId,
    departmentName: basics.departmentName,
    jobGradeName: basics.jobGradeName,
    roleId: employee.roleId,
    roleCode: basics.roleCode,
    roleName: basics.roleName,
    headDepartmentIds,
    headDepartmentNames: tables.department.filter((d) => headDepartmentIds.includes(d.id)).map((d) => d.departmentName),
    permissions: permissionMapOf(tables, employee.roleId),
  };
}

export const sessionApi = {
  /** 계정 선택 목록: 사용 중인 사원 */
  listAccounts: (): Promise<AccountView[]> =>
    mockQuery((tables) =>
      tables.employee
        .filter((e) => e.isActive)
        .sort(compareEmployees(tables))
        .map((employee) => {
          const basics = employeeBasicsOf(tables, employee);
          return {
            employeeId: employee.id,
            employeeNo: employee.employeeNo,
            employeeName: employee.employeeName,
            departmentName: basics.departmentName,
            jobGradeName: basics.jobGradeName,
            roleCode: basics.roleCode,
            roleName: basics.roleName,
            headDepartmentNames: tables.department.filter((d) => d.headEmployeeId === employee.id).map((d) => d.departmentName),
          };
        }),
    ),

  getSessionUser: (employeeId: number): Promise<SessionUser> => mockQuery((tables) => buildSessionUser(tables, employeeId)),

  /** 계정을 고르면 최근 접속 시각(last_login_at)을 남긴다 */
  selectAccount: (employeeId: number): Promise<SessionUser> =>
    mockMutation((tx) => {
      const user = buildSessionUser(tx.tables, employeeId);
      updateRow(tx, 'employee', employeeId, { lastLoginAt: tx.nowIso });
      return user;
    }),
};

