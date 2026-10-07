// 조직 조회 API(API-155·158·161·163)를 실제 앱과 DB(fs_common)로 확인한다.
// 권한 가드·쿼리 변환·날짜 변환까지 보려고 HTTP로 부른다. 시드(seed.md)의 조직 데이터만 읽는다.
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import { PERMISSION, type DepartmentNode, type EmployeeView, type JobGradeView, type PageResult, type RoleView } from '@fantasteel/shared';
import { AppModule } from '../../app.module';

let app: INestApplication;
let baseUrl: string;
/** 관리자 이현정 */
let adminCookie: string;
/** 영업 사원 박서영 — 사원 관리·부서·권한 관리 권한 없음 */
let salesCookie: string;

async function login(employeeNo: string): Promise<string> {
  const res = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ employeeNo, password: process.env.SEED_PASSWORD ?? 'fantasteel' }),
  });
  if (!res.ok) throw new Error(`로그인 실패 (HTTP ${res.status})`);
  return (res.headers.get('set-cookie') ?? '').split(';')[0];
}

async function get<T>(path: string, cookie = adminCookie) {
  const res = await fetch(`${baseUrl}${path}`, { headers: { cookie } });
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
