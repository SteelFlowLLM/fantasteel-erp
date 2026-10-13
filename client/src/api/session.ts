// 로그인과 로그인 사원 정보. 사원번호·비밀번호로 로그인하고 사원 정보·권한을 서버에서 읽는다 (api/server/session.ts, 2026-10-07 사용자 결정).
import type { RoleCode } from '@/codes';
import type { PermissionMap } from '@/lib/permissions';
import { serverSessionApi } from '@/api/server/session';

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

export const sessionApi = {
  getSessionUser: (employeeId: number): Promise<SessionUser> => serverSessionApi.getSessionUser(employeeId),

  // ── 로그인 ──
  login: serverSessionApi.login,
  current: serverSessionApi.current,
  /** 서버 로그인 쿠키를 지운다 */
  logout: (): Promise<void> => serverSessionApi.logout(),
};
