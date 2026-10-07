// 로그인과 로그인 사원 정보. 가짜 DB 모드는 계정 선택(SPEC 5장 결정 1), 서버 모드는 사원번호·비밀번호 로그인이고
// 사원 정보·권한을 서버에서 읽는다 (api/server/session.ts, 2026-10-07 사용자 결정).
import type { RoleCode } from '@/codes';
import type { PermissionMap } from '@/lib/permissions';
import type { MockTables } from '@/mock/schema';
import { findRow, updateRow } from '@/mock/store';
import { ApiError, mockMutation, mockQuery } from '@/api/client';
import { isServerDataSource } from '@/api/http';
import { compareEmployees, employeeBasicsOf, headDepartmentIdsOf, permissionMapOf } from '@/api/orgViews';
import { serverSessionApi } from '@/api/server/session';
import type { SessionAccount } from '@/lib/sessionEmployee';

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

/** 로그인한 사원 (탭마다 sessionStorage에 사원 id·사원번호만 둔다) */
export interface SessionUser {
  employeeId: number;
  employeeNo: string;
  employeeName: string;
  departmentId: number;
  departmentName: string;
  jobGradeName: string;
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

  getSessionUser: (employeeId: number): Promise<SessionUser> =>
    isServerDataSource() ? serverSessionApi.getSessionUser(employeeId) : mockQuery((tables) => buildSessionUser(tables, employeeId)),

  /** 계정을 고르면 최근 접속 시각(last_login_at)을 남긴다 (가짜 DB 모드) */
  selectAccount: (employeeId: number): Promise<SessionAccount> =>
    mockMutation((tx) => {
      const user = buildSessionUser(tx.tables, employeeId);
      updateRow(tx, 'employee', employeeId, { lastLoginAt: tx.nowIso });
      return user;
    }),

  // ── 서버 모드 로그인 ──
  login: serverSessionApi.login,
  current: serverSessionApi.current,
  /** 서버 모드만 쿠키를 지운다. 가짜 DB 모드는 탭 세션만 비우면 된다 */
  logout: (): Promise<void> => (isServerDataSource() ? serverSessionApi.logout() : Promise.resolve()),
};
