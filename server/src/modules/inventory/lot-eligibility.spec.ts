// 판정 뒤 재고 반영(onLotsEligibilityChanged)을 실제 DB(fs_sales)로 확인한다 (REQ-INV-003·004·007, quality.md 4장).
// 같은 묶음의 다른 테스트와 재고가 섞이지 않도록 테스트마다 새 슬래브 규격을 만든다.
import { Test, type TestingModule } from '@nestjs/testing';
import {
  BUSINESS_EVENT_TYPE,
  INSPECTION_RESULT,
  LOT_RELATION_EVIDENCE,
  LOT_STATUS,
  PROCESS_TYPE,
  calcTheoreticalWeightTon,
  type InspectionResult,
} from '@fantasteel/shared';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryService } from './inventory.service';

let moduleRef: TestingModule;
let prisma: PrismaService;
let inventory: InventoryService;
let inspectionStandardId: number;
let inspectorId: number;
let customerId: number;
let seq = 0;

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  await moduleRef.init();
  prisma = moduleRef.get(PrismaService);
  inventory = moduleRef.get(InventoryService);
  inspectorId = (await prisma.employee.findUniqueOrThrow({ where: { employeeNo: '2205013' } })).id;
  inspectionStandardId = (await prisma.inspectionStandard.findFirstOrThrow()).id;
  customerId = (await prisma.customer.findFirstOrThrow({ orderBy: { id: 'asc' } })).id;
}, 60_000);

afterAll(async () => {
  await moduleRef?.close();
});

async function newSlabItem(): Promise<number> {
  seq += 1;
  const base = await prisma.item.findFirstOrThrow({ where: { itemType: 'SLAB' }, orderBy: { id: 'asc' } });
  const lengthMm = 20000 + seq;
  const item = await prisma.item.create({
    data: {
      itemCode: `SL-ELIG-${seq}`,
      itemName: `적격 테스트 슬래브 ${seq}`,
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

async function newSalesOrderItem(itemId: number, orderedQty: number) {
  seq += 1;
  const salesOrder = await prisma.salesOrder.create({ data: { salesOrderNo: `T-ELIG-SO-${seq}`, customerId, ownerEmployeeId: inspectorId } });
  return prisma.salesOrderItem.create({ data: { salesOrderId: salesOrder.id, itemId, orderedQty, dueDate: new Date('2026-12-31') } });
}

async function newPlan(itemId: number, salesOrderItemId: number | null) {
  seq += 1;
  return prisma.productionPlan.create({ data: { productionPlanNo: `T-ELIG-PP-${seq}`, salesOrderItemId, itemId, shortageQty: 1, heatCount: 1 } });
}

async function setResult(lotId: number, inspectionResult: InspectionResult) {
  await prisma.qualityInspection.upsert({
    where: { lotId },
    create: { lotId, inspectionStandardId, inspectorEmployeeId: inspectorId, inspectedAt: new Date(), inspectionResult },
    update: { inspectionResult },
  });
}

/** 히트 1개와 하위 슬래브 n매. 판정은 주어진 것만 만들고(null = 검사 없음) 재고는 건드리지 않는다 */
async function addHeat(itemId: number, slabCount: number, options: { heatResult?: InspectionResult | null; slabResult?: InspectionResult | null; planId?: number } = {}) {
  const item = await prisma.item.findUniqueOrThrow({ where: { id: itemId } });
  const now = new Date();
  seq += 1;
  const steelmaking = await prisma.productionResult.create({ data: { processType: PROCESS_TYPE.STEELMAKING, converterCode: 'BOF1', startedAt: now, completedAt: now } });
  const casting = await prisma.productionResult.create({
    data: { processType: PROCESS_TYPE.CONTINUOUS_CASTING, productionPlanId: options.planId ?? null, startedAt: now, completedAt: now },
  });
  const heat = await prisma.lot.create({ data: { lotNo: `T-EL-${seq}`, lotType: 'HEAT', steelGradeId: item.steelGradeId, productionResultId: steelmaking.id } });
  if (options.heatResult) await setResult(heat.id, options.heatResult);
  const slabs = [];
  for (let n = 1; n <= slabCount; n++) {
    const slab = await prisma.lot.create({
      data: { lotNo: `T-EL-${seq}-${String(n).padStart(2, '0')}`, lotType: 'SLAB', itemId, productionResultId: casting.id, producedDate: new Date('2026-09-01T00:00:00.000Z') },
    });
    await prisma.lotRelation.create({ data: { parentLotId: heat.id, childLotId: slab.id, lotRelationEvidence: LOT_RELATION_EVIDENCE.ACTUAL_INPUT } });
    if (options.slabResult) await setResult(slab.id, options.slabResult);
    slabs.push(slab);
  }
  return { heat, slabs };
}

/** 검사 등록·수정이 하듯 판정을 바꾼 뒤 같은 tx에서 재고에 반영한다 */
async function judge(lotId: number, next: InspectionResult, previousResult: InspectionResult | null = null) {
  await setResult(lotId, next);
  await prisma.$transaction((tx) => inventory.onLotsEligibilityChanged(tx, { lotId, previousResult }));
}

const inventoryOf = (itemId: number) => prisma.inventory.findUnique({ where: { itemId } });
const reservationsOf = (salesOrderItemId: number) => prisma.reservation.findMany({ where: { salesOrderItemId }, orderBy: { id: 'asc' } });
const reserve = (salesOrderItemId: number, salesOrderId: number, itemId: number, qty: number) =>
  prisma.$transaction((tx) => inventory.reserveForSalesOrderItem(tx, { salesOrderId, salesOrderItemId, itemId, qty, actor: 'SYSTEM' }));

describe('적격이 됨 → on_hand·자동 예약 (REQ-INV-003·004)', () => {
  it('히트가 합격인 슬래브가 합격하면 재고 행을 만들고 on_hand +1, 원래 수주 품목에 1매 자동 예약(SYSTEM)', async () => {
    const itemId = await newSlabItem();
    const soItem = await newSalesOrderItem(itemId, 2);
    const plan = await newPlan(itemId, soItem.id);
    const { slabs } = await addHeat(itemId, 1, { heatResult: INSPECTION_RESULT.PASS, planId: plan.id });
    expect(await inventoryOf(itemId)).toBeNull();

    await judge(slabs[0].id, INSPECTION_RESULT.PASS);

    expect(await inventoryOf(itemId)).toMatchObject({ onHandQty: 1, reservedQty: 1, rollingAllocatedQty: 0 });
    expect(await reservationsOf(soItem.id)).toEqual([expect.objectContaining({ reservedQty: 1, reservationStatus: 'ACTIVE', itemId })]);
    const event = await prisma.businessEvent.findFirstOrThrow({
      where: { salesOrderId: soItem.salesOrderId, businessEventType: BUSINESS_EVENT_TYPE.RESERVATION_CREATED },
      include: { businessEventLots: true },
    });
    expect(event).toMatchObject({ actorType: 'SYSTEM' });
    expect(event.businessEventLots.map((l) => l.lotId)).toEqual([slabs[0].id]);
  });

  it('히트가 나중에 합격하면 이미 합격한 하위 슬래브가 함께 적격, 미확보를 넘는 매수는 여재로 남는다', async () => {
    const itemId = await newSlabItem();
    const soItem = await newSalesOrderItem(itemId, 2);
    const plan = await newPlan(itemId, soItem.id);
    const { heat } = await addHeat(itemId, 3, { slabResult: INSPECTION_RESULT.PASS, planId: plan.id });

    await judge(heat.id, INSPECTION_RESULT.PASS);

    expect(await inventoryOf(itemId)).toMatchObject({ onHandQty: 3, reservedQty: 2 });
    expect((await reservationsOf(soItem.id)).map((r) => r.reservedQty)).toEqual([1, 1]);
  });

  it('계획이 수주에서 해제됐으면 자동 예약 없이 여재', async () => {
    const itemId = await newSlabItem();
    const plan = await newPlan(itemId, null);
    const { slabs } = await addHeat(itemId, 1, { heatResult: INSPECTION_RESULT.PASS, planId: plan.id });

    await judge(slabs[0].id, INSPECTION_RESULT.PASS);

    expect(await inventoryOf(itemId)).toMatchObject({ onHandQty: 1, reservedQty: 0 });
  });

  it('상위 히트가 미판정(PENDING)이거나 자기 판정이 PENDING이면 적격이 아니다', async () => {
    const itemId = await newSlabItem();
    const { slabs } = await addHeat(itemId, 2, { heatResult: INSPECTION_RESULT.PENDING });

    await judge(slabs[0].id, INSPECTION_RESULT.PASS);
    await judge(slabs[1].id, INSPECTION_RESULT.PENDING);

    expect(await inventoryOf(itemId)).toBeNull();
  });

  it('투입·출고된 LOT은 on_hand를 건드리지 않는다', async () => {
    const itemId = await newSlabItem();
    const { heat, slabs } = await addHeat(itemId, 2, { slabResult: INSPECTION_RESULT.PASS });
    await prisma.lot.update({ where: { id: slabs[1].id }, data: { lotStatus: LOT_STATUS.CONSUMED } });

    await judge(heat.id, INSPECTION_RESULT.PASS);

    expect(await inventoryOf(itemId)).toMatchObject({ onHandQty: 1 });
  });
});

describe('적격에서 빠짐 → 배정 해제·예약 축소·on_hand (REQ-INV-007)', () => {
  it('히트가 PASS에서 FAIL로 바뀌면 하위 슬래브를 빼고, 그 LOT을 만든 계획의 수주 예약부터 줄인다', async () => {
    const itemId = await newSlabItem();
    const soA = await newSalesOrderItem(itemId, 2);
    const planA = await newPlan(itemId, soA.id);
    const first = await addHeat(itemId, 2, { slabResult: INSPECTION_RESULT.PASS, planId: planA.id });
    await judge(first.heat.id, INSPECTION_RESULT.PASS);
    // 다른 히트의 합격 슬래브 1매를 다른 수주 B가 재고 우선 예약한다
    const other = await addHeat(itemId, 1, { slabResult: INSPECTION_RESULT.PASS });
    await judge(other.heat.id, INSPECTION_RESULT.PASS);
    const soB = await newSalesOrderItem(itemId, 1);
    expect(await reserve(soB.id, soB.salesOrderId, itemId, 1)).toBe(1);
    expect(await inventoryOf(itemId)).toMatchObject({ onHandQty: 3, reservedQty: 3 });

    await judge(first.heat.id, INSPECTION_RESULT.FAIL, INSPECTION_RESULT.PASS);

    expect(await inventoryOf(itemId)).toMatchObject({ onHandQty: 1, reservedQty: 1 });
    expect((await reservationsOf(soA.id)).map((r) => r.reservationStatus)).toEqual(['RELEASED', 'RELEASED']);
    expect(await reservationsOf(soB.id)).toEqual([expect.objectContaining({ reservedQty: 1, reservationStatus: 'ACTIVE' })]);
    const released = await prisma.businessEvent.findMany({ where: { salesOrderId: soA.salesOrderId, businessEventType: BUSINESS_EVENT_TYPE.RESERVATION_RELEASED } });
    expect(released).toHaveLength(2);
    expect(released.every((e) => e.actorType === 'SYSTEM' && e.reason?.startsWith('QUALITY_FAILURE'))).toBe(true);
  });

  it('그 LOT의 수주 예약이 없으면 최근 예약부터 줄이고, 일부만 줄이면 ACTIVE·RELEASED로 행을 나눈다', async () => {
    const itemId = await newSlabItem();
    const { slabs } = await addHeat(itemId, 4, { heatResult: INSPECTION_RESULT.PASS });
    for (const slab of slabs) await judge(slab.id, INSPECTION_RESULT.PASS);
    const soOld = await newSalesOrderItem(itemId, 2);
    const soNew = await newSalesOrderItem(itemId, 2);
    await reserve(soOld.id, soOld.salesOrderId, itemId, 2);
    await reserve(soNew.id, soNew.salesOrderId, itemId, 2);

    await judge(slabs[0].id, INSPECTION_RESULT.FAIL, INSPECTION_RESULT.PASS);

    expect(await inventoryOf(itemId)).toMatchObject({ onHandQty: 3, reservedQty: 3 });
    expect(await reservationsOf(soOld.id)).toEqual([expect.objectContaining({ reservedQty: 2, reservationStatus: 'ACTIVE' })]);
    expect((await reservationsOf(soNew.id)).map((r) => [r.reservedQty, r.reservationStatus])).toEqual([
      [1, 'ACTIVE'],
      [1, 'RELEASED'],
    ]);
  });

  it('가용이 남으면 예약은 그대로 두고 on_hand만 줄인다', async () => {
    const itemId = await newSlabItem();
    const { slabs } = await addHeat(itemId, 3, { heatResult: INSPECTION_RESULT.PASS });
    for (const slab of slabs) await judge(slab.id, INSPECTION_RESULT.PASS);
    const so = await newSalesOrderItem(itemId, 1);
    await reserve(so.id, so.salesOrderId, itemId, 1);

    await judge(slabs[2].id, INSPECTION_RESULT.FAIL, INSPECTION_RESULT.PASS);

    expect(await inventoryOf(itemId)).toMatchObject({ onHandQty: 2, reservedQty: 1 });
    expect(await reservationsOf(so.id)).toEqual([expect.objectContaining({ reservedQty: 1, reservationStatus: 'ACTIVE' })]);
  });

  it('열연 배정이 확정된 슬래브가 불합격이면 배정을 해제하고 rolling −1 (SYSTEM, QUALITY_FAILURE)', async () => {
    const itemId = await newSlabItem();
    const { slabs } = await addHeat(itemId, 2, { heatResult: INSPECTION_RESULT.PASS });
    for (const slab of slabs) await judge(slab.id, INSPECTION_RESULT.PASS);
    const coilPlan = await newPlan(itemId, null);
    const allocation = await prisma.allocation.create({
      data: { lotId: slabs[0].id, allocationPurpose: 'HOT_ROLLING', productionPlanId: coilPlan.id, allocationStatus: 'CONFIRMED' },
    });
    await prisma.inventory.update({ where: { itemId }, data: { rollingAllocatedQty: 1 } });

    await judge(slabs[0].id, INSPECTION_RESULT.FAIL, INSPECTION_RESULT.PASS);

    expect(await prisma.allocation.findUniqueOrThrow({ where: { id: allocation.id } })).toMatchObject({ allocationStatus: 'RELEASED' });
    expect(await inventoryOf(itemId)).toMatchObject({ onHandQty: 1, rollingAllocatedQty: 0, reservedQty: 0 });
    const event = await prisma.businessEvent.findFirstOrThrow({ where: { targetType: 'allocation', targetId: allocation.id, businessEventType: BUSINESS_EVENT_TYPE.ALLOCATION_RELEASED } });
    expect(event).toMatchObject({ actorType: 'SYSTEM' });
    expect(event.reason).toMatch(/^QUALITY_FAILURE/);
  });

  it('FAIL에서 PASS로 고치면 다시 적격이 되어 on_hand +1', async () => {
    const itemId = await newSlabItem();
    const { slabs } = await addHeat(itemId, 1, { heatResult: INSPECTION_RESULT.PASS, slabResult: INSPECTION_RESULT.FAIL });

    await judge(slabs[0].id, INSPECTION_RESULT.PASS, INSPECTION_RESULT.FAIL);

    expect(await inventoryOf(itemId)).toMatchObject({ onHandQty: 1 });
  });
});
