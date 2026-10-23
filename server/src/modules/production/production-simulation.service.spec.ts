// 실적 시뮬레이션을 실제 DB(fs_prod)로 확인한다 (REQ-PRD-007, 업무 프로세스 8장, 14.3 "연주 시드 손실").
import { Test, type TestingModule } from '@nestjs/testing';
import { type AuthUser } from '@fantasteel/shared';
import { AppModule } from '../../app.module';
import { AuthUserService } from '../../common/auth/auth-user.service';
import { AppException } from '../../common/errors/app.exception';
import { seoulToday } from '../../common/time/seoul-date';
import { PrismaService } from '../../prisma/prisma.service';
import { SalesOrderService } from '../sales-order/sales-order.service';
import { ProductionSimulationService } from './production-simulation.service';

let moduleRef: TestingModule;
let prisma: PrismaService;
let simulation: ProductionSimulationService;
let salesOrders: SalesOrderService;
let sales: AuthUser;
let producer: AuthUser;
let customerId: number;
let seq = 0;

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (e) {
    if (e instanceof AppException) return e.code;
    throw e;
  }
  throw new Error('오류가 나지 않았습니다');
}

async function receive(itemCode: string, ton: string) {
  seq += 1;
  const item = await prisma.item.findUniqueOrThrow({ where: { itemCode } });
  const supplier = await prisma.supplier.findFirstOrThrow({ orderBy: { id: 'asc' } });
  const date = new Date(`${seoulToday()}T00:00:00Z`);
  const pr = await prisma.purchaseRequisition.create({ data: { purchaseRequisitionNo: `PR-SIM-${seq}`, itemId: item.id, requestedTon: ton, desiredReceiptDate: date, requesterId: producer.employeeId, purchaseRequisitionStatus: 'ORDERED' } });
  const po = await prisma.purchaseOrder.create({ data: { purchaseOrderNo: `PO-SIM-${seq}`, supplierId: supplier.id } });
  const poi = await prisma.purchaseOrderItem.create({ data: { purchaseOrderId: po.id, purchaseRequisitionId: pr.id, itemId: item.id, orderedTon: ton } });
  const gr = await prisma.goodsReceipt.create({ data: { goodsReceiptNo: `GR-SIM-${seq}`, purchaseOrderItemId: poi.id, receivedTon: ton, receivedDate: date } });
  await prisma.lot.create({ data: { lotNo: `RM-SIM-${itemCode}-${seq}`, lotType: 'RAW_MATERIAL', itemId: item.id, goodsReceiptId: gr.id, yardId: item.defaultYardId, initialTon: ton, remainingTon: ton } });
}

async function planFor(itemCode: string, orderedQty: number) {
  const item = await prisma.item.findUniqueOrThrow({ where: { itemCode } });
  const order = await salesOrders.create(sales, { customerId, items: [{ itemId: item.id, orderedQty, dueDate: '2026-12-31' }] });
  return prisma.productionPlan.findUniqueOrThrow({ where: { productionPlanNo: order.items[0].productionPlanNo ?? '' } });
}

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  await moduleRef.init();
  prisma = moduleRef.get(PrismaService);
  simulation = moduleRef.get(ProductionSimulationService);
  salesOrders = moduleRef.get(SalesOrderService);
  const authUsers = moduleRef.get(AuthUserService);
  const load = async (employeeNo: string) => {
    const employee = await prisma.employee.findUniqueOrThrow({ where: { employeeNo } });
    const user = await authUsers.load(employee.id);
    if (!user) throw new Error(employeeNo);
    return user;
  };
  sales = await load('2103003');
  producer = await load('1401006');
  customerId = (await prisma.customer.findFirstOrThrow({ orderBy: { id: 'asc' } })).id;
  // 히트 6개 남짓: 철광석 444.445 · 석탄 166.667 · 석회석 41.667 t/히트, 합금철 SS275 2.5t·SM355 5t/히트
  for (const [code, ton] of [['ORE01', '3000'], ['COL01', '1100'], ['LIM01', '300'], ['SMN01', '40']] as const) await receive(code, ton);
}, 60_000);

afterAll(async () => {
  await moduleRef?.close();
});

describe('실적 시뮬레이션 (API-209)', () => {
  it('슬래브 11매(히트 2개): 제선·제강·연주를 한 번에, 연주에서만 0~5% 손실, 계획 완료', async () => {
    const plan = await planFor('SL-SS275-250x1200x10000', 11);
    const result = await simulation.simulate(producer, plan.id, { randomSeed: 12345 });
    expect(result.randomSeed).toBe(12345);
    expect(result.productionPlanStatus).toBe('COMPLETED');
    const castings = result.steps.filter((s) => s.processType === 'CONTINUOUS_CASTING');
    expect(castings).toHaveLength(2);
    expect(result.steps.filter((s) => s.processType === 'STEELMAKING')).toHaveLength(2);
    for (const c of castings) {
      expect(c.plannedQty).toBe(10);
      expect(Number(c.sampleLossRate)).toBeLessThanOrEqual(0.05);
      expect(c.lossQty).toBe(Math.floor((c.plannedQty ?? 0) * Number(c.sampleLossRate)));
      expect(c.outputQty).toBe((c.plannedQty ?? 0) - (c.lossQty ?? 0));
      expect(c.outputLotNos).toHaveLength(c.outputQty ?? 0);
    }
    // 손실률은 연주 실적에만 저장된다
    const stored = await prisma.productionResult.findMany({ where: { productionPlanId: plan.id }, orderBy: { id: 'asc' } });
    expect(stored.filter((r) => r.simulatedLossRate !== null).map((r) => r.processType)).toEqual(['CONTINUOUS_CASTING', 'CONTINUOUS_CASTING']);
    // 작업 시각은 앞 공정이 끝난 뒤에 이어진다
    for (let i = 1; i < result.steps.length; i++) expect(result.steps[i].startedAt >= result.steps[i - 1].completedAt).toBe(true);
    const event = await prisma.businessEvent.findFirstOrThrow({ where: { targetType: 'production_result', targetId: castings[0].productionResultId, businessEventType: 'PRODUCTION_RESULT_REGISTERED' } });
    expect(event.afterData).toMatchObject({ simulation: true, randomSeed: 12345, plannedQty: 10, sampleLossRate: castings[0].sampleLossRate });
    expect(await codeOf(simulation.simulate(producer, plan.id, {}))).toBe('COM-001');
  });

  it('같은 시드면 같은 손실 (재현 가능)', async () => {
    const a = await simulation.simulate(producer, (await planFor('SL-SS275-250x1500x10000', 3)).id, { randomSeed: 777 });
    const b = await simulation.simulate(producer, (await planFor('SL-SS275-250x1500x10000', 3)).id, { randomSeed: 777 });
    const losses = (r: typeof a) => r.steps.filter((s) => s.processType === 'CONTINUOUS_CASTING').map((s) => [s.plannedQty, s.sampleLossRate, s.lossQty]);
    expect(losses(a)).toEqual(losses(b));
  });

  it('코일 계획: 갓 연주한 슬래브는 검사 전이라 열연은 건너뛰고 계획은 진행중', async () => {
    const plan = await planFor('CL-SM355A-4.5x1500x544000', 3);
    const result = await simulation.simulate(producer, plan.id, { randomSeed: 1 });
    expect(result.steps.map((s) => s.processType)).not.toContain('HOT_ROLLING');
    expect(result.skippedRolling).toContain('검사');
    expect(result.productionPlanStatus).toBe('IN_PROGRESS');
  });

  it('원료가 모자라면 INV-001이고 실적·LOT이 하나도 남지 않는다 (전체 롤백)', async () => {
    const plan = await planFor('SL-SS275-250x1200x10000', 200);
    const lotsBefore = await prisma.lot.count();
    expect(await codeOf(simulation.simulate(producer, plan.id, { randomSeed: 5 }))).toBe('INV-001');
    expect(await prisma.productionResult.count({ where: { productionPlanId: plan.id } })).toBe(0);
    expect(await prisma.lot.count()).toBe(lotsBefore);
    expect((await prisma.productionPlan.findUniqueOrThrow({ where: { id: plan.id } })).productionPlanStatus).toBe('PLANNED');
  });

  it('취소된 계획 → COM-001, 없는 계획 → COM-003', async () => {
    const plan = await planFor('SL-SS275-250x1200x10000', 1);
    await prisma.productionPlan.update({ where: { id: plan.id }, data: { productionPlanStatus: 'CANCELLED' } });
    expect(await codeOf(simulation.simulate(producer, plan.id, {}))).toBe('COM-001');
    expect(await codeOf(simulation.simulate(producer, 999_999, {}))).toBe('COM-003');
  });
});
