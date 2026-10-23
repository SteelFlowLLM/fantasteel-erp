// 대시보드 출하 실적·공정별 수율·여재 보유 위젯(GET dashboard/widgets/shipment-result·process-yield·surplus-age)을 실제 앱과 DB(fs_sales)로 확인한다.
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import type { ProcessYieldWidget, ShipmentResultWidget, SurplusAgeWidget } from '@fantasteel/shared';
import { AppModule } from '../../app.module';
import { AuthUserService } from '../../common/auth/auth-user.service';
import { seoulToday } from '../../common/time/seoul-date';
import { PrismaService } from '../../prisma/prisma.service';
import { ProductionSimulationService } from '../production/production-simulation.service';
import { SalesOrderService } from '../sales-order/sales-order.service';
import { DashboardRepository } from './dashboard.repository';

let app: INestApplication;
let baseUrl: string;

async function login(employeeNo: string): Promise<string> {
  const res = await fetch(`${baseUrl}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ employeeNo, password: process.env.SEED_PASSWORD! }) });
  return (res.headers.get('set-cookie') ?? '').split(';')[0];
}

async function get<T>(path: string, cookie: string) {
  const res = await fetch(`${baseUrl}${path}`, { headers: { cookie } });
  return { status: res.status, body: (await res.json()) as { data: T; error?: { code: string } } };
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(0);
  baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1`;
}, 60_000);

afterAll(async () => {
  await app?.close();
});

/** 관리자가 부서·권한 화면에서 역할 권한을 뺀 상태를 만든다(업무 조회는 기본으로 모든 역할, 역할별 메뉴 v2 3장). 돌려놓는 함수를 돌려준다 */
async function revokeRolePermission(roleCode: string, permission: string): Promise<() => Promise<void>> {
  const prisma = app.get(PrismaService);
  const role = await prisma.role.findUniqueOrThrow({ where: { roleCode } });
  const row = await prisma.rolePermission.findUniqueOrThrow({ where: { roleId_permission: { roleId: role.id, permission } } });
  await prisma.rolePermission.delete({ where: { id: row.id } });
  return async () => {
    await prisma.rolePermission.create({ data: { roleId: role.id, permission, permissionLevel: row.permissionLevel } });
  };
}

describe('GET dashboard/widgets/shipment-result', () => {
  it('출고 확정 권한이 있으면 오늘 포함 최근 30일을 하루 단위로 준다', async () => {
    const { status, body } = await get<ShipmentResultWidget>('/dashboard/widgets/shipment-result', await login('1610014'));
    expect(status).toBe(200);
    expect(body.data).toMatchObject({ to: seoulToday(), days: 30 });
    expect(body.data.series).toHaveLength(30);
    expect(body.data.series[0].date).toBe(body.data.from);
    expect(body.data.series.at(-1)?.date).toBe(seoulToday());
    expect(body.data.totalTon).toMatch(/^\d+\.\d{3}$/);
  });

  it('출고 확정 조회 권한이 없으면 COM-002 (업무 조회는 모든 역할이라 생산도 보고, 관리자가 빼면 막힌다)', async () => {
    const production = await login('1709007');
    expect((await get('/dashboard/widgets/shipment-result', production)).status).toBe(200);
    const restore = await revokeRolePermission('PRODUCTION', 'GOODS_ISSUE_CONFIRM');
    try {
      expect((await get('/dashboard/widgets/shipment-result', production)).body.error?.code).toBe('COM-002');
    } finally {
      await restore();
    }
  });
});

describe('GET dashboard/widgets/process-yield', () => {
  it('작업 실적 조회 권한이 있으면 공정 4개를 주고, 완료 실적이 없으면 수율은 비어 있다', async () => {
    const { status, body } = await get<ProcessYieldWidget>('/dashboard/widgets/process-yield', await login('1401006'));
    expect(status).toBe(200);
    expect(body.data.processes.map((p) => p.processType)).toEqual(['IRONMAKING', 'STEELMAKING', 'CONTINUOUS_CASTING', 'HOT_ROLLING']);
    for (const p of body.data.processes) {
      expect(p.inputTon).toMatch(/^\d+\.\d{3}$/);
      if (p.resultCount === 0) expect(p).toMatchObject({ actualYieldRate: null, plannedYieldRate: null });
    }
    expect(body.data.processes[0]).toMatchObject({ actualYieldRate: null, plannedYieldRate: null });
  });

  it('작업 실적 조회 권한이 없으면 COM-002 (업무 조회는 모든 역할이라 물류도 보고, 관리자가 빼면 막힌다)', async () => {
    const logistics = await login('1610014');
    expect((await get('/dashboard/widgets/process-yield', logistics)).status).toBe(200);
    const restore = await revokeRolePermission('LOGISTICS', 'PRODUCTION_RESULT_CONFIRM');
    try {
      expect((await get('/dashboard/widgets/process-yield', logistics)).body.error?.code).toBe('COM-002');
    } finally {
      await restore();
    }
  });
});

describe('GET dashboard/widgets/surplus-age', () => {
  it('모든 사원이 읽고, 여재가 없으면 빈 목록과 0 t', async () => {
    const { status, body } = await get<SurplusAgeWidget>('/dashboard/widgets/surplus-age', await login('2304015'));
    expect(status).toBe(200);
    expect(body.data).toMatchObject({ today: seoulToday() });
    expect(body.data.totalQty).toBe(body.data.items.reduce((s, r) => s + r.surplusQty, 0));
    expect(body.data.totalTon).toMatch(/^\d+\.\d{3}$/);
    for (const row of body.data.items) expect(row.surplusQty).toBeGreaterThan(0);
  });
});

describe('공정 흐름 판정 대기 수 (검사 입력 대기 목록과 같은 조건)', () => {
  it('불합격 히트의 하위 슬래브·코일은 세지 않고, 판정 대기 히트의 하위 슬래브는 센다', async () => {
    const prisma = app.get(PrismaService);
    const repository = app.get(DashboardRepository);
    const before = await repository.countPendingInspectionLots(prisma);
    const standard = await prisma.inspectionStandard.findFirstOrThrow({ orderBy: { id: 'asc' } });
    const inspector = await prisma.employee.findUniqueOrThrow({ where: { employeeNo: '2205013' } });
    const slabItem = await prisma.item.findUniqueOrThrow({ where: { itemCode: 'SL-SS275-250x1200x10000' } });
    const coilItem = await prisma.item.findUniqueOrThrow({ where: { itemCode: 'CL-SS275-2.5x1200x980000' } });
    // 계획 없이 공정 실적만 만들어 LOT에 연결한다 (LOT 유형별 필수 칸, lot_type_columns_check)
    const resultOf = async (processType: string) =>
      (await prisma.productionResult.create({ data: { processType, converterCode: processType === 'STEELMAKING' ? 'BOF1' : null, startedAt: new Date(), completedAt: new Date() } })).id;
    const [steelmaking, casting, rolling] = [await resultOf('STEELMAKING'), await resultOf('CONTINUOUS_CASTING'), await resultOf('HOT_ROLLING')];
    const producedDate = new Date('2026-10-02T00:00:00.000Z');
    const heatOf = (lotNo: string) => prisma.lot.create({ data: { lotNo, lotType: 'HEAT', steelGradeId: slabItem.steelGradeId, productionResultId: steelmaking } });
    const slabOf = (lotNo: string) => prisma.lot.create({ data: { lotNo, lotType: 'SLAB', itemId: slabItem.id, productionResultId: casting, producedDate } });
    const coilOf = (lotNo: string) => prisma.lot.create({ data: { lotNo, lotType: 'COIL', itemId: coilItem.id, productionResultId: rolling, producedDate } });
    const link = (parentLotId: number, childLotId: number) => prisma.lotRelation.create({ data: { parentLotId, childLotId, lotRelationEvidence: 'ACTUAL_INPUT' } });

    const failedHeat = await heatOf('HT-DSH-FAIL');
    await prisma.qualityInspection.create({ data: { lotId: failedHeat.id, inspectionStandardId: standard.id, inspectionResult: 'FAIL', inspectorEmployeeId: inspector.id, inspectedAt: new Date() } });
    const failedSlab = await slabOf('HT-DSH-FAIL-01');
    await link(failedHeat.id, failedSlab.id);
    await link(failedSlab.id, (await coilOf('CDSH-FAIL-01')).id);
    const waitingHeat = await heatOf('HT-DSH-WAIT');
    await link(waitingHeat.id, (await slabOf('HT-DSH-WAIT-01')).id);

    expect(await repository.countPendingInspectionLots(prisma)).toEqual({ heat: before.heat + 1, slab: before.slab + 1, coil: before.coil });
  });
});

describe('여재 보유: 진행 중인 코일 수주용 슬래브 (inventory.md 8-1)', () => {
  it('코일 수주가 진행 중이면 그 계획이 만든 합격 슬래브는 여재가 아니고, 수주를 취소하면 여재가 된다', async () => {
    const prisma = app.get(PrismaService);
    const authUsers = app.get(AuthUserService);
    const userOf = async (employeeNo: string) => {
      const employee = await prisma.employee.findUniqueOrThrow({ where: { employeeNo } });
      const user = await authUsers.load(employee.id);
      if (!user) throw new Error(employeeNo);
      return user;
    };
    const sales = await userOf('2103003');
    const producer = await userOf('1401006');
    const quality = await userOf('2205013');

    // 원료 입고 (실적 시뮬레이션이 원료 LOT을 쓴다. production-simulation.service.spec.ts와 같은 방식)
    const supplier = await prisma.supplier.findFirstOrThrow({ orderBy: { id: 'asc' } });
    const date = new Date(`${seoulToday()}T00:00:00Z`);
    for (const [itemCode, ton] of [['ORE01', '3000'], ['COL01', '1100'], ['LIM01', '300'], ['SMN01', '40']] as const) {
      const item = await prisma.item.findUniqueOrThrow({ where: { itemCode } });
      const pr = await prisma.purchaseRequisition.create({ data: { purchaseRequisitionNo: `PR-DSH-${itemCode}`, itemId: item.id, requestedTon: ton, desiredReceiptDate: date, requesterId: producer.employeeId, purchaseRequisitionStatus: 'ORDERED' } });
      const po = await prisma.purchaseOrder.create({ data: { purchaseOrderNo: `PO-DSH-${itemCode}`, supplierId: supplier.id } });
      const poi = await prisma.purchaseOrderItem.create({ data: { purchaseOrderId: po.id, purchaseRequisitionId: pr.id, itemId: item.id, orderedTon: ton } });
      const gr = await prisma.goodsReceipt.create({ data: { goodsReceiptNo: `GR-DSH-${itemCode}`, purchaseOrderItemId: poi.id, receivedTon: ton, receivedDate: date } });
      await prisma.lot.create({ data: { lotNo: `RM-DSH-${itemCode}`, lotType: 'RAW_MATERIAL', itemId: item.id, goodsReceiptId: gr.id, yardId: item.defaultYardId, initialTon: ton, remainingTon: ton } });
    }

    // 코일 수주 → 슬래브까지 생산(열연 투입 전) → 히트·슬래브 합격
    const coil = await prisma.item.findUniqueOrThrow({ where: { itemCode: 'CL-SS275-2.5x1200x980000' } });
    const customerId = (await prisma.customer.findFirstOrThrow({ orderBy: { id: 'asc' } })).id;
    const order = await app.get(SalesOrderService).create(sales, { customerId, items: [{ itemId: coil.id, orderedQty: 2, dueDate: '2099-12-31' }] });
    const plan = await prisma.productionPlan.findUniqueOrThrow({ where: { productionPlanNo: order.items[0].productionPlanNo ?? '' } });
    await app.get(ProductionSimulationService).simulate(producer, plan.id, { randomSeed: 20261007 });
    const lots = await prisma.lot.findMany({ where: { productionResult: { productionPlanId: plan.id }, lotType: { in: ['HEAT', 'SLAB'] } } });
    const slabLots = lots.filter((l) => l.lotType === 'SLAB');
    expect(slabLots.length).toBeGreaterThan(0);
    const standard = await prisma.inspectionStandard.findFirstOrThrow({ orderBy: { id: 'asc' } });
    for (const lot of lots) {
      await prisma.qualityInspection.create({ data: { lotId: lot.id, inspectionStandardId: standard.id, inspectionResult: 'PASS', inspectorEmployeeId: quality.employeeId, inspectedAt: new Date() } });
    }
    const slabItemCode = 'SL-SS275-250x1200x10000';
    const surplusOf = async () => {
      const { body } = await get<SurplusAgeWidget>('/dashboard/widgets/surplus-age', await login('2205013'));
      return body.data.items.find((r) => r.itemCode === slabItemCode)?.surplusQty ?? 0;
    };

    expect(await surplusOf()).toBe(0);

    // 수주를 취소하면 계획의 수주 품목이 해제되어(null) 그 슬래브가 여재가 된다
    await app.get(SalesOrderService).cancel(sales, order.salesOrderId, { reason: '대시보드 여재 테스트' });
    expect(await surplusOf()).toBe(slabLots.length);
  }, 120_000);
});
