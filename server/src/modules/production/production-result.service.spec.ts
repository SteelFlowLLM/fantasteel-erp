// 작업 실적(제선 → 제강 → 연주)을 실제 DB(fs_prod)로 확인한다 (REQ-PRD-003, REQ-LOT-001~004, BP-PRD-02).
// 같은 DB를 쓰는 다른 테스트의 원료·용선과 섞이지 않게 입고일·작업일을 2020-01로 두고 고로·전로 코드는 BF9·BOF9를 쓴다.
import { Test, type TestingModule } from '@nestjs/testing';
import { BUSINESS_EVENT_TYPE, type AuthUser } from '@fantasteel/shared';
import { AppModule } from '../../app.module';
import { AuthUserService } from '../../common/auth/auth-user.service';
import { AppException } from '../../common/errors/app.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { SalesOrderService } from '../sales-order/sales-order.service';
import { ProductionResultService } from './production-result.service';
import { ProductionService } from './production.service';

let moduleRef: TestingModule;
let prisma: PrismaService;
let results: ProductionResultService;
let production: ProductionService;
let salesOrders: SalesOrderService;
let sales: AuthUser;
let producer: AuthUser;
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

/** 원료 입고 fixture: 구매요청 → 발주 → 입고 → 원료 LOT (purchasing 입고 API 대신 직접 만든다) */
async function receive(itemCode: string, ton: string, receivedDate: string) {
  seq += 1;
  const item = await prisma.item.findUniqueOrThrow({ where: { itemCode } });
  const supplier = await prisma.supplier.findFirstOrThrow({ orderBy: { id: 'asc' } });
  const pr = await prisma.purchaseRequisition.create({
    data: { purchaseRequisitionNo: `PR-PT-${seq}`, itemId: item.id, requestedTon: ton, desiredReceiptDate: new Date(`${receivedDate}T00:00:00Z`), requesterId: producer.employeeId, purchaseRequisitionStatus: 'ORDERED' },
  });
  const po = await prisma.purchaseOrder.create({ data: { purchaseOrderNo: `PO-PT-${seq}`, supplierId: supplier.id } });
  const poi = await prisma.purchaseOrderItem.create({ data: { purchaseOrderId: po.id, purchaseRequisitionId: pr.id, itemId: item.id, orderedTon: ton } });
  const gr = await prisma.goodsReceipt.create({ data: { goodsReceiptNo: `GR-PT-${seq}`, purchaseOrderItemId: poi.id, receivedTon: ton, receivedDate: new Date(`${receivedDate}T00:00:00Z`) } });
  return prisma.lot.create({ data: { lotNo: `RM-PT-${itemCode}-${seq}`, lotType: 'RAW_MATERIAL', itemId: item.id, goodsReceiptId: gr.id, yardId: item.defaultYardId, initialTon: ton, remainingTon: ton } });
}

async function planFor(itemCode: string, orderedQty: number) {
  const item = await prisma.item.findUniqueOrThrow({ where: { itemCode } });
  const customer = await prisma.customer.findFirstOrThrow({ orderBy: { id: 'asc' } });
  const result = await salesOrders.create(sales, { customerId: customer.id, items: [{ itemId: item.id, orderedQty, dueDate: '2026-12-31' }] });
  return prisma.productionPlan.findUniqueOrThrow({ where: { productionPlanNo: result.items[0].productionPlanNo ?? '' } });
}

const lotOf = (id: number) => prisma.lot.findUniqueOrThrow({ where: { id } });
const at = (hhmm: string) => `2020-01-03T${hhmm}:00.000Z`;

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  await moduleRef.init();
  prisma = moduleRef.get(PrismaService);
  results = moduleRef.get(ProductionResultService);
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
}, 60_000);

afterAll(async () => {
  await moduleRef?.close();
});

describe('14.1 슬래브 4매: 제선 → 제강 → 연주', () => {
  let planId: number;
  let ore1: number;
  let ore2: number;
  let smn: number;
  let hotMetalId: number;
  let heatId: number;

  beforeAll(async () => {
    planId = (await planFor('SL-SS275-250x1200x10000', 4)).id;
    ore1 = (await receive('ORE01', '300.000', '2020-01-01')).id;
    ore2 = (await receive('ORE01', '300.000', '2020-01-02')).id;
    await receive('COL01', '200.000', '2020-01-01');
    await receive('LIM01', '50.000', '2020-01-01');
    smn = (await receive('SMN01', '10.000', '2020-01-01')).id;
  });

  it('제선: 원료별 용선량 × 원단위를 입고일 순으로 차감하고 용선 LOT·기간 기반 관계를 만든다. 계획은 진행중', async () => {
    const view = await results.register(producer, {
      processType: 'IRONMAKING',
      productionPlanId: planId,
      blastFurnaceCode: 'BF9',
      startedAt: at('00:00'),
      completedAt: at('04:00'),
      hotMetalTon: '277.778',
    });
    expect(view).toMatchObject({ processType: 'IRONMAKING', productionPlanId: null, blastFurnaceCode: 'BF9', completedAt: at('04:00'), operatorName: '강민석' });
    expect(view.outputs).toEqual([expect.objectContaining({ lotType: 'HOT_METAL', lotNo: 'HM-BF9-200103-01', initialTon: '277.778' })]);
    hotMetalId = view.outputs[0].lotId;
    // 철광석 277.778 × 1.6 = 444.445t: 첫 LOT 300t 소진, 둘째 LOT에서 144.445t
    expect(await lotOf(ore1)).toMatchObject({ lotStatus: 'CONSUMED' });
    expect((await lotOf(ore1)).remainingTon?.toFixed(3)).toBe('0.000');
    expect((await lotOf(ore2)).remainingTon?.toFixed(3)).toBe('155.555');
    const relations = await prisma.lotRelation.findMany({ where: { childLotId: hotMetalId }, orderBy: { parentLotId: 'asc' } });
    expect(relations).toHaveLength(4);
    expect(relations.every((r) => r.lotRelationEvidence === 'PERIOD_BASED' && r.inputStartedAt?.toISOString() === at('00:00') && r.inputEndedAt?.toISOString() === at('04:00'))).toBe(true);
    expect(view.inputTon).toBe('652.779'); // 444.445 + 166.667 + 41.667
    expect((await prisma.productionPlan.findUniqueOrThrow({ where: { id: planId } })).productionPlanStatus).toBe('IN_PROGRESS');
    const events = await prisma.businessEvent.findMany({ where: { targetType: 'production_result', targetId: view.id }, orderBy: { id: 'asc' } });
    expect(events.map((e) => e.businessEventType)).toEqual([BUSINESS_EVENT_TYPE.PRODUCTION_STARTED, BUSINESS_EVENT_TYPE.PRODUCTION_RESULT_REGISTERED]);
    expect(events[1].salesOrderId).not.toBeNull();
  });

  it('원료가 모자라면 INV-001이고 아무것도 바꾸지 않는다', async () => {
    const before = (await lotOf(ore2)).remainingTon?.toFixed(3);
    expect(await codeOf(results.register(producer, { processType: 'IRONMAKING', blastFurnaceCode: 'BF8', startedAt: at('04:00'), completedAt: at('05:00'), hotMetalTon: '1000' }))).toBe('INV-001');
    expect((await lotOf(ore2)).remainingTon?.toFixed(3)).toBe(before);
    expect(await prisma.productionResult.count({ where: { blastFurnaceCode: 'BF8' } })).toBe(0);
  });

  it('제강: 작업 시작 → 완료. 히트 톤 = 용선 × 제강 수율, 합금철 = 히트 톤 × kg/t ÷ 1,000, 용선→히트·합금철→히트 실제 투입', async () => {
    const started = await results.register(producer, { processType: 'STEELMAKING', productionPlanId: planId, converterCode: 'BOF9', startedAt: at('05:00') });
    expect(started.completedAt).toBeNull();
    expect(await codeOf(results.register(producer, { processType: 'STEELMAKING', productionPlanId: planId, converterCode: 'BOF9', startedAt: at('05:10') }))).toBe('COM-001');
    expect(await codeOf(results.complete(producer, started.id, { completedAt: at('04:59'), inputHotMetalTon: '277.778' }))).toBe('COM-004');

    const done = await results.complete(producer, started.id, { completedAt: at('06:00'), inputHotMetalTon: '277.778' });
    expect(done.outputs).toEqual([expect.objectContaining({ lotType: 'HEAT', lotNo: 'HT-BOF9-200103-001', initialTon: '250.000' })]);
    heatId = done.outputs[0].lotId;
    expect(await lotOf(hotMetalId)).toMatchObject({ lotStatus: 'CONSUMED' });
    // SS275 합금철 10 kg/t → 250 × 10 ÷ 1,000 = 2.500t
    expect((await lotOf(smn)).remainingTon?.toFixed(3)).toBe('7.500');
    const relations = await prisma.lotRelation.findMany({ where: { childLotId: heatId } });
    expect(relations.map((r) => [r.parentLotId, r.lotRelationEvidence, r.inputTon?.toFixed(3)]).sort()).toEqual([
      [hotMetalId, 'ACTUAL_INPUT', '277.778'],
      [smn, 'ACTUAL_INPUT', '2.500'],
    ].sort());
    expect(await codeOf(results.register(producer, { processType: 'STEELMAKING', productionPlanId: planId, converterCode: 'BOF9', startedAt: at('06:00'), completedAt: at('07:00'), inputHotMetalTon: '10' }))).toBe('COM-001');
  });

  it('입력 기준값: 연주 전 히트와 최대 슬래브 매수', async () => {
    const context = await results.workContext(planId);
    expect(context).toMatchObject({ heatCount: 1, heatsToMakeQty: 0, hotMetalTonPerHeat: '277.778', slabTheoreticalWeightTon: '23.550', lastBlastFurnaceCode: expect.any(String) });
    expect(context.uncastHeats).toEqual([expect.objectContaining({ lotId: heatId, heatTon: '250.000', maxSlabQty: 10 })]);
  });

  it('연주: 최대 매수를 넘으면 COM-004, 10매면 슬래브 HT-…-01~10과 히트→슬래브 관계, 히트 소진, 계획 완료', async () => {
    const started = await results.register(producer, { processType: 'CONTINUOUS_CASTING', productionPlanId: planId, heatLotId: heatId, startedAt: at('07:00') });
    expect(started.startedHeatLotId).toBe(heatId);
    expect(await codeOf(results.complete(producer, started.id, { completedAt: at('09:00'), slabQty: 11 }))).toBe('COM-004');
    const done = await results.complete(producer, started.id, { completedAt: at('09:00'), slabQty: 10 });
    expect(done.outputQty).toBe(10);
    expect(done.outputTon).toBe('235.500');
    expect(done.outputs.map((o) => o.lotNo)).toEqual(Array.from({ length: 10 }, (_, i) => `HT-BOF9-200103-001-${String(i + 1).padStart(2, '0')}`));
    const slab = await lotOf(done.outputs[0].lotId);
    expect(slab).toMatchObject({ lotType: 'SLAB', lotStatus: 'AVAILABLE' });
    expect(slab.producedDate?.toISOString().slice(0, 10)).toBe('2020-01-03');
    expect(await lotOf(heatId)).toMatchObject({ lotStatus: 'CONSUMED' });
    expect(await prisma.lotRelation.count({ where: { parentLotId: heatId } })).toBe(10);

    const detail = await production.getPlanDetail(planId);
    expect(detail).toMatchObject({ productionPlanStatus: 'COMPLETED', canCancel: false });
    expect(detail.progress).toMatchObject({ madeHeatQty: 1, castHeatQty: 1, slabQty: 10, pendingQty: 10, openWorkCount: 0 });
    expect(detail.results.map((r) => r.processType)).toEqual(['STEELMAKING', 'CONTINUOUS_CASTING']);
    // 완료 계획이라도 판정 대기 슬래브가 남아 재생산이 필요하다고 보지 않는다
    expect(detail.reproduction).toMatchObject({ openPlanRemainingQty: 4, additionalPlanQty: 0 });
    expect(await codeOf(results.register(producer, { processType: 'CONTINUOUS_CASTING', productionPlanId: planId, heatLotId: heatId, startedAt: at('10:00') }))).toBe('COM-001');
  });

  it('목록: 계획·공정으로 거른다', async () => {
    const page = await results.listResults({ productionPlanId: planId });
    expect(page.items.map((r) => r.processType)).toEqual(['CONTINUOUS_CASTING', 'STEELMAKING']);
    const casting = await results.listResults({ productionPlanId: planId, processType: 'CONTINUOUS_CASTING' });
    expect(casting.total).toBe(1);
  });
});

describe('작업 실적 입력 오류', () => {
  it('계획 없는 제강 → COM-004, 고로 코드 없는 제선 → COM-004, 없는 계획 → COM-003, 다른 계획의 히트 → COM-004', async () => {
    expect(await codeOf(results.register(producer, { processType: 'STEELMAKING', converterCode: 'BOF9', startedAt: at('11:00') }))).toBe('COM-004');
    expect(await codeOf(results.register(producer, { processType: 'IRONMAKING', startedAt: at('11:00') }))).toBe('COM-004');
    expect(await codeOf(results.register(producer, { processType: 'STEELMAKING', productionPlanId: 999_999, converterCode: 'BOF9', startedAt: at('11:00') }))).toBe('COM-003');
    const other = await planFor('SL-SS275-250x1500x10000', 1);
    const heat = await prisma.lot.findFirstOrThrow({ where: { lotType: 'HEAT', lotNo: 'HT-BOF9-200103-001' } });
    expect(await codeOf(results.register(producer, { processType: 'CONTINUOUS_CASTING', productionPlanId: other.id, heatLotId: heat.id, startedAt: at('11:00') }))).toBe('COM-004');
  });

  it('같은 고로에 작업 중인 제선이 있으면 새로 시작할 수 없다 (COM-001)', async () => {
    const first = await results.register(producer, { processType: 'IRONMAKING', blastFurnaceCode: 'BF7', startedAt: at('12:00') });
    expect(await codeOf(results.register(producer, { processType: 'IRONMAKING', blastFurnaceCode: 'BF7', startedAt: at('12:30') }))).toBe('COM-001');
    expect(await codeOf(results.complete(producer, first.id, { completedAt: at('13:00') }))).toBe('COM-004');
  });

  it('슬래브 계획에는 열연 공정이 없다 (COM-004)', async () => {
    const plan = await planFor('SL-SS275-250x1500x10000', 1);
    expect(await codeOf(results.register(producer, { processType: 'HOT_ROLLING', productionPlanId: plan.id, startedAt: at('11:00') }))).toBe('COM-004');
  });
});
