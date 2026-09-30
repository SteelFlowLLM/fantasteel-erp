// @nestjs/common·websockets는 ESM 전용이라 플래그 없는 jest에서는 대체품을 쓴다 (purchasing/testing/nest-common.shim.ts)
jest.mock('@nestjs/common', () => require('../purchasing/testing/nest-common.shim'));
jest.mock('../../common/realtime/realtime.gateway', () => ({ employeeChannel: (id: number) => `employee:${id}`, RealtimeGateway: class {} }));

import type { AuthUser } from '@fantasteel/shared';
import { authOf, closeTestContext, createDepartment, createEmployee, createTestContext, kstDate, type TestContext } from '../purchasing/testing/test-context';

/**
 * MRP (REQ-PRD-005, 업무 프로세스 정의서 4.4). 기대값은 시드 기준정보로 손으로 계산했다.
 *   히트 용량 250t, 제강 수율 0.95, 연주 수율 0.96
 *   원단위: 철광석 1.6 · 석탄 0.75 · 석회석 0.25 (t/용선 t), FeMn SS275 6 · SM355 12, FeSi SS275 2.5 · SM355 4 (kg/용강 t)
 *   SS275 슬래브 250×1200×10000 = 23.550t/매, 4매 → 94.2t ÷ 0.96 = 98.125t → 히트 1개(250t)
 *   필요 용선 = 250 ÷ 0.95 = 263.158t
 *
 * MRP는 "진행 중인 생산계획 전체"를 보므로, 시작할 때 DB에 있던 진행 계획·원료 재고·입고예정을 잠시 치워 두고 끝나면 되돌린다.
 */
describe('MRP 계산', () => {
  let ctx: TestContext;
  let user: AuthUser;
  let rm: Record<'IO' | 'CL' | 'LS' | 'FM' | 'FS', number>;
  let seq = 0;

  // 되돌릴 것
  let parkedPlans: { id: number; productionPlanStatus: string }[] = [];
  let parkedLotIds: number[] = [];
  let parkedOrderItems: { id: number; receivedTon: string }[] = [];
  // 테스트가 만든 것
  let planIds: number[] = [];
  let lotIds: number[] = [];
  let purchaseOrderIds: number[] = [];
  let requisitionIds: number[] = [];

  beforeAll(async () => {
    ctx = await createTestContext();
    const department = await createDepartment(ctx);
    user = await createEmployee(ctx, department.id);
    const rows = await ctx.prisma.rawMaterial.findMany({ where: { materialCode: { in: ['IO', 'CL', 'LS', 'FM', 'FS'] } } });
    rm = Object.fromEntries(rows.map((r) => [r.materialCode, r.id])) as typeof rm;
    const realIds = Object.values(rm);

    parkedPlans = await ctx.prisma.productionPlan.findMany({ where: { productionPlanStatus: { in: ['PLANNED', 'CONFIRMED', 'IN_PROGRESS'] } }, select: { id: true, productionPlanStatus: true } });
    await ctx.prisma.productionPlan.updateMany({ where: { id: { in: parkedPlans.map((p) => p.id) } }, data: { productionPlanStatus: 'CANCELLED' } });

    const lots = await ctx.prisma.lot.findMany({
      where: { lotStatus: 'IN_STOCK', OR: [{ lotType: 'HOT_METAL' }, { lotType: 'RAW_MATERIAL', rawMaterialId: { in: realIds } }] },
      select: { id: true },
    });
    parkedLotIds = lots.map((l) => l.id);
    await ctx.prisma.lot.updateMany({ where: { id: { in: parkedLotIds } }, data: { lotStatus: 'CONSUMED' } });

    const orderItems = await ctx.prisma.purchaseOrderItem.findMany({
      where: { rawMaterialId: { in: realIds }, purchaseOrder: { purchaseOrderStatus: { in: ['CONFIRMED', 'PARTIALLY_RECEIVED'] } } },
    });
    parkedOrderItems = orderItems.filter((i) => i.receivedTon.lt(i.orderedTon)).map((i) => ({ id: i.id, receivedTon: i.receivedTon.toFixed(3) }));
    for (const i of orderItems) await ctx.prisma.purchaseOrderItem.update({ where: { id: i.id }, data: { receivedTon: i.orderedTon } });
  });

  afterEach(async () => {
    await ctx.prisma.productionPlan.updateMany({ where: { id: { in: planIds } }, data: { productionPlanStatus: 'CANCELLED' } });
    await ctx.prisma.lot.updateMany({ where: { id: { in: lotIds } }, data: { lotStatus: 'CONSUMED', remainingTon: 0 } });
    await ctx.prisma.purchaseOrder.updateMany({ where: { id: { in: purchaseOrderIds } }, data: { purchaseOrderStatus: 'RECEIVED' } });
    await ctx.prisma.purchaseRequisition.updateMany({ where: { id: { in: requisitionIds } }, data: { purchaseRequisitionStatus: 'REJECTED', rejectReason: '시험 데이터' } });
    planIds = [];
    lotIds = [];
    purchaseOrderIds = [];
    requisitionIds = [];
  });

  afterAll(async () => {
    for (const p of parkedPlans) await ctx.prisma.productionPlan.update({ where: { id: p.id }, data: { productionPlanStatus: p.productionPlanStatus } });
    await ctx.prisma.lot.updateMany({ where: { id: { in: parkedLotIds } }, data: { lotStatus: 'IN_STOCK' } });
    for (const i of parkedOrderItems) await ctx.prisma.purchaseOrderItem.update({ where: { id: i.id }, data: { receivedTon: i.receivedTon } });
    await closeTestContext(ctx);
  });

  // ───────────── 시험 데이터 ─────────────

  /** 수주 1건 + 품목 1개 + 그 부족분 생산계획 */
  async function plan(
    specCode: string, shortageQty: number, dueInDays: number,
    extra: { productionPlanStatus?: string; heatCount?: number; surplusUseQty?: number; producedHeats?: number } = {},
  ) {
    const n = ++seq;
    const spec = await ctx.prisma.productSpec.findUniqueOrThrow({ where: { specCode } });
    const customer = await ctx.prisma.customer.findFirstOrThrow();
    const salesOrder = await ctx.prisma.salesOrder.create({
      data: {
        salesOrderNo: `T-SO-${ctx.tag}-${n}`, customerId: customer.id, dueDate: new Date(`${kstDate(dueInDays)}T00:00:00.000Z`), ownerEmployeeId: user.employeeId,
        items: { create: [{ lineNo: 1, productSpecId: spec.id, orderedQty: shortageQty }] },
      },
      include: { items: true },
    });
    const row = await ctx.prisma.productionPlan.create({
      data: {
        productionPlanNo: `T-PP-${ctx.tag}-${n}`, salesOrderItemId: salesOrder.items[0].id, productSpecId: spec.id, steelGradeId: spec.steelGradeId,
        shortageQty, surplusUseQty: extra.surplusUseQty ?? 0, heatCount: extra.heatCount ?? 0, productionPlanStatus: extra.productionPlanStatus ?? 'PLANNED',
      },
    });
    planIds.push(row.id);
    for (let i = 0; i < (extra.producedHeats ?? 0); i++) {
      const heat = await ctx.prisma.lot.create({ data: { lotNo: `T-HT-${ctx.tag}-${n}-${i}`, lotType: 'HEAT', steelGradeId: spec.steelGradeId, initialTon: 250, productionPlanId: row.id } });
      lotIds.push(heat.id);
    }
    return { ...row, salesOrder };
  }

  async function rawLot(rawMaterialId: number, ton: string) {
    const lot = await ctx.prisma.lot.create({ data: { lotNo: `T-RM-${ctx.tag}-${++seq}`, lotType: 'RAW_MATERIAL', rawMaterialId, initialTon: ton, remainingTon: ton } });
    lotIds.push(lot.id);
  }

  async function hotMetalLot(ton: string) {
    const lot = await ctx.prisma.lot.create({ data: { lotNo: `T-HM-${ctx.tag}-${++seq}`, lotType: 'HOT_METAL', initialTon: ton, remainingTon: ton, blastFurnaceNo: '1' } });
    lotIds.push(lot.id);
  }

  /** 확정 발주 1건 (품목 1개). 입고예정 = orderedTon − receivedTon */
  async function purchaseOrder(rawMaterialId: number, orderedTon: string, receivedTon: string) {
    const supplier = await ctx.prisma.supplier.findFirstOrThrow();
    const po = await ctx.prisma.purchaseOrder.create({
      data: {
        purchaseOrderNo: `T-PO-${ctx.tag}-${++seq}`, supplierId: supplier.id, purchaseOrderStatus: receivedTon === '0' ? 'CONFIRMED' : 'PARTIALLY_RECEIVED', confirmedAt: new Date(),
        items: { create: [{ lineNo: 1, rawMaterialId, orderedTon, receivedTon }] },
      },
    });
    purchaseOrderIds.push(po.id);
    return po;
  }

  /** 계산 결과를 `원료코드 → 톤(소수 3자리)`로 */
  async function calculate() {
    const calc = await ctx.mrp.calculate(ctx.prisma);
    const codeOf = new Map(Object.entries(rm).map(([code, id]) => [id, code]));
    const pick = (field: 'requiredTon' | 'remainingTon' | 'scheduledReceiptTon' | 'netRequiredTon') =>
      Object.fromEntries(calc.requirements.filter((r) => codeOf.has(r.rawMaterialId)).map((r) => [codeOf.get(r.rawMaterialId), r[field].toFixed(3)]));
    return { calc, gross: pick('requiredTon'), remaining: pick('remainingTon'), scheduled: pick('scheduledReceiptTon'), net: pick('netRequiredTon') };
  }

  // ───────────── 테스트 ─────────────

  it('진행 중인 생산계획이 없으면 소요가 0이다', async () => {
    const { calc, gross } = await calculate();
    expect(calc.heatCount).toBe(0);
    expect(calc.hotMetalTon.toFixed(3)).toBe('0.000');
    expect(gross).toEqual({ IO: '0.000', CL: '0.000', LS: '0.000' });
  });

  it('SS275 슬래브 4매(히트 1개): 용선 263.158t, 원료는 용선 × 원단위, 합금철은 히트 톤 × kg/t ÷ 1,000', async () => {
    const p = await plan('SL-SS275-250x1200x10000', 4, 20);
    const { calc, gross, net } = await calculate();

    expect(calc.heatCount).toBe(1);
    expect(calc.heatTon.toFixed(3)).toBe('250.000');
    expect(calc.requiredHotMetalTon.toFixed(3)).toBe('263.158'); // 250 ÷ 0.95
    expect(calc.hotMetalTon.toFixed(3)).toBe('263.158');
    expect(gross).toEqual({
      IO: '421.053', // 263.158 × 1.6  = 421.0528
      CL: '197.369', // 263.158 × 0.75 = 197.3685
      LS: '65.790', //  263.158 × 0.25 = 65.7895
      FM: '1.500', //   250 × 6 ÷ 1000 (제강 수율을 다시 적용하지 않는다)
      FS: '0.625', //   250 × 2.5 ÷ 1000
    });
    // 재고·입고예정이 없으므로 순소요 = 총소요
    expect(net).toEqual(gross);
    expect(calc.requirements.every((r) => r.requiredDate?.toISOString().slice(0, 10) === kstDate(20))).toBe(true);
    expect(calc.plans).toHaveLength(1);
    expect(calc.plans[0]).toMatchObject({ productionPlanId: p.id, heatCount: 1, salesOrderNo: p.salesOrder.salesOrderNo, steelGradeCode: 'SS275' });
  });

  it('순소요 = max(0, 총소요 − 원료 LOT 잔량 − 입고예정), 용선 재고는 용선 소요에서 한 번 뺀다', async () => {
    await plan('SL-SS275-250x1200x10000', 4, 20);
    await hotMetalLot('63.158'); //            새로 만들 용선 = 263.158 − 63.158 = 200.000
    await rawLot(rm.IO, '250');
    await rawLot(rm.CL, '120');
    await rawLot(rm.CL, '80'); //              석탄 LOT 2개 합계 200 > 소요 150
    await rawLot(rm.FM, '0.4');
    await purchaseOrder(rm.IO, '50', '30'); // 입고예정 20
    await purchaseOrder(rm.FM, '1', '0'); //   입고예정 1

    const { calc, gross, remaining, scheduled, net } = await calculate();
    expect(calc.requiredHotMetalTon.toFixed(3)).toBe('263.158');
    expect(calc.hotMetalRemainingTon.toFixed(3)).toBe('63.158');
    expect(calc.hotMetalTon.toFixed(3)).toBe('200.000');
    expect(gross).toEqual({ IO: '320.000', CL: '150.000', LS: '50.000', FM: '1.500', FS: '0.625' });
    expect(remaining).toEqual({ IO: '250.000', CL: '200.000', LS: '0.000', FM: '0.400', FS: '0.000' });
    expect(scheduled).toEqual({ IO: '20.000', CL: '0.000', LS: '0.000', FM: '1.000', FS: '0.000' });
    expect(net).toEqual({
      IO: '50.000', // 320 − 250 − 20
      CL: '0.000', //  150 − 200 → 0 (음수가 되지 않는다)
      LS: '50.000',
      FM: '0.100', //  1.5 − 0.4 − 1
      FS: '0.625',
    });
  });

  it('계획이 여러 개여도 같은 재고·입고예정을 계획마다 다시 빼지 않는다', async () => {
    const early = await plan('SL-SM355-250x1500x10000', 4, 9); //  29.438t × 4 = 117.752 ÷ 0.96 = 122.658t → 히트 1개
    await plan('SL-SS275-250x1200x10000', 4, 20);
    await rawLot(rm.IO, '250');
    await purchaseOrder(rm.IO, '50', '30');

    const { calc, gross, net } = await calculate();
    expect(calc.heatCount).toBe(2);
    expect(calc.heatTon.toFixed(3)).toBe('500.000');
    expect(calc.requiredHotMetalTon.toFixed(3)).toBe('526.316'); // 500 ÷ 0.95
    expect(gross).toEqual({
      IO: '842.106', // 526.316 × 1.6
      CL: '394.737', // 526.316 × 0.75
      LS: '131.579', // 526.316 × 0.25
      FM: '4.500', //   250 × 6 ÷ 1000 + 250 × 12 ÷ 1000
      FS: '1.625', //   250 × 2.5 ÷ 1000 + 250 × 4 ÷ 1000
    });
    // 재고 250 + 입고예정 20을 한 번만 뺀다. 계획마다 빼면 (421.053 − 270) × 2 = 302.106이 되어 버린다.
    expect(net.IO).toBe('572.106');
    // 필요일 = 기여하는 수주 납기 중 가장 이른 날
    const io = calc.requirements.find((r) => r.rawMaterialId === rm.IO);
    expect(io?.requiredDate?.toISOString().slice(0, 10)).toBe(kstDate(9));
    expect(early.salesOrder.dueDate.toISOString().slice(0, 10)).toBe(kstDate(9));
    // 계획별 기여분의 합 = 총소요 (용선 재고가 없을 때)
    const ioShares = calc.plans.map((p) => p.requirements.find((r) => r.rawMaterialId === rm.IO)?.requiredTon.toFixed(3));
    expect(ioShares).toEqual(['421.053', '421.053']);
  });

  it('편성 확정된 계획은 아직 만들지 않은 히트만, 여재로 채우는 매수는 빼고 계산한다', async () => {
    await plan('SL-SS275-250x1200x10000', 30, 15, { productionPlanStatus: 'IN_PROGRESS', heatCount: 3, producedHeats: 2 }); // 남은 히트 1개
    await plan('SL-SS275-250x1200x10000', 10, 15, { productionPlanStatus: 'IN_PROGRESS', heatCount: 1, producedHeats: 1 }); // 다 만들었다 → 0
    await plan('SL-SS275-250x1200x10000', 4, 15, { surplusUseQty: 4 }); //                                                     전부 여재로 → 0
    // 코일 22.975t: 열연 수율 22.975 ÷ 23.550 = 0.9756, 누적 0.96 × 0.9756 = 0.9366. (11 − 여재 1) × 22.975 ÷ 0.9366 = 245.302t → 히트 1개
    // 여재를 빼지 않으면 11 × 22.975 ÷ 0.9366 = 269.832t → 히트 2개가 된다.
    await plan('CL-SS275-4.5x1200x542000', 11, 15, { surplusUseQty: 1 });

    const { calc, gross } = await calculate();
    expect(calc.plans.map((p) => p.heatCount)).toEqual([1, 1]);
    expect(calc.heatTon.toFixed(3)).toBe('500.000');
    expect(gross.FM).toBe('3.000'); // 500 × 6 ÷ 1000
    expect(gross.IO).toBe('842.106');
  });

  it('실행하면 mrp_run·mrp_requirement·작업 로그가 남고, 계획별 기여와 구매요청·발주로 덮인 양을 알려 준다', async () => {
    const p = await plan('SL-SS275-250x1200x10000', 4, 20);
    await rawLot(rm.IO, '250');
    const po = await purchaseOrder(rm.IO, '50', '30');

    const run = await ctx.mrp.run(user);
    expect(run.mrpRunNo).toMatch(/^MRP-\d{8}-\d{4}$/);
    expect(run.heatCount).toBe(1);
    expect(run.hotMetalTon.toFixed(3)).toBe('263.158');
    expect(run.requiredHotMetalTon).toBe('263.158');
    expect(run.plans.map((x) => x.productionPlanId)).toEqual([p.id]);

    const io = run.requirements.find((r) => r.rawMaterial.id === rm.IO)!;
    expect([io.requiredTon, io.remainingTon, io.scheduledReceiptTon, io.netRequiredTon].map((t) => t.toFixed(3))).toEqual(['421.053', '250.000', '20.000', '151.053']);
    expect(io.contributions).toEqual([expect.objectContaining({ productionPlanId: p.id, heatCount: 1, requiredTon: '421.053' })]);
    expect(io.coverage.openPurchaseOrders).toEqual([expect.objectContaining({ purchaseOrderId: po.id })]);
    expect(io.coverage.openRequisitions).toEqual([]);
    expect(io.coverage.uncoveredTon.toFixed(3)).toBe('151.053');
    expect(io.coverage.isCovered).toBe(false);

    const stored = await ctx.prisma.mrpRequirement.findMany({ where: { mrpRunId: run.id } });
    expect(stored).toHaveLength(5);
    const event = await ctx.prisma.businessEvent.findFirstOrThrow({ where: { eventType: 'MRP_RUN', targetType: 'MRP_RUN', targetId: run.id } });
    expect(event.actorEmployeeId).toBe(user.employeeId);
    // MRP는 구매요청을 자동으로 만들지 않는다 (P2)
    expect(await ctx.prisma.purchaseRequisitionItem.count({ where: { rawMaterialId: rm.IO, purchaseRequisition: { requesterId: user.employeeId } } })).toBe(0);

    // MRP 뒤에 구매요청을 올리면 같은 실행을 다시 조회했을 때 덮인 것으로 보인다 (중복 요청 방지)
    const requisition = await ctx.requisitions.create({ items: [{ rawMaterialId: rm.IO, requiredTon: '151.053' }], desiredReceiptDate: kstDate(10), sourceType: 'MRP' }, await authOf(ctx, user.employeeId));
    requisitionIds.push(requisition.id);
    const again = await ctx.mrp.detail(run.id);
    const ioAgain = again.requirements.find((r) => r.rawMaterial.id === rm.IO)!;
    expect(ioAgain.netRequiredTon.toFixed(3)).toBe('151.053');
    expect(ioAgain.coverage.openRequisitions).toEqual([expect.objectContaining({ purchaseRequisitionId: requisition.id, purchaseRequisitionStatus: 'DRAFT' })]);
    expect(ioAgain.coverage.openRequisitionTon.toFixed(3)).toBe('151.053');
    expect(ioAgain.coverage.uncoveredTon.toFixed(3)).toBe('0.000');
    expect(ioAgain.coverage.isCovered).toBe(true);

    expect((await ctx.mrp.latest())?.id).toBe(run.id);
    expect((await ctx.mrp.list())[0]).toMatchObject({ id: run.id, shortageCount: 5 });
  });
});
