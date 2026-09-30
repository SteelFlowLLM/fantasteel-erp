// 생산·품질 통합 테스트. 실제 DB(기본 fs_prod)에 시드가 들어 있어야 한다.
//   DATABASE_URL=postgresql://postgres:postgres@localhost:54322/fs_prod npx jest src/modules/production src/modules/quality
// 테스트마다 자기 수주·계획을 만들고, 재고 수치는 실행 전후 차이로 확인한다 (같은 DB에서 여러 번 돌려도 된다).
// 재고 풀을 함께 쓰므로 DB를 건드리는 테스트는 이 파일 하나에 모아 순서대로 실행한다.
// @nestjs/common·websockets는 ESM 전용이라 플래그 없는 jest에서는 대체품을 쓰고, service는 직접 조립한다 (소켓 발송만 뺀다).
jest.mock('@nestjs/common', () => require('./testing/nest-common.shim'));
jest.mock('../../common/realtime/realtime.gateway', () => ({ employeeChannel: (id: number) => `employee:${id}`, RealtimeGateway: class {} }));

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:54322/fs_prod';

import type { AuthUser } from '@fantasteel/shared';
import { NumberingService } from '../../common/numbering/numbering.service';
import type { RealtimeService } from '../../common/realtime/realtime.service';
import { AppException } from '../../common/errors/app.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessEventRecorder } from '../business-event/business-event.recorder';
import { StockService } from '../inventory/stock.service';
import { NotificationSender } from '../notification/notification.sender';
import { QualityInspectionService } from '../quality/quality-inspection.service';
import { QualityRepository } from '../quality/quality.repository';
import { RejectedLotService } from '../quality/rejected-lot.service';
import { SalesOrderStatusService } from '../sales-order/sales-order-status.service';
import { ProductionMaterialService } from './production-material.service';
import { ProductionPlanProgressService } from './production-plan-progress.service';
import { ProductionPlanService } from './production-plan.service';
import { ProductionPlanWriter } from './production-plan.writer';
import { ProductionResultService } from './production-result.service';
import { ProductionRepository } from './production.repository';
import { ResultSimulationService } from './result-simulation.service';
import { lossQtyOf, sampleLossRate, seededRandom } from './simulation-random';
import { YieldCalculator } from './yield.calculator';

jest.setTimeout(300_000);

const SLAB = 'SL-SS275-250x1200x10000'; // 1매 23.550t (인수 시나리오 14.1)
const COIL = 'CL-SS275-4.5x1200x542000';
// 히트 1개당 원료: 용선 263.158t → 철광석 421.053 / 석탄 197.369 / 석회석 65.790, 합금철 FeMn 1.500 / FeSi 0.625
const RAW_PER_HEAT: Record<string, number> = { IO: 421.053, CL: 197.369, LS: 65.79, FM: 1.5, FS: 0.625 };
const HEATS_TO_PREPARE = 14;

describe('생산·품질 흐름 (실제 DB)', () => {
  let prisma: PrismaService;
  let plans: ProductionPlanService;
  let results: ProductionResultService;
  let simulation: ResultSimulationService;
  let quality: QualityInspectionService;
  let rejected: RejectedLotService;
  let stock: StockService;
  let writer: ProductionPlanWriter;
  let numbering: NumberingService;
  let prod: AuthUser;
  let qc: AuthUser;
  let sales: AuthUser;

  const authUser = async (employeeNo: string): Promise<AuthUser> => {
    const e = await prisma.employee.findUniqueOrThrow({ where: { employeeNo }, include: { department: true, role: true } });
    return { employeeId: e.id, employeeNo, employeeName: e.employeeName, roleCode: e.role.roleCode, departmentId: e.departmentId, departmentName: e.department.departmentName, jobGrade: e.jobGrade, headDepartmentIds: [], permissions: {} };
  };
  const spec = (specCode: string) => prisma.productSpec.findUniqueOrThrow({ where: { specCode } });
  const pool = async (specCode: string) => prisma.inventory.findUniqueOrThrow({ where: { productSpecId: (await spec(specCode)).id } });
  const rawInventory = async (materialCode: string) => {
    const rm = await prisma.rawMaterial.findUniqueOrThrow({ where: { materialCode }, include: { inventories: true } });
    return { rm, onHandTon: rm.inventories[0].onHandTon };
  };

  /** 재고 불변조건: reserved_qty = ACTIVE 예약 합계, on_hand_qty = 재고 풀 LOT 수(적격·미소진·귀속 슬래브 제외). */
  const expectPoolConsistent = async (specCode: string) => {
    const s = await spec(specCode);
    const inv = await prisma.inventory.findUniqueOrThrow({ where: { productSpecId: s.id } });
    const active = await prisma.reservation.aggregate({ where: { productSpecId: s.id, status: 'ACTIVE' }, _sum: { reservedQty: true } });
    const lots = await prisma.lot.findMany({
      where: { productSpecId: s.id, lotStatus: 'IN_STOCK', isPassed: true, heatLot: { isPassed: true } },
      include: { salesOrderItem: { include: { productSpec: { include: { item: true } } } } },
    });
    const inPool = lots.filter((l) => !(l.lotType === 'SLAB' && l.salesOrderItem && l.salesOrderItem.salesOrderItemStatus !== 'CANCELLED' && l.salesOrderItem.productSpec.item.itemType === 'COIL'));
    expect(inv.reservedQty).toBe(active._sum.reservedQty ?? 0);
    expect(inv.onHandQty).toBe(inPool.length);
  };

  /** 수주를 직접 만들고(수주 API는 다른 모듈) 재고를 먼저 예약한 뒤 부족분 생산계획을 만든다. 주문 매수 = 예약 가용 + shortageQty. */
  const createOrderWithShortage = async (specCode: string, shortageQty: number) => {
    const s = await spec(specCode);
    const customer = await prisma.customer.findFirstOrThrow({ orderBy: { id: 'asc' } });
    return prisma.tx(async (tx) => {
      const available = await stock.availableQty(tx, s.id);
      const order = await tx.salesOrder.create({
        data: { salesOrderNo: await numbering.documentNo(tx, 'SO'), customerId: customer.id, dueDate: new Date(Date.now() + 14 * 86_400_000), ownerEmployeeId: sales.employeeId, note: 'jest' },
      });
      const item = await tx.salesOrderItem.create({ data: { salesOrderId: order.id, lineNo: 1, productSpecId: s.id, orderedQty: available + shortageQty } });
      const reservedQty = await stock.reserveForItem(tx, { salesOrderItemId: item.id, maxQty: item.orderedQty, actor: sales });
      const plan = await writer.createForShortage(tx, { salesOrderItemId: item.id, shortageQty: item.orderedQty - reservedQty, actor: sales });
      return { order, item, plan, reservedQty };
    });
  };

  const planResults = (planId: number) => prisma.productionResult.findMany({ where: { productionPlanId: planId }, orderBy: { id: 'asc' } });
  const resultOf = async (planId: number, processCode: string, heatSeq?: number) => {
    const rows = await planResults(planId);
    const row = rows.find((r) => r.processCode === processCode && (heatSeq === undefined || r.heatSeq === heatSeq) && r.productionResultStatus !== 'COMPLETED');
    if (!row) throw new Error(`남은 ${processCode} 실적이 없습니다`);
    return row;
  };
  const run = async (planId: number, processCode: string, body: Parameters<ProductionResultService['complete']>[1], heatSeq?: number) => {
    const row = await resultOf(planId, processCode, heatSeq);
    await results.start(row.id, prod);
    return results.complete(row.id, body, prod);
  };
  const compositionOk = [{ inspectionItemCode: 'C', measuredValue: '0.18' }, { inspectionItemCode: 'Si', measuredValue: '0.3' }, { inspectionItemCode: 'Mn', measuredValue: '1.0' }, { inspectionItemCode: 'P', measuredValue: '0.02' }, { inspectionItemCode: 'S', measuredValue: '0.02' }];
  const slabOk = [{ inspectionItemCode: 'SURFACE_DEFECT_COUNT', measuredValue: '0' }, { inspectionItemCode: 'THICKNESS_DEVIATION', measuredValue: '1' }, { inspectionItemCode: 'WIDTH_DEVIATION', measuredValue: '-2' }, { inspectionItemCode: 'LENGTH_DEVIATION', measuredValue: '10' }];
  const activeReserved = (salesOrderItemId: number) => prisma.tx((tx) => stock.activeReservedQty(tx, salesOrderItemId));

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    const realtime = { changed: () => undefined, toEmployees: () => undefined } as unknown as RealtimeService;
    numbering = new NumberingService();
    const events = new BusinessEventRecorder(realtime);
    const notifications = new NotificationSender(realtime);
    stock = new StockService(events, realtime);
    const salesOrderStatus = new SalesOrderStatusService(realtime);
    writer = new ProductionPlanWriter(numbering, events, notifications, stock, realtime);
    const yields = new YieldCalculator();
    const repo = new ProductionRepository();
    const materials = new ProductionMaterialService(repo, yields, realtime);
    const progress = new ProductionPlanProgressService(repo, events, notifications, salesOrderStatus, realtime);
    plans = new ProductionPlanService(prisma, repo, yields, materials, progress, writer, stock, salesOrderStatus, events, realtime);
    results = new ProductionResultService(prisma, repo, yields, materials, progress, numbering, stock, events, notifications, realtime);
    const qualityRepo = new QualityRepository();
    quality = new QualityInspectionService(prisma, qualityRepo, numbering, stock, progress, events, notifications, realtime);
    rejected = new RejectedLotService(prisma, qualityRepo, events, realtime);
    simulation = new ResultSimulationService(prisma, repo, plans, results, materials, yields, quality, stock, events, realtime);
    prod = await authUser('1803021');
    qc = await authUser('1911030');
    sales = await authUser('2104012');

    // 이 파일의 테스트가 쓸 원료를 넉넉히 넣어 둔다 (입고 모듈 대신 테스트가 직접 원료 LOT을 만든다).
    await prisma.tx(async (tx) => {
      for (const [code, perHeat] of Object.entries(RAW_PER_HEAT)) {
        const { rm, onHandTon } = await rawInventory(code);
        const need = perHeat * HEATS_TO_PREPARE;
        if (onHandTon.gte(need)) continue;
        const ton = (need - Number(onHandTon)).toFixed(3);
        await tx.lot.create({ data: { lotNo: await numbering.rawMaterialLotNo(tx, code), lotType: 'RAW_MATERIAL', rawMaterialId: rm.id, initialTon: ton, remainingTon: ton, yardId: rm.yardId } });
        await stock.adjustRawMaterialTon(tx, rm.id, ton);
      }
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // ───────────────────────────── 히트 편성 ─────────────────────────────

  describe('히트 편성 (인수 시나리오 14.1: SS275 슬래브 23.550t, 부족 4매)', () => {
    let planId: number;

    it('미리보기: 히트 1개, 슬래브 계획 10매, 예상 여재 6매, 필요 투입량·용선·원료 소요', async () => {
      const { plan } = await createOrderWithShortage(SLAB, 4);
      planId = plan.id;
      const p = await plans.heatPreview(plan.id, {});
      // 목표중량 = 4 × 23.550 = 94.200t, 누적 계획수율(용강 기준) = 연주 0.96
      expect(p.targetQty).toBe(4);
      expect(p.targetTon.toFixed(3)).toBe('94.200');
      expect(p.cumulativeYieldRate.toFixed(4)).toBe('0.9600');
      // 필요 투입량 = 94.200 ÷ 0.96 = 98.125t → 히트 수 = ceil(98.125 ÷ 250) = 1
      expect(p.requiredInputTon.toFixed(3)).toBe('98.125');
      expect(p.heatCount).toBe(1);
      expect(p.heatTon.toFixed(3)).toBe('250.000');
      // 필요 용선 = 250 ÷ 0.95 = 263.1578… → 263.158t
      expect(p.hotMetalTon.toFixed(3)).toBe('263.158');
      // 히트당 슬래브 = floor(250 × 0.96 ÷ 23.550) = floor(10.19) = 10매 → 여재 6매
      expect(p.slabQtyPerHeat).toBe(10);
      expect(p.plannedSlabQty).toBe(10);
      expect(p.expectedSurplusQty).toBe(6);
      const required = Object.fromEntries(p.rawMaterials.map((r) => [r.materialCode, r.requiredTon.toFixed(3)]));
      // 철광석 263.158 × 1.6, 석탄 × 0.75, 석회석 × 0.25
      expect(required.IO).toBe('421.053');
      expect(required.CL).toBe('197.369');
      expect(required.LS).toBe('65.790');
      // 합금철 = 히트 톤 × kg/t ÷ 1,000: FeMn 250 × 6 ÷ 1000, FeSi 250 × 2.5 ÷ 1000
      expect(required.FM).toBe('1.500');
      expect(required.FS).toBe('0.625');
      expect(p.hasRawShortage).toBe(false);
      // 미리보기는 저장하지 않는다
      expect((await prisma.productionPlan.findUniqueOrThrow({ where: { id: plan.id } })).productionPlanStatus).toBe('PLANNED');
      expect(await planResults(plan.id)).toHaveLength(0);
    });

    it('확정: 편성 값 저장, 공정별 READY 실적 생성, 시작 전에는 취소할 수 있다', async () => {
      await expect(plans.confirm(planId, { surplusUseQty: 1 }, prod)).rejects.toMatchObject({ code: 'COM-003' }); // 슬래브 계획은 여재 사용 불가
      const d = await plans.confirm(planId, {}, prod);
      expect(d.productionPlanStatus).toBe('CONFIRMED');
      expect(d.heatCount).toBe(1);
      expect(d.plannedSlabQty).toBe(10);
      expect(d.requiredInputTon.toFixed(3)).toBe('98.125');
      expect(d.surplus.expectedQty).toBe(6);
      expect(d.results.map((r) => [r.processCode, r.heatSeq, r.productionResultStatus, r.plannedQty])).toEqual([
        ['IRONMAKING', null, 'READY', null], ['STEELMAKING', 1, 'READY', null], ['CASTING', 1, 'READY', 10],
      ]);
      expect(d.results[0].defaultHotMetalTon?.toFixed(3)).toBe('263.158');
      await expect(plans.confirm(planId, {}, prod)).rejects.toMatchObject({ code: 'COM-005' });
      const cancelled = await plans.cancel(planId, { reason: 'jest' }, prod);
      expect(cancelled.productionPlanStatus).toBe('CANCELLED');
      const events = await prisma.businessEvent.findMany({ where: { targetType: 'PRODUCTION_PLAN', targetId: planId }, orderBy: { id: 'asc' } });
      expect(events.map((e) => e.eventType)).toEqual(['PRODUCTION_PLAN_CREATED', 'PRODUCTION_PLAN_CONFIRMED', 'PRODUCTION_PLAN_CANCELLED']);
    });
  });

  // ───────────────────────────── 수동 실적 ─────────────────────────────

  describe('공정 실적 직접 등록 (슬래브 계획)', () => {
    let planId: number;
    let itemId: number;
    let heatLotId: number;

    it('제선: 원료가 모자라면 어떤 원료가 몇 톤 부족한지 알리고 아무것도 바꾸지 않는다 (잔량 음수 금지)', async () => {
      const created = await createOrderWithShortage(SLAB, 2);
      planId = created.plan.id;
      itemId = created.item.id;
      await plans.confirm(planId, {}, prod);
      const before = await rawInventory('IO');
      const lotsBefore = await prisma.lot.findMany({ where: { lotType: 'RAW_MATERIAL' }, orderBy: { id: 'asc' }, select: { id: true, remainingTon: true } });
      const row = await resultOf(planId, 'IRONMAKING');
      await results.start(row.id, prod);
      const err: AppException = await results.complete(row.id, { blastFurnaceNo: '1', hotMetalTon: '99999999' }, prod).catch((e) => e);
      expect(err).toBeInstanceOf(AppException);
      expect(err.getStatus()).toBe(409);
      expect(err.message).toContain('철광석');
      expect(err.message).toMatch(/철광석 [\d.]+t 부족\(필요 159999998\.400t/);
      expect((await rawInventory('IO')).onHandTon.toFixed(3)).toBe(before.onHandTon.toFixed(3));
      expect(await prisma.lot.findMany({ where: { lotType: 'RAW_MATERIAL' }, orderBy: { id: 'asc' }, select: { id: true, remainingTon: true } })).toEqual(lotsBefore);
      expect(await prisma.lot.count({ where: { productionPlanId: planId } })).toBe(0);
      expect(await prisma.lot.count({ where: { lotType: 'RAW_MATERIAL', remainingTon: { lt: 0 } } })).toBe(0);
    });

    it('제선: 원료 LOT을 FIFO로 차감하고 용선 LOT(HM-고로-YYMMDD-NN)과 기간 기반 계보를 만든다', async () => {
      const before = { IO: await rawInventory('IO'), CL: await rawInventory('CL'), LS: await rawInventory('LS') };
      const row = await resultOf(planId, 'IRONMAKING');
      const done = await results.complete(row.id, { blastFurnaceNo: '1' }, prod); // 앞 테스트에서 이미 시작함. 용선량은 기본값(필요량)
      expect(done.productionResultStatus).toBe('COMPLETED');
      expect(done.outputTon?.toFixed(3)).toBe('263.158');
      expect(done.inputTon?.toFixed(3)).toBe('684.212'); // 421.053 + 197.369 + 65.790
      expect(done.lots).toHaveLength(1);
      expect(done.lots[0].lotNo).toMatch(/^HM-1-\d{6}-\d{2}$/);
      const hotMetal = await prisma.lot.findUniqueOrThrow({ where: { id: done.lots[0].id }, include: { parentRelations: { include: { parentLot: { include: { rawMaterial: true } } } } } });
      expect(hotMetal.remainingTon?.toFixed(3)).toBe('263.158');
      expect(hotMetal.parentRelations.every((r) => r.relationType === 'RAW_TO_HOT_METAL' && r.evidenceType === 'PERIOD' && r.periodStart && r.periodEnd && r.periodStart <= r.periodEnd)).toBe(true);
      const inputByCode = new Map<string, number>();
      for (const r of hotMetal.parentRelations) inputByCode.set(r.parentLot.rawMaterial!.materialCode, (inputByCode.get(r.parentLot.rawMaterial!.materialCode) ?? 0) + Number(r.inputTon));
      expect(inputByCode.get('IO')?.toFixed(3)).toBe('421.053');
      expect(inputByCode.get('CL')?.toFixed(3)).toBe('197.369');
      expect(inputByCode.get('LS')?.toFixed(3)).toBe('65.790');
      expect(before.IO.onHandTon.sub((await rawInventory('IO')).onHandTon).toFixed(3)).toBe('421.053');
      expect(before.CL.onHandTon.sub((await rawInventory('CL')).onHandTon).toFixed(3)).toBe('197.369');
      expect(before.LS.onHandTon.sub((await rawInventory('LS')).onHandTon).toFixed(3)).toBe('65.790');
      // inventory.on_hand_ton = 원료 LOT 잔량 합계
      for (const code of ['IO', 'CL', 'LS']) {
        const { rm, onHandTon } = await rawInventory(code);
        const sum = await prisma.lot.aggregate({ where: { rawMaterialId: rm.id, lotType: 'RAW_MATERIAL' }, _sum: { remainingTon: true } });
        expect(onHandTon.toFixed(3)).toBe(sum._sum.remainingTon?.toFixed(3));
      }
      expect((await prisma.productionPlan.findUniqueOrThrow({ where: { id: planId } })).productionPlanStatus).toBe('IN_PROGRESS');
    });

    it('제강: 용선과 합금철(히트 톤 × kg/t ÷ 1,000)을 차감하고 히트 LOT(HT-전로-YYMMDD-NNN)을 만든다', async () => {
      const before = { FM: await rawInventory('FM'), FS: await rawInventory('FS') };
      const done = await run(planId, 'STEELMAKING', { converterNo: '2' }, 1);
      expect(done.lots[0].lotNo).toMatch(/^HT-2-\d{6}-\d{3}$/);
      heatLotId = done.lots[0].id;
      const heat = await prisma.lot.findUniqueOrThrow({ where: { id: heatLotId }, include: { parentRelations: { include: { parentLot: { include: { rawMaterial: true } } } } } });
      expect(heat.lotType).toBe('HEAT');
      expect(heat.initialTon?.toFixed(3)).toBe('250.000');
      expect(heat.isPassed).toBeNull();
      const hot = heat.parentRelations.filter((r) => r.relationType === 'HOT_METAL_TO_HEAT');
      expect(hot).toHaveLength(1);
      expect(hot[0].evidenceType).toBe('DIRECT');
      expect(hot[0].inputTon?.toFixed(3)).toBe('263.158');
      expect(hot[0].parentLot.remainingTon?.toFixed(3)).toBe('0.000');
      expect(hot[0].parentLot.lotStatus).toBe('CONSUMED');
      const alloy = new Map<string, number>();
      for (const r of heat.parentRelations.filter((x) => x.relationType === 'ALLOY_TO_HEAT')) {
        expect(r.evidenceType).toBe('DIRECT');
        alloy.set(r.parentLot.rawMaterial!.materialCode, (alloy.get(r.parentLot.rawMaterial!.materialCode) ?? 0) + Number(r.inputTon));
      }
      expect(alloy.get('FM')?.toFixed(3)).toBe('1.500'); // 250 × 6 ÷ 1000
      expect(alloy.get('FS')?.toFixed(3)).toBe('0.625'); // 250 × 2.5 ÷ 1000
      expect(before.FM.onHandTon.sub((await rawInventory('FM')).onHandTon).toFixed(3)).toBe('1.500');
      expect(before.FS.onHandTon.sub((await rawInventory('FS')).onHandTon).toFixed(3)).toBe('0.625');
    });

    it('연주: 계획 매수를 넘으면 거부, 슬래브 LOT은 히트번호-SS, 히트는 소진', async () => {
      const row = await resultOf(planId, 'CASTING', 1);
      await results.start(row.id, prod);
      await expect(results.complete(row.id, { outputQty: 11 }, prod)).rejects.toMatchObject({ code: 'COM-003' });
      const done = await results.complete(row.id, { outputQty: 3 }, prod);
      expect(done.plannedQty).toBe(10);
      expect(done.outputQty).toBe(3);
      expect(done.lossQty).toBe(7);
      const heat = await prisma.lot.findUniqueOrThrow({ where: { id: heatLotId } });
      expect(heat.lotStatus).toBe('CONSUMED');
      const slabs = await prisma.lot.findMany({ where: { heatLotId, lotType: 'SLAB' }, orderBy: { lotNo: 'asc' }, include: { parentRelations: true } });
      expect(slabs.map((s) => s.lotNo)).toEqual([`${heat.lotNo}-01`, `${heat.lotNo}-02`, `${heat.lotNo}-03`]);
      expect(slabs.every((s) => s.isPassed === null && s.salesOrderItemId === itemId && s.productionPlanId === planId && s.parentRelations[0].relationType === 'HEAT_TO_SLAB')).toBe(true);
    });

    it('검사: 필수 항목이 비면 거부(판정 없음), 경계값 합격, 같은 LOT 두 번째 검사는 COM-005', async () => {
      const slabs = await prisma.lot.findMany({ where: { heatLotId, lotType: 'SLAB' }, orderBy: { lotNo: 'asc' } });
      const slabPool = await pool(SLAB);
      // 히트 성분: P 누락 → 거부, 아무것도 저장되지 않는다
      await expect(quality.register({ lotId: heatLotId, values: compositionOk.filter((v) => v.inspectionItemCode !== 'P') }, qc)).rejects.toMatchObject({ code: 'COM-003' });
      expect((await prisma.lot.findUniqueOrThrow({ where: { id: heatLotId } })).isPassed).toBeNull();
      expect(await prisma.qualityInspection.count({ where: { lotId: heatLotId } })).toBe(0);
      // 검사 대기 목록: 히트(성분)와, 히트가 아직 미판정인 슬래브도 나온다. 측정할 항목과 기준이 함께 온다
      const waitingHeat = (await quality.list({ status: 'pending', lotId: heatLotId }))[0];
      expect(waitingHeat).toMatchObject({ inspectionResult: 'PENDING', processCode: 'STEELMAKING' });
      expect('items' in waitingHeat && waitingHeat.items.map((i) => [i.inspectionItemCode, i.maxValue?.toString()])).toEqual([['C', '0.25'], ['Si', '0.45'], ['Mn', '1.4'], ['P', '0.04'], ['S', '0.04']]);
      const waitingSlabs = await quality.list({ status: 'pending', processCode: 'CASTING' });
      expect(slabs.every((s) => waitingSlabs.some((w) => w.lot.id === s.id))).toBe(true);
      // 슬래브가 먼저 합격해도 히트가 미판정이면 재고에 들어가지 않는다
      const s1 = await quality.register({ lotId: slabs[0].id, values: slabOk }, qc);
      expect(s1.inspectionResult).toBe('PASS');
      expect((await pool(SLAB)).onHandQty).toBe(slabPool.onHandQty);
      // 히트 성분: C = 0.25 (max 0.25, 경계 포함) → 합격. 이미 합격해 있던 슬래브 1매가 이때 적격이 되어 자동 예약된다
      const h = await quality.register({ lotId: heatLotId, values: compositionOk.map((v) => (v.inspectionItemCode === 'C' ? { ...v, measuredValue: '0.25' } : v)) }, qc);
      expect(h.inspectionResult).toBe('PASS');
      expect(h.values.find((v) => v.inspectionItemCode === 'C')?.maxValue?.toString()).toBe('0.25');
      expect((await pool(SLAB)).onHandQty).toBe(slabPool.onHandQty + 1);
      expect((await pool(SLAB)).reservedQty).toBe(slabPool.reservedQty + 1);
      await expect(quality.register({ lotId: heatLotId, values: compositionOk }, qc)).rejects.toMatchObject({ code: 'COM-005' });
      // 슬래브 2: 표면 결함 3개 (max 2) → 불합격, 재고에 들어가지 않는다
      const s2 = await quality.register({ lotId: slabs[1].id, values: slabOk.map((v) => (v.inspectionItemCode === 'SURFACE_DEFECT_COUNT' ? { ...v, measuredValue: '3' } : v)) }, qc);
      expect(s2.inspectionResult).toBe('FAIL');
      expect((await pool(SLAB)).onHandQty).toBe(slabPool.onHandQty + 1);
      // 슬래브 3: 두께 편차 -5 (min -5, 경계 포함) → 합격, 남은 부족 1매에 자동 예약
      const s3 = await quality.register({ lotId: slabs[2].id, values: slabOk.map((v) => (v.inspectionItemCode === 'THICKNESS_DEVIATION' ? { ...v, measuredValue: '-5' } : v)) }, qc);
      expect(s3.inspectionResult).toBe('PASS');
      expect((await pool(SLAB)).onHandQty).toBe(slabPool.onHandQty + 2);
      expect((await pool(SLAB)).reservedQty).toBe(slabPool.reservedQty + 2);
      await expectPoolConsistent(SLAB);

      const plan = await plans.get(planId);
      expect(plan.productionPlanStatus).toBe('COMPLETED');
      const rows = await rejected.list();
      const bad = rows.find((r) => r.id === slabs[1].id);
      expect(bad?.rejectedBy).toBe('OWN');
      expect(bad?.failedInspection?.failedItems.map((i) => i.inspectionItemCode)).toEqual(['SURFACE_DEFECT_COUNT']);
      const disposed = await rejected.setDisposition(slabs[1].id, { dispositionStatus: 'SCRAPPED', reason: '표면 결함 과다' }, qc);
      expect(disposed.dispositionStatus).toBe('SCRAPPED');
      await expect(rejected.setDisposition(slabs[0].id, { dispositionStatus: 'HOLD', reason: '합격 LOT' }, qc)).rejects.toMatchObject({ code: 'COM-005' });
      const types = (await prisma.businessEvent.findMany({ where: { lotIds: { has: slabs[1].id } }, orderBy: { id: 'asc' } })).map((e) => e.eventType);
      expect(types).toEqual(expect.arrayContaining(['RESULT_REGISTERED', 'INSPECTION_REGISTERED', 'REJECTED_JUDGED', 'DISPOSITION_SET']));
    });
  });

  // ───────────────────────────── 실적 시뮬레이션 ─────────────────────────────

  describe('실적 시뮬레이션', () => {
    it('슬래브 수주: 합격 생산분은 부족 매수만 자동 예약되고 나머지는 재고 풀의 여재가 된다', async () => {
      const { item, plan, reservedQty } = await createOrderWithShortage(SLAB, 4);
      await plans.confirm(plan.id, {}, prod);
      const before = await pool(SLAB);
      expect(before.onHandQty - before.reservedQty).toBe(0); // 가용 재고는 이 수주가 모두 예약했다
      const out = await simulation.simulate(plan.id, { seed: 11 }, prod);

      expect(out.plan.productionPlanStatus).toBe('COMPLETED');
      expect(out.steps.filter((s) => s.kind === 'RESULT').map((s) => s.processCode)).toEqual(['IRONMAKING', 'STEELMAKING', 'CASTING']);
      const casting = out.plan.results.find((r) => r.processCode === 'CASTING')!;
      expect(casting.isSimulated).toBe(true);
      expect(casting.operatorEmployeeId).toBeNull();
      expect(casting.outputQty).toBe(10 - (casting.lossQty ?? 0));
      expect(casting.lossQty).toBe(lossQtyOf(10, out.sampledLossRate!)); // 10매 × 5% 미만 → 0매
      expect(out.plan.lots.slabs).toHaveLength(10);
      expect(out.plan.lots.slabs.every((l) => l.isPassed === true && l.isEligible)).toBe(true);

      const after = await pool(SLAB);
      expect(after.onHandQty).toBe(before.onHandQty + 10);
      expect(after.reservedQty).toBe(before.reservedQty + 4); // 부족 4매만 자동 예약
      expect(after.onHandQty - after.reservedQty).toBe(6); // 나머지 6매는 여재(예약 가용)
      expect(await activeReserved(item.id)).toBe(reservedQty + 4);
      expect(await prisma.tx((tx) => stock.unsecuredQty(tx, item.id))).toBe(0);
      expect(out.plan.surplus.actualQty).toBe(6);
      await expectPoolConsistent(SLAB);

      const auto = await prisma.reservation.findMany({ where: { salesOrderItemId: item.id, isAutoReserved: true, status: 'ACTIVE' } });
      expect(auto.reduce((s, r) => s + r.reservedQty, 0)).toBe(4);
      // 시뮬레이션이 남긴 로그는 SYSTEM 주체 + SIMULATION 사유
      const resultIds = out.plan.results.map((r) => r.id);
      const events = await prisma.businessEvent.findMany({ where: { targetType: 'PRODUCTION_RESULT', targetId: { in: resultIds } } });
      expect(events.length).toBe(9); // 공정 3개 × (시작·완료·실적)
      expect(events.every((e) => e.actorType === 'SYSTEM' && e.reasonCode === 'SIMULATION')).toBe(true);
      // 다시 실행해도 더 할 일이 없다 (완료된 계획)
      await expect(simulation.simulate(plan.id, { seed: 11 }, prod)).rejects.toMatchObject({ code: 'COM-005' });
    });

    it('코일 수주: 필요한 슬래브만 귀속(재고 풀 밖)·열연되고 코일은 자동 예약, 남은 슬래브는 여재', async () => {
      const { item, plan, reservedQty } = await createOrderWithShortage(COIL, 3);
      const preview = await plans.heatPreview(plan.id, {});
      // 열연 계획 수율 = 22.975 ÷ 23.550 = 0.9756, 누적 = 0.96 × 0.9756 = 0.9366, 필요 투입량 = 3 × 22.975 ÷ 0.9366 = 73.5906… → 73.591t
      expect(preview.hotRollingYieldRate.toFixed(4)).toBe('0.9756');
      expect(preview.cumulativeYieldRate.toFixed(4)).toBe('0.9366');
      expect(preview.requiredInputTon.toFixed(3)).toBe('73.591');
      expect(preview.heatCount).toBe(1);
      expect(preview.expectedSurplusQty).toBe(7);
      const confirmed = await plans.confirm(plan.id, {}, prod);
      expect(confirmed.results.map((r) => r.processCode)).toEqual(['IRONMAKING', 'STEELMAKING', 'CASTING', 'HOT_ROLLING']);
      const slabBefore = await pool(SLAB);
      const coilBefore = await pool(COIL);

      // 1) 연주·슬래브 검사까지만
      const upToCasting = await simulation.simulate(plan.id, { seed: 5, untilProcess: 'CASTING' }, prod);
      expect(upToCasting.plan.productionPlanStatus).toBe('IN_PROGRESS');
      expect(upToCasting.plan.lots.slabs).toHaveLength(10);
      expect(upToCasting.plan.earmarkedSlabs).toHaveLength(3); // 필요한 3매만 열연 투입용으로 귀속
      expect(upToCasting.plan.rolling).toMatchObject({ rolledQty: 0, remainingQty: 3, rollingNeedQty: 0, earmarkedSlabQty: 3 });
      const slabMid = await pool(SLAB);
      expect(slabMid.onHandQty).toBe(slabBefore.onHandQty + 7); // 귀속 3매는 재고 풀에 들어가지 않는다
      expect(slabMid.reservedQty).toBe(slabBefore.reservedQty);
      expect(await prisma.lot.count({ where: { productionPlanId: plan.id, lotType: 'SLAB', salesOrderItemId: item.id } })).toBe(3);
      expect(await prisma.lot.count({ where: { productionPlanId: plan.id, lotType: 'SLAB', salesOrderItemId: null } })).toBe(7);
      await expectPoolConsistent(SLAB);

      // 2) 이어서 실행: 끝난 공정은 건너뛰고 배정·열연·코일 검사만 한다
      const rest = await simulation.simulate(plan.id, { seed: 5 }, prod);
      expect(rest.steps.map((s) => s.kind)).toEqual(['ALLOCATION', 'RESULT', 'INSPECTION']);
      expect(rest.plan.productionPlanStatus).toBe('COMPLETED');
      const coils = rest.plan.lots.coils;
      expect(coils).toHaveLength(3);
      const consumed = await prisma.lot.findMany({ where: { productionPlanId: plan.id, lotType: 'SLAB', lotStatus: 'CONSUMED' }, orderBy: { lotNo: 'asc' }, include: { childRelations: { include: { childLot: true } } } });
      expect(consumed).toHaveLength(3);
      for (const slab of consumed) {
        // 코일 번호 = C + 슬래브번호(HT- 제외), 슬래브 1매 → 코일 1개
        expect(slab.lotNo).toMatch(/^HT-1-\d{6}-\d{3}-\d{2}$/);
        expect(slab.childRelations).toHaveLength(1);
        expect(slab.childRelations[0].relationType).toBe('SLAB_TO_COIL');
        expect(slab.childRelations[0].childLot.lotNo).toBe(`C${slab.lotNo.slice(3)}`);
        expect(slab.childRelations[0].childLot.heatLotId).toBe(slab.heatLotId);
        expect(slab.childRelations[0].childLot.salesOrderItemId).toBe(item.id);
      }
      const allocations = await prisma.allocation.findMany({ where: { productionPlanId: plan.id } });
      expect(allocations.map((a) => [a.purpose, a.status])).toEqual([['ROLLING', 'CONSUMED'], ['ROLLING', 'CONSUMED'], ['ROLLING', 'CONSUMED']]);

      const coilAfter = await pool(COIL);
      expect(coilAfter.onHandQty).toBe(coilBefore.onHandQty + 3);
      expect(coilAfter.reservedQty).toBe(coilBefore.reservedQty + 3); // 코일 3개 자동 예약
      expect(await activeReserved(item.id)).toBe(reservedQty + 3);
      const slabAfter = await pool(SLAB);
      expect(slabAfter.onHandQty).toBe(slabBefore.onHandQty + 7); // 여재 슬래브 7매는 재고 풀에 남는다
      expect(slabAfter.reservedQty).toBe(slabBefore.reservedQty);
      expect(rest.plan.surplus).toEqual({ expectedQty: 7, actualQty: 7 });
      expect(rest.plan.results.filter((r) => r.processCode === 'HOT_ROLLING').map((r) => [r.productionResultStatus, r.outputQty, r.lossQty])).toEqual([['COMPLETED', 3, 0]]);
      await expectPoolConsistent(SLAB);
      await expectPoolConsistent(COIL);
    });

    it('코일 계획이 여재만으로 채워지면 히트 0개로 바로 열연한다 (여재는 편성 확정 때 재고 풀에서 빠진다)', async () => {
      const { item, plan } = await createOrderWithShortage(COIL, 2);
      const preview = await plans.heatPreview(plan.id, { surplusUseQty: 2 });
      expect(preview.surplus.availableQty).toBeGreaterThanOrEqual(2); // 앞 테스트가 남긴 여재
      expect(preview.heatCount).toBe(0);
      expect(preview.plannedSlabQty).toBe(0);
      expect(preview.requiredInputTon.toFixed(3)).toBe('0.000');
      expect(preview.rawMaterials.every((r) => r.requiredTon.isZero())).toBe(true);
      const slabBefore = await pool(SLAB);
      await expect(plans.confirm(plan.id, { surplusUseQty: 3 }, prod)).rejects.toMatchObject({ code: 'COM-003' }); // 부족 매수 초과
      const confirmed = await plans.confirm(plan.id, { surplusUseQty: 2 }, prod);
      expect(confirmed.heatCount).toBe(0);
      expect(confirmed.surplusUseQty).toBe(2);
      expect(confirmed.results.map((r) => [r.processCode, r.plannedQty])).toEqual([['HOT_ROLLING', 2]]);
      expect(confirmed.earmarkedSlabs.map((l) => l.lotNo)).toEqual(preview.surplus.lots.slice(0, 2).map((l) => l.lotNo)); // FIFO
      expect((await pool(SLAB)).onHandQty).toBe(slabBefore.onHandQty - 2);
      await expectPoolConsistent(SLAB);

      const out = await simulation.simulate(plan.id, { seed: 3 }, prod);
      expect(out.sampledLossRate).toBeNull(); // 연주를 하지 않았다
      expect(out.steps.map((s) => s.kind)).toEqual(['ALLOCATION', 'RESULT', 'INSPECTION']);
      expect(out.plan.productionPlanStatus).toBe('COMPLETED');
      expect(out.plan.lots.coils).toHaveLength(2);
      expect(await prisma.tx((tx) => stock.unsecuredQty(tx, item.id))).toBe(0);
      expect((await pool(SLAB)).onHandQty).toBe(slabBefore.onHandQty - 2);
      await expectPoolConsistent(SLAB);
      await expectPoolConsistent(COIL);
    });

    it('같은 시드로 새 계획 두 개를 돌리면 연주 손실이 같다', async () => {
      // 30매 계획(히트 3개)에서 손실이 1매 이상 나오는 시드를 고른다: floor(30 × 손실률) ≥ 1 ↔ 손실률 ≥ 3.34%
      let seed = 1;
      while (lossQtyOf(30, sampleLossRate(seededRandom(seed))) < 1) seed++;
      const expectedRate = sampleLossRate(seededRandom(seed));
      const runOnce = async () => {
        const { plan } = await createOrderWithShortage(SLAB, 25); // 25 × 23.550 ÷ 0.96 = 613.28t → 히트 3개, 슬래브 계획 30매
        const confirmed = await plans.confirm(plan.id, {}, prod);
        expect(confirmed.heatCount).toBe(3);
        expect(confirmed.plannedSlabQty).toBe(30);
        const out = await simulation.simulate(plan.id, { seed, untilProcess: 'CASTING', includeInspection: false }, prod);
        const casting = out.plan.results.filter((r) => r.processCode === 'CASTING');
        return { rate: out.sampledLossRate, loss: casting.map((r) => r.lossQty), output: casting.map((r) => r.outputQty), stored: casting.map((r) => r.sampledLossRate?.toFixed(4)), slabs: out.plan.lots.slabs.length };
      };
      const a = await runOnce();
      const b = await runOnce();
      expect(a.rate).toBe(expectedRate);
      expect(b).toEqual(a);
      const totalLoss = a.loss.reduce((s: number, v) => s + (v ?? 0), 0);
      expect(totalLoss).toBe(lossQtyOf(30, expectedRate));
      expect(totalLoss).toBeGreaterThanOrEqual(1);
      expect(totalLoss).toBeLessThanOrEqual(1); // 30매의 5% = 1.5 → 최대 1매
      expect(a.slabs).toBe(30 - totalLoss);
      expect(a.stored).toEqual([expectedRate, expectedRate, expectedRate]);
    });

    it('원료가 모자라면 아무것도 바꾸지 않고 멈추며 부족한 원료와 톤을 알려 준다', async () => {
      const { plan } = await createOrderWithShortage(SLAB, 1);
      await plans.confirm(plan.id, {}, prod);
      // 합금철 FeSi를 0.125t만 남긴다 (히트 1개에 0.625t 필요). 테스트가 끝나면 되돌린다.
      const { rm, onHandTon } = await rawInventory('FS');
      const lots = await prisma.lot.findMany({ where: { rawMaterialId: rm.id, lotType: 'RAW_MATERIAL', lotStatus: 'IN_STOCK' }, orderBy: { id: 'asc' } });
      const restore = async () => {
        for (const l of lots) await prisma.lot.update({ where: { id: l.id }, data: { remainingTon: l.remainingTon } });
        await prisma.inventory.update({ where: { rawMaterialId: rm.id }, data: { onHandTon } });
      };
      try {
        for (const [i, l] of lots.entries()) await prisma.lot.update({ where: { id: l.id }, data: { remainingTon: i === 0 ? '0.125' : 0 } });
        await prisma.inventory.update({ where: { rawMaterialId: rm.id }, data: { onHandTon: '0.125' } });
        const ioBefore = (await rawInventory('IO')).onHandTon;

        const preview = await plans.heatPreview(plan.id, {});
        expect(preview.hasRawShortage).toBe(true);
        expect(preview.rawMaterials.find((r) => r.materialCode === 'FS')).toMatchObject({ isShort: true });
        expect(preview.rawMaterials.find((r) => r.materialCode === 'FS')?.shortageTon.toFixed(3)).toBe('0.500');

        const err: AppException = await simulation.simulate(plan.id, { seed: 1 }, prod).catch((e) => e);
        expect(err).toBeInstanceOf(AppException);
        expect(err.getStatus()).toBe(409);
        expect(err.message).toContain('합금철 FeSi 0.500t 부족(필요 0.625t, 잔량 0.125t)');
        expect(err.message).not.toContain('철광석');

        expect((await planResults(plan.id)).every((r) => r.productionResultStatus === 'READY')).toBe(true);
        expect(await prisma.lot.count({ where: { productionPlanId: plan.id } })).toBe(0);
        expect((await prisma.productionPlan.findUniqueOrThrow({ where: { id: plan.id } })).productionPlanStatus).toBe('CONFIRMED');
        expect((await rawInventory('IO')).onHandTon.toFixed(3)).toBe(ioBefore.toFixed(3));
      } finally {
        await restore();
      }
      // 원료를 채운 뒤에는 같은 계획이 끝까지 진행된다
      const out = await simulation.simulate(plan.id, { seed: 1 }, prod);
      expect(out.plan.productionPlanStatus).toBe('COMPLETED');
    });
  });

  // ───────────────────────────── 불합격 히트 ─────────────────────────────

  describe('불합격 히트의 하위 LOT', () => {
    it('예약·배정·열연에 쓸 수 없고, 계획은 닫히며 재생산이 필요해진다', async () => {
      const { item, plan } = await createOrderWithShortage(SLAB, 2);
      await plans.confirm(plan.id, {}, prod);
      await run(plan.id, 'IRONMAKING', { blastFurnaceNo: '1' });
      const steel = await run(plan.id, 'STEELMAKING', { converterNo: '1' }, 1);
      const heatId = steel.lots[0].id;
      await run(plan.id, 'CASTING', { outputQty: 4 }, 1); // 히트 미판정 상태에서도 연주는 진행할 수 있다
      const slabs = await prisma.lot.findMany({ where: { heatLotId: heatId, lotType: 'SLAB' }, orderBy: { lotNo: 'asc' } });
      const before = await pool(SLAB);
      await quality.register({ lotId: slabs[0].id, values: slabOk }, qc); // 슬래브 자체는 합격

      // 성분 불합격: C 0.2501 > 0.25
      const failed = await quality.register({ lotId: heatId, values: compositionOk.map((v) => (v.inspectionItemCode === 'C' ? { ...v, measuredValue: '0.2501' } : v)) }, qc);
      expect(failed.inspectionResult).toBe('FAIL');
      const after = await pool(SLAB);
      expect(after.onHandQty).toBe(before.onHandQty); // 하위 슬래브는 재고에 들어가지 않는다
      expect(after.reservedQty).toBe(before.reservedQty);
      expect(await prisma.reservation.count({ where: { salesOrderItemId: item.id, isAutoReserved: true } })).toBe(0);
      await expectPoolConsistent(SLAB);

      // 하위 슬래브: 적격 아님, 배정 불가(INV-002), FIFO 추천에 나오지 않음, 검사 대상에서도 빠진다
      expect(await prisma.tx((tx) => stock.isEligible(tx, slabs[0].id))).toBe(false);
      await expect(prisma.tx((tx) => stock.confirmAllocation(tx, { lotId: slabs[0].id, purpose: 'SHIPMENT', salesOrderItemId: item.id, actor: prod }))).rejects.toMatchObject({ code: 'INV-002' });
      const recommended = await prisma.tx(async (tx) => stock.recommendLots(tx, { productSpecId: (await spec(SLAB)).id, qty: 1000, purpose: 'SHIPMENT' }));
      expect(recommended.some((l) => slabs.some((s) => s.id === l.id))).toBe(false);
      await expect(quality.register({ lotId: slabs[1].id, values: slabOk }, qc)).rejects.toMatchObject({ code: 'COM-005' });
      const pending = await quality.list({ status: 'pending' });
      expect(pending.some((p) => 'lot' in p && slabs.some((s) => s.id === p.lot.id))).toBe(false);

      // 불합격 목록: 히트 자신(OWN) + 하위 슬래브 4매(HEAT), 불합격 항목은 C
      const rows = (await rejected.list()).filter((r) => r.id === heatId || r.heatLotId === heatId);
      expect(rows).toHaveLength(5);
      expect(rows.find((r) => r.id === heatId)?.rejectedBy).toBe('OWN');
      expect(rows.filter((r) => r.rejectedBy === 'HEAT')).toHaveLength(4);
      expect(rows.every((r) => r.failedInspection?.failedItems.map((i) => i.inspectionItemCode).join() === 'C')).toBe(true);
      expect(rows.every((r) => r.affectedSalesOrderItem?.salesOrderItemId === item.id && r.hasReproductionPlan === false)).toBe(true);
      const events = await prisma.businessEvent.findMany({ where: { targetType: 'LOT', targetId: heatId, eventType: 'REJECTED_JUDGED' } });
      expect(events).toHaveLength(1);
      expect(events[0].reasonCode).toBe('QUALITY_FAILURE');
      expect(events[0].lotIds.sort()).toEqual([heatId, ...slabs.map((s) => s.id)].sort());

      // 더 나올 것이 없으므로 계획은 완료되고, 미확보 2매 전부 재생산이 필요하다
      expect((await plans.get(plan.id)).productionPlanStatus).toBe('COMPLETED');
      const need = await plans.reproductionPreview(item.id);
      expect(need).toMatchObject({ unsecuredQty: 2, openPlanRemainingQty: 0, additionalQty: 2 });
      const created = await plans.createReproduction({ salesOrderItemId: item.id }, prod);
      expect(created.reservedFromStockQty + created.planQty).toBe(2); // 가용 재고(여재)가 있으면 그것부터 예약하고 나머지만 계획
      if (created.plan) {
        expect(created.plan.isReproduction).toBe(true);
        expect(created.plan.shortageQty).toBe(created.planQty);
        expect((await rejected.list()).find((r) => r.id === heatId)?.hasReproductionPlan).toBe(true);
      }
      // 이미 채워졌으면 더 만들 수 없다
      await expect(plans.createReproduction({ salesOrderItemId: item.id }, prod)).rejects.toMatchObject({ code: 'COM-005' });
      await expectPoolConsistent(SLAB);
    });
  });
});
