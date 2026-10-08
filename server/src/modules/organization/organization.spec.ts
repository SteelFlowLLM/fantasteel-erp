// 조직 API(조회 API-155·158·161·163, 등록·수정 API-156·157·159·160·162·164, 삭제·직급 수정 API-271·272·273)를 실제 앱과 DB(fs_common)로 확인한다.
// 권한 가드·쿼리 변환·날짜 변환까지 보려고 HTTP로 부른다. 조회는 시드(seed.md) 조직 데이터를 읽는다.
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import { PERMISSION, type DepartmentNode, type DepartmentView, type EmployeeView, type JobGradeView, type PageResult, type RoleView } from '@fantasteel/shared';
import { AppModule } from '../../app.module';

let app: INestApplication;
let baseUrl: string;
/** 관리자 이현정 */
let adminCookie: string;
/** 영업 사원 박서영 — 사원 관리·부서·권한 관리 권한 없음 */
let salesCookie: string;

async function login(employeeNo: string, password = process.env.SEED_PASSWORD ?? 'fantasteel'): Promise<string> {
  const res = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ employeeNo, password }),
  });
  if (!res.ok) throw new Error(`로그인 실패 (HTTP ${res.status})`);
  return (res.headers.get('set-cookie') ?? '').split(';')[0];
}

async function get<T>(path: string, cookie = adminCookie) {
  const res = await fetch(`${baseUrl}${path}`, { headers: { cookie } });
  return { status: res.status, body: (await res.json()) as { success: boolean; data: T; error?: { code: string } } };
}

async function send<T>(method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, payload?: unknown, cookie = adminCookie) {
  const res = await fetch(`${baseUrl}${path}`, { method, headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  return { status: res.status, body: (await res.json()) as { success: boolean; data: T; error?: { code: string } } };
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(0);
  baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1`;
  adminCookie = await login('1503001');
  salesCookie = await login('2103003');
}, 60_000);

afterAll(async () => {
  await app?.close();
});

const flatten = (nodes: DepartmentNode[]): DepartmentNode[] => nodes.flatMap((n) => [n, ...flatten(n.children)]);

describe('GET /employees (API-155)', () => {
  it('페이지로 주고 비밀번호 해시를 내보내지 않는다', async () => {
    const { status, body } = await get<PageResult<EmployeeView>>('/employees?page=1&size=5');
    expect(status).toBe(200);
    expect(body.data).toMatchObject({ page: 1, size: 5 });
    expect(body.data.items).toHaveLength(5);
    expect(body.data.total).toBeGreaterThanOrEqual(15);
    for (const e of body.data.items) {
      expect(e).not.toHaveProperty('passwordHash');
      expect(Number.isNaN(Date.parse(e.createdAt))).toBe(false);
    }
  });

  it('부서장은 headDepartmentIds에 부서가 들어간다', async () => {
    const { body } = await get<PageResult<EmployeeView>>('/employees?keyword=1702004');
    expect(body.data.items).toHaveLength(1);
    const head = body.data.items[0];
    expect(head).toMatchObject({ employeeName: '최준혁', departmentName: '구매부', roleCode: 'PURCHASE' });
    expect(head.headDepartmentIds).toEqual([head.departmentId]);
  });

  it('역할·사용 여부로 거른다', async () => {
    const { body } = await get<PageResult<EmployeeView>>('/employees?roleCode=QUALITY&isActive=true&size=100');
    expect(body.data.items.length).toBeGreaterThanOrEqual(2);
    expect(body.data.items.every((e) => e.roleCode === 'QUALITY' && e.isActive)).toBe(true);
  });

  it('없는 역할 값은 COM-004', async () => {
    const { status, body } = await get('/employees?roleCode=NOPE');
    expect(status).toBe(400);
    expect(body.error?.code).toBe('COM-004');
  });

  it('사원 관리 권한이 없으면 COM-002', async () => {
    const { body } = await get('/employees', salesCookie);
    expect(body.error?.code).toBe('COM-002');
  });
});

describe('GET /departments (API-158)', () => {
  it('부서 트리와 사용 중 인원, 부서장 표시를 준다 — 권한 없는 사원도 볼 수 있다', async () => {
    const { status, body } = await get<DepartmentNode[]>('/departments', salesCookie);
    expect(status).toBe(200);
    expect(body.data.every((d) => d.parentId === null)).toBe(true);

    const production = body.data.find((d) => d.departmentName === '생산부');
    expect(production?.children.map((c) => c.departmentName)).toEqual(expect.arrayContaining(['제선파트', '제강파트', '연주파트', '열연파트']));
    for (const child of production?.children ?? []) expect(child.parentId).toBe(production?.id);

    const steel = flatten(body.data).find((d) => d.departmentName === '제강파트');
    expect(steel?.headEmployeeName).toBe('장혜린');
    expect(steel?.members.map((m) => [m.employeeName, m.isHead])).toEqual([
      ['장혜린', true],
      ['조은서', false],
    ]);
  });
});

describe('GET /job-grades (API-161)', () => {
  it('표시 순서대로 준다', async () => {
    const { body } = await get<JobGradeView[]>('/job-grades', salesCookie);
    const orders = body.data.map((g) => g.sortOrder);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
    expect(body.data.map((g) => g.jobGradeName)).toEqual(expect.arrayContaining(['부장', '차장', '과장', '대리', '사원']));
    expect(body.data.reduce((sum, g) => sum + g.employeeCount, 0)).toBeGreaterThanOrEqual(15);
  });
});

describe('GET /roles (API-163)', () => {
  it('역할 6개와 권한을 공통 코드 순서로 준다', async () => {
    const { body } = await get<RoleView[]>('/roles');
    expect(body.data.map((r) => r.roleCode).sort()).toEqual(['ADMIN', 'LOGISTICS', 'PRODUCTION', 'PURCHASE', 'QUALITY', 'SALES']);
    const order: string[] = Object.values(PERMISSION);
    for (const role of body.data) {
      const indexes = role.permissions.map((p) => order.indexOf(p.permission));
      expect(indexes).toEqual([...indexes].sort((a, b) => a - b));
    }
    const admin = body.data.find((r) => r.roleCode === 'ADMIN');
    expect(admin?.permissions).toEqual(expect.arrayContaining([{ permission: 'EMPLOYEE_MANAGE', permissionLevel: 'USE' }]));
  });

  it('부서·권한 관리 권한이 없으면 COM-002', async () => {
    const { body } = await get('/roles', salesCookie);
    expect(body.error?.code).toBe('COM-002');
  });
});

// ── 등록·수정 (API-156·157·162). 이 파일이 만든 사원·직급으로만 확인한다 (물류부에 넣어 위 조직도 확인과 겹치지 않게) ──

let seq = 0;
async function newEmployeePayload() {
  const [departments, grades, roles] = await Promise.all([get<DepartmentNode[]>('/departments'), get<JobGradeView[]>('/job-grades'), get<RoleView[]>('/roles')]);
  seq += 1;
  return {
    employeeNo: `T${Date.now()}${seq}`,
    password: 'new-pass-1',
    employeeName: `테스트사원${seq}`,
    departmentId: flatten(departments.body.data).find((d) => d.departmentName === '물류부')!.id,
    jobGradeId: grades.body.data.find((g) => g.jobGradeName === '사원')!.id,
    roleId: roles.body.data.find((r) => r.roleCode === 'LOGISTICS')!.id,
  };
}

describe('POST /employees (API-156)', () => {
  it('등록하면 비밀번호는 응답에 없고, 그 비밀번호로 로그인할 수 있다', async () => {
    const payload = await newEmployeePayload();
    const { status, body } = await send<EmployeeView>('POST', '/employees', payload);
    expect(status).toBe(201);
    expect(body.data).toMatchObject({ employeeNo: payload.employeeNo, departmentName: '물류부', roleCode: 'LOGISTICS', isActive: true, headDepartmentIds: [] });
    expect(body.data).not.toHaveProperty('password');
    expect(body.data).not.toHaveProperty('passwordHash');
    await expect(login(payload.employeeNo, payload.password)).resolves.toContain('=');
  });

  it('없는 부서는 COM-003, 겹치는 사원번호는 COM-001', async () => {
    const payload = await newEmployeePayload();
    expect((await send('POST', '/employees', { ...payload, departmentId: 999999 })).body.error?.code).toBe('COM-003');
    await send('POST', '/employees', payload);
    expect((await send('POST', '/employees', payload)).body.error?.code).toBe('COM-001');
  });

  it('사원 관리 권한이 없으면 COM-002', async () => {
    const { body } = await send('POST', '/employees', await newEmployeePayload(), salesCookie);
    expect(body.error?.code).toBe('COM-002');
  });
});

describe('PATCH /employees/:id (API-157)', () => {
  it('부서·직급·역할을 바꾸고, 퇴사 처리하면 그 사원의 다음 요청은 AUTH-002', async () => {
    const payload = await newEmployeePayload();
    const created = (await send<EmployeeView>('POST', '/employees', payload)).body.data;
    const cookie = await login(payload.employeeNo, payload.password);
    const roles = (await get<RoleView[]>('/roles')).body.data;
    const quality = roles.find((r) => r.roleCode === 'QUALITY')!;

    const changed = await send<EmployeeView>('PATCH', `/employees/${created.id}`, { employeeName: '바뀐이름', roleId: quality.id });
    expect(changed.body.data).toMatchObject({ employeeNo: payload.employeeNo, employeeName: '바뀐이름', roleCode: 'QUALITY' });

    const retired = await send<EmployeeView>('PATCH', `/employees/${created.id}`, { isActive: false });
    expect(retired.body.data.isActive).toBe(false);
    expect((await get('/departments', cookie)).body.error?.code).toBe('AUTH-002');
  });

  it('부서장인 사원은 퇴사 처리할 수 없다 (COM-004)', async () => {
    const head = (await get<PageResult<EmployeeView>>('/employees?keyword=1702004')).body.data.items[0];
    const { body } = await send('PATCH', `/employees/${head.id}`, { isActive: false });
    expect(body.error?.code).toBe('COM-004');
    expect((await get<PageResult<EmployeeView>>('/employees?keyword=1702004')).body.data.items[0].isActive).toBe(true);
  });

  it('사원번호는 바꿀 수 없다 (받지 않는 값은 COM-004), 없는 사원은 COM-003', async () => {
    const head = (await get<PageResult<EmployeeView>>('/employees?keyword=1702004')).body.data.items[0];
    expect((await send('PATCH', `/employees/${head.id}`, { employeeNo: '9999999' })).body.error?.code).toBe('COM-004');
    expect((await send('PATCH', '/employees/999999', { employeeName: '없음' })).body.error?.code).toBe('COM-003');
  });
});

describe('POST /job-grades (API-162)', () => {
  it('등록하면 표시 순서대로 목록에 들어간다', async () => {
    const name = `테스트직급${Date.now()}`;
    const { status, body } = await send<JobGradeView>('POST', '/job-grades', { jobGradeName: name, sortOrder: 99 });
    expect(status).toBe(201);
    expect(body.data).toMatchObject({ jobGradeName: name, sortOrder: 99, employeeCount: 0 });
    const list = (await get<JobGradeView[]>('/job-grades')).body.data;
    expect(list.at(-1)?.jobGradeName).toBe(name);
  });

  it('사원 관리 권한이 없으면 COM-002', async () => {
    const { body } = await send('POST', '/job-grades', { jobGradeName: '권한없음', sortOrder: 1 }, salesCookie);
    expect(body.error?.code).toBe('COM-002');
  });
});

// ── 부서 등록·수정 (API-159·160), 역할 권한 변경 (API-164). 이 파일이 만든 부서와, 끝나면 되돌리는 물류 역할로만 확인한다 ──

const newDepartment = (parentId: number | null = null) => {
  seq += 1;
  return send<DepartmentView>('POST', '/departments', { departmentCode: `T-${Date.now()}-${seq}`, departmentName: `테스트부서${seq}`, parentId });
};

describe('POST /departments (API-159)', () => {
  it('최상위·하위 부서를 등록하고 트리에 들어간다', async () => {
    const top = await newDepartment();
    expect(top.status).toBe(201);
    expect(top.body.data).toMatchObject({ parentId: null, headEmployeeId: null });
    const child = await newDepartment(top.body.data.id);
    expect(child.body.data.parentId).toBe(top.body.data.id);
    const node = (await get<DepartmentNode[]>('/departments')).body.data.find((d) => d.id === top.body.data.id);
    expect(node?.children.map((c) => c.id)).toEqual([child.body.data.id]);
  });

  it('없는 상위 부서는 COM-003, 겹치는 부서코드는 COM-001, 권한이 없으면 COM-002', async () => {
    const top = (await newDepartment()).body.data;
    expect((await send('POST', '/departments', { departmentCode: `T-X-${Date.now()}`, departmentName: '없음', parentId: 999999 })).body.error?.code).toBe('COM-003');
    expect((await send('POST', '/departments', { departmentCode: top.departmentCode, departmentName: '겹침' })).body.error?.code).toBe('COM-001');
    expect((await send('POST', '/departments', { departmentCode: `T-Y-${Date.now()}`, departmentName: '권한없음' }, salesCookie)).body.error?.code).toBe('COM-002');
  });
});

describe('PATCH /departments/:id (API-160)', () => {
  it('자기 자신이나 하위 부서를 상위로 지정하면 COM-004 (계층 순환)', async () => {
    const a = (await newDepartment()).body.data;
    const b = (await newDepartment(a.id)).body.data;
    const c = (await newDepartment(b.id)).body.data;
    expect((await send('PATCH', `/departments/${a.id}`, { parentId: a.id })).body.error?.code).toBe('COM-004');
    expect((await send('PATCH', `/departments/${a.id}`, { parentId: c.id })).body.error?.code).toBe('COM-004');
    const moved = await send<DepartmentView>('PATCH', `/departments/${c.id}`, { parentId: a.id, departmentName: '옮긴부서' });
    expect(moved.body.data).toMatchObject({ parentId: a.id, departmentName: '옮긴부서', departmentCode: c.departmentCode });
  });

  it('부서장을 지정·해제하고, 퇴사자는 COM-004, 없는 사원은 COM-003', async () => {
    const dept = (await newDepartment()).body.data;
    const payload = await newEmployeePayload();
    const employee = (await send<EmployeeView>('POST', '/employees', payload)).body.data;

    const assigned = await send<DepartmentView>('PATCH', `/departments/${dept.id}`, { headEmployeeId: employee.id });
    expect(assigned.body.data).toMatchObject({ headEmployeeId: employee.id, headEmployeeName: employee.employeeName });
    const cleared = await send<DepartmentView>('PATCH', `/departments/${dept.id}`, { headEmployeeId: null });
    expect(cleared.body.data.headEmployeeId).toBeNull();

    await send('PATCH', `/employees/${employee.id}`, { isActive: false });
    expect((await send('PATCH', `/departments/${dept.id}`, { headEmployeeId: employee.id })).body.error?.code).toBe('COM-004');
    expect((await send('PATCH', `/departments/${dept.id}`, { headEmployeeId: 999999 })).body.error?.code).toBe('COM-003');
    expect((await send('PATCH', '/departments/999999', { departmentName: '없음' })).body.error?.code).toBe('COM-003');
  });
});

describe('PUT /roles/:id/permissions (API-164)', () => {
  it('권한을 통째로 바꾸면 그 역할 사원의 다음 요청부터 반영된다 (빠진 권한은 COM-002)', async () => {
    const logistics = (await get<RoleView[]>('/roles')).body.data.find((r) => r.roleCode === 'LOGISTICS')!;
    const original = logistics.permissions;
    const logisticsCookie = await login('2304015');
    expect((await get('/roles', logisticsCookie)).body.error?.code).toBe('COM-002');

    try {
      const granted = await send<RoleView>('PUT', `/roles/${logistics.id}/permissions`, { permissions: [...original, { permission: 'ORG_MANAGE', permissionLevel: 'VIEW' }] });
      expect(granted.body.data.permissions).toContainEqual({ permission: 'ORG_MANAGE', permissionLevel: 'VIEW' });
      expect((await get('/roles', logisticsCookie)).status).toBe(200);
    } finally {
      const restored = await send<RoleView>('PUT', `/roles/${logistics.id}/permissions`, { permissions: original });
      expect(restored.body.data.permissions).toEqual(original);
    }
    expect((await get('/roles', logisticsCookie)).body.error?.code).toBe('COM-002');
  });

  it('같은 권한 두 번·잘못된 값은 COM-004, 없는 역할은 COM-003, 권한이 없으면 COM-002', async () => {
    const twice = [
      { permission: 'MILL_SHEET_READ', permissionLevel: 'USE' },
      { permission: 'MILL_SHEET_READ', permissionLevel: 'VIEW' },
    ];
    expect((await send('PUT', '/roles/1/permissions', { permissions: twice })).body.error?.code).toBe('COM-004');
    expect((await send('PUT', '/roles/1/permissions', { permissions: [{ permission: 'NOPE', permissionLevel: 'USE' }] })).body.error?.code).toBe('COM-004');
    expect((await send('PUT', '/roles/999999/permissions', { permissions: [] })).body.error?.code).toBe('COM-003');
    expect((await send('PUT', '/roles/1/permissions', { permissions: [] }, salesCookie)).body.error?.code).toBe('COM-002');
  });
});

// ── 삭제·직급 수정 (API-271·272·273, 2026-10-08 추가). 이 파일이 만든 부서·직급·사원으로만 확인한다 ──

/** 퇴사 처리한 사원 1명을 만든다 (퇴사자도 참조로 세는지 보려고) */
async function createRetiredEmployee(override: { departmentId?: number; jobGradeId?: number }) {
  const created = await send<EmployeeView>('POST', '/employees', { ...(await newEmployeePayload()), ...override });
  await send('PATCH', `/employees/${created.body.data.id}`, { isActive: false });
}

describe('PATCH·DELETE /job-grades/:id (API-272·273)', () => {
  const newGrade = async () => (await send<JobGradeView>('POST', '/job-grades', { jobGradeName: `삭제직급${Date.now()}`, sortOrder: 98 })).body.data;

  it('이름·표시 순서를 바꾸고, 쓰는 사원이 없으면 지워 목록에서 빠진다', async () => {
    const grade = await newGrade();
    const renamed = await send<JobGradeView>('PATCH', `/job-grades/${grade.id}`, { jobGradeName: `${grade.jobGradeName}수정`, sortOrder: 97 });
    expect(renamed.body.data).toMatchObject({ id: grade.id, jobGradeName: `${grade.jobGradeName}수정`, sortOrder: 97 });

    const deleted = await send<JobGradeView>('DELETE', `/job-grades/${grade.id}`);
    expect(deleted.status).toBe(200);
    expect(deleted.body.data).toMatchObject({ id: grade.id, jobGradeName: `${grade.jobGradeName}수정` });
    expect((await get<JobGradeView[]>('/job-grades')).body.data.some((g) => g.id === grade.id)).toBe(false);
  });

  it('쓰는 사원이 있으면(퇴사자 포함) 지우지 않는다 (COM-004)', async () => {
    const grade = await newGrade();
    await createRetiredEmployee({ jobGradeId: grade.id });
    expect((await send('DELETE', `/job-grades/${grade.id}`)).body.error?.code).toBe('COM-004');
  });

  it('없는 직급은 COM-003, 빈 이름은 COM-004, 권한이 없으면 COM-002', async () => {
    expect((await send('PATCH', '/job-grades/999999', { sortOrder: 1 })).body.error?.code).toBe('COM-003');
    expect((await send('DELETE', '/job-grades/999999')).body.error?.code).toBe('COM-003');
    const grade = await newGrade();
    expect((await send('PATCH', `/job-grades/${grade.id}`, { jobGradeName: '  ' })).body.error?.code).toBe('COM-004');
    expect((await send('DELETE', `/job-grades/${grade.id}`, undefined, salesCookie)).body.error?.code).toBe('COM-002');
  });
});

describe('DELETE /departments/:id (API-271)', () => {
  const newDepartment = async (parentId?: number) => {
    seq += 1;
    const code = `D${Date.now()}${seq}`;
    return (await send<DepartmentView>('POST', '/departments', { departmentCode: code, departmentName: `삭제부서${seq}`, parentId })).body.data;
  };

  it('하위 부서·소속 사원이 없으면 지워 조직도에서 빠진다', async () => {
    const department = await newDepartment();
    const deleted = await send<DepartmentView>('DELETE', `/departments/${department.id}`);
    expect(deleted.status).toBe(200);
    expect(deleted.body.data).toMatchObject({ id: department.id, departmentCode: department.departmentCode });
    expect(flatten((await get<DepartmentNode[]>('/departments')).body.data).some((d) => d.id === department.id)).toBe(false);
  });

  it('하위 부서나 소속 사원(퇴사자 포함)이 있으면 지우지 않는다 (COM-004)', async () => {
    const parent = await newDepartment();
    await newDepartment(parent.id);
    expect((await send('DELETE', `/departments/${parent.id}`)).body.error?.code).toBe('COM-004');

    const withRetired = await newDepartment();
    await createRetiredEmployee({ departmentId: withRetired.id });
    expect((await send('DELETE', `/departments/${withRetired.id}`)).body.error?.code).toBe('COM-004');
  });

  it('없는 부서는 COM-003, 권한이 없으면 COM-002', async () => {
    expect((await send('DELETE', '/departments/999999')).body.error?.code).toBe('COM-003');
    const department = await newDepartment();
    expect((await send('DELETE', `/departments/${department.id}`, undefined, salesCookie)).body.error?.code).toBe('COM-002');
  });
});
