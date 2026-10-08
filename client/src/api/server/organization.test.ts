// 조직 서버 어댑터: 관리 화면 조회·변경은 서버(employees·departments·job-grades·roles), 멤버 선택용 조회는 서버 모드에서도 가짜 DB.
import type { DepartmentNode, EmployeeView, JobGradeView, RoleView } from '@fantasteel/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { employeeAdminApi } from '@/api/adminEmployees';
import { adminOrgApi, departmentAdminApi, jobGradeAdminApi, roleAdminApi } from '@/api/adminOrganization';
import { directoryApi } from '@/api/directory';
import { InputError } from '@/api/errors';
import { ok, page, stopFakeServer, useFakeServer } from '@/api/server/serverTestKit';
import { SEED_EMPLOYEE_NO } from '@/test/actors';

const AT = '2026-10-07T00:00:00.000Z';

const employee = (id: number, employeeName: string): EmployeeView => ({
  id,
  employeeNo: `90000${id}`,
  employeeName,
  departmentId: 2,
  departmentName: '생산부',
  jobGradeId: 1,
  jobGradeName: '부장',
  roleId: 3,
  roleCode: 'PRODUCTION',
  roleName: '생산',
  isActive: true,
  headDepartmentIds: [],
  createdAt: AT,
  updatedAt: AT,
});

const member = (id: number, employeeName: string, jobGradeName: string, isHead = false) => ({ id, employeeNo: `90000${id}`, employeeName, jobGradeId: 1, jobGradeName, isHead });
const node = (id: number, departmentName: string, parentId: number | null, extra: Partial<DepartmentNode> = {}): DepartmentNode => ({
  id,
  departmentCode: `D${id}`,
  departmentName,
  parentId,
  headEmployeeId: null,
  headEmployeeName: null,
  members: [],
  children: [],
  createdAt: AT,
  updatedAt: AT,
  ...extra,
});

// 생산부(부서장은 하위 파트 소속 강부장) → 제강파트(2명)
const tree: DepartmentNode[] = [
  node(2, '생산부', null, {
    headEmployeeId: 11,
    headEmployeeName: '강부장',
    children: [node(5, '제강파트', 2, { members: [member(11, '강부장', '부장', false), member(12, '조사원', '사원')] })],
  }),
];

afterEach(() => stopFakeServer());

describe('조직 서버 어댑터 (api/server/organization.ts)', () => {
  it('관리 화면 사원 목록은 거르기를 쿼리로 보내고 페이지를 끝까지 읽는다', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.admin, (c) => {
      if (c.path !== '/employees') return undefined;
      return c.query.page === '1' ? ok({ ...page([employee(11, '강부장')], 2), size: 1 }) : ok({ items: [employee(12, '조사원')], page: 2, size: 1, total: 2 });
    });
    const result = await directoryApi.listManagedEmployees({ roleCode: 'PRODUCTION', isActive: true, keyword: ' 강 ' });

    expect(calls.map((c) => c.query)).toEqual([
      { roleCode: 'PRODUCTION', isActive: 'true', keyword: '강', page: '1', size: '100' },
      { roleCode: 'PRODUCTION', isActive: 'true', keyword: '강', page: '2', size: '100' },
    ]);
    expect(result.map((e) => e.employeeName)).toEqual(['강부장', '조사원']);
    expect(result[0].lastLoginAt).toBeNull();
  });

  it('부서 트리를 목록(깊이·상위 이름·인원 수)과 조직도(전체 인원·부서장 직급)로 바꾼다', async () => {
    useFakeServer(SEED_EMPLOYEE_NO.admin, (c) => (c.path === '/departments' ? ok(tree) : undefined));
    const list = await directoryApi.listDepartments();
    const chart = await adminOrgApi.getOrgChart();

    expect(list.map((d) => [d.departmentName, d.depth, d.parentName, d.memberCount])).toEqual([
      ['생산부', 0, null, 0],
      ['제강파트', 1, '생산부', 2],
    ]);
    expect(chart[0]).toMatchObject({ depth: 0, totalMemberCount: 2, head: { id: 11, employeeName: '강부장', jobGradeName: '부장' } });
    expect(chart[0].children[0]).toMatchObject({ depth: 1, head: null, totalMemberCount: 2 });
  });

  it('직급·역할은 서버 값을 쓰고 ERD에 없는 직급 코드는 비운다', async () => {
    const grades: JobGradeView[] = [{ id: 1, jobGradeName: '부장', sortOrder: 1, employeeCount: 3, createdAt: AT, updatedAt: AT }];
    const roles: RoleView[] = [{ id: 1, roleCode: 'ADMIN', roleName: '관리자', permissions: [{ permission: 'ORG_MANAGE', permissionLevel: 'USE' }], employeeCount: 1, createdAt: AT, updatedAt: AT }];
    useFakeServer(SEED_EMPLOYEE_NO.admin, (c) => (c.path === '/job-grades' ? ok(grades) : c.path === '/roles' ? ok(roles) : undefined));

    expect(await directoryApi.listJobGrades()).toEqual([{ id: 1, jobGradeCode: '', jobGradeName: '부장', sortOrder: 1, employeeCount: 3, updatedAt: AT }]);
    expect((await directoryApi.listRoles())[0]).toMatchObject({ roleCode: 'ADMIN', permissions: [{ permission: 'ORG_MANAGE', permissionLevel: 'USE' }] });
  });

  it('사원 목록(관리자 전용 API)은 서버 모드에서도 서버를 부르지 않고, 멤버 선택 조직도는 서버 조직도를 쓴다', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.admin, () => undefined);
    const employees = await directoryApi.listEmployees({ isActive: true });
    expect(calls).toEqual([]);
    expect(employees.length).toBeGreaterThan(0);

    await expect(directoryApi.getOrgChart()).rejects.toThrow();
    expect(calls.map((c) => c.path)).toContain('/departments');
  });
});

describe('조직 서버 어댑터 — 변경', () => {
  const department = { id: 7, departmentCode: 'T-1', departmentName: '테스트부', parentId: 2, headEmployeeId: 11, headEmployeeName: '강부장', createdAt: AT, updatedAt: AT };
  const echo = (c: { method: string; path: string }) => {
    if (c.path === '/employees' && c.method === 'POST') return ok(employee(21, '새사원'));
    if (c.path.startsWith('/employees/')) return ok({ ...employee(11, '강부장'), isActive: false });
    if (c.path.startsWith('/departments')) return ok(department);
    if (c.path.startsWith('/job-grades')) return ok({ id: 9, jobGradeName: '수석', sortOrder: 0, employeeCount: 0, createdAt: AT, updatedAt: AT });
    if (c.path.startsWith('/roles/')) return ok({ id: 6, roleCode: 'LOGISTICS', roleName: '물류', permissions: [], employeeCount: 2, createdAt: AT, updatedAt: AT });
    return undefined;
  };

  it('사원 등록은 비밀번호를 함께 보내고, 비밀번호가 없으면 서버를 부르지 않는다', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.admin, echo);
    const input = { employeeNo: '2610099', employeeName: '새사원', departmentId: 2, jobGradeId: 1, roleId: 3 };
    const missing = await employeeAdminApi.create(input).catch((e: unknown) => e);
    expect(missing).toBeInstanceOf(InputError);
    expect((missing as InputError).fieldErrors).toHaveProperty('password');
    expect(calls).toEqual([]);

    const saved = await employeeAdminApi.create({ ...input, password: 'pass-1' });
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/employees', body: { ...input, password: 'pass-1' } });
    expect(saved).toEqual({ id: 21, employeeNo: '9000021', employeeName: '새사원', isActive: true });
  });

  it('사원 수정은 화면 확인값(expectedUpdatedAt) 없이 보내고, 사용 안 함·다시 사용은 isActive만 보낸다', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.admin, echo);
    await employeeAdminApi.update({ id: 11, employeeName: '강부장', departmentId: 5, jobGradeId: 1, roleId: 3, expectedUpdatedAt: AT });
    await employeeAdminApi.deactivate({ id: 11, expectedUpdatedAt: AT });
    await employeeAdminApi.activate({ id: 11 });

    expect(calls.map((c) => [c.method, c.path, c.body])).toEqual([
      ['PATCH', '/employees/11', { employeeName: '강부장', departmentId: 5, jobGradeId: 1, roleId: 3 }],
      ['PATCH', '/employees/11', { isActive: false }],
      ['PATCH', '/employees/11', { isActive: true }],
    ]);
  });

  it('부서 등록은 정렬 순서를, 부서 수정은 부서코드를 보내지 않는다', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.admin, echo);
    const created = await departmentAdminApi.create({ departmentCode: 'T-1', departmentName: '테스트부', parentId: 2, sortOrder: '3' });
    await departmentAdminApi.update({ id: 7, departmentCode: 'CHANGED', departmentName: '테스트부', parentId: null, headEmployeeId: 11, sortOrder: '3', expectedUpdatedAt: AT });

    expect(created).toEqual({ id: 7, name: '테스트부' });
    expect(calls.map((c) => [c.method, c.path, c.body])).toEqual([
      ['POST', '/departments', { departmentCode: 'T-1', departmentName: '테스트부', parentId: 2 }],
      ['PATCH', '/departments/7', { departmentName: '테스트부', parentId: null, headEmployeeId: 11 }],
    ]);
  });

  it('직급 등록은 표시 순서를 정수로 보내고 직급 코드는 보내지 않는다 (정수가 아니면 서버를 부르지 않음)', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.admin, echo);
    expect(await jobGradeAdminApi.create({ jobGradeCode: '', jobGradeName: '수석', sortOrder: ' 0 ' })).toEqual({ id: 9, name: '수석' });
    expect(await jobGradeAdminApi.create({ jobGradeCode: '', jobGradeName: '수석', sortOrder: '1.5' }).catch((e: unknown) => e)).toBeInstanceOf(InputError);
    expect(calls.map((c) => c.body)).toEqual([{ jobGradeName: '수석', sortOrder: 0 }]);
  });

  it('부서 삭제·직급 삭제는 DELETE, 직급 수정은 이름과 정수 표시 순서만 PATCH로 보낸다 (API-271·272·273)', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.admin, echo);
    expect(await departmentAdminApi.remove({ id: 7, expectedUpdatedAt: AT })).toEqual({ id: 7, name: '테스트부' });
    expect(await jobGradeAdminApi.update({ id: 9, jobGradeCode: '', jobGradeName: '수석', sortOrder: '2', expectedUpdatedAt: AT })).toEqual({ id: 9, name: '수석' });
    expect(await jobGradeAdminApi.remove({ id: 9, expectedUpdatedAt: AT })).toEqual({ id: 9, name: '수석' });
    expect(calls.map((c) => [c.method, c.path, c.body])).toEqual([
      ['DELETE', '/departments/7', undefined],
      ['PATCH', '/job-grades/9', { jobGradeName: '수석', sortOrder: 2 }],
      ['DELETE', '/job-grades/9', undefined],
    ]);
  });

  it('역할 권한 저장은 PUT으로 권한 목록만 보낸다', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.admin, echo);
    const permissions = [{ permission: 'GOODS_ISSUE_CONFIRM' as const, permissionLevel: 'USE' as const }];
    expect(await roleAdminApi.replacePermissions({ roleId: 6, permissions, expectedUpdatedAt: AT })).toEqual({ id: 6, name: '물류' });
    expect(calls[0]).toMatchObject({ method: 'PUT', path: '/roles/6/permissions', body: { permissions } });
  });
});
