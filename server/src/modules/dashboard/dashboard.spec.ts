import { WIDGETS, type AuthUser } from '@fantasteel/shared';
import { cleanupTag, connectTestDb, createGenealogy, createShipment, newTag, type Genealogy } from '../lot/testing/genealogy.fixture';
import { PrismaService } from '../../prisma/prisma.service';
import { buildDefaultLayout, GRID_COLUMNS, parseStoredLayout, validatePlacements } from './dashboard-layout';
import { DashboardLayoutService } from './dashboard-layout.service';
import { DashboardWidgetService } from './dashboard-widget.service';
import { DashboardRepository } from './dashboard.repository';
import { daysToDue, isDeliveryRisk } from './delivery-risk';
import { DAY_MS, kstDateString, kstTodayDate, lastDays } from './kst';
import { SearchService } from './search.service';

const p = (widgetCode: string, x: number, y: number, w: number, h: number) => ({ widgetCode, x, y, w, h });

describe('대시보드 배치 (REQ-DSH-002)', () => {
  it('기본 배치 = isDefault 위젯을 기본 크기로 12칸 격자에 채운다', () => {
    const layout = buildDefaultLayout();
    expect(layout).toEqual([
      p('PROCESS_FLOW', 0, 0, 12, 3),
      p('ORDER_FULFILLMENT', 0, 3, 6, 5),
      p('AGENT_RISK', 6, 3, 6, 5),
      p('RECENT_EVENTS', 0, 8, 6, 5),
      p('PRODUCT_STOCK', 6, 8, 6, 5),
      p('PROCESS_YIELD', 0, 13, 6, 4),
    ]);
    expect(layout.map((l) => l.widgetCode)).toEqual(WIDGETS.filter((w) => w.isDefault).map((w) => w.code));
    expect(validatePlacements(layout)).toBeNull();
  });

  it('검증: 알 수 없는 코드·중복·정수·크기·격자 범위', () => {
    expect(validatePlacements([p('PROCESS_FLOW', 0, 0, 12, 3)])).toBeNull();
    expect(validatePlacements([p('NOPE', 0, 0, 1, 1)])).toMatch(/알 수 없는 위젯/);
    expect(validatePlacements([p('PROCESS_FLOW', 0, 0, 6, 3), p('PROCESS_FLOW', 6, 0, 6, 3)])).toMatch(/두 번/);
    expect(validatePlacements([p('PROCESS_FLOW', 0.5, 0, 6, 3)])).toMatch(/정수/);
    expect(validatePlacements([p('PROCESS_FLOW', 0, 0, 6, 3.2)])).toMatch(/정수/);
    expect(validatePlacements([p('PROCESS_FLOW', -1, 0, 6, 3)])).toMatch(/0 이상/);
    expect(validatePlacements([p('PROCESS_FLOW', 0, -2, 6, 3)])).toMatch(/0 이상/);
    expect(validatePlacements([p('PROCESS_FLOW', 0, 0, 0, 3)])).toMatch(/1 이상/);
    expect(validatePlacements([p('PROCESS_FLOW', 0, 0, 6, 0)])).toMatch(/1 이상/);
    expect(validatePlacements([p('PROCESS_FLOW', 7, 0, 6, 3)])).toMatch(/12칸/);
    expect(validatePlacements([p('PROCESS_FLOW', 6, 0, 6, 3)])).toBeNull(); // x + w = 12 는 허용
    expect(GRID_COLUMNS).toBe(12);
  });

  it('저장된 JSON이 깨져 있으면 기본 배치로 돌아간다', () => {
    expect(parseStoredLayout('x')).toBeNull();
    expect(parseStoredLayout([{ widgetCode: 'PROCESS_FLOW', x: 0, y: 0, w: 99, h: 1 }])).toBeNull();
    expect(parseStoredLayout([p('PROCESS_FLOW', 0, 0, 12, 3)])).toEqual([p('PROCESS_FLOW', 0, 0, 12, 3)]);
  });
});

describe('납기 위험 규칙 (REQ-AGT-004, AI 아님)', () => {
  const today = new Date('2026-09-30T00:00:00Z');
  const due = (offset: number) => new Date(today.getTime() + offset * DAY_MS);
  it('남은 일수 ≤ 기준일 이고 출하 < 주문일 때만 위험', () => {
    expect(daysToDue(due(3), today)).toBe(3);
    expect(isDeliveryRisk({ dueDate: due(3), orderedQty: 10, shippedQty: 4 }, today, 3)).toBe(true); // 경계 포함
    expect(isDeliveryRisk({ dueDate: due(4), orderedQty: 10, shippedQty: 4 }, today, 3)).toBe(false);
    expect(isDeliveryRisk({ dueDate: due(0), orderedQty: 10, shippedQty: 0 }, today, 3)).toBe(true);
    expect(isDeliveryRisk({ dueDate: due(-2), orderedQty: 10, shippedQty: 9 }, today, 3)).toBe(true); // 납기 지남
    expect(isDeliveryRisk({ dueDate: due(1), orderedQty: 10, shippedQty: 10 }, today, 3)).toBe(false); // 전량 출하
  });

  it('한국 시간 날짜 계산', () => {
    // 2026-09-30 16:00Z = 2026-10-01 01:00 KST
    expect(kstDateString(new Date('2026-09-30T16:00:00Z'))).toBe('2026-10-01');
    expect(kstTodayDate(new Date('2026-09-30T16:00:00Z')).toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(lastDays(3, new Date('2026-09-30T16:00:00Z'))).toEqual(['2026-09-29', '2026-09-30', '2026-10-01']);
  });
});

describe('대시보드 (DB)', () => {
  let prisma: PrismaService;
  let layouts: DashboardLayoutService;
  let widgets: DashboardWidgetService;
  let search: SearchService;
  let user: AuthUser;
  let savedLayout: unknown;
  const tags: string[] = [];
  const now = new Date();

  beforeAll(async () => {
    prisma = connectTestDb();
    await prisma.onModuleInit();
    const repo = new DashboardRepository();
    layouts = new DashboardLayoutService(prisma, repo);
    widgets = new DashboardWidgetService(prisma, repo);
    search = new SearchService(prisma, repo);
    const emp = await prisma.employee.findFirstOrThrow({ where: { employeeNo: '1911030' } });
    user = { employeeId: emp.id, employeeNo: emp.employeeNo, employeeName: emp.employeeName, roleCode: 'QUALITY', departmentId: emp.departmentId, departmentName: '품질부', jobGrade: emp.jobGrade, headDepartmentIds: [], permissions: {} };
    savedLayout = (await prisma.dashboardWidgetLayout.findUnique({ where: { employeeId: emp.id } }))?.layout;
    await prisma.dashboardWidgetLayout.deleteMany({ where: { employeeId: emp.id } });
  });

  afterAll(async () => {
    for (const t of tags) {
      await cleanupTag(prisma, t);
      await prisma.purchaseRequisition.deleteMany({ where: { purchaseRequisitionNo: { contains: t } } });
    }
    await prisma.dashboardWidgetLayout.deleteMany({ where: { employeeId: user.employeeId } });
    if (savedLayout) await prisma.dashboardWidgetLayout.create({ data: { employeeId: user.employeeId, layout: savedLayout as object } });
    await prisma.onModuleDestroy();
  });

  const tagged = () => {
    const t = newTag();
    tags.push(t);
    return t;
  };

  it('저장한 배치가 없으면 기본 배치, 저장하면 그대로 돌려주고, 잘못된 배치는 거부한다', async () => {
    const first = await layouts.get(user);
    expect(first.isDefault).toBe(true);
    expect(first.placements).toEqual(buildDefaultLayout());

    const dto = { placements: [p('PRODUCT_STOCK', 0, 0, 8, 4), p('DELIVERY_RISK', 8, 0, 4, 4)] };
    const saved = await layouts.save(dto, user);
    expect(saved).toEqual({ placements: dto.placements, isDefault: false });
    expect(await layouts.get(user)).toEqual({ placements: dto.placements, isDefault: false });

    await expect(layouts.save({ placements: [p('PRODUCT_STOCK', 8, 0, 6, 4)] }, user)).rejects.toMatchObject({ code: 'COM-003' });
    await expect(layouts.save({ placements: [p('PRODUCT_STOCK', 0, 0, 6, 4), p('PRODUCT_STOCK', 6, 0, 6, 4)] }, user)).rejects.toMatchObject({ code: 'COM-003' });
    // 거부된 뒤에도 이전 저장값이 유지된다
    expect((await layouts.get(user)).placements).toEqual(dto.placements);

    const empty = await layouts.save({ placements: [] }, user);
    expect(empty.placements).toEqual([]);
    expect(await layouts.get(user)).toEqual({ placements: [], isDefault: false });
  });

  it('모든 위젯이 응답한다. P2 위젯은 { available: false, grade: P2 } 만', async () => {
    for (const w of WIDGETS) {
      const res = await widgets.get(w.code, {}, now);
      expect(res.widgetCode).toBe(w.code);
      if (w.isP2) expect(res).toEqual({ widgetCode: w.code, available: false, grade: 'P2' });
      else expect(res).toMatchObject({ available: true });
    }
    await expect(widgets.get('NOPE', {}, now)).rejects.toMatchObject({ code: 'COM-004' });
  });

  it('공정 흐름·제품 재고·수율은 DB 값과 일치한다 (빈 실적도 안전)', async () => {
    // 다른 테스트 파일이 같은 DB에 동시에 LOT을 만들 수 있으므로, 위젯 호출 전·후 DB 값 사이에 들어오는지 본다.
    const counts = async () => ({
      slabQualified: await prisma.lot.count({ where: { lotType: 'SLAB', lotStatus: 'IN_STOCK', isPassed: true, heatLot: { isPassed: true } } }),
      slabWaiting: await prisma.lot.count({ where: { lotType: 'SLAB', isPassed: null } }),
      plans: await prisma.productionPlan.count({ where: { productionPlanStatus: { in: ['PLANNED', 'CONFIRMED', 'IN_PROGRESS'] } } }),
    });
    const lo = await counts();
    const flow = await widgets.processFlow(now);
    const hi = await counts();
    const stage = (k: string) => flow.stages.find((s) => s.key === k)!.count;
    const within = (v: number, a: number, b: number) => {
      expect(v).toBeGreaterThanOrEqual(Math.min(a, b));
      expect(v).toBeLessThanOrEqual(Math.max(a, b));
    };
    within(stage('QUALIFIED_SLAB'), lo.slabQualified, hi.slabQualified);
    within(stage('SLAB_AWAITING_INSPECTION'), lo.slabWaiting, hi.slabWaiting);
    within(stage('OPEN_PLANS'), lo.plans, hi.plans);

    const stock = await widgets.productStock();
    const inv = await prisma.inventory.aggregate({ where: { productSpec: { item: { itemType: 'SLAB' } } }, _sum: { onHandQty: true, reservedQty: true } });
    const slabTotal = stock.totals.find((t) => t.itemType === 'SLAB')!;
    expect(slabTotal.onHandQty).toBe(inv._sum.onHandQty ?? 0);
    expect(slabTotal.availableQty).toBe((inv._sum.onHandQty ?? 0) - (inv._sum.reservedQty ?? 0));
    const row = stock.items.find((i) => i.itemType === 'SLAB')!;
    expect(row.onHandTon).toBe((Number(row.theoreticalWeightTon) * row.onHandQty).toFixed(3));

    const yieldW = await widgets.processYield();
    expect(yieldW.processes.map((x) => x.processCode)).toEqual(['IRONMAKING', 'STEELMAKING', 'CASTING', 'HOT_ROLLING']);
    expect(yieldW.processes.find((x) => x.processCode === 'STEELMAKING')!.plannedYieldRate).toBe('0.9500');
    const casting = yieldW.processes.find((x) => x.processCode === 'CASTING')!;
    if (casting.resultCount === 0) {
      expect(casting.actualYieldRate).toBeNull();
      expect(casting.qtyAttainmentRate).toBeNull();
    }
  });

  it('생산 실적이 있으면 공정별 계획 대비 산출을 계산한다', async () => {
    const tag = tagged();
    const before = await widgets.processYield();
    const b = before.processes.find((x) => x.processCode === 'CASTING')!;
    await prisma.productionResult.create({ data: { processCode: 'CASTING', productionResultStatus: 'COMPLETED', plannedQty: 10, outputQty: 9, lossQty: 1, inputTon: 250, outputTon: 240 } });
    try {
      const after = await widgets.processYield();
      const a = after.processes.find((x) => x.processCode === 'CASTING')!;
      expect(a.resultCount).toBe(b.resultCount + 1);
      expect(a.plannedQty).toBe(b.plannedQty + 10);
      expect(a.outputQty).toBe(b.outputQty + 9);
      expect(a.plannedYieldRate).toBe('0.9600');
      if (b.resultCount === 0) {
        expect(a.actualYieldRate).toBe('0.9600');
        expect(a.qtyAttainmentRate).toBe('0.9000');
      }
    } finally {
      await prisma.productionResult.deleteMany({ where: { processCode: 'CASTING', plannedQty: 10, outputQty: 9, lossQty: 1, isSimulated: false, productionPlanId: null } });
    }
    void tag;
  });

  it('납기 위험 위젯: 기준일 이내 + 미출하만, 지난 납기 포함, 취소·전량출하 제외', async () => {
    const tag = tagged();
    const setting = await prisma.productionSetting.findUniqueOrThrow({ where: { id: 1 } });
    const risk = setting.deliveryRiskDays;
    const today = kstTodayDate(now);
    const owner = await prisma.employee.findFirstOrThrow({ where: { employeeNo: '2104012' } });
    const customer = await prisma.customer.findFirstOrThrow();
    const spec = await prisma.productSpec.findUniqueOrThrow({ where: { specCode: 'SL-SS275-250x1200x10000' } });
    const mk = (suffix: string, offsetDays: number, item: { orderedQty: number; shippedQty: number; status?: string }, isCancelled = false) =>
      prisma.salesOrder.create({
        data: {
          salesOrderNo: `SO-${tag}-${suffix}`,
          customerId: customer.id,
          dueDate: new Date(today.getTime() + offsetDays * DAY_MS),
          ownerEmployeeId: owner.id,
          isCancelled,
          items: { create: [{ lineNo: 1, productSpecId: spec.id, orderedQty: item.orderedQty, shippedQty: item.shippedQty, salesOrderItemStatus: item.status ?? 'REGISTERED' }] },
        },
      });
    await mk('IN', risk, { orderedQty: 5, shippedQty: 2, status: 'PARTIALLY_SHIPPED' }); // 경계 = 위험
    await mk('LATE', -2, { orderedQty: 5, shippedQty: 0 }); // 납기 지남 = 위험
    await mk('FAR', risk + 1, { orderedQty: 5, shippedQty: 0 }); // 여유
    await mk('DONE', 0, { orderedQty: 5, shippedQty: 5, status: 'SHIPPED' }); // 전량 출하
    await mk('CANC', 0, { orderedQty: 5, shippedQty: 0, status: 'CANCELLED' }, true); // 취소

    const res = await widgets.deliveryRisk(now, 50);
    const mine = res.items.filter((i) => i.salesOrderNo.startsWith(`SO-${tag}`));
    expect(mine.map((i) => i.salesOrderNo)).toEqual([`SO-${tag}-LATE`, `SO-${tag}-IN`]);
    expect(mine[0]).toMatchObject({ daysToDue: -2, isOverdue: true, remainingQty: 5, orderedQty: 5, shippedQty: 0 });
    expect(mine[1]).toMatchObject({ daysToDue: risk, isOverdue: false, remainingQty: 3, remainingTon: '70.650' });
    expect(res.deliveryRiskDays).toBe(risk);

    // 수주 충족 위젯에도 같은 판정이 나온다 (진행 중 = 전량 출하·취소 제외)
    const ful = await widgets.orderFulfillment(now, 50);
    const orders = ful.salesOrders.filter((o) => o.salesOrderNo.startsWith(`SO-${tag}`));
    expect(orders.map((o) => o.salesOrderNo).sort()).toEqual([`SO-${tag}-FAR`, `SO-${tag}-IN`, `SO-${tag}-LATE`]);
    expect(orders.find((o) => o.salesOrderNo.endsWith('-IN'))).toMatchObject({ isDeliveryRisk: true, orderedQty: 5, shippedQty: 2, progressRate: '0.4000' });
    expect(orders.find((o) => o.salesOrderNo.endsWith('-FAR'))!.isDeliveryRisk).toBe(false);
  });

  it('수주 충족 위젯: 예약(ACTIVE)·생산 중(계획 목표 − 생산 LOT)·출하를 따로 센다', async () => {
    const tag = tagged();
    const owner = await prisma.employee.findFirstOrThrow({ where: { employeeNo: '2104012' } });
    const customer = await prisma.customer.findFirstOrThrow();
    const spec = await prisma.productSpec.findUniqueOrThrow({ where: { specCode: 'SL-SS275-250x1200x10000' } });
    const so = await prisma.salesOrder.create({
      data: { salesOrderNo: `SO-${tag}`, customerId: customer.id, dueDate: new Date(now.getTime() + 30 * DAY_MS), ownerEmployeeId: owner.id, items: { create: [{ lineNo: 1, productSpecId: spec.id, orderedQty: 10 }] } },
      include: { items: true },
    });
    const item = so.items[0];
    // 예약은 재고 풀을 건드리지 않는 시험용 행이라 reservation만 만든다 (inventory.reserved_qty는 이 위젯이 읽지 않는다)
    await prisma.reservation.createMany({
      data: [
        { salesOrderItemId: item.id, productSpecId: spec.id, reservedQty: 3, status: 'ACTIVE' },
        { salesOrderItemId: item.id, productSpecId: spec.id, reservedQty: 2, status: 'RELEASED' },
      ],
    });
    const plan = await prisma.productionPlan.create({
      data: { productionPlanNo: `PP-${tag}`, salesOrderItemId: item.id, productSpecId: spec.id, steelGradeId: spec.steelGradeId, shortageQty: 7, productionPlanStatus: 'IN_PROGRESS' },
    });
    // 이 계획이 만든 슬래브 3개: 합격 1·검사 전 1·불합격 1 → 불합격은 생산분으로 치지 않는다
    for (const [n, passed] of [['1', true], ['2', null], ['3', false]] as const) {
      await prisma.lot.create({ data: { lotNo: `${tag}-P${n}`, lotType: 'SLAB', productSpecId: spec.id, steelGradeId: spec.steelGradeId, productionPlanId: plan.id, isPassed: passed } });
    }
    const res = await widgets.orderFulfillment(now, 50);
    const order = res.salesOrders.find((o) => o.salesOrderNo === `SO-${tag}`)!;
    expect(order).toMatchObject({ orderedQty: 10, reservedQty: 3, inProductionQty: 5, shippedQty: 0, progressRate: '0.0000', orderedTon: '235.500', isDeliveryRisk: false });
    expect(order.items[0]).toMatchObject({ lineNo: 1, reservedQty: 3, inProductionQty: 5 });
  });

  it('여재 정의: 적격 · IN_STOCK · 수주 미귀속 · CONFIRMED 배정 없음', async () => {
    const tag = tagged();
    const g: Genealogy = await createGenealogy(prisma, tag);
    const owner = await prisma.employee.findFirstOrThrow({ where: { employeeNo: '2104012' } });
    const so = await prisma.salesOrder.create({
      data: { salesOrderNo: `SO-${tag}`, customerId: (await prisma.customer.findFirstOrThrow()).id, dueDate: new Date(now.getTime() + 30 * DAY_MS), ownerEmployeeId: owner.id, items: { create: [{ lineNo: 1, productSpecId: g.slabSpecId, orderedQty: 5 }] } },
      include: { items: true },
    });
    const bad = await prisma.lot.create({
      data: { lotNo: `${tag}-HT-BADHEAT`, lotType: 'HEAT', steelGradeId: g.steelGradeId, initialTon: 10, isPassed: false, lotStatus: 'CONSUMED' },
    });
    const at = new Date(now.getTime() - 10 * DAY_MS);
    const slab = (no: string, over: Record<string, unknown>) =>
      prisma.lot.create({ data: { lotNo: `${tag}-S${no}`, lotType: 'SLAB', productSpecId: g.slabSpecId, steelGradeId: g.steelGradeId, heatLotId: g.heatId, producedAt: at, isPassed: true, ...over } });
    const a = await slab('A', {}); // 여재
    const b = await slab('B', { salesOrderItemId: so.items[0].id }); // 수주 귀속 (열연 투입용)
    const c = await slab('C', {}); // CONFIRMED 배정 있음
    await prisma.allocation.create({ data: { lotId: c.id, purpose: 'SHIPMENT', salesOrderItemId: so.items[0].id, status: 'CONFIRMED' } });
    const d = await slab('D', { isPassed: false }); // 자기 검사 불합격
    const e = await slab('E', { isPassed: null }); // 검사 전
    const f = await slab('F', { heatLotId: bad.id }); // 상위 히트 불합격
    const h = await slab('H', { lotStatus: 'CONSUMED' }); // 이미 소진
    const i = await slab('I', {}); // 배정이 해제(RELEASED)된 것은 여재
    await prisma.allocation.create({ data: { lotId: i.id, purpose: 'SHIPMENT', salesOrderItemId: so.items[0].id, status: 'RELEASED' } });

    const res = await widgets.surplusAge(50, now);
    const mine = res.items.filter((x) => x.lotNo.startsWith(`${tag}-S`)).map((x) => x.lotNo.slice(-1)).sort();
    expect(mine).toEqual(['A', 'I']);
    const row = res.items.find((x) => x.lotId === a.id)!;
    expect(row).toMatchObject({ ageDays: 10, weightTon: '23.550', specCode: 'SL-SS275-250x1200x10000', steelGradeCode: 'SS275' });
    expect(res.summary.count).toBe(await prisma.lot.count({ where: { lotType: 'SLAB', lotStatus: 'IN_STOCK', isPassed: true, heatLot: { isPassed: true }, salesOrderItemId: null, allocations: { none: { status: 'CONFIRMED' } } } }));
    expect(res.summary.maxAgeDays).toBeGreaterThanOrEqual(10);
    void [b, c, d, e, f, h];
  });

  it('불합격률: 기간 안 판정된 검사만, 강종별로 센다', async () => {
    const tag = tagged();
    const g = await createGenealogy(prisma, tag);
    const rate = async (days: number) => {
      const r = await widgets.rejectRate(days, now);
      return r.grades.find((x) => x.steelGradeId === g.steelGradeId)!;
    };
    const before = await rate(30);
    const qi = (n: string, lotId: number, result: string, inspectedAt: Date | null) =>
      prisma.qualityInspection.create({ data: { qualityInspectionNo: `QI-${tag}-${n}`, lotId, processCode: 'CASTING', inspectionResult: result, inspectedAt } });
    await qi('1', g.slabAId, 'PASS', new Date(now.getTime() - DAY_MS));
    await qi('2', g.slabBId, 'FAIL', new Date(now.getTime() - 2 * DAY_MS));
    await qi('3', g.slabBId, 'FAIL', new Date(now.getTime() - 60 * DAY_MS)); // 기간 밖
    await qi('4', g.slabAId, 'PENDING', null); // 판정 전
    const after = await rate(30);
    expect(after.inspectedCount).toBe(before.inspectedCount + 2);
    expect(after.failedCount).toBe(before.failedCount + 1);
    const casting = after.byProcess.find((x) => x.processCode === 'CASTING')!;
    const castingBefore = before.byProcess.find((x) => x.processCode === 'CASTING')!;
    expect(casting.inspectedCount).toBe(castingBefore.inspectedCount + 2);
    expect(after.rejectRate).toBe((after.failedCount / after.inspectedCount).toFixed(4));
    const wide = await rate(90);
    expect(wide.inspectedCount).toBe(after.inspectedCount + 1);
    // 값이 하나도 없는 강종도 목록에 나온다 (null)
    const all = await widgets.rejectRate(1, now);
    expect(all.grades.length).toBe(await prisma.steelGrade.count({ where: { isActive: true } }));
  });

  it('구매 진행·원료 잔량: 미입고 톤과 최신 MRP 소요를 보여 준다', async () => {
    const tag = tagged();
    const supplier = await prisma.supplier.findFirstOrThrow();
    const raw = await prisma.rawMaterial.findFirstOrThrow({ where: { materialCode: 'CL' } });
    const beforeBal = await widgets.rawMaterialBalance();
    const beforePur = await widgets.purchaseProgress(20);
    const cl0 = beforeBal.items.find((i) => i.materialCode === 'CL')!;
    const owner = await prisma.employee.findFirstOrThrow({ where: { employeeNo: '1907015' } });
    await prisma.purchaseRequisition.create({ data: { purchaseRequisitionNo: `PR-${tag}`, requesterId: owner.id, departmentId: owner.departmentId, purchaseRequisitionStatus: 'WAITING_APPROVAL' } });
    const po = await prisma.purchaseOrder.create({
      data: {
        purchaseOrderNo: `PO-${tag}`, supplierId: supplier.id, purchaseOrderStatus: 'PARTIALLY_RECEIVED', dueDate: new Date(now.getTime() + 3 * DAY_MS),
        items: { create: [{ lineNo: 1, rawMaterialId: raw.id, orderedTon: 100, receivedTon: 40 }] },
      },
    });
    const run = await prisma.mrpRun.create({
      data: { mrpRunNo: `MRP-${tag}`, requirements: { create: [{ rawMaterialId: raw.id, requiredTon: 500, remainingTon: 300, scheduledReceiptTon: 60, netRequiredTon: 140 }] } },
    });
    try {
      const bal = await widgets.rawMaterialBalance();
      const pur = await widgets.purchaseProgress(20);
      const cl = bal.items.find((i) => i.materialCode === 'CL')!;
      expect(cl.onHandTon).toBe(cl0.onHandTon);
      expect((Number(cl.scheduledReceiptTon) - Number(cl0.scheduledReceiptTon)).toFixed(3)).toBe('60.000');
      expect(bal.mrpRun?.mrpRunNo).toBe(`MRP-${tag}`);
      expect(cl).toMatchObject({ grossRequiredTon: '500.000', netRequiredTon: '140.000' });
      expect(bal.items.find((i) => i.materialCode === 'IO')!.grossRequiredTon).toBeNull();

      expect(pur.openPurchaseOrders.count).toBe(beforePur.openPurchaseOrders.count + 1);
      expect((Number(pur.openPurchaseOrders.outstandingTon) - Number(beforePur.openPurchaseOrders.outstandingTon)).toFixed(3)).toBe('60.000');
      expect(pur.openPurchaseOrders.purchaseOrders.find((o) => o.purchaseOrderNo === `PO-${tag}`)).toMatchObject({ outstandingTon: '60.000', supplierName: supplier.supplierName });
      const waiting = (r: typeof pur) => r.requisitionsByStatus.find((s) => s.status === 'WAITING_APPROVAL')!.count;
      expect(waiting(pur)).toBe(waiting(beforePur) + 1);
    } finally {
      await prisma.mrpRun.update({ where: { id: run.id }, data: { requirements: { deleteMany: {} } } });
      await prisma.mrpRun.delete({ where: { id: run.id } });
      await prisma.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: po.id } });
      await prisma.purchaseOrder.delete({ where: { id: po.id } });
    }
  });

  it('출하 실적·생산량: 최근 N일 하루 단위 (빈 날도 0으로 채움)', async () => {
    const tag = tagged();
    const g = await createGenealogy(prisma, tag);
    await createShipment(prisma, g);
    const ship = await widgets.shipmentResult(7, now);
    expect(ship.series).toHaveLength(7);
    expect(ship.series.map((d) => d.date)).toEqual(lastDays(7, now));
    const today = ship.series[6];
    expect(today.issuedQty).toBeGreaterThanOrEqual(2);
    expect(today.slabQty).toBeGreaterThanOrEqual(1);
    expect(today.coilQty).toBeGreaterThanOrEqual(1);
    expect(Number(today.issuedTon)).toBeGreaterThanOrEqual(23.55 + 3);
    expect(ship.totalQty).toBe(ship.series.reduce((s, d) => s + d.issuedQty, 0));

    const flow = await widgets.processFlow(now);
    expect(flow.issuedToday.lotCount).toBeGreaterThanOrEqual(2);

    const vol = await widgets.productionVolume(14, now);
    expect(vol.series).toHaveLength(14);
    const seededSlabs = await prisma.lot.count({ where: { lotType: 'SLAB', producedAt: { gte: new Date(now.getTime() - 13 * DAY_MS) } } });
    expect(vol.totalSlabQty).toBeGreaterThanOrEqual(3); // 이 테스트가 방금 만든 슬래브 2매 + 시드분
    expect(vol.totalSlabQty).toBeLessThanOrEqual(seededSlabs);
    expect(vol.series[13].slabQty).toBeGreaterThanOrEqual(2);
    expect(vol.series[13].coilQty).toBeGreaterThanOrEqual(1);
  });

  it('최근 작업 로그 위젯: 최신 순, 수주 연결이 있으면 링크', async () => {
    const tag = tagged();
    const so = await prisma.salesOrder.create({
      data: { salesOrderNo: `SO-${tag}`, customerId: (await prisma.customer.findFirstOrThrow()).id, dueDate: new Date(), ownerEmployeeId: user.employeeId },
    });
    await prisma.businessEvent.create({ data: { actorType: 'SYSTEM', eventType: 'AUTO_RESERVED', targetType: 'RESERVATION', salesOrderId: so.id, lotIds: [], summary: `${tag} 자동 예약`, occurredAt: new Date(now.getTime() + 60_000) } });
    const res = await widgets.recentEvents(3);
    expect(res.items.length).toBeGreaterThanOrEqual(1);
    expect(res.items.length).toBeLessThanOrEqual(3);
    expect(res.items[0]).toMatchObject({ actorLabel: '시스템', eventTypeLabel: '자동 예약', linkPath: `/business-events?salesOrderId=${so.id}` });
  });

  it('통합 검색: 번호 일부·정확 일치를 종류별 이동 경로로 돌려주고 최대 10건', async () => {
    const tag = tagged();
    const g = await createGenealogy(prisma, tag);
    const ship = await createShipment(prisma, g);
    const so = await prisma.salesOrder.findUniqueOrThrow({ where: { salesOrderNo: ship.salesOrderNo } });
    const req = await prisma.shipmentRequest.findUniqueOrThrow({ where: { shipmentRequestNo: ship.shipmentRequestNo } });
    const ms = await prisma.millSheet.findUniqueOrThrow({ where: { millSheetNo: ship.millSheetNo } });
    const owner = await prisma.employee.findFirstOrThrow({ where: { employeeNo: '1907015' } });
    const pr = await prisma.purchaseRequisition.create({ data: { purchaseRequisitionNo: `PR-${tag}`, requesterId: owner.id, departmentId: owner.departmentId } });
    const spec = await prisma.productSpec.findUniqueOrThrow({ where: { specCode: 'SL-SS275-250x1200x10000' } });
    const plan = await prisma.productionPlan.create({ data: { productionPlanNo: `PP-${tag}`, productSpecId: spec.id, steelGradeId: spec.steelGradeId, shortageQty: 1 } });

    const hits = await search.search(tag.toLowerCase());
    const byKind = Object.fromEntries(hits.map((h) => [h.kind + (h.kind === 'LOT' ? h.label : ''), h]));
    expect(hits.length).toBeLessThanOrEqual(10);
    expect(byKind.SALES_ORDER).toEqual({ kind: 'SALES_ORDER', kindLabel: '수주', label: `SO-${tag}`, linkPath: `/sales-orders/${so.id}` });
    expect(byKind.PRODUCTION_PLAN.linkPath).toBe(`/production/plans?plan=${plan.id}`);
    expect(byKind.PURCHASE_REQUISITION.linkPath).toBe(`/purchase-requisitions/${pr.id}`);
    expect(byKind.SHIPMENT_REQUEST.linkPath).toBe(`/shipment-requests/${req.id}`);
    expect(byKind.MILL_SHEET.linkPath).toBe(`/mill-sheets?id=${ms.id}`);
    expect(hits.find((h) => h.kind === 'LOT' && h.label === `${tag}-HT`)!.linkPath).toBe(`/lots/trace?lot=${tag}-HT`);
    expect(hits.filter((h) => h.kind === 'LOT').length).toBeGreaterThan(1);

    // 정확히 일치하는 번호가 부분 일치보다 앞에 온다
    const exact = await search.search(`${tag}-HT`);
    expect(exact[0]).toMatchObject({ kind: 'LOT', label: `${tag}-HT` });
    expect(await search.search('')).toEqual([]);
    expect(await search.search('%')).toEqual([]);
    expect(await search.search('_')).toEqual([]);
    expect((await search.search('S')).length).toBe(10);

    await prisma.productionPlan.deleteMany({ where: { id: plan.id } });
  });
});
