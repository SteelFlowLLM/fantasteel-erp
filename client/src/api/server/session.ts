// 서버 모드의 로그인 사원 (POST /auth/login·logout, GET /auth/me). 사원·부서 id는 서버 id다.
// /auth/me에 없는 부서·직급·부서장 부서 이름은 조직도(GET /departments, 모든 사원 조회 가능)에서 채운다.
import type { AuthUser, DepartmentNode } from '@fantasteel/shared';
import { ApiError } from '@/api/errors';
import { currentServerLogin, serverLogin, serverLogout, serverRequest } from '@/api/http';
import type { SessionUser } from '@/api/session';
import { ROLE_LABEL } from '@/codes';
import type { SessionAccount } from '@/lib/sessionEmployee';

const flatten = (nodes: DepartmentNode[]): DepartmentNode[] => nodes.flatMap((node) => [node, ...flatten(node.children)]);
const accountOf = (user: AuthUser): SessionAccount => ({ employeeId: user.employeeId, employeeNo: user.employeeNo });

export const serverSessionApi = {
  login: async (employeeNo: string, password: string): Promise<SessionAccount> => accountOf(await serverLogin(employeeNo, password)),

  /** 이 브라우저가 이미 로그인돼 있으면 그 사원 (새 탭) */
  current: async (): Promise<SessionAccount | null> => {
    const user = await currentServerLogin();
    return user ? accountOf(user) : null;
  },

  logout: serverLogout,

  getSessionUser: async (employeeId: number): Promise<SessionUser> => {
    const [me, tree] = await Promise.all([serverRequest<AuthUser>('GET', '/auth/me'), serverRequest<DepartmentNode[]>('GET', '/departments')]);
    // 탭에 남은 사원과 쿠키의 사원이 다르면 셸이 세션을 비우고 다시 로그인하게 한다
    if (me.employeeId !== employeeId) throw new ApiError('COM-002', '다시 로그인해 주세요');
    const departments = flatten(tree);
    const department = departments.find((d) => d.id === me.departmentId);
    const heads = departments.filter((d) => me.headDepartmentIds.includes(d.id));
    return {
      employeeId: me.employeeId,
      employeeNo: me.employeeNo,
      employeeName: me.employeeName,
      departmentId: me.departmentId,
      departmentName: department?.departmentName ?? '-',
      jobGradeName: department?.members.find((m) => m.id === me.employeeId)?.jobGradeName ?? '-',
      roleCode: me.roleCode,
      roleName: ROLE_LABEL[me.roleCode],
      headDepartmentIds: me.headDepartmentIds,
      headDepartmentNames: heads.map((d) => d.departmentName),
      permissions: me.permissions,
    };
  },
};
