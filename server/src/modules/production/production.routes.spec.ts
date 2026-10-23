// 고정 경로 순서와 쿼리 변환: GET production-plans/hot-rolling·reproduction-checks가 production-plans/:id(정수 변환)보다 먼저 잡혀야 하고,
// productionPlanIds=1,2,3(쉼표)이 숫자 배열로 바뀌어야 한다 (이슈 #498). 서비스 단위 시험으로는 경로 등록 순서와 쿼리 변환을 볼 수 없어
// 실제 앱을 띄워 HTTP로 부른다 (실제 DB fs_prod, 전역 설정은 main.ts와 같게).
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';

let app: INestApplication;
let baseUrl: string;
let cookie: string;
const planIds: number[] = [];

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(0);
  baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1`;

  // 관리자: 생산계획 확정·열연 투입 조회 권한이 모두 있다
  const login = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ employeeNo: '1503001', password: process.env.SEED_PASSWORD! }),
  });
  if (!login.ok) throw new Error(`로그인 실패 (HTTP ${login.status})`);
  cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];

  // 수주 연결 없는 코일·슬래브 계획 (경로·변환만 보므로 수주·LOT 없이 넣는다)
  const prisma = app.get(PrismaService);
  const coil = await prisma.item.findFirstOrThrow({ where: { itemType: 'COIL' }, orderBy: { id: 'asc' } });
  const slab = await prisma.item.findFirstOrThrow({ where: { itemType: 'SLAB' }, orderBy: { id: 'asc' } });
  for (const [no, item] of [['PP-ROUTE-C', coil], ['PP-ROUTE-S', slab]] as const) {
    const plan = await prisma.productionPlan.create({ data: { productionPlanNo: no, itemId: item.id, shortageQty: 2, heatCount: 1, productionPlanStatus: 'PLANNED' } });
    planIds.push(plan.id);
  }
}, 60_000);

afterAll(async () => {
  await app.get(PrismaService).productionPlan.deleteMany({ where: { id: { in: planIds } } });
  await app?.close();
});

const get = async <T = unknown>(path: string) => {
  const res = await fetch(`${baseUrl}${path}`, { headers: { cookie } });
  return { status: res.status, body: (await res.json()) as { success: boolean; data: T; error?: { code: string } } };
};

interface HotRollingRow {
  plan: { productionPlanNo: string };
  shortageQty: number;
  usableCoilQty: number;
  failedCoilQty: number;
  confirmedAllocationQty: number;
  neededQty: number;
  isRollable: boolean;
}
interface CheckRow {
  productionPlanId: number;
  itemType: string;
  reproduction: unknown;
}

describe('열연 투입 목록 경로 (GET production-plans/hot-rolling)', () => {
  it('production-plans/:id의 정수 변환에 걸리지 않고 코일 계획만 페이지로 준다', async () => {
    const { status, body } = await get<{ items: HotRollingRow[]; page: number; size: number; total: number }>('/production-plans/hot-rolling?page=1&size=100');
    expect(status).toBe(200);
    expect(body.data).toMatchObject({ page: 1, size: 100, total: expect.any(Number) });
    const mine = body.data.items.filter((r) => r.plan.productionPlanNo.startsWith('PP-ROUTE-'));
    expect(mine.map((r) => r.plan.productionPlanNo)).toEqual(['PP-ROUTE-C']);
    expect(mine[0]).toMatchObject({ shortageQty: 2, usableCoilQty: 0, failedCoilQty: 0, confirmedAllocationQty: 0, neededQty: 2, isRollable: false });
  });

  it('page·size는 정수여야 한다', async () => {
    expect((await get('/production-plans/hot-rolling?size=1000')).status).toBe(400);
  });

  it('production-plans/:id는 그대로 받는다 (없는 계획이면 COM-003, 정수가 아니면 COM-004)', async () => {
    expect((await get('/production-plans/2000000000')).body.error?.code).toBe('COM-003');
    expect((await get('/production-plans/abc')).body.error?.code).toBe('COM-004');
  });
});

describe('계획 여러 개의 재생산 판단 경로 (GET production-plans/reproduction-checks)', () => {
  it('쉼표로 이은 계획 id를 숫자 배열로 바꿔 읽는다 (없는 id는 빠진다)', async () => {
    const { status, body } = await get<CheckRow[]>(`/production-plans/reproduction-checks?productionPlanIds=${planIds[1]},${planIds[0]},2000000000`);
    expect(status).toBe(200);
    expect(body.data.map((c) => c.productionPlanId)).toEqual([planIds[0], planIds[1]]);
    expect(body.data[0]).toMatchObject({ reproduction: null, itemType: 'COIL' });
  });

  it('계획 id가 없거나 정수가 아니거나 100개를 넘으면 400', async () => {
    expect((await get('/production-plans/reproduction-checks')).status).toBe(400);
    expect((await get('/production-plans/reproduction-checks?productionPlanIds=')).status).toBe(400);
    expect((await get('/production-plans/reproduction-checks?productionPlanIds=1,abc')).status).toBe(400);
    expect((await get('/production-plans/reproduction-checks?productionPlanIds=0')).status).toBe(400);
    expect((await get(`/production-plans/reproduction-checks?productionPlanIds=${Array.from({ length: 101 }, (_, i) => i + 1).join(',')}`)).status).toBe(400);
  });
});
