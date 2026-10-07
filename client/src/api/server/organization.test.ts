// 조직 서버 어댑터: 관리 화면 조회는 서버(GET employees·departments·job-grades·roles), 멤버 선택용 조회는 서버 모드에서도 가짜 DB.
import type { DepartmentNode, EmployeeView, JobGradeView, RoleView } from '@fantasteel/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { adminOrgApi } from '@/api/adminOrganization';
import { directoryApi } from '@/api/directory';
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

  it('메신저·업무 멤버 선택용 조회는 서버 모드에서도 서버를 부르지 않는다', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.admin, () => undefined);
    const employees = await directoryApi.listEmployees({ isActive: true });
    const chart = await directoryApi.getOrgChart();

    expect(calls).toEqual([]);
    expect(employees.length).toBeGreaterThan(0);
    expect(chart.length).toBeGreaterThan(0);
  });
});
