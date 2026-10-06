// 재생산 계획 생성을 실제 DB(fs_prod)로 확인한다 (REQ-PRD-006, BP-QC-01, 14.1-5·6).
// 이 파일 전용 슬래브 규격을 만들어 다른 테스트의 재고와 섞이지 않게 한다.
import { Test, type TestingModule } from '@nestjs/testing';
import { BUSINESS_EVENT_TYPE, calcTheoreticalWeightTon, type AuthUser, type InspectionResult } from '@fantasteel/shared';
import { AppModule } from '../../app.module';
import { AuthUserService } from '../../common/auth/auth-user.service';
import { AppException } from '../../common/errors/app.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { SalesOrderService } from '../sales-order/sales-order.service';
import { ProductionService } from './production.service';

let moduleRef: TestingModule;
let prisma: PrismaService;
let production: ProductionService;
let inventory: InventoryService;
let salesOrders: SalesOrderService;
let sales: AuthUser;
let producer: AuthUser;
let customerId: number;
let slabItemId: number;
let inspectionStandardId: number;
let inspectorId: number;
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

/** 히트 1개 + 슬래브 판정별 fixture (계획에 연결). 판정 뒤 재고 반영은 품질 등록과 같은 함수로 */
async function cast(productionPlanId: number | null, results: (InspectionResult | null)[]) {
  seq += 1;
  const now = new Date();
  const grade = (await prisma.item.findUniqueOrThrow({ where: { id: slabItemId } })).steelGradeId;
  const steelmaking = await prisma.productionResult.create({ data: { processType: 'STEELMAKING', converterCode: 'BOF5', productionPlanId, startedAt: now, completedAt: now } });
  const heat = await prisma.lot.create({ data: { lotNo: `RP-HT-${seq}`, lotType: 'HEAT', steelGradeId: grade, productionResultId: steelmaking.id, initialTon: '250', lotStatus: 'CONSUMED' } });
  await prisma.qualityInspection.create({ data: { lotId: heat.id, inspectionStandardId, inspectorEmployeeId: inspectorId, inspectedAt: now, inspectionResult: 'PASS' } });
  const casting = await prisma.productionResult.create({ data: { processType: 'CONTINUOUS_CASTING', productionPlanId, startedAt: now, completedAt: now } });
  const ids: number[] = [];
  for (const [n, result] of results.entries()) {
    const slab = await prisma.lot.create({ data: { lotNo: `RP-HT-${seq}-${n + 1}`, lotType: 'SLAB', itemId: slabItemId, productionResultId: casting.id, producedDate: new Date('2026-10-01T00:00:00Z') } });
    await prisma.lotRelation.create({ data: { parentLotId: heat.id, childLotId: slab.id, lotRelationEvidence: 'ACTUAL_INPUT' } });
    if (result) await prisma.qualityInspection.create({ data: { lotId: slab.id, inspectionStandardId, inspectorEmployeeId: inspectorId, inspectedAt: now, inspectionResult: result } });
    ids.push(slab.id);
  }
  await prisma.$transaction((tx) => inventory.onLotsEligibilityChanged(tx, [heat.id], 'SYSTEM'));
  return ids;
}

async function order(qty: number) {
  const created = await salesOrders.create(sales, { customerId, items: [{ itemId: slabItemId, orderedQty: qty, dueDate: '2026-12-31' }] });
  const plan = await prisma.productionPlan.findUniqueOrThrow({ where: { productionPlanNo: created.items[0].productionPlanNo ?? '' } });
  return { salesOrderId: created.salesOrderId, salesOrderItemId: plan.salesOrderItemId ?? 0, plan };
}

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  await moduleRef.init();
  prisma = moduleRef.get(PrismaService);
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
  inspectionStandardId = (await prisma.inspectionStandard.findFirstOrThrow()).id;
  inspectorId = (await prisma.employee.findUniqueOrThrow({ where: { employeeNo: '2205013' } })).id;
  const base = await prisma.item.findUniqueOrThrow({ where: { itemCode: 'SL-SS275-250x1200x10000' } });
  const item = await prisma.item.create({
    data: { itemCode: 'SL-RP-TEST', itemName: '재생산 테스트 슬래브', itemType: 'SLAB', unitType: 'QTY', steelGradeId: base.steelGradeId, thicknessMm: '250', widthMm: '1200', lengthMm: '10002', theoreticalWeightTon: calcTheoreticalWeightTon('250', '1200', '10002'), defaultYardId: base.defaultYardId },
  });
  slabItemId = item.id;
}, 60_000);

afterAll(async () => {
  await moduleRef?.close();
});

describe('재생산 계획 생성 (API-202)', () => {
  it('검사 대기 슬래브가 남아 있으면 재생산하지 않는다 (COM-001)', async () => {
    const { salesOrderItemId, plan } = await order(4);
    await cast(plan.id, ['PASS', 'PASS', null, null]);
    await prisma.productionPlan.update({ where: { id: plan.id }, data: { productionPlanStatus: 'COMPLETED' } });
    const check = await production.reproductionCheck(prisma, salesOrderItemId);
    expect(check).toMatchObject({ activeReservedQty: 2, unsecuredQty: 2, openPlanRemainingQty: 2, additionalPlanQty: 0 });
    expect(await codeOf(production.createReproductionPlan(producer, salesOrderItemId))).toBe('COM-001');
  });

  it('불합격 2매 → 여재 1매를 먼저 예약하고 남은 1매만 재생산 계획 (14.1-5·6)', async () => {
    const { salesOrderItemId, salesOrderId, plan } = await order(4);
    await cast(plan.id, ['PASS', 'PASS', 'FAIL', 'FAIL']);
    await prisma.productionPlan.update({ where: { id: plan.id }, data: { productionPlanStatus: 'COMPLETED' } });
    // 수주 연결이 없는 합격 슬래브 1매 = 여재
    await cast(null, ['PASS']);
    const before = await production.reproductionCheck(prisma, salesOrderItemId);
    expect(before).toMatchObject({ unsecuredQty: 2, openPlanRemainingQty: 0, additionalPlanQty: 2, reservationAvailableQty: 1, reproductionNeedQty: 1 });

    const result = await production.createReproductionPlan(producer, salesOrderItemId);
    expect(result.reservedFromSurplusQty).toBe(1);
    expect(result.plan).toMatchObject({ isReproduction: true, shortageQty: 1, productionPlanStatus: 'PLANNED', salesOrderItemId, heatCount: 1 });
    const event = await prisma.businessEvent.findFirstOrThrow({ where: { targetType: 'production_plan', targetId: result.plan?.id ?? 0 } });
    expect(event).toMatchObject({ businessEventType: BUSINESS_EVENT_TYPE.REPRODUCTION_PLAN_CREATED, salesOrderId, actorEmployeeId: producer.employeeId });
    expect(event.reason).toContain('여재 1매');
    const reserved = await prisma.reservation.aggregate({ where: { salesOrderItemId, reservationStatus: 'ACTIVE' }, _sum: { reservedQty: true } });
    expect(reserved._sum.reservedQty).toBe(3);

    // 새 재생산 계획이 남은 1매를 덮으므로 다시 만들 수 없다
    expect(await codeOf(production.createReproductionPlan(producer, salesOrderItemId))).toBe('COM-001');
    expect((await production.listPlans({ isReproduction: true, salesOrderId })).items).toHaveLength(1);
  });

  it('여재로 다 채우면 계획을 만들지 않는다', async () => {
    const { salesOrderItemId, plan } = await order(2);
    await cast(plan.id, ['FAIL', 'FAIL']);
    await prisma.productionPlan.update({ where: { id: plan.id }, data: { productionPlanStatus: 'COMPLETED' } });
    await cast(null, ['PASS', 'PASS']);
    const result = await production.createReproductionPlan(producer, salesOrderItemId);
    expect(result).toMatchObject({ reservedFromSurplusQty: 2, plan: null });
  });

  it('취소된 수주 품목 → COM-001, 없는 품목 → COM-003', async () => {
    const { salesOrderItemId, salesOrderId } = await order(1);
    await salesOrders.cancel(sales, salesOrderId, { reason: '테스트' });
    expect(await codeOf(production.createReproductionPlan(producer, salesOrderItemId))).toBe('COM-001');
    expect(await codeOf(production.createReproductionPlan(producer, 999_999))).toBe('COM-003');
  });
});
