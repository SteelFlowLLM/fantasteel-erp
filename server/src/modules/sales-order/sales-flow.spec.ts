// 수주 → 예약·생산계획 → 출하요청 → LOT 배정 → 수주 취소를 실제 DB(fs_sales)로 확인한다.
// 같은 묶음(fs_sales)의 다른 테스트 파일과 DB를 함께 쓰므로 전체 건수 대신 이 파일이 만든 규격·수주로 확인한다.
import { Test, type TestingModule } from '@nestjs/testing';
import {
  BUSINESS_EVENT_TYPE,
  INSPECTION_RESULT,
  LOT_RELATION_EVIDENCE,
  PROCESS_TYPE,
  SHIPMENT_REQUEST_STATUS,
  type AuthUser,
  type InspectionResult,
  calcTheoreticalWeightTon,
  calcWeightTon,
} from '@fantasteel/shared';
import { AppModule } from '../../app.module';
import { AuthUserService } from '../../common/auth/auth-user.service';
import { AppException } from '../../common/errors/app.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { DashboardService } from '../dashboard/dashboard.service';
import { InventoryService } from '../inventory/inventory.service';
import { ShipmentService } from '../shipment/shipment.service';
import { SalesOrderService } from './sales-order.service';

let moduleRef: TestingModule;
let prisma: PrismaService;
let salesOrders: SalesOrderService;
let shipments: ShipmentService;
let inventory: InventoryService;
let dashboard: DashboardService;
let sales: AuthUser;
let logistics: AuthUser;
let customerA: number;
let customerB: number;
let inspectionStandardId: number;
let inspectorId: number;
/** 23.550t(250×1200×10000) 시드 규격. 14.1·14.3 예시를 그대로 확인하는 첫 테스트에 쓴다 */
let seedSlabIds: number[];
let seq = 0;

const DUE = '2026-12-31';

/** 업무 오류 코드를 꺼낸다 (AppException이 아니면 그대로 던진다) */
async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (e) {
    if (e instanceof AppException) return e.code;
    throw e;
  }
  throw new Error('오류가 나지 않았습니다');
}

/** 테스트마다 새 슬래브 규격을 만들어 재고가 섞이지 않게 한다 (테스트 DB에만 생긴다) */
async function nextSlabItemId(): Promise<number> {
  const seeded = seedSlabIds.shift();
  if (seeded !== undefined) return seeded;
  seq += 1;
  const base = await prisma.item.findFirstOrThrow({ where: { itemType: 'SLAB' }, orderBy: { id: 'asc' } });
  const lengthMm = 10000 + seq;
  const item = await prisma.item.create({
    data: {
      itemCode: `SL-TEST-${seq}`,
      itemName: `테스트 슬래브 ${seq}`,
      itemType: 'SLAB',
      unitType: 'QTY',
      steelGradeId: base.steelGradeId,
      thicknessMm: '250',
      widthMm: '1200',
      lengthMm: String(lengthMm),
      theoreticalWeightTon: calcTheoreticalWeightTon('250', '1200', lengthMm),
      defaultYardId: base.defaultYardId,
    },
  });
  return item.id;
}

/**
 * 합격 제품 LOT을 만든다: 제강 실적 → 히트(검사) → 연주 실적 → 슬래브 n매(검사) + 히트→슬래브 관계.
 * 적격(자기 PASS + 히트 PASS)인 매수만큼 재고 on_hand를 늘린다 (품질 모듈이 할 일을 테스트에서 대신한다).
 */
async function addSlabs(itemId: number, count: number, options: { producedDate?: string; heatResult?: InspectionResult; lotResult?: InspectionResult; productionPlanId?: number } = {}) {
  const item = await prisma.item.findUniqueOrThrow({ where: { id: itemId } });
  const now = new Date();
  const steelmaking = await prisma.productionResult.create({ data: { processType: PROCESS_TYPE.STEELMAKING, converterCode: 'BOF1', startedAt: now, completedAt: now } });
  seq += 1;
  const heat = await prisma.lot.create({ data: { lotNo: `T-HT-${seq}`, lotType: 'HEAT', steelGradeId: item.steelGradeId, productionResultId: steelmaking.id } });
  const heatResult = options.heatResult ?? INSPECTION_RESULT.PASS;
  await prisma.qualityInspection.create({ data: { lotId: heat.id, inspectionStandardId, inspectorEmployeeId: inspectorId, inspectedAt: now, inspectionResult: heatResult } });
  const casting = await prisma.productionResult.create({
    data: { processType: PROCESS_TYPE.CONTINUOUS_CASTING, productionPlanId: options.productionPlanId ?? null, startedAt: now, completedAt: now },
  });
  const lots = [];
  for (let n = 1; n <= count; n++) {
    const slab = await prisma.lot.create({
      data: {
        lotNo: `T-HT-${seq}-${String(n).padStart(2, '0')}`,
        lotType: 'SLAB',
        itemId,
        productionResultId: casting.id,
        producedDate: new Date(`${options.producedDate ?? '2026-09-01'}T00:00:00.000Z`),
      },
    });
    await prisma.qualityInspection.create({ data: { lotId: slab.id, inspectionStandardId, inspectorEmployeeId: inspectorId, inspectedAt: now, inspectionResult: options.lotResult ?? INSPECTION_RESULT.PASS } });
    await prisma.lotRelation.create({ data: { parentLotId: heat.id, childLotId: slab.id, lotRelationEvidence: LOT_RELATION_EVIDENCE.ACTUAL_INPUT } });
    lots.push(slab);
  }
  const eligible = heatResult === INSPECTION_RESULT.PASS && (options.lotResult ?? INSPECTION_RESULT.PASS) === INSPECTION_RESULT.PASS ? count : 0;
  await prisma.inventory.upsert({ where: { itemId }, create: { itemId, onHandQty: eligible }, update: { onHandQty: { increment: eligible } } });
  return lots;
}

const inventoryOf = (itemId: number) => prisma.inventory.findUniqueOrThrow({ where: { itemId } });
const eventsOf = (salesOrderId: number) => prisma.businessEvent.findMany({ where: { salesOrderId }, orderBy: { id: 'asc' } });
const createSalesOrder = (itemId: number, orderedQty: number, customerId = customerA, key?: string) =>
  salesOrders.create(sales, { customerId, items: [{ itemId, orderedQty, dueDate: DUE }] }, key);

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  await moduleRef.init();
  prisma = moduleRef.get(PrismaService);
  salesOrders = moduleRef.get(SalesOrderService);
  shipments = moduleRef.get(ShipmentService);
  inventory = moduleRef.get(InventoryService);
  dashboard = moduleRef.get(DashboardService);
  const authUsers = moduleRef.get(AuthUserService);
  const load = async (employeeNo: string) => {
    const employee = await prisma.employee.findUniqueOrThrow({ where: { employeeNo } });
    const user = await authUsers.load(employee.id);
    if (!user) throw new Error(employeeNo);
    return user;
  };
  sales = await load('2103003');
  logistics = await load('2304015');
  inspectorId = (await prisma.employee.findUniqueOrThrow({ where: { employeeNo: '2205013' } })).id;
  inspectionStandardId = (await prisma.inspectionStandard.findFirstOrThrow()).id;
  const customers = await prisma.customer.findMany({ orderBy: { id: 'asc' } });
  customerA = customers[0].id;
  customerB = customers[1].id;
  const slabs = await prisma.item.findMany({ where: { itemType: 'SLAB' }, orderBy: { id: 'asc' } });
  seedSlabIds = slabs.filter((s) => s.theoreticalWeightTon?.toFixed(3) === '23.550').map((s) => s.id);
}, 60_000);

afterAll(async () => {
  await moduleRef?.close();
});

describe('수주 등록 (REQ-SO-001~003, BP-SO-01)', () => {
  it('합격 가용 6매에 23.550t 규격 10매: ACTIVE 6매 예약, 부족 4매 생산계획(히트 1), 톤 235.500은 계산값', async () => {
    const itemId = await nextSlabItemId();
    await addSlabs(itemId, 6);
    const result = await createSalesOrder(itemId, 10);

    expect(result.salesOrderNo).toMatch(/^SO-\d{4}-\d{3}$/);
    expect(result.items).toEqual([expect.objectContaining({ orderedQty: 10, orderedTon: '235.500', reservedQty: 6, shortageQty: 4, productionPlanNo: expect.stringMatching(/^PP-\d{4}-\d{4}$/) })]);
    const reservations = await prisma.reservation.findMany({ where: { salesOrderItem: { salesOrderId: result.salesOrderId } } });
    expect(reservations).toEqual([expect.objectContaining({ reservedQty: 6, reservationStatus: 'ACTIVE' })]);
    expect(await inventoryOf(itemId)).toMatchObject({ onHandQty: 6, reservedQty: 6 });
    const plan = await prisma.productionPlan.findFirstOrThrow({ where: { productionPlanNo: result.items[0].productionPlanNo ?? '' } });
    expect(plan).toMatchObject({ shortageQty: 4, heatCount: 1, productionPlanStatus: 'PLANNED', itemId });
    expect((await eventsOf(result.salesOrderId)).map((e) => e.businessEventType)).toEqual([
      BUSINESS_EVENT_TYPE.SALES_ORDER_CREATED,
      BUSINESS_EVENT_TYPE.RESERVATION_CREATED,
      BUSINESS_EVENT_TYPE.PRODUCTION_PLAN_CREATED,
    ]);
  });

  it('재고 행이 없으면 예약 없이 전량 생산계획', async () => {
    const itemId = await nextSlabItemId();
    const result = await createSalesOrder(itemId, 3);
    expect(result.items[0]).toMatchObject({ reservedQty: 0, shortageQty: 3 });
  });

  it('재고가 넉넉하면 생산계획을 만들지 않는다', async () => {
    const itemId = await nextSlabItemId();
    await addSlabs(itemId, 5);
    const result = await createSalesOrder(itemId, 5);
    expect(result.items[0]).toMatchObject({ reservedQty: 5, shortageQty: 0, productionPlanNo: null });
  });

  it.each([[10.5], [0], [-1], ['10'], [null]])('수량 %p → SO-002', async (orderedQty) => {
    expect(await codeOf(salesOrders.create(sales, { customerId: customerA, items: [{ itemId: await nextSlabItemId(), orderedQty, dueDate: DUE }] }))).toBe('SO-002');
  });

  it('원료 규격·없는 규격 → SO-001, 없는 고객사 → COM-003', async () => {
    const rawMaterial = await prisma.item.findFirstOrThrow({ where: { itemType: 'RAW_MATERIAL' } });
    expect(await codeOf(createSalesOrder(rawMaterial.id, 1))).toBe('SO-001');
    expect(await codeOf(createSalesOrder(999_999, 1))).toBe('SO-001');
    expect(await codeOf(createSalesOrder(await nextSlabItemId(), 1, 999_999))).toBe('COM-003');
  });

  it('같은 요청 키로 두 번 저장하면 수주는 한 건', async () => {
    const itemId = await nextSlabItemId();
    const [a, b] = await Promise.all([createSalesOrder(itemId, 2, customerA, 'key-double-click'), createSalesOrder(itemId, 2, customerA, 'key-double-click')]);
    expect(b.salesOrderId).toBe(a.salesOrderId);
    expect(await prisma.salesOrder.count({ where: { salesOrderItems: { some: { itemId } } } })).toBe(1);
  });

  it('동일 규격 동시 주문: ACTIVE 예약 합계가 가용을 넘지 않고 둘 다 저장된다 (REQ-INV-009)', async () => {
    const itemId = await nextSlabItemId();
    await addSlabs(itemId, 6);
    const [a, b] = await Promise.all([createSalesOrder(itemId, 5), createSalesOrder(itemId, 5)]);
    expect(a.items[0].reservedQty + b.items[0].reservedQty).toBe(6);
    expect(a.items[0].shortageQty + b.items[0].shortageQty).toBe(4);
    const active = await prisma.reservation.aggregate({ where: { itemId, reservationStatus: 'ACTIVE' }, _sum: { reservedQty: true } });
    expect(active._sum.reservedQty).toBe(6);
    expect(await inventoryOf(itemId)).toMatchObject({ onHandQty: 6, reservedQty: 6 });
  });
});

describe('수주 조회 (REQ-SO-004·005)', () => {
  it('목록·상세·충족 현황이 DB 값을 따라 바뀐다: 부분 출고 4매 → 부분출하, 진행률 4/10', async () => {
    const itemId = await nextSlabItemId();
    await addSlabs(itemId, 10);
    const { salesOrderId } = await createSalesOrder(itemId, 10);

    let detail = await salesOrders.detail(salesOrderId);
    expect(detail).toMatchObject({ salesOrderStatus: 'OPEN', totalOrderedQty: 10, progress: { qty: 0, denominatorQty: 10 }, cancelBlock: null });
    expect(detail.items[0]).toMatchObject({ activeReservedQty: 10, passedQty: 10, shippedQty: 0, unsecuredQty: 0 });

    // 출고 확정(물류 담당)이 하는 일을 DB에서 직접 바꾼다: ACTIVE 10 → ACTIVE 6 + CONVERTED 4, 품목 부분출하
    const soItem = await prisma.salesOrderItem.findFirstOrThrow({ where: { salesOrderId } });
    const active = await prisma.reservation.findFirstOrThrow({ where: { salesOrderItemId: soItem.id } });
    await prisma.reservation.update({ where: { id: active.id }, data: { reservedQty: 6 } });
    await prisma.reservation.create({ data: { salesOrderItemId: soItem.id, itemId, reservedQty: 4, reservationStatus: 'CONVERTED' } });
    await prisma.salesOrderItem.update({ where: { id: soItem.id }, data: { salesOrderItemStatus: 'PARTIALLY_SHIPPED' } });

    detail = await salesOrders.detail(salesOrderId);
    expect(detail).toMatchObject({ salesOrderStatus: 'PARTIALLY_SHIPPED', totalShippedQty: 4, progress: { qty: 4, denominatorQty: 10, ratio: 0.4 }, cancelBlock: 'SO-003' });
    expect(detail.items[0]).toMatchObject({ shippedQty: 4, unshippedQty: 6, activeReservedQty: 6, passedQty: 10 });

    const fulfillment = await salesOrders.fulfillment(salesOrderId);
    expect(fulfillment.items[0]).toMatchObject({ shippedQty: 4, activeReservedQty: 6 });
    const list = await salesOrders.list({ page: 1, size: 100 });
    expect(list.items.find((s) => s.id === salesOrderId)).toMatchObject({ salesOrderStatus: 'PARTIALLY_SHIPPED', totalShippedQty: 4 });
    const reservations = await salesOrders.reservations(salesOrderId);
    expect(reservations.map((r) => [r.reservationStatus, r.reservedQty])).toEqual([
      ['ACTIVE', 6],
      ['CONVERTED', 4],
    ]);
  });

  it('진행중 계획의 합격 제품은 생산중 잔여에서 빠진다', async () => {
    const itemId = await nextSlabItemId();
    const { salesOrderId, items } = await createSalesOrder(itemId, 4);
    const plan = await prisma.productionPlan.findFirstOrThrow({ where: { productionPlanNo: items[0].productionPlanNo ?? '' } });
    await prisma.productionPlan.update({ where: { id: plan.id }, data: { productionPlanStatus: 'IN_PROGRESS' } });
    await addSlabs(itemId, 1, { productionPlanId: plan.id });

    const detail = await salesOrders.detail(salesOrderId);
    expect(detail.items[0]).toMatchObject({ inProductionQty: 3, plannedQty: 0, unsecuredQty: 4, additionalPlanQty: 1 });
    expect(detail.productionPlans[0]).toMatchObject({ productionPlanStatus: 'IN_PROGRESS', remainingTargetQty: 3 });
  });

  it('납기까지 기준일(3일) 이하이고 미출하가 있으면 납기 위험', async () => {
    const itemId = await nextSlabItemId();
    const { salesOrderId } = await createSalesOrder(itemId, 1);
    const soItem = await prisma.salesOrderItem.findFirstOrThrow({ where: { salesOrderId } });
    await prisma.salesOrderItem.update({ where: { id: soItem.id }, data: { dueDate: new Date(Date.now() + 2 * 86_400_000) } });
    expect((await salesOrders.detail(salesOrderId)).isDueRisk).toBe(true);
  });

  it('없는 수주 → COM-003', async () => {
    expect(await codeOf(salesOrders.detail(999_999))).toBe('COM-003');
  });
});

describe('수주 취소 (REQ-SO-006, BP-SO-02)', () => {
  it('생산 시작 전 취소: 예약 RELEASED·재고 예약 복구, 계획 CANCELLED, 품목 취소. 다시 취소하면 COM-001', async () => {
    const itemId = await nextSlabItemId();
    await addSlabs(itemId, 6);
    const { salesOrderId } = await createSalesOrder(itemId, 10);

    const result = await salesOrders.cancel(sales, salesOrderId, { reason: '고객 요청' });
    expect(result.cancellation).toMatchObject({ reason: '고객 요청', releasedReservations: [expect.objectContaining({ releasedQty: 6 })], cancelledPlanNos: [expect.any(String)], unlinkedPlanNos: [] });
    expect(await inventoryOf(itemId)).toMatchObject({ onHandQty: 6, reservedQty: 0 });
    expect(await prisma.reservation.findMany({ where: { salesOrderItem: { salesOrderId } } })).toEqual([expect.objectContaining({ reservationStatus: 'RELEASED' })]);
    expect(await prisma.productionPlan.findMany({ where: { salesOrderItem: { salesOrderId } } })).toEqual([expect.objectContaining({ productionPlanStatus: 'CANCELLED' })]);

    const detail = await salesOrders.detail(salesOrderId);
    expect(detail).toMatchObject({ salesOrderStatus: 'CANCELLED', cancelBlock: 'CANCELLED', cancellation: { reason: '고객 요청' } });
    const types = (await eventsOf(salesOrderId)).map((e) => e.businessEventType);
    expect(types.slice(3)).toEqual([BUSINESS_EVENT_TYPE.RESERVATION_RELEASED, BUSINESS_EVENT_TYPE.PRODUCTION_PLAN_CANCELLED, BUSINESS_EVENT_TYPE.SALES_ORDER_CANCELLED]);
    expect(await codeOf(salesOrders.cancel(sales, salesOrderId, { reason: '다시' }))).toBe('COM-001');
  });

  it('연주 진행 중 취소: 계획의 수주 연결을 풀어 여재로 전환', async () => {
    const itemId = await nextSlabItemId();
    const { salesOrderId, items } = await createSalesOrder(itemId, 4);
    await prisma.productionPlan.update({ where: { productionPlanNo: items[0].productionPlanNo ?? '' }, data: { productionPlanStatus: 'IN_PROGRESS' } });

    const result = await salesOrders.cancel(sales, salesOrderId, { reason: '사양 변경' });
    expect(result.cancellation.unlinkedPlanNos).toEqual([items[0].productionPlanNo]);
    expect(await prisma.productionPlan.findUniqueOrThrow({ where: { productionPlanNo: items[0].productionPlanNo ?? '' } })).toMatchObject({ salesOrderItemId: null, productionPlanStatus: 'IN_PROGRESS' });
    expect((await eventsOf(salesOrderId)).map((e) => e.businessEventType)).toContain(BUSINESS_EVENT_TYPE.SURPLUS_CONVERTED);
  });

  it('취소하면 그 계획의 확정 열연 배정을 해제하고 rolling_allocated_qty를 되돌린다', async () => {
    const slabItemId = await nextSlabItemId();
    const [slab] = await addSlabs(slabItemId, 1);
    const orderItemId = await nextSlabItemId();
    const { salesOrderId, items } = await createSalesOrder(orderItemId, 2);
    const plan = await prisma.productionPlan.findUniqueOrThrow({ where: { productionPlanNo: items[0].productionPlanNo ?? '' } });
    // 열연 배정 확정(생산 담당 범위)이 하는 일을 DB에 직접 넣는다
    const allocation = await prisma.allocation.create({ data: { lotId: slab.id, allocationPurpose: 'HOT_ROLLING', productionPlanId: plan.id, allocationStatus: 'CONFIRMED' } });
    await prisma.inventory.update({ where: { itemId: slabItemId }, data: { rollingAllocatedQty: 1 } });

    await salesOrders.cancel(sales, salesOrderId, { reason: '열연 전 취소' });
    expect(await prisma.allocation.findUniqueOrThrow({ where: { id: allocation.id } })).toMatchObject({ allocationStatus: 'RELEASED' });
    expect(await inventoryOf(slabItemId)).toMatchObject({ onHandQty: 1, rollingAllocatedQty: 0 });
    const released = await prisma.businessEvent.findFirstOrThrow({ where: { salesOrderId, businessEventType: BUSINESS_EVENT_TYPE.ALLOCATION_RELEASED }, include: { businessEventLots: true } });
    expect(released.businessEventLots.map((l) => l.lotId)).toEqual([slab.id]);
  });

  it('출고된 매수가 있으면 SO-003, 진행 중 출하요청이 있으면 SO-004', async () => {
    const itemId = await nextSlabItemId();
    await addSlabs(itemId, 4);
    const shipped = await createSalesOrder(itemId, 2);
    const soItem = await prisma.salesOrderItem.findFirstOrThrow({ where: { salesOrderId: shipped.salesOrderId } });
    await prisma.reservation.updateMany({ where: { salesOrderItemId: soItem.id }, data: { reservationStatus: 'CONVERTED' } });
    expect(await codeOf(salesOrders.cancel(sales, shipped.salesOrderId, { reason: '취소' }))).toBe('SO-003');

    const requested = await createSalesOrder(itemId, 2);
    const requestedItem = await prisma.salesOrderItem.findFirstOrThrow({ where: { salesOrderId: requested.salesOrderId } });
    await shipments.create(sales, { customerId: customerA, items: [{ salesOrderItemId: requestedItem.id, requestQty: 1 }] });
    expect(await codeOf(salesOrders.cancel(sales, requested.salesOrderId, { reason: '취소' }))).toBe('SO-004');
  });
});

describe('출하요청 (REQ-SHP-001)', () => {
  it('출하 가능 = 예약 − 다른 출하요청 매수. 넘치면 SHP-002, 다른 고객사 품목은 묶을 수 없다', async () => {
    const itemId = await nextSlabItemId();
    await addSlabs(itemId, 6);
    const { salesOrderId } = await createSalesOrder(itemId, 6);
    const soItem = await prisma.salesOrderItem.findFirstOrThrow({ where: { salesOrderId } });
    const shippableOf = async () => (await shipments.listShippable(customerA)).find((i) => i.salesOrderItemId === soItem.id)?.shippableQty ?? 0;
    expect(await shippableOf()).toBe(6);

    const first = await shipments.create(sales, { customerId: customerA, shipDate: '2026-10-10', items: [{ salesOrderItemId: soItem.id, requestQty: 4 }] });
    expect(first).toMatchObject({ shipmentRequestStatus: 'REQUESTED', shipDate: '2026-10-10', totalRequestQty: 4, items: [expect.objectContaining({ unallocatedQty: 4 })] });
    expect(first.shipmentRequestNo).toMatch(/^DR-\d{4}-\d{4}$/);
    expect(await shippableOf()).toBe(2);
    expect(await codeOf(shipments.create(sales, { customerId: customerA, items: [{ salesOrderItemId: soItem.id, requestQty: 3 }] }))).toBe('SHP-002');
    expect(await codeOf(shipments.create(sales, { customerId: customerB, items: [{ salesOrderItemId: soItem.id, requestQty: 1 }] }))).toBe('COM-004');

    const cancelled = await shipments.cancel(sales, first.id);
    expect(cancelled.shipmentRequestStatus).toBe('CANCELLED');
    expect(await shippableOf()).toBe(6);
    expect(await codeOf(shipments.cancel(sales, first.id))).toBe('COM-001');
  });

  it('출고 확정된 출하요청 취소 → SHP-003', async () => {
    const itemId = await nextSlabItemId();
    await addSlabs(itemId, 1);
    const { salesOrderId } = await createSalesOrder(itemId, 1);
    const soItem = await prisma.salesOrderItem.findFirstOrThrow({ where: { salesOrderId } });
    const request = await shipments.create(sales, { customerId: customerA, items: [{ salesOrderItemId: soItem.id, requestQty: 1 }] });
    await prisma.shipmentRequest.update({ where: { id: request.id }, data: { shipmentRequestStatus: SHIPMENT_REQUEST_STATUS.ISSUED } });
    expect(await codeOf(shipments.cancel(sales, request.id))).toBe('SHP-003');
  });
});

describe('LOT 배정 (REQ-INV-006·009)', () => {
  async function requestFor(itemId: number, qty: number) {
    const { salesOrderId } = await createSalesOrder(itemId, qty);
    const soItem = await prisma.salesOrderItem.findFirstOrThrow({ where: { salesOrderId } });
    const request = await shipments.create(sales, { customerId: customerA, items: [{ salesOrderItemId: soItem.id, requestQty: qty }] });
    return { salesOrderId, request, requestItemId: request.items[0].id };
  }

  it('추천: 생산완료일 오래된 순, 같으면 LOT 번호 순. 저장하지 않고 작업 로그만 남긴다', async () => {
    const itemId = await nextSlabItemId();
    const newer = await addSlabs(itemId, 1, { producedDate: '2026-09-20' });
    const older = await addSlabs(itemId, 2, { producedDate: '2026-09-05' });
    const { salesOrderId, requestItemId } = await requestFor(itemId, 2);

    const before = await prisma.allocation.count();
    const recommendation = await inventory.recommendAllocations(sales, { allocationPurpose: 'SHIPMENT', shipmentRequestItemId: requestItemId });
    expect(recommendation.candidates.map((c) => [c.lotNo, c.isRecommended])).toEqual([
      [older[0].lotNo, true],
      [older[1].lotNo, true],
      [newer[0].lotNo, false],
    ]);
    expect(await prisma.allocation.count()).toBe(before);
    const event = await prisma.businessEvent.findFirstOrThrow({ where: { salesOrderId, businessEventType: BUSINESS_EVENT_TYPE.ALLOCATION_RECOMMENDED }, include: { businessEventLots: true } });
    expect(event.businessEventLots.map((l) => l.lotId).sort()).toEqual([older[0].id, older[1].id].sort());
  });

  it('확정 → 모두 배정되면 배정 확정, 해제하면 배정 대기, 변경은 한 번에', async () => {
    const itemId = await nextSlabItemId();
    const lots = await addSlabs(itemId, 3);
    const { request, requestItemId } = await requestFor(itemId, 2);

    await inventory.confirmAllocations(sales, { allocationPurpose: 'SHIPMENT', shipmentRequestItemId: requestItemId, lotIds: [lots[0].id] });
    expect((await shipments.findOne(sales, request.id)).shipmentRequestStatus).toBe('REQUESTED');
    const [second] = await inventory.confirmAllocations(sales, { allocationPurpose: 'SHIPMENT', shipmentRequestItemId: requestItemId, lotIds: [lots[1].id] });
    const allocated = await shipments.findOne(sales, request.id);
    expect(allocated).toMatchObject({ shipmentRequestStatus: 'ALLOCATED', items: [expect.objectContaining({ unallocatedQty: 0 })] });
    expect(allocated.items[0].allocations).toHaveLength(2);
    expect(await codeOf(inventory.confirmAllocations(sales, { allocationPurpose: 'SHIPMENT', shipmentRequestItemId: requestItemId, lotIds: [lots[2].id] }))).toBe('INV-001');

    const changed = await inventory.releaseAllocation(sales, second.id, { newLotId: lots[2].id, reason: '야드 위치' });
    expect(changed).toMatchObject({ lotId: lots[2].id, allocationStatus: 'CONFIRMED' });
    expect(await prisma.allocation.findUniqueOrThrow({ where: { id: second.id } })).toMatchObject({ allocationStatus: 'RELEASED' });
    expect((await shipments.findOne(sales, request.id)).shipmentRequestStatus).toBe('ALLOCATED');

    await inventory.releaseAllocation(sales, changed.id, {});
    expect((await shipments.findOne(sales, request.id)).shipmentRequestStatus).toBe('REQUESTED');

    const consumed = await prisma.allocation.findFirstOrThrow({ where: { lotId: lots[0].id, allocationStatus: 'CONFIRMED' } });
    await prisma.allocation.update({ where: { id: consumed.id }, data: { allocationStatus: 'CONSUMED' } });
    expect(await codeOf(inventory.releaseAllocation(sales, consumed.id, {}))).toBe('INV-004');
  });

  it('미합격 히트의 슬래브는 INV-002, 다른 요청에 배정된 LOT은 INV-003', async () => {
    const itemId = await nextSlabItemId();
    const good = await addSlabs(itemId, 2);
    const failed = await addSlabs(itemId, 1, { heatResult: INSPECTION_RESULT.FAIL });
    const a = await requestFor(itemId, 1);
    const b = await requestFor(itemId, 1);

    expect(await codeOf(inventory.confirmAllocations(sales, { allocationPurpose: 'SHIPMENT', shipmentRequestItemId: a.requestItemId, lotIds: [failed[0].id] }))).toBe('INV-002');
    await inventory.confirmAllocations(sales, { allocationPurpose: 'SHIPMENT', shipmentRequestItemId: a.requestItemId, lotIds: [good[0].id] });
    expect(await codeOf(inventory.confirmAllocations(sales, { allocationPurpose: 'SHIPMENT', shipmentRequestItemId: b.requestItemId, lotIds: [good[0].id] }))).toBe('INV-003');
  });

  it('같은 LOT을 두 출하요청에 동시에 확정하면 하나만 성공한다 (부분 unique)', async () => {
    const itemId = await nextSlabItemId();
    const lots = await addSlabs(itemId, 2);
    const a = await requestFor(itemId, 1);
    const b = await requestFor(itemId, 1);

    const results = await Promise.allSettled([
      inventory.confirmAllocations(sales, { allocationPurpose: 'SHIPMENT', shipmentRequestItemId: a.requestItemId, lotIds: [lots[0].id] }),
      inventory.confirmAllocations(sales, { allocationPurpose: 'SHIPMENT', shipmentRequestItemId: b.requestItemId, lotIds: [lots[0].id] }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    // 전역 필터가 allocation_confirmed_lot_key 위반을 INV-003으로 바꾼다
    expect(JSON.stringify((rejected?.reason as { meta?: unknown }).meta ?? (rejected?.reason as AppException).code)).toMatch(/allocation_confirmed_lot_key|INV-003/);
    expect(await prisma.allocation.count({ where: { lotId: lots[0].id, allocationStatus: 'CONFIRMED' } })).toBe(1);
  });

  it('물류는 출하 배정을 확정할 수 없다 (COM-002), 출하요청 취소는 확정 배정을 해제한다', async () => {
    const itemId = await nextSlabItemId();
    const lots = await addSlabs(itemId, 1);
    const { request, requestItemId } = await requestFor(itemId, 1);
    expect(await codeOf(inventory.confirmAllocations(logistics, { allocationPurpose: 'SHIPMENT', shipmentRequestItemId: requestItemId, lotIds: [lots[0].id] }))).toBe('COM-002');

    await inventory.confirmAllocations(sales, { allocationPurpose: 'SHIPMENT', shipmentRequestItemId: requestItemId, lotIds: [lots[0].id] });
    await shipments.cancel(sales, request.id);
    expect(await prisma.allocation.findFirstOrThrow({ where: { lotId: lots[0].id } })).toMatchObject({ allocationStatus: 'RELEASED' });
    expect(await shipments.findOne(logistics, request.id)).toMatchObject({ shipmentRequestStatus: 'CANCELLED' });
  });
});

describe('대시보드 위젯 (REQ-DSH-001)', () => {
  it('제품 재고: 합격 재고·예약·가용 매수와 톤', async () => {
    const itemId = await nextSlabItemId();
    await addSlabs(itemId, 3);
    await createSalesOrder(itemId, 1);
    const widget = await dashboard.productStock();
    const row = widget.items.find((r) => r.itemId === itemId);
    const item = await prisma.item.findUniqueOrThrow({ where: { id: itemId } });
    expect(row).toMatchObject({ onHandQty: 3, reservedQty: 1, rollingAllocatedQty: 0, availableQty: 2, availableTon: calcWeightTon(2, item.theoreticalWeightTon?.toFixed(3) ?? '0') });
    expect(widget.totals.map((t) => t.itemType)).toEqual(['SLAB', 'COIL']);
  });

  it('수주 충족 현황: 납기 위험(3일 이하·미출하)을 서버가 계산하고, 취소 수주는 빠진다', async () => {
    const itemId = await nextSlabItemId();
    const risky = await createSalesOrder(itemId, 2);
    const soItem = await prisma.salesOrderItem.findFirstOrThrow({ where: { salesOrderId: risky.salesOrderId } });
    await prisma.salesOrderItem.update({ where: { id: soItem.id }, data: { dueDate: new Date(Date.now() + 86_400_000) } });
    const cancelled = await createSalesOrder(itemId, 1);
    await salesOrders.cancel(sales, cancelled.salesOrderId, { reason: '테스트' });

    const widget = await dashboard.orderFulfillment(sales);
    expect(widget.deliveryRiskDays).toBe(3);
    const row = widget.salesOrders.find((s) => s.salesOrderId === risky.salesOrderId);
    expect(row).toMatchObject({ isDueRisk: true, items: [expect.objectContaining({ isDueRisk: true, daysToDue: expect.any(Number) })] });
    expect(row?.items[0].daysToDue).toBeLessThanOrEqual(3);
    expect(widget.salesOrders.some((s) => s.salesOrderId === cancelled.salesOrderId)).toBe(false);
    const dueDates = widget.salesOrders.map((s) => s.earliestDueDate ?? '9999-12-31');
    expect(dueDates).toEqual([...dueDates].sort());
  });

  it('공정 흐름 현황: 권한이 없는 단계는 null, 재고 단계는 모두 본다', async () => {
    const full = await dashboard.processFlow(sales);
    expect(full.salesOrders?.openCount).toBeGreaterThan(0);
    expect(full.shipmentRequests).not.toBeNull();
    expect(full.inventories.slabAvailableQty).toBeGreaterThan(0);

    const noSales: AuthUser = { ...sales, permissions: {} };
    const limited = await dashboard.processFlow(noSales);
    expect(limited).toMatchObject({ salesOrders: null, productionPlans: null, inspections: null, shipmentRequests: null, goodsIssues: null });
    expect(await codeOf(dashboard.orderFulfillment(noSales))).toBe('COM-002');
  });
});
