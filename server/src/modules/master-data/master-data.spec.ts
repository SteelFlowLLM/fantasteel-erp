// 기준정보 조회 API(API-165·168·170·172·175·178)를 실제 앱과 DB(fs_master)로 확인한다.
// 권한 가드·쿼리 변환·Decimal 문자열 변환까지 보려고 HTTP로 부른다. 값은 시드(seed.ts) 기준정보를 읽는다.
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import type {
  ItemView,
  RoutingView,
  SpecificConsumptionView,
  SpecMappingView,
  SteelGradeView,
} from '@fantasteel/shared';
import { AppModule } from '../../app.module';

let app: INestApplication;
let baseUrl: string;
/** 관리자 이현정 — 기준정보 관리 사용 */
let adminCookie: string;
/** 생산부장 강민석 — 기준정보 조회만 */
let productionCookie: string;
/** 물류부장 신현우 — 기준정보 권한 없음 */
let logisticsCookie: string;

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

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(0);
  baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1`;
  adminCookie = await login('1503001');
  productionCookie = await login('1401006');
  logisticsCookie = await login('1610014');
}, 60_000);

afterAll(async () => {
  await app?.close();
});

describe('기준정보 조회 권한', () => {
  const paths = ['/items', '/steel-grades', '/spec-mappings', '/routings', '/specific-consumptions', '/customers'];

  it.each(paths)('%s: 조회 권한이 있으면 읽는다', async (path) => {
    const { status, body } = await get(path, productionCookie);
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  it.each(paths)('%s: 기준정보 권한이 없으면 COM-002', async (path) => {
    const { status, body } = await get(path, logisticsCookie);
    expect(status).toBe(403);
    expect(body.error?.code).toBe('COM-002');
  });
});

describe('GET /items (API-165)', () => {
  it('규격은 치수·이론중량(소수 3자리)을 준다', async () => {
    const { body } = await get<ItemView[]>('/items');
    const slab = body.data.find((i) => i.itemCode === 'SL-SS275-250x1200x10000');
    expect(slab).toMatchObject({ itemType: 'SLAB', unitType: 'QTY', steelGradeCode: 'SS275', thicknessMm: '250.00', theoreticalWeightTon: '23.550' });
  });

  it('itemType으로 거른다', async () => {
    const { body } = await get<ItemView[]>('/items?itemType=COIL');
    expect(body.data).toHaveLength(12);
    expect(body.data.every((i) => i.itemType === 'COIL')).toBe(true);
  });
});

describe('GET /steel-grades (API-168)', () => {
  it('시드 강종 6종과 적용 규격 번호', async () => {
    const { body } = await get<SteelGradeView[]>('/steel-grades');
    expect(body.data.map((g) => g.steelGradeCode).sort()).toEqual(['SM355A', 'SM355B', 'SM355C', 'SM355D', 'SPHC', 'SS275']);
    expect(body.data.every((g) => g.standardNo.length > 0)).toBe(true);
  });
});

describe('GET /spec-mappings (API-170)', () => {
  it('슬래브·코일 규격과 열연 계획 수율(계산값)을 준다', async () => {
    const { body } = await get<SpecMappingView[]>('/spec-mappings');
    expect(body.data).toHaveLength(12);
    const mapping = body.data.find((m) => m.slabItem.itemCode === 'SL-SS275-250x1200x10000');
    expect(mapping).toMatchObject({
      steelGradeCode: 'SS275',
      slabItem: { theoreticalWeightTon: '23.550' },
      coilItem: { itemCode: 'CL-SS275-2.5x1200x980000', theoreticalWeightTon: '23.079' },
      hotRollingYieldRate: '0.9800',
    });
  });
});

describe('GET /routings (API-172)', () => {
  it('품목 유형별 공정 순서와 계획 수율. 제선·열연은 null', async () => {
    const { body } = await get<RoutingView[]>('/routings');
    const coil = body.data.filter((r) => r.itemType === 'COIL');
    expect(coil.map((r) => [r.processType, r.plannedYieldRate])).toEqual([
      ['IRONMAKING', null],
      ['STEELMAKING', '0.9000'],
      ['CONTINUOUS_CASTING', '0.9800'],
      ['HOT_ROLLING', null],
    ]);
    expect(body.data.filter((r) => r.itemType === 'SLAB')).toHaveLength(3);
  });
});

describe('GET /specific-consumptions (API-175)', () => {
  it('공통 원단위는 강종 null, 합금철은 강종별', async () => {
    const { body } = await get<SpecificConsumptionView[]>('/specific-consumptions');
    expect(body.data).toHaveLength(7);
    expect(body.data.find((c) => c.rawMaterialItemCode === 'ORE01')).toMatchObject({ rawMaterialType: 'IRON_ORE', steelGradeId: null, consumptionRate: '1.6000' });
    expect(body.data.find((c) => c.rawMaterialItemCode === 'SMN01' && c.steelGradeCode === 'SPHC')).toMatchObject({ rawMaterialType: 'FERROALLOY', consumptionRate: '4.0000' });
  });
});
