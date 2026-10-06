// 생산계획 조회·히트 편성·취소를 실제 DB(fs_prod)로 확인한다. 계획은 수주 등록으로 만든다 (REQ-PRD-001).
import { Test, type TestingModule } from '@nestjs/testing';
import { BUSINESS_EVENT_TYPE, type AuthUser } from '@fantasteel/shared';
import { AppModule } from '../../app.module';
import { AuthUserService } from '../../common/auth/auth-user.service';
import { AppException } from '../../common/errors/app.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { SalesOrderService } from '../sales-order/sales-order.service';
import { ProductionService } from './production.service';

let moduleRef: TestingModule;
let prisma: PrismaService;
let production: ProductionService;
let salesOrders: SalesOrderService;
let sales: AuthUser;
let producer: AuthUser;
let customerId: number;

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (e) {
    if (e instanceof AppException) return e.code;
    throw e;
  }
  throw new Error('오류가 나지 않았습니다');
}

/** 재고가 없는 시드 규격으로 수주 → 전량 생산계획 */
async function planFor(itemCode: string, orderedQty: number) {
  const item = await prisma.item.findUniqueOrThrow({ where: { itemCode } });
  const result = await salesOrders.create(sales, { customerId, items: [{ itemId: item.id, orderedQty, dueDate: '2026-12-31' }] });
  const planNo = result.items[0].productionPlanNo;
  if (!planNo) throw new Error('생산계획이 만들어지지 않았습니다');
  return prisma.productionPlan.findUniqueOrThrow({ where: { productionPlanNo: planNo } });
}

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  await moduleRef.init();
  prisma = moduleRef.get(PrismaService);
  production = moduleRef.get(ProductionService);
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
}, 60_000);

afterAll(async () => {
  await moduleRef?.close();
});

describe('생산계획 조회 (API-200·201)', () => {
  it('14.1 슬래브 4매: 히트 1개, 250t, 필요 용선 277.778t, 히트당 10매 → 예상 여재 6매', async () => {
    const plan = await planFor('SL-SS275-250x1200x10000', 4);
    const detail = await production.getPlanDetail(plan.id);
    expect(detail).toMatchObject({ productionPlanStatus: 'PLANNED', shortageQty: 4, heatCount: 1, itemType: 'SLAB', canCancel: true, canConfirm: true });
    expect(detail.salesOrderNo).toMatch(/^SO-\d{4}-\d{3}$/);
    expect(detail.formation).toMatchObject({
      targetTon: '94.200',
      cumulativeYieldRate: '0.9800',
      requiredMoltenSteelTon: '96.122',
      heatCount: 1,
      heatTon: '250.000',
      requiredHotMetalTon: '277.778',
      slabQtyPerHeat: 10,
      plannedSlabQty: 10,
      expectedSurplusSlabQty: 6,
      savedHeatCount: 1,
    });
    expect(detail.progress).toMatchObject({ madeHeatQty: 0, slabQty: 0, openWorkCount: 0 });
    expect(detail.reproduction).toMatchObject({ orderedQty: 4, unsecuredQty: 4, openPlanRemainingQty: 4, additionalPlanQty: 0, reproductionNeedQty: 0 });
  });

  it('코일 계획은 매핑된 슬래브로 연주 매수를 계산하고 열연 수율을 곱한다', async () => {
    const plan = await planFor('CL-SM355A-4.5x1500x544000', 6);
    const formation = await production.previewHeatPlan(plan.id);
    const slab = await prisma.item.findUniqueOrThrow({ where: { itemCode: 'SL-SM355A-250x1500x10000' } });
    expect(formation.slabItemId).toBe(slab.id);
    expect(formation.hotRollingYieldRate).not.toBeNull();
    expect(Number(formation.cumulativeYieldRate)).toBeLessThan(0.98);
    expect(formation.plannedSlabQty).toBe(formation.slabQtyPerHeat * formation.heatCount);
  });

  it('목록: 상태·품목 유형·수주로 거르고 최근 계획부터', async () => {
    const plan = await planFor('SL-SM355B-220x1400x9500', 2);
    const page = await production.listPlans({ productionPlanStatus: 'PLANNED', itemType: 'SLAB', page: 1, size: 100 });
    expect(page.items.map((p) => p.id)).toContain(plan.id);
    expect(page.items.every((p) => p.productionPlanStatus === 'PLANNED' && p.itemType === 'SLAB')).toBe(true);
    expect(page.items[0].id).toBeGreaterThanOrEqual(plan.id);
    const salesOrderId = (await prisma.salesOrderItem.findUniqueOrThrow({ where: { id: plan.salesOrderItemId ?? 0 } })).salesOrderId;
    const bySalesOrder = await production.listPlans({ salesOrderId });
    expect(bySalesOrder.items).toEqual([expect.objectContaining({ id: plan.id, customerName: expect.any(String), dueDate: '2026-12-31' })]);
    expect(await codeOf(production.getPlanDetail(999_999))).toBe('COM-003');
  });
});

describe('히트 편성 확정 (API-204)', () => {
  it('히트 용량 설정이 바뀌면 다시 계산해 저장한다. 작업 로그는 남기지 않는다', async () => {
    const plan = await planFor('SL-SS275-250x1200x10000', 8);
    const setting = await prisma.productionSetting.findFirstOrThrow();
    const eventsBefore = await prisma.businessEvent.count({ where: { targetType: 'production_plan', targetId: plan.id } });
    try {
      await prisma.productionSetting.update({ where: { id: setting.id }, data: { heatCapacityTon: '100' } });
      const preview = await production.previewHeatPlan(plan.id);
      // 8 × 23.550 = 188.4 ÷ 0.98 = 192.245 → 100t 히트 2개
      expect(preview).toMatchObject({ heatCount: 2, savedHeatCount: 1 });
      const confirmed = await production.confirmHeatPlan(plan.id);
      expect(confirmed.heatCount).toBe(2);
      expect(confirmed.formation?.savedHeatCount).toBe(2);
    } finally {
      await prisma.productionSetting.update({ where: { id: setting.id }, data: { heatCapacityTon: setting.heatCapacityTon } });
    }
    expect(await prisma.businessEvent.count({ where: { targetType: 'production_plan', targetId: plan.id } })).toBe(eventsBefore);
  });

  it('진행중 계획은 확정할 수 없다 (COM-001)', async () => {
    const plan = await planFor('SL-SS275-250x1200x10000', 1);
    await prisma.productionPlan.update({ where: { id: plan.id }, data: { productionPlanStatus: 'IN_PROGRESS' } });
    expect(await codeOf(production.confirmHeatPlan(plan.id))).toBe('COM-001');
  });
});

describe('생산계획 취소 (API-205)', () => {
  it('계획 상태면 취소하고 작업 로그(사유 포함)를 남긴다. 다시 취소하면 COM-001', async () => {
    const plan = await planFor('SL-SS275-250x1500x10000', 3);
    const detail = await production.cancelPlan(producer, plan.id, { reason: '고객 일정 변경' });
    expect(detail).toMatchObject({ productionPlanStatus: 'CANCELLED', canCancel: false, canConfirm: false });
    const event = await prisma.businessEvent.findFirstOrThrow({ where: { targetType: 'production_plan', targetId: plan.id, businessEventType: BUSINESS_EVENT_TYPE.PRODUCTION_PLAN_CANCELLED } });
    expect(event).toMatchObject({ actorType: 'USER', actorEmployeeId: producer.employeeId });
    expect(event.reason).toContain('고객 일정 변경');
    expect(event.salesOrderId).not.toBeNull();
    expect(await codeOf(production.cancelPlan(producer, plan.id, {}))).toBe('COM-001');
    // 취소한 계획은 재생산 판단의 진행 계획 잔여 목표에서 빠진다
    expect(detail.reproduction).toMatchObject({ openPlanRemainingQty: 0, additionalPlanQty: 3 });
  });

  it('진행중 계획은 취소할 수 없다 (COM-001), 없는 계획은 COM-003', async () => {
    const plan = await planFor('SL-SS275-250x1500x10000', 2);
    await prisma.productionPlan.update({ where: { id: plan.id }, data: { productionPlanStatus: 'IN_PROGRESS' } });
    expect(await codeOf(production.cancelPlan(producer, plan.id, {}))).toBe('COM-001');
    expect(await codeOf(production.cancelPlan(producer, 999_999, {}))).toBe('COM-003');
  });
});
