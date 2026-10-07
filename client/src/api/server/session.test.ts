// 서버 모드 로그인 사원: 계정 선택은 서버 로그인, 사원 정보·권한은 GET /auth/me (사원·부서 id는 서버 id).
// 가짜 DB만 쓰는 화면의 요청 사원은 세션 사원번호로 가짜 DB 사원을 찾는다.
import type { AuthUser, DepartmentNode } from '@fantasteel/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { actingEmployeeId, setActingEmployeeForTest } from '@/api/actor';
import { ApiError } from '@/api/errors';
import { ok, stopFakeServer, useFakeServer } from '@/api/server/serverTestKit';
import { sessionApi } from '@/api/session';
import { writeSessionAccount } from '@/lib/sessionEmployee';
import { employeeIdOf, SEED_EMPLOYEE_NO } from '@/test/actors';

const AT = '2026-10-07T00:00:00.000Z';

// 서버 id는 가짜 DB id와 다르게 잡는다
const authUser: AuthUser = {
  employeeId: 904,
  employeeNo: SEED_EMPLOYEE_NO.purchaseHead,
  employeeName: '최준혁',
  roleCode: 'PURCHASE',
  departmentId: 20,
  jobGradeId: 1,
  headDepartmentIds: [20],
  permissions: { PURCHASE_REQUISITION_CREATE: 'USE', PURCHASE_ORDER_CONFIRM: 'VIEW' },
};

const node = (id: number, departmentName: string, extra: Partial<DepartmentNode> = {}): DepartmentNode => ({
  id,
  departmentCode: `D${id}`,
  departmentName,
  parentId: null,
  headEmployeeId: null,
  headEmployeeName: null,
  members: [],
  children: [],
  createdAt: AT,
  updatedAt: AT,
  ...extra,
});

const tree: DepartmentNode[] = [
  node(10, '영업부'),
  node(20, '구매부', {
    headEmployeeId: 904,
    headEmployeeName: '최준혁',
    members: [{ id: 904, employeeNo: SEED_EMPLOYEE_NO.purchaseHead, employeeName: '최준혁', jobGradeId: 1, jobGradeName: '부장', isHead: true }],
  }),
];

const respond = (user: AuthUser) => (c: { path: string }) => (c.path === '/auth/me' ? ok(user) : c.path === '/departments' ? ok(tree) : undefined);

/** sessionStorage가 있는 브라우저 창 (테스트 환경은 node) */
function stubWindow(): void {
  const store = new Map<string, string>();
  const sessionStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) };
  vi.stubGlobal('window', { sessionStorage });
}

afterEach(() => stopFakeServer());

describe('서버 모드 세션 (api/server/session.ts)', () => {
  it('계정을 고르면 목록의 사원번호로 서버에 로그인하고 서버 사원 id를 세션에 둔다', async () => {
    const logins: unknown[] = [];
    useFakeServer(SEED_EMPLOYEE_NO.purchaseHead, () => undefined);
    // 가짜 서버의 로그인은 빈 성공이라 이 테스트만 로그인 응답을 바꾼다
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      if (!url.endsWith('/auth/login')) throw new Error(`로그인 말고 부르면 안 돼요: ${url}`);
      logins.push(JSON.parse(String(init.body)));
      return ok(authUser);
    });
    await expect(sessionApi.selectAccount(employeeIdOf(SEED_EMPLOYEE_NO.purchaseHead))).resolves.toEqual({ employeeId: 904, employeeNo: SEED_EMPLOYEE_NO.purchaseHead });
    expect(logins).toEqual([{ employeeNo: SEED_EMPLOYEE_NO.purchaseHead, password: 'fantasteel' }]);
  });

  it('사원 정보·권한은 /auth/me, 부서·직급·부서장 부서 이름은 조직도에서 채운다', async () => {
    useFakeServer(SEED_EMPLOYEE_NO.purchaseHead, respond(authUser));
    await expect(sessionApi.getSessionUser(904)).resolves.toEqual({
      employeeId: 904,
      employeeNo: SEED_EMPLOYEE_NO.purchaseHead,
      employeeName: '최준혁',
      departmentId: 20,
      departmentName: '구매부',
      jobGradeName: '부장',
      roleCode: 'PURCHASE',
      roleName: '구매',
      headDepartmentIds: [20],
      headDepartmentNames: ['구매부'],
      permissions: { PURCHASE_REQUISITION_CREATE: 'USE', PURCHASE_ORDER_CONFIRM: 'VIEW' },
    });
  });

  it('탭에 남은 사원 id와 서버 로그인 사원이 다르면 COM-002 (셸이 세션을 비운다)', async () => {
    useFakeServer(SEED_EMPLOYEE_NO.purchaseHead, respond(authUser));
    await expect(sessionApi.getSessionUser(employeeIdOf(SEED_EMPLOYEE_NO.purchaseHead))).rejects.toMatchObject({ code: 'COM-002' });
    await expect(sessionApi.getSessionUser(1)).rejects.toBeInstanceOf(ApiError);
  });

  it('가짜 DB 화면의 요청 사원은 세션 사원번호로 찾고, 가짜 DB에 없는 사원이면 없음', () => {
    useFakeServer(SEED_EMPLOYEE_NO.purchaseHead, () => undefined);
    stubWindow();
    setActingEmployeeForTest(undefined);
    writeSessionAccount({ employeeId: 904, employeeNo: SEED_EMPLOYEE_NO.purchaseHead });
    expect(actingEmployeeId()).toBe(employeeIdOf(SEED_EMPLOYEE_NO.purchaseHead));
    writeSessionAccount({ employeeId: 999, employeeNo: '2610099' });
    expect(actingEmployeeId()).toBeNull();
  });
});
