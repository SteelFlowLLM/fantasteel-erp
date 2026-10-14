// 업무 프로세스 14.2 P1 코일·혼합 흐름을 실제 DB(fs_sales)로 끝까지 잇는다. 단계별 세부 규칙은 열연·재고·품질 테스트가 확인한다.
// 코일·슬래브 혼합 수주 → 품목별 생산계획 → 실적 시뮬레이션 → 검사·자동 예약 → 같은 슬래브를 두고 출하 배정과 열연 배정이 겹치는 경우
// → 열연(슬래브 1매 → 코일 1개) → 코일 검사·자동 예약 → 출고·밀시트 → LOT 역추적.
// 다른 테스트 파일과 같은 DB를 쓰므로 이 테스트 전용 슬래브·코일 규격과 매핑, 원료 입고를 직접 만든다.
import { Test, type TestingModule } from '@nestjs/testing';
import { calcTheoreticalWeightTon, calcWeightTon, type AuthUser } from '@fantasteel/shared';
import { AppModule } from '../../app.module';
import { AuthUserService } from '../../common/auth/auth-user.service';
import { AppException } from '../../common/errors/app.exception';
import { seoulToday } from '../../common/time/seoul-date';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { LotService } from '../lot/lot.service';
import { HotRollingService } from '../production/hot-rolling.service';
import { ProductionSimulationService } from '../production/production-simulation.service';
import { ProductionService } from '../production/production.service';
import { isItemApplicable } from '../quality/inspection-judge';
import { QualityService } from '../quality/quality.service';
import { ShipmentService } from '../shipment/shipment.service';
import { SalesOrderService } from './sales-order.service';

let moduleRef: TestingModule;
let prisma: PrismaService;
const users: Record<'sales' | 'production' | 'quality' | 'logistics' | 'purchase', AuthUser> = {} as never;

async function receiveRawMaterial(itemCode: string, ton: string, seq: number) {
  const item = await prisma.item.findUniqueOrThrow({ where: { itemCode } });
  const supplier = await prisma.supplier.findFirstOrThrow({ orderBy: { id: 'asc' } });
  const date = new Date(`${seoulToday()}T00:00:00Z`);
  const pr = await prisma.purchaseRequisition.create({ data: { purchaseRequisitionNo: `PR-CFLOW-${seq}`, itemId: item.id, requestedTon: ton, desiredReceiptDate: date, requesterId: users.purchase.employeeId, purchaseRequisitionStatus: 'ORDERED' } });
  const po = await prisma.purchaseOrder.create({ data: { purchaseOrderNo: `PO-CFLOW-${seq}`, supplierId: supplier.id } });
  const poi = await prisma.purchaseOrderItem.create({ data: { purchaseOrderId: po.id, purchaseRequisitionId: pr.id, itemId: item.id, orderedTon: ton } });
  const gr = await prisma.goodsReceipt.create({ data: { goodsReceiptNo: `GR-CFLOW-${seq}`, purchaseOrderItemId: poi.id, receivedTon: ton, receivedDate: date } });
  await prisma.lot.create({ data: { lotNo: `RM-CFLOW-${itemCode}-${seq}`, lotType: 'RAW_MATERIAL', itemId: item.id, goodsReceiptId: gr.id, yardId: item.defaultYardId, initialTon: ton, remainingTon: ton } });
}

/** 기준 범위 가운데 값(상·하한 중 하나만 있으면 그 안쪽)으로 적용 항목을 모두 채워 합격시킨다 */
async function inspect(lotId: number, processType: string, steelGradeId: number) {
  const lot = await prisma.lot.findUniqueOrThrow({ where: { id: lotId }, include: { item: true } });
  const standard = await prisma.inspectionStandard.findFirstOrThrow({ where: { processType, steelGradeId }, orderBy: { versionNo: 'desc' }, include: { inspectionStandardItems: true } });
  const inside = (min: Prisma.Decimal | null, max: Prisma.Decimal | null) =>
    min && max ? min.add(max).div(2) : max ? max.div(2) : min ? min.add(1) : new Prisma.Decimal(1);
  const values = standard.inspectionStandardItems
    .filter((i) => isItemApplicable(i, lot.item?.thicknessMm ?? null))
    .map((i) => ({ inspectionStandardItemId: i.id, measuredValue: inside(i.minValue, i.maxValue).toFixed(4) }));
  return moduleRef.get(QualityService).registerQualityInspection({ lotId, values }, users.quality);
}

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  await moduleRef.init();
  prisma = moduleRef.get(PrismaService);
  const authUsers = moduleRef.get(AuthUserService);
  const load = async (employeeNo: string) => {
    const employee = await prisma.employee.findUniqueOrThrow({ where: { employeeNo } });
    const user = await authUsers.load(employee.id);
    if (!user) throw new Error(employeeNo);
    return user;
  };
  Object.assign(users, { sales: await load('2103003'), production: await load('1401006'), quality: await load('2205013'), logistics: await load('2304015'), purchase: await load('2207005') });
  // 히트 2개분 원료 (히트 1개: 철광석 444.445 · 석탄 166.667 · 석회석 41.667 t, 합금철 SS275 2.5 t)
  for (const [index, [code, ton]] of ([['ORE01', '1000'], ['COL01', '400'], ['LIM01', '100'], ['SMN01', '10']] as const).entries()) await receiveRawMaterial(code, ton, index + 1);
}, 60_000);

afterAll(async () => {
  await moduleRef?.close();
});

describe('14.2 P1 코일·슬래브 혼합 수주 흐름 (핵심)', () => {
  it('혼합 수주부터 열연·코일 자동 예약·출고·추적까지 이어지고, 같은 슬래브를 출하와 열연에 동시에 배정할 수 없다', async () => {
    const base = await prisma.item.findUniqueOrThrow({ where: { itemCode: 'SL-SS275-250x1200x10000' } });
    const steelGradeId = base.steelGradeId ?? 0;
    const slab = await prisma.item.create({
      data: { itemCode: 'SL-CFLOW', itemName: '코일 흐름 슬래브', itemType: 'SLAB', unitType: 'QTY', steelGradeId, thicknessMm: '250', widthMm: '1200', lengthMm: '9980', theoreticalWeightTon: calcTheoreticalWeightTon('250', '1200', '9980'), defaultYardId: base.defaultYardId },
    });
    const coilWeightTon = calcTheoreticalWeightTon('4.5', '1200', '544000');
    const coil = await prisma.item.create({
      data: { itemCode: 'CL-CFLOW', itemName: '코일 흐름 코일', itemType: 'COIL', unitType: 'QTY', steelGradeId, thicknessMm: '4.5', widthMm: '1200', lengthMm: '544000', theoreticalWeightTon: coilWeightTon, defaultYardId: base.defaultYardId },
    });
    await prisma.specMapping.create({ data: { slabItemId: slab.id, coilItemId: coil.id } });
    const customerId = (await prisma.customer.findFirstOrThrow({ orderBy: { id: 'asc' } })).id;
    const salesOrders = moduleRef.get(SalesOrderService);
    const production = moduleRef.get(ProductionService);
    const simulation = moduleRef.get(ProductionSimulationService);
    const inventory = moduleRef.get(InventoryService);
    const shipments = moduleRef.get(ShipmentService);
    const stockOf = async (itemId: number) => (await inventory.productStock(prisma)).find((r) => r.itemId === itemId);

    // 1. 혼합 수주: 품목마다 부족분만 계획. 코일 계획은 매핑된 슬래브로 히트를 잡고 열연 수율을 곱한다
    const order = await salesOrders.create(users.sales, {
      customerId,
      items: [
        { itemId: coil.id, orderedQty: 2, dueDate: '2026-12-31' },
        { itemId: slab.id, orderedQty: 3, dueDate: '2026-12-31' },
      ],
    });
    const [coilLine, slabLine] = order.items;
    expect([coilLine, slabLine]).toMatchObject([{ reservedQty: 0, shortageQty: 2 }, { reservedQty: 0, shortageQty: 3 }]);
    const planOf = async (productionPlanNo: string | null) => production.getPlanDetail((await prisma.productionPlan.findUniqueOrThrow({ where: { productionPlanNo: productionPlanNo ?? '' } })).id);
    const coilPlan = await planOf(coilLine.productionPlanNo);
    const slabPlan = await planOf(slabLine.productionPlanNo);
    expect(coilPlan.formation).toMatchObject({ shortageQty: 2, slabItemId: slab.id, heatCount: 1 });
    expect(coilPlan.formation?.hotRollingYieldRate).not.toBeNull();
    expect(slabPlan.formation).toMatchObject({ shortageQty: 3, slabItemId: slab.id, hotRollingYieldRate: null, heatCount: 1 });

    // 2. 실적 시뮬레이션: 슬래브 계획은 연주까지, 코일 계획은 슬래브가 검사 전이라 열연을 건너뛴다
    const slabRun = await simulation.simulate(users.production, slabPlan.id, { randomSeed: 20261014 });
    expect(slabRun.steps.map((s) => s.processType)).toEqual(['IRONMAKING', 'STEELMAKING', 'CONTINUOUS_CASTING']);
    const coilRun = await simulation.simulate(users.production, coilPlan.id, { randomSeed: 20261015 });
    expect(coilRun.steps.map((s) => s.processType)).toEqual(['IRONMAKING', 'STEELMAKING', 'CONTINUOUS_CASTING']);
    expect(coilRun.skippedRolling).not.toBeNull();
    const lotsOf = (productionPlanId: number, lotType: string) => prisma.lot.findMany({ where: { lotType, productionResult: { productionPlanId } }, orderBy: { lotNo: 'asc' } });

    // 3. 검사 합격: 슬래브 계획분은 슬래브 품목에 3매 예약, 코일 계획의 슬래브는 코일 품목에 예약하지 않는다
    for (const planId of [slabPlan.id, coilPlan.id]) {
      for (const lot of await lotsOf(planId, 'SLAB')) await inspect(lot.id, 'CONTINUOUS_CASTING', steelGradeId);
      for (const lot of await lotsOf(planId, 'HEAT')) await inspect(lot.id, 'STEELMAKING', steelGradeId);
    }
    const reservedOf = async () => (await salesOrders.detail(order.salesOrderId)).items.map((i) => i.activeReservedQty);
    expect(await reservedOf()).toEqual([0, 3]);
    const castQty = (await lotsOf(slabPlan.id, 'SLAB')).length + (await lotsOf(coilPlan.id, 'SLAB')).length;
    expect(await stockOf(slab.id)).toMatchObject({ onHandQty: castQty, reservedQty: 3, rollingAllocatedQty: 0 });

    // 4. 같은 슬래브를 출하 배정과 열연 배정에 동시에 확정하면 하나만 성공한다 (REQ-INV-009, 판매 예약 비침범)
    const slabRequest = await shipments.create(users.sales, { customerId, items: [{ salesOrderItemId: slabLine.salesOrderItemId, requestQty: 3 }] });
    const shipmentRequestItemId = slabRequest.items[0].id;
    const [contested] = await lotsOf(coilPlan.id, 'SLAB');
    const hotRolling = moduleRef.get(HotRollingService);
    const race = await Promise.allSettled([
      hotRolling.confirm(users.production, coilPlan.id, { lotIds: [contested.id] }),
      inventory.confirmAllocations(users.sales, { allocationPurpose: 'SHIPMENT', shipmentRequestItemId, lotIds: [contested.id] }),
    ]);
    expect(race.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    // 진 쪽은 잠금 뒤 재검증(INV-003)이나 부분 unique 위반(전역 필터가 INV-003으로 바꾼다)으로 막힌다. 어느 쪽이 지는지는 매번 다르다
    const [lost] = race.flatMap((r) => (r.status === 'rejected' ? [r.reason as unknown] : []));
    expect(lost instanceof AppException ? lost.code : JSON.stringify((lost as { meta?: unknown }).meta)).toMatch(/INV-003|allocation_confirmed_lot_key/);
    expect(await prisma.allocation.count({ where: { lotId: contested.id, allocationStatus: 'CONFIRMED' } })).toBe(1);
    const rollingWon = race[0].status === 'fulfilled';
    expect(await stockOf(slab.id)).toMatchObject({ reservedQty: 3, rollingAllocatedQty: rollingWon ? 1 : 0 });

    // 5. 열연: 필요한 2매만 배정해 슬래브 1매 → 코일 1개, 코일 계획 완료
    const rolled = await simulation.simulate(users.production, coilPlan.id, { randomSeed: 20261016 });
    expect(rolled.steps.map((s) => s.processType)).toEqual(['HOT_ROLLING']);
    expect(rolled.productionPlanStatus).toBe('COMPLETED');
    const coils = await lotsOf(coilPlan.id, 'COIL');
    expect(coils).toHaveLength(2);
    expect(coils.every((c) => c.itemId === coil.id)).toBe(true);
    expect(await stockOf(slab.id)).toMatchObject({ onHandQty: castQty - 2, reservedQty: 3, rollingAllocatedQty: 0 });

    // 6. 코일 검사 합격 → 원래 수주의 코일 품목에 자동 예약, 코일 톤은 코일 규격 이론중량으로 계산
    for (const lot of coils) await inspect(lot.id, 'HOT_ROLLING', steelGradeId);
    expect(await reservedOf()).toEqual([2, 3]);
    expect(await stockOf(coil.id)).toMatchObject({ onHandQty: 2, reservedQty: 2, onHandTon: calcWeightTon(2, coilWeightTon) });

    // 7. 남은 슬래브 배정·코일 출하요청 배정 → 출고 확정, 두 품목 모두 출하 완료. 코일 밀시트는 열연한 슬래브의 히트
    //    (열연 추천은 계획과 관계없이 생산완료일 FIFO라 슬래브 계획이 먼저 만든 슬래브를 쓸 수 있다)
    const allocateRecommended = async (itemId: number) => {
      const recommendation = await inventory.recommendAllocations(users.sales, { allocationPurpose: 'SHIPMENT', shipmentRequestItemId: itemId });
      const lotIds = recommendation.candidates.filter((c) => c.isRecommended).map((c) => c.lotId);
      await inventory.confirmAllocations(users.sales, { allocationPurpose: 'SHIPMENT', shipmentRequestItemId: itemId, lotIds });
    };
    await allocateRecommended(shipmentRequestItemId);
    const coilRequest = await shipments.create(users.sales, { customerId, items: [{ salesOrderItemId: coilLine.salesOrderItemId, requestQty: 2 }] });
    await allocateRecommended(coilRequest.items[0].id);
    for (const request of [slabRequest, coilRequest]) expect((await shipments.issue(users.logistics, request.id)).shipmentRequestStatus).toBe('ISSUED');
    const detail = await salesOrders.detail(order.salesOrderId);
    expect(detail.salesOrderStatus).toBe('SHIPPED');
    expect(detail.items.map((i) => i.shippedQty)).toEqual([2, 3]);
    const sheets = await shipments.listMillSheets({ shipmentRequestId: coilRequest.id, page: 1, size: 20 });
    const sheet = await shipments.findMillSheet(sheets.items[0].id);
    const parentsOf = async (lotIds: number[]) => (await prisma.lotRelation.findMany({ where: { childLotId: { in: lotIds } }, include: { parentLot: true } })).map((r) => r.parentLot);
    const rolledHeats = await parentsOf((await parentsOf(coils.map((c) => c.id))).map((s) => s.id));
    expect(sheet.snapshot.heats.map((h) => h.heatNo).sort()).toEqual([...new Set(rolledHeats.map((h) => h.lotNo))].sort());
    expect(sheet.snapshot.totalQty).toBe(2);

    // 8. 출고한 코일 역추적: 코일 → 슬래브 → 히트 → 용선 → 원료
    const trace = await moduleRef.get(LotService).trace(coils[0].id, 'backward');
    expect(new Set(trace.nodes.map((n) => n.lotType))).toEqual(new Set(['COIL', 'SLAB', 'HEAT', 'HOT_METAL', 'RAW_MATERIAL']));
  }, 60_000);
});
