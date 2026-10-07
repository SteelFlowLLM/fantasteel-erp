// 서버 모드의 로그인 사원 (POST /auth/login, GET /auth/me). 사원·부서 id는 서버 id다.
// /auth/me에 없는 부서·직급·부서장 부서 이름은 조직도(GET /departments, 모든 사원 조회 가능)에서 채운다.
import type { AuthUser, DepartmentNode } from '@fantasteel/shared';
import { ApiError } from '@/api/errors';
import { loginWithDevPassword, serverRequest } from '@/api/http';
import type { SessionUser } from '@/api/session';
import { ROLE_LABEL } from '@/codes';
import type { SessionAccount } from '@/lib/sessionEmployee';

const flatten = (nodes: DepartmentNode[]): DepartmentNode[] => nodes.flatMap((node) => [node, ...flatten(node.children)]);

export const serverSessionApi = {
  selectAccount: async (employeeNo: string): Promise<SessionAccount> => {
    const user = await loginWithDevPassword(employeeNo);
    return { employeeId: user.employeeId, employeeNo: user.employeeNo };
  },

  getSessionUser: async (employeeId: number): Promise<SessionUser> => {
    const [me, tree] = await Promise.all([serverRequest<AuthUser>('GET', '/auth/me'), serverRequest<DepartmentNode[]>('GET', '/departments')]);
    // 탭에 남은 사원과 쿠키의 사원이 다르면 셸이 세션을 비우고 다시 고르게 한다
    if (me.employeeId !== employeeId) throw new ApiError('COM-002', '계정을 다시 골라 주세요');
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
