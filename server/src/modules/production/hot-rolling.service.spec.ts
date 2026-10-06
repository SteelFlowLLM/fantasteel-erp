// 열연 투입(추천·배정·변경·해제·열연 실적)을 실제 DB(fs_prod)로 확인한다 (REQ-PRD-004, REQ-INV-006·009, BP-INV-01, 14.2).
// 다른 테스트의 슬래브와 재고가 섞이지 않게 이 파일 전용 슬래브·코일 규격과 매핑을 만든다. 작업일은 2020-02.
import { Test, type TestingModule } from '@nestjs/testing';
import { BUSINESS_EVENT_TYPE, calcTheoreticalWeightTon, type AuthUser } from '@fantasteel/shared';
import { AppModule } from '../../app.module';
import { AuthUserService } from '../../common/auth/auth-user.service';
import { AppException } from '../../common/errors/app.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { SalesOrderService } from '../sales-order/sales-order.service';
import { HotRollingService } from './hot-rolling.service';
import { ProductionResultService } from './production-result.service';
import { ProductionService } from './production.service';

let moduleRef: TestingModule;
let prisma: PrismaService;
let hotRolling: HotRollingService;
let results: ProductionResultService;
let production: ProductionService;
let inventory: InventoryService;
let salesOrders: SalesOrderService;
let sales: AuthUser;
let producer: AuthUser;
let customerId: number;
let slabItemId: number;
let coilItemId: number;
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

async function receive(itemCode: string, ton: string, receivedDate: string) {
  seq += 1;
  const item = await prisma.item.findUniqueOrThrow({ where: { itemCode } });
  const supplier = await prisma.supplier.findFirstOrThrow({ orderBy: { id: 'asc' } });
  const date = new Date(`${receivedDate}T00:00:00Z`);
  const pr = await prisma.purchaseRequisition.create({ data: { purchaseRequisitionNo: `PR-HR-${seq}`, itemId: item.id, requestedTon: ton, desiredReceiptDate: date, requesterId: producer.employeeId, purchaseRequisitionStatus: 'ORDERED' } });
  const po = await prisma.purchaseOrder.create({ data: { purchaseOrderNo: `PO-HR-${seq}`, supplierId: supplier.id } });
  const poi = await prisma.purchaseOrderItem.create({ data: { purchaseOrderId: po.id, purchaseRequisitionId: pr.id, itemId: item.id, orderedTon: ton } });
  const gr = await prisma.goodsReceipt.create({ data: { goodsReceiptNo: `GR-HR-${seq}`, purchaseOrderItemId: poi.id, receivedTon: ton, receivedDate: date } });
  await prisma.lot.create({ data: { lotNo: `RM-HR-${itemCode}-${seq}`, lotType: 'RAW_MATERIAL', itemId: item.id, goodsReceiptId: gr.id, yardId: item.defaultYardId, initialTon: ton, remainingTon: ton } });
}

/** 판정 fixture: 검사 행을 PASS로 만들고 품질 등록과 같은 재고 반영(onLotsEligibilityChanged)을 부른다 */
async function pass(lotIds: number[]) {
  const standard = await prisma.inspectionStandard.findFirstOrThrow();
  const inspector = await prisma.employee.findUniqueOrThrow({ where: { employeeNo: '2205013' } });
  for (const lotId of lotIds) {
    await prisma.qualityInspection.create({ data: { lotId, inspectionStandardId: standard.id, inspectorEmployeeId: inspector.id, inspectedAt: new Date(), inspectionResult: 'PASS' } });
  }
  await prisma.$transaction((tx) => inventory.onLotsEligibilityChanged(tx, lotIds, 'SYSTEM'));
}

const at = (day: string, hhmm: string) => `2020-02-${day}T${hhmm}:00.000Z`;
const stock = () => prisma.inventory.findUniqueOrThrow({ where: { itemId: slabItemId } });

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  await moduleRef.init();
  prisma = moduleRef.get(PrismaService);
  hotRolling = moduleRef.get(HotRollingService);
  results = moduleRef.get(ProductionResultService);
  production = moduleRef.get(ProductionService);
  inventory = moduleRef.get(InventoryService);
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

  const base = await prisma.item.findUniqueOrThrow({ where: { itemCode: 'SL-SM355A-250x1500x10000' } });
  const coilBase = await prisma.item.findUniqueOrThrow({ where: { itemCode: 'CL-SM355A-4.5x1500x544000' } });
  const slab = await prisma.item.create({
    data: { itemCode: 'SL-HR-TEST', itemName: '열연 테스트 슬래브', itemType: 'SLAB', unitType: 'QTY', steelGradeId: base.steelGradeId, thicknessMm: '250', widthMm: '1500', lengthMm: '10001', theoreticalWeightTon: calcTheoreticalWeightTon('250', '1500', '10001'), defaultYardId: base.defaultYardId },
  });
  const coil = await prisma.item.create({
    data: { itemCode: 'CL-HR-TEST', itemName: '열연 테스트 코일', itemType: 'COIL', unitType: 'QTY', steelGradeId: coilBase.steelGradeId, thicknessMm: '4.5', widthMm: '1500', lengthMm: '544001', theoreticalWeightTon: calcTheoreticalWeightTon('4.5', '1500', '544001'), defaultYardId: coilBase.defaultYardId },
  });
  await prisma.specMapping.create({ data: { slabItemId: slab.id, coilItemId: coil.id } });
  slabItemId = slab.id;
  coilItemId = coil.id;
}, 60_000);

afterAll(async () => {
  await moduleRef?.close();
});

describe('14.2 코일 3개: 필요한 슬래브만 열연, 판매 예약 비침범', () => {
  let planId: number;
  let slabIds: number[];

  beforeAll(async () => {
    const order = await salesOrders.create(sales, { customerId, items: [{ itemId: coilItemId, orderedQty: 3, dueDate: '2026-12-31' }] });
    planId = (await prisma.productionPlan.findUniqueOrThrow({ where: { productionPlanNo: order.items[0].productionPlanNo ?? '' } })).id;
    for (const [code, ton] of [['ORE01', '500'], ['COL01', '200'], ['LIM01', '50'], ['SMN01', '10']] as const) await receive(code, ton, '2020-02-01');
    await results.register(producer, { processType: 'IRONMAKING', productionPlanId: planId, blastFurnaceCode: 'BF6', startedAt: at('02', '00:00'), completedAt: at('02', '04:00'), hotMetalTon: '277.778' });
    const steel = await results.register(producer, { processType: 'STEELMAKING', productionPlanId: planId, converterCode: 'BOF6', startedAt: at('02', '05:00'), completedAt: at('02', '06:00'), inputHotMetalTon: '277.778' });
    const heatId = steel.outputs[0].lotId;
    const cast = await results.register(producer, { processType: 'CONTINUOUS_CASTING', productionPlanId: planId, heatLotId: heatId, startedAt: at('02', '07:00'), completedAt: at('02', '09:00'), slabQty: 8 });
    slabIds = cast.outputs.map((o) => o.lotId);
    // 연주까지 했지만 열연할 슬래브가 남아 있어 계획은 진행중
    expect((await prisma.productionPlan.findUniqueOrThrow({ where: { id: planId } })).productionPlanStatus).toBe('IN_PROGRESS');
  });

  it('검사 전: 후보·추천 없음, 더 필요한 슬래브 3매', async () => {
    const detail = await hotRolling.detail(planId);
    expect(detail).toMatchObject({ shortageQty: 3, usableCoilQty: 0, neededQty: 3, recommendableQty: 0, isRollable: true, candidates: [] });
    expect(detail.slabItemId).toBe(slabItemId);
  });

  it('합격 8매 중 판매 예약 6매 → 가용 2매만 추천, 3매 확정은 INV-001(아무것도 저장 안 함)', async () => {
    const heat = await prisma.lotRelation.findFirstOrThrow({ where: { childLotId: slabIds[0] } });
    await pass([heat.parentLotId, ...slabIds]);
    expect(await stock()).toMatchObject({ onHandQty: 8, reservedQty: 0 });
    const slabOrder = await salesOrders.create(sales, { customerId, items: [{ itemId: slabItemId, orderedQty: 6, dueDate: '2026-12-31' }] });
    expect(slabOrder.items[0].reservedQty).toBe(6);

    const detail = await hotRolling.recommend(producer, planId);
    expect(detail).toMatchObject({ neededQty: 3, recommendableQty: 2, slabPool: { onHandQty: 8, reservedQty: 6, availableQty: 2 } });
    expect(detail.candidates).toHaveLength(8);
    expect(detail.candidates.filter((c) => c.isRecommended).map((c) => c.lotId)).toEqual(slabIds.slice(0, 2));
    expect(detail.candidates.every((c) => c.isOwnPlan)).toBe(true);
    const recommended = await prisma.businessEvent.findFirstOrThrow({ where: { targetType: 'production_plan', targetId: planId, businessEventType: BUSINESS_EVENT_TYPE.ALLOCATION_RECOMMENDED } });
    expect(recommended.reason).toContain('FIFO_RECOMMENDATION');

    expect(await codeOf(hotRolling.confirm(producer, planId, { lotIds: slabIds.slice(0, 3) }))).toBe('INV-001');
    expect(await prisma.allocation.count({ where: { productionPlanId: planId } })).toBe(0);
    expect(await stock()).toMatchObject({ rollingAllocatedQty: 0 });
    expect(await codeOf(hotRolling.confirm(producer, planId, { lotIds: slabIds.slice(0, 4) }))).toBe('INV-001');

    const confirmed = await hotRolling.confirm(producer, planId, { lotIds: slabIds.slice(0, 2) });
    expect(confirmed).toMatchObject({ confirmedAllocationQty: 2, neededQty: 1, slabPool: { rollingAllocatedQty: 2, availableQty: 0 } });
    expect(await codeOf(hotRolling.confirm(producer, planId, { lotIds: [slabIds[0]] }))).toBe('INV-003');
  });

  it('변경: 기존 해제 + 새 슬래브 확정을 한 번에 (ALLOCATION_CHANGED), 해제하면 rolling −1', async () => {
    const before = await hotRolling.detail(planId);
    const first = before.allocations.find((a) => a.lotId === slabIds[0]);
    if (!first) throw new Error('배정이 없습니다');
    const changed = await hotRolling.release(producer, planId, first.id, { newLotId: slabIds[2], reason: '야드 위치' });
    expect(changed.allocations.filter((a) => a.allocationStatus === 'CONFIRMED').map((a) => a.lotId).sort()).toEqual([slabIds[1], slabIds[2]].sort());
    expect(await prisma.businessEvent.count({ where: { businessEventType: BUSINESS_EVENT_TYPE.ALLOCATION_CHANGED, businessEventLots: { some: { lotId: slabIds[2] } } } })).toBe(1);
    expect(await stock()).toMatchObject({ rollingAllocatedQty: 2 });

    const third = changed.allocations.find((a) => a.lotId === slabIds[2] && a.allocationStatus === 'CONFIRMED');
    if (!third) throw new Error('배정이 없습니다');
    const released = await hotRolling.release(producer, planId, third.id, {});
    expect(released).toMatchObject({ confirmedAllocationQty: 1, slabPool: { rollingAllocatedQty: 1, availableQty: 1 } });
    expect(await codeOf(hotRolling.release(producer, planId, third.id, {}))).toBe('COM-001');
  });

  it('열연 실적: 확정 배정 슬래브 1매 → 코일 1개(C + 슬래브번호), 슬래브·배정 소진, 재고 rolling·현재고 감소', async () => {
    const view = await results.register(producer, { processType: 'HOT_ROLLING', productionPlanId: planId, startedAt: at('03', '00:00'), completedAt: at('03', '02:00') });
    expect(view.outputQty).toBe(1);
    const slabNo = (await prisma.lot.findUniqueOrThrow({ where: { id: slabIds[1] } })).lotNo;
    expect(view.outputs[0]).toMatchObject({ lotType: 'COIL', lotNo: `C${slabNo.slice(3)}`, itemCode: 'CL-HR-TEST' });
    expect(view.inputs).toEqual([expect.objectContaining({ lotId: slabIds[1], lotType: 'SLAB' })]);
    expect(await prisma.lot.findUniqueOrThrow({ where: { id: slabIds[1] } })).toMatchObject({ lotStatus: 'CONSUMED' });
    expect(await prisma.allocation.findFirstOrThrow({ where: { lotId: slabIds[1], productionPlanId: planId, allocationStatus: { not: 'RELEASED' } } })).toMatchObject({ allocationStatus: 'CONSUMED' });
    expect(await stock()).toMatchObject({ onHandQty: 7, reservedQty: 6, rollingAllocatedQty: 0 });
    expect(await codeOf(results.register(producer, { processType: 'HOT_ROLLING', productionPlanId: planId, startedAt: at('03', '03:00'), completedAt: at('03', '04:00') }))).toBe('COM-004');
  });

  it('판매 예약이 풀리면 남은 2매를 배정·열연하고 코일 3개가 되면 계획 완료', async () => {
    const slabOrder = await prisma.salesOrder.findFirstOrThrow({ where: { salesOrderItems: { some: { itemId: slabItemId } } } });
    await salesOrders.cancel(sales, slabOrder.id, { reason: '고객 취소' });
    const detail = await hotRolling.recommend(producer, planId);
    expect(detail).toMatchObject({ usableCoilQty: 1, neededQty: 2, recommendableQty: 2 });
    const lotIds = detail.candidates.filter((c) => c.isRecommended).map((c) => c.lotId);
    await hotRolling.confirm(producer, planId, { lotIds });
    await results.register(producer, { processType: 'HOT_ROLLING', productionPlanId: planId, startedAt: at('03', '05:00'), completedAt: at('03', '07:00') });
    const plan = await production.getPlanDetail(planId);
    expect(plan).toMatchObject({ productionPlanStatus: 'COMPLETED' });
    expect(plan.progress).toMatchObject({ coilQty: 3, pendingQty: 3 });
    const after = await hotRolling.detail(planId);
    expect(after).toMatchObject({ isRollable: false, neededQty: 0 });
    // 남은 합격 슬래브 5매는 여재로 재고에 남는다 (REQ-PRD-004)
    expect(await stock()).toMatchObject({ onHandQty: 5, reservedQty: 0, rollingAllocatedQty: 0 });
  });
});

describe('열연 투입 오류', () => {
  it('슬래브 계획은 열연 투입 화면이 없다 (COM-004), 없는 계획 COM-003', async () => {
    const item = await prisma.item.findUniqueOrThrow({ where: { itemCode: 'SL-SS275-250x1200x10000' } });
    const order = await salesOrders.create(sales, { customerId, items: [{ itemId: item.id, orderedQty: 1, dueDate: '2026-12-31' }] });
    const plan = await prisma.productionPlan.findUniqueOrThrow({ where: { productionPlanNo: order.items[0].productionPlanNo ?? '' } });
    expect(await codeOf(hotRolling.detail(plan.id))).toBe('COM-004');
    expect(await codeOf(hotRolling.detail(999_999))).toBe('COM-003');
  });

  it('수주 연결이 끊긴 코일 계획은 열연하지 않는다', async () => {
    const order = await salesOrders.create(sales, { customerId, items: [{ itemId: coilItemId, orderedQty: 1, dueDate: '2026-12-31' }] });
    const plan = await prisma.productionPlan.findUniqueOrThrow({ where: { productionPlanNo: order.items[0].productionPlanNo ?? '' } });
    await prisma.productionPlan.update({ where: { id: plan.id }, data: { salesOrderItemId: null, productionPlanStatus: 'IN_PROGRESS' } });
    const detail = await hotRolling.detail(plan.id);
    expect(detail).toMatchObject({ isRollable: false, recommendableQty: 0 });
    expect(detail.notRollableReason).toContain('여재');
    expect(await codeOf(hotRolling.confirm(producer, plan.id, { lotIds: [1] }))).toBe('COM-001');
  });
});
