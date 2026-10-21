// 수주 취소와 열연 완료가 겹칠 때 계획·열연 배정 재고가 깨지지 않는지 실제 DB(fs_prod)로 확인한다 (#478).
// 다른 테스트의 슬래브·재고와 섞이지 않게 이 파일 전용 슬래브·코일 규격을 만든다. 작업일은 2020-03.
import { Test, type TestingModule } from '@nestjs/testing';
import { BUSINESS_EVENT_TYPE, calcTheoreticalWeightTon, type AuthUser } from '@fantasteel/shared';
import { AppModule } from '../../app.module';
import { AuthUserService } from '../../common/auth/auth-user.service';
import { BusinessEventRecorder } from '../../common/business-event/business-event.recorder';
import { AppException } from '../../common/errors/app.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { SalesOrderService } from '../sales-order/sales-order.service';
import { HotRollingService } from './hot-rolling.service';
import { ProductionSimulationService } from './production-simulation.service';
import { ProductionResultService } from './production-result.service';

let moduleRef: TestingModule;
let prisma: PrismaService;
let hotRolling: HotRollingService;
let results: ProductionResultService;
let inventory: InventoryService;
let salesOrders: SalesOrderService;
let simulation: ProductionSimulationService;
let recorder: BusinessEventRecorder;
let sales: AuthUser;
let producer: AuthUser;
let customerId: number;
let slabItemId: number;
let coilItemId: number;
let seq = 0;

async function receive(itemCode: string, ton: string) {
  seq += 1;
  const item = await prisma.item.findUniqueOrThrow({ where: { itemCode } });
  const supplier = await prisma.supplier.findFirstOrThrow({ orderBy: { id: 'asc' } });
  const date = new Date('2020-03-01T00:00:00Z');
  const pr = await prisma.purchaseRequisition.create({ data: { purchaseRequisitionNo: `PR-RC-${seq}`, itemId: item.id, requestedTon: ton, desiredReceiptDate: date, requesterId: producer.employeeId, purchaseRequisitionStatus: 'ORDERED' } });
  const po = await prisma.purchaseOrder.create({ data: { purchaseOrderNo: `PO-RC-${seq}`, supplierId: supplier.id } });
  const poi = await prisma.purchaseOrderItem.create({ data: { purchaseOrderId: po.id, purchaseRequisitionId: pr.id, itemId: item.id, orderedTon: ton } });
  const gr = await prisma.goodsReceipt.create({ data: { goodsReceiptNo: `GR-RC-${seq}`, purchaseOrderItemId: poi.id, receivedTon: ton, receivedDate: date } });
  await prisma.lot.create({ data: { lotNo: `RM-RC-${itemCode}-${seq}`, lotType: 'RAW_MATERIAL', itemId: item.id, goodsReceiptId: gr.id, yardId: item.defaultYardId, initialTon: ton, remainingTon: ton } });
}

async function pass(lotIds: number[]) {
  const standard = await prisma.inspectionStandard.findFirstOrThrow();
  const inspector = await prisma.employee.findUniqueOrThrow({ where: { employeeNo: '2205013' } });
  for (const lotId of lotIds) {
    await prisma.qualityInspection.create({ data: { lotId, inspectionStandardId: standard.id, inspectorEmployeeId: inspector.id, inspectedAt: new Date(), inspectionResult: 'PASS' } });
  }
  await prisma.$transaction((tx) => inventory.onLotsEligibilityChanged(tx, lotIds, 'SYSTEM'));
}

const at = (day: string, hhmm: string) => `2020-03-${day}T${hhmm}:00.000Z`;

/** rolling_allocated_qty는 그 슬래브 규격의 확정 열연 배정 수와 같아야 한다 ([ERD] 불변조건) */
async function assertRollingInvariant() {
  const stock = await prisma.inventory.findUniqueOrThrow({ where: { itemId: slabItemId } });
  const confirmed = await prisma.allocation.count({ where: { allocationPurpose: 'HOT_ROLLING', allocationStatus: 'CONFIRMED', lot: { itemId: slabItemId } } });
  expect(stock.rollingAllocatedQty).toBe(confirmed);
  expect(stock.rollingAllocatedQty).toBeGreaterThanOrEqual(0);
  expect(stock.onHandQty - stock.reservedQty - stock.rollingAllocatedQty).toBeGreaterThanOrEqual(0);
}

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  await moduleRef.init();
  prisma = moduleRef.get(PrismaService);
  hotRolling = moduleRef.get(HotRollingService);
  results = moduleRef.get(ProductionResultService);
  inventory = moduleRef.get(InventoryService);
  salesOrders = moduleRef.get(SalesOrderService);
  simulation = moduleRef.get(ProductionSimulationService);
  recorder = moduleRef.get(BusinessEventRecorder);
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
  const base = await prisma.item.findUniqueOrThrow({ where: { itemCode: 'SL-SM355A-250x1500x10000' } });
  const coilBase = await prisma.item.findUniqueOrThrow({ where: { itemCode: 'CL-SM355A-4.5x1500x544000' } });
  const slab = await prisma.item.create({
    data: { itemCode: 'SL-RC-TEST', itemName: '취소 경합 슬래브', itemType: 'SLAB', unitType: 'QTY', steelGradeId: base.steelGradeId, thicknessMm: '250', widthMm: '1500', lengthMm: '10002', theoreticalWeightTon: calcTheoreticalWeightTon('250', '1500', '10002'), defaultYardId: base.defaultYardId },
  });
  const coil = await prisma.item.create({
    data: { itemCode: 'CL-RC-TEST', itemName: '취소 경합 코일', itemType: 'COIL', unitType: 'QTY', steelGradeId: coilBase.steelGradeId, thicknessMm: '4.5', widthMm: '1500', lengthMm: '544002', theoreticalWeightTon: calcTheoreticalWeightTon('4.5', '1500', '544002'), defaultYardId: coilBase.defaultYardId },
  });
  await prisma.specMapping.create({ data: { slabItemId: slab.id, coilItemId: coil.id } });
  slabItemId = slab.id;
  coilItemId = coil.id;
  // 계획 4~5개의 제선·제강을 돌릴 만큼 (히트 1개 ≈ 철광석 445t)
  for (const [code, ton] of [['ORE01', '4000'], ['COL01', '1500'], ['LIM01', '400'], ['SMN01', '100']] as const) await receive(code, ton);
}, 60_000);

afterAll(async () => {
  await moduleRef?.close();
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
let day = 10;

/** 코일 2개 수주 → 제선·제강·연주·검사 → 슬래브 2매 열연 배정까지. 수주·계획 id */
async function rollablePlan() {
  day += 1;
  const order = await salesOrders.create(sales, { customerId, items: [{ itemId: coilItemId, orderedQty: 2, dueDate: '2026-12-31' }] });
  const planId = (await prisma.productionPlan.findUniqueOrThrow({ where: { productionPlanNo: order.items[0].productionPlanNo ?? '' } })).id;
  await results.register(producer, { processType: 'IRONMAKING', productionPlanId: planId, blastFurnaceCode: 'BF7', startedAt: at(String(day), '00:00'), completedAt: at(String(day), '04:00'), hotMetalTon: '277.778' });
  const steel = await results.register(producer, { processType: 'STEELMAKING', productionPlanId: planId, converterCode: 'BOF7', startedAt: at(String(day), '05:00'), completedAt: at(String(day), '06:00'), inputHotMetalTon: '277.778' });
  const heatId = steel.outputs[0].lotId;
  const cast = await results.register(producer, { processType: 'CONTINUOUS_CASTING', productionPlanId: planId, heatLotId: heatId, startedAt: at(String(day), '07:00'), completedAt: at(String(day), '09:00'), slabQty: 4 });
  const slabIds = cast.outputs.map((o) => o.lotId);
  await pass([heatId, ...slabIds]);
  await hotRolling.confirm(producer, planId, { lotIds: slabIds.slice(0, 2) });
  return { salesOrderId: order.salesOrderId, planId };
}

describe('잠금 순서 장벽 시험 (#478 리뷰)', () => {
  it('열연 완료가 계획을 잠근 채 진행 중이면 수주 취소는 기다렸다가, 완료된 상태를 보고 배정을 다시 빼지 않는다', async () => {
    const { salesOrderId, planId } = await rollablePlan();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    let rolledInside = false;
    // 열연 실적(시작+완료)을 한 트랜잭션에서 하고, 커밋 전에 멈춰 계획·재고 잠금을 쥔다
    const rolling = prisma.$transaction(
      async (tx) => {
        const started = await results.startInTx(tx, producer, { processType: 'HOT_ROLLING', productionPlanId: planId, startedAt: new Date(at(String(day), '10:00')) });
        await results.completeInTx(tx, producer, started.id, { completedAt: new Date(at(String(day), '12:00')) });
        rolledInside = true;
        await gate;
      },
      { maxWait: 10_000, timeout: 30_000 },
    );
    while (!rolledInside) await sleep(20);
    let cancelled = false;
    const cancel = salesOrders.cancel(sales, salesOrderId, { reason: '장벽 시험 취소' }).then(() => (cancelled = true));
    await sleep(500);
    expect(cancelled).toBe(false);
    release();
    await rolling;
    await cancel;
    await assertRollingInvariant();
    expect(await prisma.allocation.count({ where: { productionPlanId: planId, allocationStatus: 'CONSUMED' } })).toBe(2);
    expect(await prisma.allocation.count({ where: { productionPlanId: planId, allocationStatus: 'RELEASED' } })).toBe(0);
    expect((await prisma.productionPlan.findUniqueOrThrow({ where: { id: planId } })).productionPlanStatus).not.toBe('CANCELLED');
  }, 60_000);

  it('수주 취소가 먼저 끝나면 열연 완료는 업무 오류로 막히고 재고는 그대로 맞는다', async () => {
    const { salesOrderId, planId } = await rollablePlan();
    await salesOrders.cancel(sales, salesOrderId, { reason: '먼저 취소' });
    await assertRollingInvariant();
    await expect(results.register(producer, { processType: 'HOT_ROLLING', productionPlanId: planId, startedAt: at(String(day), '10:00'), completedAt: at(String(day), '12:00') })).rejects.toBeInstanceOf(AppException);
    await assertRollingInvariant();
    expect(await prisma.allocation.count({ where: { productionPlanId: planId, allocationStatus: 'RELEASED' } })).toBe(2);
  }, 60_000);

  it('실적 시뮬레이션(열연까지)은 다른 거래가 재고 → 작업 로그 순서로 잠가도 교착 없이 끝난다', async () => {
    day += 1;
    const order = await salesOrders.create(sales, { customerId, items: [{ itemId: coilItemId, orderedQty: 1, dueDate: '2026-12-31' }] });
    const planId = (await prisma.productionPlan.findUniqueOrThrow({ where: { productionPlanNo: order.items[0].productionPlanNo ?? '' } })).id;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    let lockedInside = false;
    // 수주 등록·품질 검사와 같은 순서: 슬래브 재고 행을 잠근 뒤 작업 로그를 남긴다
    const other = prisma.$transaction(
      async (tx) => {
        await inventory.lockInventoriesFirst(tx, [slabItemId]);
        lockedInside = true;
        await gate;
        await recorder.record(tx, { type: BUSINESS_EVENT_TYPE.SALES_ORDER_CREATED, actor: 'SYSTEM', target: { table: 'sales_order', id: order.salesOrderId }, reason: '교착 시험' });
      },
      { maxWait: 10_000, timeout: 30_000 },
    );
    while (!lockedInside) await sleep(20);
    const simulated = simulation.simulate(producer, planId, { randomSeed: 4242 });
    // 시뮬레이션이 작업 로그를 먼저 잡았다면 아래 기록이 그 잠금을 기다려 교착(40P01)이 난다
    await sleep(500);
    release();
    await expect(other).resolves.toBeUndefined();
    await expect(simulated).resolves.toMatchObject({ productionPlanId: planId });
    await assertRollingInvariant();
  }, 90_000);
});

describe('수주 취소 ↔ 열연 완료 (#478)', () => {
  it('동시에 일어나도 한쪽이 끝난 뒤 다른 쪽이 최신 상태를 보고, 열연 배정 매수를 두 번 빼거나 진행 계획을 취소로 덮지 않는다', async () => {
    const order = await salesOrders.create(sales, { customerId, items: [{ itemId: coilItemId, orderedQty: 2, dueDate: '2026-12-31' }] });
    const planId = (await prisma.productionPlan.findUniqueOrThrow({ where: { productionPlanNo: order.items[0].productionPlanNo ?? '' } })).id;
    await results.register(producer, { processType: 'IRONMAKING', productionPlanId: planId, blastFurnaceCode: 'BF7', startedAt: at('02', '00:00'), completedAt: at('02', '04:00'), hotMetalTon: '277.778' });
    const steel = await results.register(producer, { processType: 'STEELMAKING', productionPlanId: planId, converterCode: 'BOF7', startedAt: at('02', '05:00'), completedAt: at('02', '06:00'), inputHotMetalTon: '277.778' });
    const heatId = steel.outputs[0].lotId;
    const cast = await results.register(producer, { processType: 'CONTINUOUS_CASTING', productionPlanId: planId, heatLotId: heatId, startedAt: at('02', '07:00'), completedAt: at('02', '09:00'), slabQty: 4 });
    const slabIds = cast.outputs.map((o) => o.lotId);
    await pass([heatId, ...slabIds]);
    await hotRolling.confirm(producer, planId, { lotIds: slabIds.slice(0, 2) });
    await assertRollingInvariant();
    expect((await prisma.inventory.findUniqueOrThrow({ where: { itemId: slabItemId } })).rollingAllocatedQty).toBe(2);

    const settled = await Promise.allSettled([
      results.register(producer, { processType: 'HOT_ROLLING', productionPlanId: planId, startedAt: at('03', '00:00'), completedAt: at('03', '02:00') }),
      salesOrders.cancel(sales, order.salesOrderId, { reason: '고객 요청 취소' }),
    ]);
    // 교착(40P01)·서버 오류 없이 각자 끝나거나 업무 오류로만 막힌다
    for (const s of settled) if (s.status === 'rejected') expect(s.reason).toBeInstanceOf(AppException);
    expect(settled[1].status).toBe('fulfilled');

    await assertRollingInvariant();
    const plan = await prisma.productionPlan.findUniqueOrThrow({ where: { id: planId } });
    // 작업이 시작된 계획이라 취소로 덮이지 않는다. 열연이 먼저 끝나 완료됐으면 그대로, 아니면 수주 연결만 풀린다(여재)
    expect(plan.productionPlanStatus).not.toBe('CANCELLED');
    if (plan.productionPlanStatus === 'IN_PROGRESS') expect(plan.salesOrderItemId).toBeNull();
    const consumed = await prisma.allocation.count({ where: { productionPlanId: planId, allocationStatus: 'CONSUMED' } });
    const released = await prisma.allocation.count({ where: { productionPlanId: planId, allocationStatus: 'RELEASED' } });
    expect(consumed + released).toBe(2);
  }, 60_000);
});
