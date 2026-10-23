// 기준정보 조회 API(API-165·168·170·172·175·178·181·184·187)와 등록·수정 API(API-166·167·169·171·173·174·176·177·179·180·182·183·185·186·188)를
// 권한 가드·쿼리 변환·Decimal 문자열 변환까지 보려고 HTTP로 부른다. 값은 시드(seed.ts) 기준정보를 읽는다.
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import type {
  CustomerView,
  ItemView,
  ProductionSettingView,
  RoutingView,
  SpecificConsumptionView,
  SpecMappingView,
  SteelGradeView,
  SupplierView,
  YardView,
} from '@fantasteel/shared';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';

let app: INestApplication;
let baseUrl: string;
/** 관리자 이현정 — 기준정보 관리 사용 */
let adminCookie: string;
/** 생산부장 강민석 — 기준정보 조회만 */
let productionCookie: string;
/** 물류부장 신현우 — 기준정보 조회만. 권한이 없는 경우는 테스트 동안 역할 권한을 빼서 본다 */
let logisticsCookie: string;

async function login(employeeNo: string, password = process.env.SEED_PASSWORD!): Promise<string> {
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

async function send<T>(method: 'POST' | 'PATCH' | 'DELETE', path: string, payload: unknown, cookie = adminCookie) {
  const body = payload === undefined ? undefined : JSON.stringify(payload);
  const res = await fetch(`${baseUrl}${path}`, { method, headers: { cookie, 'content-type': 'application/json' }, body });
  return { status: res.status, body: (await res.json()) as { success: boolean; data: T; error?: { code: string; message: string } } };
}

afterAll(async () => {
  await app?.close();
});

/**
 * 관리자가 부서·권한 화면에서 역할 권한을 뺀 상태를 만든다. 업무 조회는 기본으로 모든 역할에 있어서다(역할별 메뉴 v2 3장).
 * 가드가 요청마다 권한을 DB에서 읽으므로 바로 반영된다. 돌려놓는 함수를 돌려준다.
 */
async function revokeRolePermission(roleCode: string, permission: string): Promise<() => Promise<void>> {
  const prisma = app.get(PrismaService);
  const role = await prisma.role.findUniqueOrThrow({ where: { roleCode } });
  const row = await prisma.rolePermission.findUniqueOrThrow({ where: { roleId_permission: { roleId: role.id, permission } } });
  await prisma.rolePermission.delete({ where: { id: row.id } });
  return async () => {
    await prisma.rolePermission.create({ data: { roleId: role.id, permission, permissionLevel: row.permissionLevel } });
  };
}

describe('기준정보 조회 권한', () => {
  const paths = ['/items', '/steel-grades', '/spec-mappings', '/routings', '/specific-consumptions', '/customers', '/suppliers', '/yards', '/production-settings'];

  it.each(paths)('%s: 조회 권한이 있으면 읽는다', async (path) => {
    const { status, body } = await get(path, productionCookie);
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  it.each(paths)('%s: 업무 조회는 모든 역할이라 물류도 읽는다', async (path) => {
    expect((await get(path, logisticsCookie)).status).toBe(200);
  });

  describe('관리자가 물류의 기준정보 권한을 빼면', () => {
    let restore: () => Promise<void> = async () => undefined;
    beforeAll(async () => {
      restore = await revokeRolePermission('LOGISTICS', 'MASTER_MANAGE');
    });
    afterAll(async () => restore());

    it.each(paths)('%s: COM-002', async (path) => {
      const { status, body } = await get(path, logisticsCookie);
      expect(status).toBe(403);
      expect(body.error?.code).toBe('COM-002');
    });
  });
});

describe('GET /items (API-165)', () => {
  it('원료는 원료 유형·기본 공급업체를, 규격은 치수·이론중량(소수 3자리)을 준다', async () => {
    const { body } = await get<ItemView[]>('/items');
    const ore = body.data.find((i) => i.itemCode === 'ORE01');
    expect(ore).toMatchObject({ itemType: 'RAW_MATERIAL', unitType: 'TON', rawMaterialType: 'IRON_ORE', steelGradeId: null, theoreticalWeightTon: null });
    expect(ore?.defaultSupplierId).not.toBeNull();
    const slab = body.data.find((i) => i.itemCode === 'SL-SS275-250x1200x10000');
    expect(slab).toMatchObject({ itemType: 'SLAB', unitType: 'QTY', rawMaterialType: null, steelGradeCode: 'SS275', thicknessMm: '250.00', theoreticalWeightTon: '23.550', defaultSupplierId: null });
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

describe('GET /suppliers · /yards (API-181·184)', () => {
  it('공급업체 4곳', async () => {
    const { body } = await get<SupplierView[]>('/suppliers');
    expect(body.data.map((s) => s.supplierCode)).toEqual(['SUP-01', 'SUP-02', 'SUP-03', 'SUP-04']);
  });

  it('야드 3곳과 야드 유형', async () => {
    const { body } = await get<YardView[]>('/yards');
    expect(body.data.map((y) => [y.yardCode, y.yardType])).toEqual([
      ['YD-CL-01', 'COIL'],
      ['YD-RM-01', 'RAW_MATERIAL'],
      ['YD-SL-01', 'SLAB'],
    ]);
  });
});

describe('GET /production-settings (API-187)', () => {
  it('히트 용량(소수 3자리)과 납기 위험 기준일', async () => {
    const { body } = await get<ProductionSettingView>('/production-settings');
    expect(body.data).toMatchObject({ heatCapacityTon: '250.000', deliveryRiskDays: 3 });
  });
});

describe('등록·수정 (API-166·167·169·171)', () => {
  let yardIdOf: Record<string, number>;
  let gradeIdOf: Record<string, number>;

  async function itemIdOf(itemCode: string): Promise<number> {
    const item = (await get<ItemView[]>('/items')).body.data.find((i) => i.itemCode === itemCode);
    if (!item) throw new Error(`품목 없음: ${itemCode}`);
    return item.id;
  }

  beforeAll(async () => {
    const yards = (await get<YardView[]>('/yards')).body.data;
    yardIdOf = Object.fromEntries(yards.map((y) => [y.yardType, y.id]));
    const grades = (await get<SteelGradeView[]>('/steel-grades')).body.data;
    gradeIdOf = Object.fromEntries(grades.map((g) => [g.steelGradeCode, g.id]));
  });

  const slab = (thicknessMm: string) => ({
    itemType: 'SLAB',
    steelGradeId: gradeIdOf.SM355C,
    thicknessMm,
    widthMm: '1200',
    lengthMm: '10000',
    defaultYardId: yardIdOf.SLAB,
  });
  const coil = (thicknessMm: string) => ({ ...slab(thicknessMm), itemType: 'COIL', lengthMm: '980000', defaultYardId: yardIdOf.COIL });

  it('권한이 조회뿐이면 COM-002', async () => {
    const { body } = await send('POST', '/items', slab('250'), productionCookie);
    expect(body.error?.code).toBe('COM-002');
  });

  it('규격 등록: 코드·품목명·1매 이론중량(250 × 1,200 × 10,000 → 23.550)을 서버가 만든다', async () => {
    const { status, body } = await send<ItemView>('POST', '/items', slab('250'));
    expect(status).toBe(201);
    expect(body.data).toMatchObject({
      itemCode: 'SL-SM355C-250x1200x10000',
      itemName: 'SM355C 슬래브 250×1200×10000',
      unitType: 'QTY',
      thicknessMm: '250.00',
      theoreticalWeightTon: '23.550',
    });
  });

  it('같은 강종·두께·폭·길이 재등록은 거부 (COM-004)', async () => {
    const { body } = await send('POST', '/items', { ...slab('250.00'), lengthMm: '10000.0' });
    expect(body.error?.code).toBe('COM-004');
  });

  it('없는 강종은 COM-003, 다른 유형의 야드는 COM-004', async () => {
    expect((await send('POST', '/items', { ...slab('260'), steelGradeId: 999_999 })).body.error?.code).toBe('COM-003');
    expect((await send('POST', '/items', { ...slab('260'), defaultYardId: yardIdOf.COIL })).body.error?.code).toBe('COM-004');
  });

  it('원료 등록: 원료 코드 형식을 보고 기본 공급업체를 지정한다', async () => {
    const suppliers = (await get<SupplierView[]>('/suppliers')).body.data;
    const raw = { itemType: 'RAW_MATERIAL', itemCode: 'ore02', itemName: '철광석(분광)', rawMaterialType: 'IRON_ORE', defaultYardId: yardIdOf.RAW_MATERIAL };
    expect((await send('POST', '/items', { ...raw, itemCode: 'ORE2' })).body.error?.code).toBe('COM-004');
    expect((await send('POST', '/items', { ...raw, defaultSupplierId: 999_999 })).body.error?.code).toBe('COM-003');
    const { body } = await send<ItemView>('POST', '/items', { ...raw, defaultSupplierId: suppliers[0].id });
    expect(body.data).toMatchObject({ itemCode: 'ORE02', unitType: 'TON', rawMaterialType: 'IRON_ORE', defaultSupplierId: suppliers[0].id, theoreticalWeightTon: null });
    const patched = await send<ItemView>('PATCH', `/items/${body.data.id}`, { itemName: '철광석 분광', defaultSupplierId: null });
    expect(patched.body.data).toMatchObject({ itemName: '철광석 분광', defaultSupplierId: null });
  });

  it('수주에 쓰인 규격의 치수·강종 수정은 MST-002, 기본 야드만 바꾸는 것은 된다', async () => {
    const id = await itemIdOf('SL-SS275-250x1200x10000');
    // 기본 시드에는 수주가 없어 영업 사원이 수주를 등록해 규격을 쓰인 상태로 만든다
    const customers = (await get<{ id: number }[]>('/customers')).body.data;
    const salesCookie = await login('2103003');
    const ordered = await send('POST', '/sales-orders', { customerId: customers[0].id, items: [{ itemId: id, orderedQty: 1, dueDate: '2099-12-31' }] }, salesCookie);
    expect(ordered.status).toBe(201);

    const { status, body } = await send('PATCH', `/items/${id}`, { thicknessMm: '240' });
    expect(status).toBe(409);
    expect(body.error?.code).toBe('MST-002');
    expect((await send('PATCH', `/items/${id}`, { steelGradeId: gradeIdOf.SM355D })).body.error?.code).toBe('MST-002');
    expect((await send<ItemView>('PATCH', `/items/${id}`, { defaultYardId: yardIdOf.SLAB })).body.data.theoreticalWeightTon).toBe('23.550');
  });

  it('안 쓰인 규격은 치수를 고치면 코드·이론중량을 다시 만든다', async () => {
    const id = await itemIdOf('SL-SM355C-250x1200x10000');
    const { body } = await send<ItemView>('PATCH', `/items/${id}`, { thicknessMm: '200' });
    expect(body.data).toMatchObject({ itemCode: 'SL-SM355C-200x1200x10000', theoreticalWeightTon: '18.840' });
  });

  it('없는 품목 수정은 COM-003', async () => {
    expect((await send('PATCH', '/items/999999', { defaultYardId: yardIdOf.SLAB })).body.error?.code).toBe('COM-003');
  });

  it('규격 매핑: 코일이 슬래브보다 무거우면 거부, 맞으면 열연 계획 수율을 계산한다', async () => {
    const slabId = await itemIdOf('SL-SM355C-200x1200x10000');
    const heavy = (await send<ItemView>('POST', '/items', coil('2.5'))).body.data;
    expect(heavy.theoreticalWeightTon).toBe('23.079');
    expect((await send('POST', '/spec-mappings', { slabItemId: slabId, coilItemId: heavy.id })).body.error?.code).toBe('COM-004');

    const light = (await send<ItemView>('POST', '/items', coil('2'))).body.data;
    const { status, body } = await send<SpecMappingView>('POST', '/spec-mappings', { slabItemId: slabId, coilItemId: light.id });
    expect(status).toBe(201);
    expect(body.data).toMatchObject({ steelGradeCode: 'SM355C', coilItem: { theoreticalWeightTon: '18.463' }, hotRollingYieldRate: '0.9800' });

    expect((await send('POST', '/spec-mappings', { slabItemId: slabId, coilItemId: heavy.id })).body.error?.code).toBe('COM-004');
    // 매핑된 슬래브를 코일보다 가볍게 고치면 매핑 조건 위반
    expect((await send('PATCH', `/items/${slabId}`, { thicknessMm: '150' })).body.error?.code).toBe('COM-004');
  });

  it('규격 매핑: 강종이 다르면 COM-004, 없는 규격이면 COM-003', async () => {
    const slabId = await itemIdOf('SL-SS275-250x1200x10000');
    const coilId = await itemIdOf('CL-SM355A-2.5x1200x980000');
    expect((await send('POST', '/spec-mappings', { slabItemId: slabId, coilItemId: coilId })).body.error?.code).toBe('COM-004');
    expect((await send('POST', '/spec-mappings', { slabItemId: 999_999, coilItemId: coilId })).body.error?.code).toBe('COM-003');
  });

  it('강종 등록: 코드 중복은 COM-004, 적용 규격 번호는 필수', async () => {
    const payload = { steelGradeCode: 'tst-01', steelGradeName: '시험 강종', standardNo: 'KS D 0000' };
    expect((await send<SteelGradeView>('POST', '/steel-grades', payload)).body.data).toMatchObject({ steelGradeCode: 'TST-01', standardNo: 'KS D 0000' });
    expect((await send('POST', '/steel-grades', payload)).body.error?.code).toBe('COM-004');
    expect((await send('POST', '/steel-grades', { ...payload, steelGradeCode: 'TST-02', standardNo: ' ' })).body.error?.code).toBe('COM-004');
  });
});

describe('라우팅·배합 원단위·생산 설정값 등록·수정 (API-173·174·176·177·188)', () => {
  const routingOf = async (itemType: string, processType: string) => {
    const routing = (await get<RoutingView[]>('/routings')).body.data.find((r) => r.itemType === itemType && r.processType === processType);
    if (!routing) throw new Error(`라우팅 없음: ${itemType} ${processType}`);
    return routing;
  };
  const itemIdOf = async (itemCode: string) => (await get<ItemView[]>('/items')).body.data.find((i) => i.itemCode === itemCode)?.id ?? 0;

  it('라우팅 등록: 같은 공정·열연 슬래브·수율 범위는 거부, 맞으면 등록', async () => {
    expect((await send('POST', '/routings', { itemType: 'COIL', processType: 'STEELMAKING', sequenceNo: 9, plannedYieldRate: '0.9' })).body.error?.code).toBe('COM-004');
    expect((await send('POST', '/routings', { itemType: 'SLAB', processType: 'HOT_ROLLING', sequenceNo: 4 })).body.error?.code).toBe('COM-004');

    // 시드 라우팅은 공정이 다 차 있어 연주 행을 지우고 다시 등록한다 (삭제 API는 없다)
    const casting = await routingOf('SLAB', 'CONTINUOUS_CASTING');
    await app.get(PrismaService).routing.delete({ where: { id: casting.id } });
    const payload = { itemType: 'SLAB', processType: 'CONTINUOUS_CASTING', sequenceNo: 3 };
    expect((await send('POST', '/routings', payload)).body.error?.code).toBe('COM-004');
    expect((await send('POST', '/routings', { ...payload, plannedYieldRate: '1.0001' })).body.error?.code).toBe('COM-004');
    expect((await send('POST', '/routings', { ...payload, sequenceNo: 2, plannedYieldRate: '0.98' })).body.error?.code).toBe('COM-004');
    const { status, body } = await send<RoutingView>('POST', '/routings', { ...payload, plannedYieldRate: '0.98' });
    expect(status).toBe(201);
    expect(body.data).toMatchObject({ itemType: 'SLAB', processType: 'CONTINUOUS_CASTING', sequenceNo: 3, plannedYieldRate: '0.9800' });
  });

  it('라우팅 수정: 수율은 0 초과 1 이하, 열연·제선은 수율 없음, 순서 중복 거부', async () => {
    const steelmaking = await routingOf('SLAB', 'STEELMAKING');
    expect((await send('PATCH', `/routings/${steelmaking.id}`, { plannedYieldRate: '0' })).body.error?.code).toBe('COM-004');
    expect((await send('PATCH', `/routings/${steelmaking.id}`, { sequenceNo: 3 })).body.error?.code).toBe('COM-004');
    expect((await send<RoutingView>('PATCH', `/routings/${steelmaking.id}`, { plannedYieldRate: '0.92' })).body.data.plannedYieldRate).toBe('0.9200');
    const ironmaking = await routingOf('SLAB', 'IRONMAKING');
    expect((await send('PATCH', `/routings/${ironmaking.id}`, { plannedYieldRate: '0.9' })).body.error?.code).toBe('COM-004');
    expect((await send('PATCH', '/routings/999999', { sequenceNo: 9 })).body.error?.code).toBe('COM-003');
  });

  it('배합 원단위 등록: 강종은 합금철에만, 원료·강종당 1행', async () => {
    const ore = await itemIdOf('ORE01');
    const smn = await itemIdOf('SMN01');
    const grades = (await get<SteelGradeView[]>('/steel-grades')).body.data;
    const sm355c = grades.find((g) => g.steelGradeCode === 'SM355C')?.id;
    expect((await send('POST', '/specific-consumptions', { rawMaterialItemId: ore, consumptionRate: '1.5' })).body.error?.code).toBe('COM-004');
    expect((await send('POST', '/specific-consumptions', { rawMaterialItemId: ore, steelGradeId: sm355c, consumptionRate: '1.5' })).body.error?.code).toBe('COM-004');
    expect((await send('POST', '/specific-consumptions', { rawMaterialItemId: smn, consumptionRate: '15' })).body.error?.code).toBe('COM-004');
    expect((await send('POST', '/specific-consumptions', { rawMaterialItemId: smn, steelGradeId: sm355c, consumptionRate: '0' })).body.error?.code).toBe('COM-004');
    expect((await send('POST', '/specific-consumptions', { rawMaterialItemId: await itemIdOf('SL-SS275-250x1200x10000'), consumptionRate: '1' })).body.error?.code).toBe('COM-004');
    const { status, body } = await send<SpecificConsumptionView>('POST', '/specific-consumptions', { rawMaterialItemId: smn, steelGradeId: sm355c, consumptionRate: '15' });
    expect(status).toBe(201);
    expect(body.data).toMatchObject({ rawMaterialItemCode: 'SMN01', steelGradeCode: 'SM355C', consumptionRate: '15.0000' });

    expect((await send<SpecificConsumptionView>('PATCH', `/specific-consumptions/${body.data.id}`, { consumptionRate: '12.5' })).body.data.consumptionRate).toBe('12.5000');
    expect((await send('PATCH', '/specific-consumptions/999999', { consumptionRate: '1' })).body.error?.code).toBe('COM-003');
  });

  it('생산 설정값 변경: 히트 용량은 0보다 커야 한다', async () => {
    expect((await send('PATCH', '/production-settings', { heatCapacityTon: '0' })).body.error?.code).toBe('COM-004');
    expect((await send('PATCH', '/production-settings', { deliveryRiskDays: -1 })).body.error?.code).toBe('COM-004');
    const { body } = await send<ProductionSettingView>('PATCH', '/production-settings', { heatCapacityTon: '260.5', deliveryRiskDays: 5 });
    expect(body.data).toMatchObject({ heatCapacityTon: '260.500', deliveryRiskDays: 5 });
    await send('PATCH', '/production-settings', { heatCapacityTon: '250', deliveryRiskDays: 3 });
  });
});

describe('고객사·공급업체·야드 등록·수정 (API-179·180·182·183·185·186)', () => {
  it('고객사: 코드는 대문자로, 중복은 COM-004, 수정은 이름만', async () => {
    const { status, body } = await send<{ id: number; customerCode: string; customerName: string }>('POST', '/customers', { customerCode: 'cus-05', customerName: '새고객' });
    expect(status).toBe(201);
    expect(body.data).toMatchObject({ customerCode: 'CUS-05', customerName: '새고객' });
    expect((await send('POST', '/customers', { customerCode: 'CUS-05', customerName: '다른 고객' })).body.error?.code).toBe('COM-004');
    expect((await send('POST', '/customers', { customerCode: '고객', customerName: '다른 고객' })).body.error?.code).toBe('COM-004');
    expect((await send('PATCH', `/customers/${body.data.id}`, { customerName: '새고객(주)' })).body.data).toMatchObject({ customerCode: 'CUS-05', customerName: '새고객(주)' });
    expect((await send('PATCH', `/customers/${body.data.id}`, { customerCode: 'CUS-06', customerName: '새고객' })).body.error?.code).toBe('COM-004');
    expect((await send('PATCH', '/customers/999999', { customerName: '없음' })).body.error?.code).toBe('COM-003');
    expect((await send('POST', '/customers', { customerCode: 'CUS-07', customerName: '권한 없음' }, productionCookie)).body.error?.code).toBe('COM-002');
  });

  it('공급업체: 등록·이름 수정, 중복 코드 거부', async () => {
    const { body } = await send<SupplierView>('POST', '/suppliers', { supplierCode: 'SUP-05', supplierName: '새공급' });
    expect(body.data).toMatchObject({ supplierCode: 'SUP-05', supplierName: '새공급' });
    expect((await send('POST', '/suppliers', { supplierCode: 'SUP-01', supplierName: '중복' })).body.error?.code).toBe('COM-004');
    expect((await send<SupplierView>('PATCH', `/suppliers/${body.data.id}`, { supplierName: '새공급(주)' })).body.data.supplierName).toBe('새공급(주)');
    expect((await send('PATCH', '/suppliers/999999', { supplierName: '없음' })).body.error?.code).toBe('COM-003');
  });

  it('야드: 야드 유형은 YARD_TYPE, 수정은 이름만', async () => {
    expect((await send('POST', '/yards', { yardCode: 'YD-CL-02', yardName: '코일 2야드', yardType: 'SCRAP' })).body.error?.code).toBe('COM-004');
    const { body } = await send<YardView>('POST', '/yards', { yardCode: 'YD-CL-02', yardName: '코일 2야드', yardType: 'COIL' });
    expect(body.data).toMatchObject({ yardCode: 'YD-CL-02', yardType: 'COIL' });
    expect((await send('POST', '/yards', { yardCode: 'YD-CL-02', yardName: '중복', yardType: 'COIL' })).body.error?.code).toBe('COM-004');
    expect((await send<YardView>('PATCH', `/yards/${body.data.id}`, { yardName: '코일 2야드(동)' })).body.data).toMatchObject({ yardName: '코일 2야드(동)', yardType: 'COIL' });
    expect((await send('PATCH', `/yards/${body.data.id}`, { yardName: '코일', yardType: 'SLAB' })).body.error?.code).toBe('COM-004');
    expect((await send('PATCH', '/yards/999999', { yardName: '없음' })).body.error?.code).toBe('COM-003');
  });
});

describe('기준정보 삭제 ([05] 7-2: 쓰는 곳이 없을 때만)', () => {
  const del = <T>(path: string, cookie = adminCookie) => send<T>('DELETE', path, undefined, cookie);

  it('쓰는 곳이 없으면 지우고 지운 행을 돌려준다. 다시 지우면 COM-003, 조회 권한뿐이면 COM-002', async () => {
    const customer = (await send<CustomerView>('POST', '/customers', { customerCode: 'CUS-DEL', customerName: '삭제 고객' })).body.data;
    expect((await del(`/customers/${customer.id}`, productionCookie)).body.error?.code).toBe('COM-002');
    const deleted = await del<CustomerView>(`/customers/${customer.id}`);
    expect([deleted.status, deleted.body.data]).toEqual([200, customer]);
    expect((await del(`/customers/${customer.id}`)).body.error?.code).toBe('COM-003');

    const supplier = (await send<SupplierView>('POST', '/suppliers', { supplierCode: 'SUP-DEL', supplierName: '삭제 공급' })).body.data;
    expect((await del<SupplierView>(`/suppliers/${supplier.id}`)).body.data).toEqual(supplier);
    expect((await get<SupplierView[]>('/suppliers')).body.data.some((s) => s.id === supplier.id)).toBe(false);
  });

  it('강종·야드는 품목이 쓰는 동안 지울 수 없고, 품목(수량 0인 재고 행 포함)을 지우면 지울 수 있다', async () => {
    const grade = (await send<SteelGradeView>('POST', '/steel-grades', { steelGradeCode: 'DEL-01', steelGradeName: '삭제 강종', standardNo: 'KS D 0001' })).body.data;
    const yard = (await send<YardView>('POST', '/yards', { yardCode: 'YD-DEL', yardName: '삭제 야드', yardType: 'SLAB' })).body.data;
    const item = (await send<ItemView>('POST', '/items', { itemType: 'SLAB', steelGradeId: grade.id, thicknessMm: '200', widthMm: '1000', lengthMm: '8000', defaultYardId: yard.id })).body.data;
    expect((await del(`/steel-grades/${grade.id}`)).body.error).toMatchObject({ code: 'COM-004', message: '쓰는 곳이 있어 삭제할 수 없어요: 품목' });
    expect((await del(`/yards/${yard.id}`)).body.error).toMatchObject({ code: 'COM-004', message: '쓰는 곳이 있어 삭제할 수 없어요: 품목 기본 야드' });

    // 재고 행은 inventory 모듈이 필요할 때 만든다. 수량이 0이면 쓰는 곳으로 보지 않고 품목과 함께 지운다
    const prisma = app.get(PrismaService);
    await prisma.inventory.create({ data: { itemId: item.id } });
    expect((await del<ItemView>(`/items/${item.id}`)).body.data).toMatchObject({ id: item.id, itemCode: item.itemCode });
    expect(await prisma.inventory.count({ where: { itemId: item.id } })).toBe(0);
    expect((await del<SteelGradeView>(`/steel-grades/${grade.id}`)).body.data).toEqual(grade);
    expect((await del<YardView>(`/yards/${yard.id}`)).body.data).toEqual(yard);
  });

  it('쓰는 곳이 있으면 COM-004와 쓰는 곳 이름 (시드 기준정보, 수주가 있는 고객사)', async () => {
    const items = (await get<ItemView[]>('/items')).body.data;
    const idOf = (itemCode: string) => items.find((i) => i.itemCode === itemCode)?.id;
    const grade = (await get<SteelGradeView[]>('/steel-grades')).body.data.find((g) => g.steelGradeCode === 'SS275');
    const supplier = (await get<SupplierView[]>('/suppliers')).body.data.find((s) => s.supplierCode === 'SUP-01');
    const reasonOf = async (path: string) => (await del(path)).body.error?.message;
    // 시드에는 이 규격의 시연 수주·계획도 있다
    expect(await reasonOf(`/items/${idOf('SL-SS275-250x1200x10000')}`)).toMatch(/^쓰는 곳이 있어 삭제할 수 없어요: 규격 매핑·수주/);
    expect(await reasonOf(`/items/${idOf('ORE01')}`)).toBe('쓰는 곳이 있어 삭제할 수 없어요: 배합 원단위');
    expect(await reasonOf(`/steel-grades/${grade?.id}`)).toBe('쓰는 곳이 있어 삭제할 수 없어요: 품목·배합 원단위·검사 기준');
    expect(await reasonOf(`/suppliers/${supplier?.id}`)).toBe('쓰는 곳이 있어 삭제할 수 없어요: 원료 기본 공급업체');

    const prisma = app.get(PrismaService);
    const customer = await prisma.customer.create({ data: { customerCode: 'CUS-USED', customerName: '수주 고객' } });
    const owner = await prisma.employee.findUniqueOrThrow({ where: { employeeNo: '2103003' } });
    await prisma.salesOrder.create({ data: { salesOrderNo: 'T-SO-DEL-1', customerId: customer.id, ownerEmployeeId: owner.id } });
    expect(await reasonOf(`/customers/${customer.id}`)).toBe('쓰는 곳이 있어 삭제할 수 없어요: 수주');
  });
});

describe('강종 수정·규격 매핑 수정·삭제 (API-280·281·282, 이슈 #477)', () => {
  const patch = <T>(path: string, payload: unknown, cookie = adminCookie) => send<T>('PATCH', path, payload, cookie);
  const del = <T>(path: string, cookie = adminCookie) => send<T>('DELETE', path, undefined, cookie);

  it('강종 수정: 이름·적용 규격 번호는 언제든, 코드는 쓰는 곳이 없을 때만 바꾼다', async () => {
    const created = (await send<SteelGradeView>('POST', '/steel-grades', { steelGradeCode: 'UPD-01', steelGradeName: '수정 전', standardNo: 'KS D 0010' })).body.data;
    const body = { steelGradeCode: 'UPD-01', steelGradeName: '수정 후', standardNo: 'KS D 0011', expectedUpdatedAt: created.updatedAt };
    expect((await patch('/steel-grades/' + created.id, body, productionCookie)).body.error?.code).toBe('COM-002');
    const updated = await patch<SteelGradeView>(`/steel-grades/${created.id}`, body);
    expect(updated.status).toBe(200);
    expect(updated.body.data).toMatchObject({ id: created.id, steelGradeCode: 'UPD-01', steelGradeName: '수정 후', standardNo: 'KS D 0011' });
    expect(updated.body.data.updatedAt).not.toBe(created.updatedAt);

    // 불러온 뒤 다른 곳에서 고쳤으면 COM-001
    expect((await patch(`/steel-grades/${created.id}`, { ...body, steelGradeName: '늦은 수정' })).body.error?.code).toBe('COM-001');
    // 쓰는 곳이 없으면 코드도 바꾼다. 다른 강종의 코드로는 못 바꾼다
    expect((await patch(`/steel-grades/${created.id}`, { ...body, steelGradeCode: 'SS275', expectedUpdatedAt: updated.body.data.updatedAt })).body.error?.code).toBe('COM-004');
    const renamed = await patch<SteelGradeView>(`/steel-grades/${created.id}`, { ...body, steelGradeCode: 'upd-02', expectedUpdatedAt: updated.body.data.updatedAt });
    expect(renamed.body.data.steelGradeCode).toBe('UPD-02');
    expect((await patch('/steel-grades/999999', body)).body.error?.code).toBe('COM-003');

    // 품목이 쓰기 시작하면 이름·적용 규격 번호만 고칠 수 있다
    const yard = (await get<YardView[]>('/yards')).body.data.find((y) => y.yardType === 'SLAB');
    await send('POST', '/items', { itemType: 'SLAB', steelGradeId: created.id, thicknessMm: '200', widthMm: '1000', lengthMm: '8000', defaultYardId: yard?.id });
    const locked = await patch(`/steel-grades/${created.id}`, { ...body, steelGradeCode: 'UPD-03', expectedUpdatedAt: undefined });
    expect(locked.body.error).toMatchObject({ code: 'COM-004', message: expect.stringContaining('쓰는 곳이 있어 강종 코드는 바꿀 수 없어요: 품목') });
    const nameOnly = await patch<SteelGradeView>(`/steel-grades/${created.id}`, { steelGradeCode: 'UPD-02', steelGradeName: '품목 있는 강종', standardNo: 'KS D 0012' });
    expect(nameOnly.body.data).toMatchObject({ steelGradeCode: 'UPD-02', steelGradeName: '품목 있는 강종', codeLockedBy: ['품목'] });
    // 목록도 같은 기준으로 코드를 잠글 이유를 내려 준다 (화면이 이 값으로 코드 칸을 잠근다)
    const listed = (await get<SteelGradeView[]>('/steel-grades')).body.data;
    expect(listed.find((g) => g.id === created.id)?.codeLockedBy).toEqual(['품목']);
    expect(listed.find((g) => g.steelGradeCode === 'SS275')?.codeLockedBy).toEqual(expect.arrayContaining(['품목', '검사 기준']));
    expect(updated.body.data.codeLockedBy).toEqual([]);
  });

  it('규격 매핑 수정·삭제: 짝을 다시 검사하고, 쓰는 곳이 있으면 막는다', async () => {
    const grade = (await send<SteelGradeView>('POST', '/steel-grades', { steelGradeCode: 'MAP-01', steelGradeName: '매핑 시험', standardNo: 'KS D 0020' })).body.data;
    const yards = (await get<YardView[]>('/yards')).body.data;
    const yardOf = (type: string) => yards.find((y) => y.yardType === type)?.id;
    const spec = async (itemType: 'SLAB' | 'COIL', thicknessMm: string, lengthMm: string) =>
      (await send<ItemView>('POST', '/items', { itemType, steelGradeId: grade.id, thicknessMm, widthMm: '1200', lengthMm, defaultYardId: yardOf(itemType) })).body.data;
    const slabA = await spec('SLAB', '200', '10000');
    const slabB = await spec('SLAB', '220', '10000');
    const coilA = await spec('COIL', '2', '980000');
    const coilB = await spec('COIL', '1.5', '980000');
    const coilHeavy = await spec('COIL', '2.5', '980000');

    const mapA = (await send<SpecMappingView>('POST', '/spec-mappings', { slabItemId: slabA.id, coilItemId: coilA.id })).body.data;
    const mapB = (await send<SpecMappingView>('POST', '/spec-mappings', { slabItemId: slabB.id, coilItemId: coilB.id })).body.data;
    expect(mapA.updatedAt).toEqual(expect.any(String));

    // 수정: 짝의 코일을 바꾸면 열연 계획 수율이 다시 계산된다. 권한은 기준정보 관리 사용
    const change = { slabItemId: slabA.id, coilItemId: coilA.id, expectedUpdatedAt: mapA.updatedAt };
    expect((await patch(`/spec-mappings/${mapA.id}`, change, productionCookie)).body.error?.code).toBe('COM-002');
    // 자기 자신의 짝을 그대로 보내도 중복이 아니다 (저장만 다시)
    const same = await patch<SpecMappingView>(`/spec-mappings/${mapA.id}`, change);
    expect(same.body.data).toMatchObject({ id: mapA.id, hotRollingYieldRate: '0.9800' });
    expect((await patch(`/spec-mappings/${mapA.id}`, { ...change, coilItemId: coilB.id, expectedUpdatedAt: same.body.data.updatedAt })).body.error?.code).toBe('COM-004'); // 다른 매핑이 쓰는 코일
    expect((await patch(`/spec-mappings/${mapA.id}`, { ...change, coilItemId: coilHeavy.id, expectedUpdatedAt: same.body.data.updatedAt })).body.error?.code).toBe('COM-004'); // 코일이 더 무거움
    // 불러온 뒤 다른 곳에서 고쳤으면 COM-001
    expect((await patch(`/spec-mappings/${mapA.id}`, change)).body.error?.code).toBe('COM-001');
    expect((await patch('/spec-mappings/999999', change)).body.error?.code).toBe('COM-003');

    // 코일 B를 풀어 주면(매핑 B 삭제) 매핑 A가 코일 B로 옮겨 간다
    expect((await del(`/spec-mappings/${mapB.id}`, productionCookie)).body.error?.code).toBe('COM-002');
    expect((await del<SpecMappingView>(`/spec-mappings/${mapB.id}`)).body.data).toMatchObject({ id: mapB.id, slabItem: { id: slabB.id }, coilItem: { id: coilB.id } });
    expect((await del(`/spec-mappings/${mapB.id}`)).body.error?.code).toBe('COM-003');
    const moved = await patch<SpecMappingView>(`/spec-mappings/${mapA.id}`, { slabItemId: slabA.id, coilItemId: coilB.id, expectedUpdatedAt: same.body.data.updatedAt });
    expect(moved.body.data).toMatchObject({ coilItem: { id: coilB.id }, hotRollingYieldRate: '0.7350' });

    // 슬래브 규격에 수주가 있으면 바꾸지도 지우지도 못한다
    const prisma = app.get(PrismaService);
    const customer = await prisma.customer.create({ data: { customerCode: 'CUS-MAP', customerName: '매핑 시험 고객' } });
    const owner = await prisma.employee.findUniqueOrThrow({ where: { employeeNo: '2103003' } });
    await prisma.salesOrder.create({
      data: { salesOrderNo: 'T-SO-MAP-1', customerId: customer.id, ownerEmployeeId: owner.id, salesOrderItems: { create: [{ itemId: slabA.id, orderedQty: 1, dueDate: new Date('2026-12-31T00:00:00Z') }] } },
    });
    const usedChange = { slabItemId: slabA.id, coilItemId: coilA.id, expectedUpdatedAt: moved.body.data.updatedAt };
    expect((await patch(`/spec-mappings/${mapA.id}`, usedChange)).body.error).toMatchObject({ code: 'COM-004', message: '쓰는 곳이 있어 매핑을 바꿀 수 없어요: 수주' });
    expect((await del(`/spec-mappings/${mapA.id}`)).body.error).toMatchObject({ code: 'COM-004', message: '쓰는 곳이 있어 매핑을 지울 수 없어요: 수주' });
    expect((await get<SpecMappingView[]>('/spec-mappings')).body.data.some((m) => m.id === mapA.id)).toBe(true);
  });
});

describe('불러온 시각으로 동시 수정 막기 (고객사·공급업체·야드·품목·라우팅·생산 설정값, 이슈 #498)', () => {
  const patch = <T>(path: string, payload: unknown) => send<T>('PATCH', path, payload);
  /** 불러온 시각이 틀리면 COM-001로 막히고 값은 그대로, 맞으면 저장되고 updatedAt이 바뀐다. 시각을 보내지 않으면 기존대로 저장된다 */
  async function expectGuarded<T extends { updatedAt: string }>(path: string, created: T, change: (expectedUpdatedAt?: string) => unknown, read: () => Promise<T>) {
    expect(created.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const stale = new Date(new Date(created.updatedAt).getTime() - 1000).toISOString();
    expect((await patch(path, change(stale))).body.error?.code).toBe('COM-001');
    expect((await read()).updatedAt).toBe(created.updatedAt);

    const saved = await patch<T>(path, change(created.updatedAt));
    expect(saved.status).toBe(200);
    expect(saved.body.data.updatedAt).not.toBe(created.updatedAt);
    expect((await read()).updatedAt).toBe(saved.body.data.updatedAt);

    // 이미 바뀐 시각으로 다시 보내면 막힌다 (다른 곳에서 먼저 저장한 경우)
    expect((await patch(path, change(created.updatedAt))).body.error?.code).toBe('COM-001');
    // 시각을 보내지 않으면 비교하지 않는다
    expect((await patch<T>(path, change())).status).toBe(200);
    expect((await patch(path, change('시각 아님'))).body.error?.code).toBe('COM-004');
  }

  it('고객사·공급업체·야드', async () => {
    const customer = (await send<CustomerView>('POST', '/customers', { customerCode: 'CUS-X1', customerName: '동시 고객' })).body.data;
    let n = 0;
    await expectGuarded(`/customers/${customer.id}`, customer, (expectedUpdatedAt) => ({ customerName: `동시 고객 ${(n += 1)}`, expectedUpdatedAt }), async () => {
      const found = (await get<CustomerView[]>('/customers')).body.data.find((c) => c.id === customer.id);
      if (!found) throw new Error('고객사 없음');
      return found;
    });

    const supplier = (await send<SupplierView>('POST', '/suppliers', { supplierCode: 'SUP-X1', supplierName: '동시 공급' })).body.data;
    await expectGuarded(`/suppliers/${supplier.id}`, supplier, (expectedUpdatedAt) => ({ supplierName: `동시 공급 ${(n += 1)}`, expectedUpdatedAt }), async () => {
      const found = (await get<SupplierView[]>('/suppliers')).body.data.find((s) => s.id === supplier.id);
      if (!found) throw new Error('공급업체 없음');
      return found;
    });

    const yard = (await send<YardView>('POST', '/yards', { yardCode: 'YD-CL-X1', yardName: '동시 야드', yardType: 'COIL' })).body.data;
    await expectGuarded(`/yards/${yard.id}`, yard, (expectedUpdatedAt) => ({ yardName: `동시 야드 ${(n += 1)}`, expectedUpdatedAt }), async () => {
      const found = (await get<YardView[]>('/yards')).body.data.find((y) => y.id === yard.id);
      if (!found) throw new Error('야드 없음');
      return found;
    });
  });

  it('품목: 원료 수정, 규격은 기본 야드를 바꾸는 갈래와 치수를 고치는 갈래 모두', async () => {
    const yards = (await get<YardView[]>('/yards')).body.data;
    const rawYard = yards.find((y) => y.yardType === 'RAW_MATERIAL');
    const slabYard = yards.find((y) => y.yardType === 'SLAB');
    const grade = (await get<SteelGradeView[]>('/steel-grades')).body.data.find((g) => g.steelGradeCode === 'SM355C');
    if (!rawYard || !slabYard || !grade) throw new Error('시드 기준정보 없음');
    const readItem = (id: number) => async () => {
      const found = (await get<ItemView[]>('/items')).body.data.find((i) => i.id === id);
      if (!found) throw new Error('품목 없음');
      return found;
    };

    const raw = (await send<ItemView>('POST', '/items', { itemType: 'RAW_MATERIAL', itemCode: 'XCC01', itemName: '동시 원료', rawMaterialType: 'COAL', defaultYardId: rawYard.id })).body.data;
    let n = 0;
    await expectGuarded(`/items/${raw.id}`, raw, (expectedUpdatedAt) => ({ itemName: `동시 원료 ${(n += 1)}`, expectedUpdatedAt }), readItem(raw.id));

    const spec = (await send<ItemView>('POST', '/items', { itemType: 'SLAB', steelGradeId: grade.id, thicknessMm: '251', widthMm: '1201', lengthMm: '10001', defaultYardId: slabYard.id })).body.data;
    // 치수를 고치는 갈래(안 쓰인 규격)
    await expectGuarded(`/items/${spec.id}`, spec, (expectedUpdatedAt) => ({ thicknessMm: `${252 + (n += 1)}`, expectedUpdatedAt }), readItem(spec.id));
    // 기본 야드만 바꾸는 갈래(치수는 그대로)
    const current = await readItem(spec.id)();
    const stale = new Date(new Date(current.updatedAt).getTime() - 1000).toISOString();
    expect((await patch(`/items/${spec.id}`, { defaultYardId: slabYard.id, expectedUpdatedAt: stale })).body.error?.code).toBe('COM-001');
    expect((await patch(`/items/${spec.id}`, { defaultYardId: slabYard.id, expectedUpdatedAt: current.updatedAt })).status).toBe(200);
  });

  it('라우팅·생산 설정값', async () => {
    const routing = (await get<RoutingView[]>('/routings')).body.data.find((r) => r.itemType === 'COIL' && r.processType === 'STEELMAKING');
    if (!routing) throw new Error('라우팅 없음');
    expect(routing.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    let n = 0;
    await expectGuarded(`/routings/${routing.id}`, routing, (expectedUpdatedAt) => ({ plannedYieldRate: `0.9${(n += 1)}`, expectedUpdatedAt }), async () => {
      const found = (await get<RoutingView[]>('/routings')).body.data.find((r) => r.id === routing.id);
      if (!found) throw new Error('라우팅 없음');
      return found;
    });

    const setting = (await get<ProductionSettingView>('/production-settings')).body.data;
    await expectGuarded('/production-settings', setting, (expectedUpdatedAt) => ({ deliveryRiskDays: 3 + (n += 1), expectedUpdatedAt }), async () => (await get<ProductionSettingView>('/production-settings')).body.data);
    await patch('/production-settings', { heatCapacityTon: '250', deliveryRiskDays: 3 });
  });
});
