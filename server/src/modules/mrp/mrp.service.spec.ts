// MRP 소요량 조회를 실제 DB(fs_prod)로 확인한다. 같은 묶음의 생산·품질 테스트가 계획·원료 LOT을 만들므로
// 이 파일이 만든 계획만 먼 미래 필요일로 골라 본다 (다른 계획은 필요일이 더 일러 먼저 차감될 수 있다).
import { Test, type TestingModule } from '@nestjs/testing';
import { AppModule } from '../../app.module';
import { AppException } from '../../common/errors/app.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { MrpService } from './mrp.service';

let moduleRef: TestingModule;
let prisma: PrismaService;
let mrp: MrpService;
let seq = 0;

const DUE = '2099-12-10';

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (e) {
    if (e instanceof AppException) return e.code;
    throw e;
  }
  throw new Error('오류가 나지 않았습니다');
}

/** SM355A 슬래브 계획. dueDate가 null이면 수주 연결 없음 (필요일 = 계획 등록일) */
async function createPlan(heatCount: number, dueDate: string | null) {
  seq += 1;
  const slab = await prisma.item.findFirstOrThrow({ where: { itemType: 'SLAB', steelGrade: { steelGradeCode: 'SM355A' } }, orderBy: { id: 'asc' } });
  let salesOrderItemId: number | null = null;
  if (dueDate) {
    const customer = await prisma.customer.findFirstOrThrow({ orderBy: { id: 'asc' } });
    const owner = await prisma.employee.findUniqueOrThrow({ where: { employeeNo: '2103003' } });
    const salesOrder = await prisma.salesOrder.create({
      data: { salesOrderNo: `T-SO-MRP-${seq}`, customerId: customer.id, ownerEmployeeId: owner.id, salesOrderItems: { create: [{ itemId: slab.id, orderedQty: 4, dueDate: new Date(`${dueDate}T00:00:00.000Z`) }] } },
      include: { salesOrderItems: true },
    });
    salesOrderItemId = salesOrder.salesOrderItems[0].id;
  }
  return prisma.productionPlan.create({ data: { productionPlanNo: `T-PP-MRP-${seq}`, salesOrderItemId, itemId: slab.id, shortageQty: 4, heatCount } });
}

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  await moduleRef.init();
  prisma = moduleRef.get(PrismaService);
  mrp = moduleRef.get(MrpService);
}, 60_000);

afterAll(async () => {
  await moduleRef?.close();
});

describe('MRP 소요량 조회 (REQ-PRD-005, 업무 프로세스 4.4)', () => {
  it('시드 예: SM355A 남은 히트 1개 → 용선 277.778t, 철광석 444.444·석탄 166.667·석회석 41.667·합금철 5.000t. 만든 히트는 뺀다', async () => {
    const plan = await createPlan(2, DUE);
    const result = await prisma.productionResult.create({ data: { productionPlanId: plan.id, processType: 'STEELMAKING', converterCode: 'BOF1', startedAt: new Date() } });
    const grade = await prisma.steelGrade.findUniqueOrThrow({ where: { steelGradeCode: 'SM355A' } });
    await prisma.lot.create({ data: { lotNo: `T-HT-MRP-${seq}`, lotType: 'HEAT', steelGradeId: grade.id, productionResultId: result.id } });

    const view = await mrp.requirements({ from: DUE, to: DUE });
    const row = view.plans.find((p) => p.productionPlanId === plan.id);

    expect(view.heatCapacityTon).toBe('250.000');
    expect(row).toEqual(expect.objectContaining({ requiredDate: DUE, isBeforePeriod: false, remainingHeatCount: 1, heatTon: '250.000', requiredHotMetalTon: '277.778', salesOrderNo: `T-SO-MRP-${seq}` }));
    expect(Object.fromEntries((row?.materials ?? []).map((m) => [m.itemCode, m.requiredTon]))).toEqual({ ORE01: '444.444', COL01: '166.667', LIM01: '41.667', SMN01: '5.000' });
  });

  it('계획 몫 확정 발주(필요일 전 도착)는 그 계획이 먼저 써서 순소요 0, 기존 구매요청 번호를 보여 준다', async () => {
    const plan = await createPlan(1, DUE);
    const ore = await prisma.item.findUniqueOrThrow({ where: { itemCode: 'ORE01' } });
    const requester = await prisma.employee.findUniqueOrThrow({ where: { employeeNo: '2207005' } });
    const requisition = await prisma.purchaseRequisition.create({
      data: { purchaseRequisitionNo: `T-PR-MRP-${seq}`, itemId: ore.id, requestedTon: '444.444', desiredReceiptDate: new Date(`${DUE}T00:00:00.000Z`), requesterId: requester.id, productionPlanId: plan.id, purchaseRequisitionStatus: 'ORDERED' },
    });
    await prisma.purchaseOrder.create({
      data: {
        purchaseOrderNo: `T-PO-MRP-${seq}`,
        supplierId: ore.defaultSupplierId ?? 0,
        purchaseOrderItems: { create: [{ purchaseRequisitionId: requisition.id, itemId: ore.id, orderedTon: '444.444', expectedReceiptDate: new Date('2099-12-01T00:00:00.000Z') }] },
      },
    });

    const view = await mrp.requirements({ from: DUE, to: DUE });
    const oreLine = view.plans.find((p) => p.productionPlanId === plan.id)?.materials.find((m) => m.itemId === ore.id);

    expect(oreLine).toEqual(expect.objectContaining({ requiredTon: '444.444', netRequirementTon: '0.000' }));
    expect(view.requisitionLines.some((l) => l.productionPlanId === plan.id && l.itemId === ore.id)).toBe(false);
    expect(view.materials.find((m) => m.itemId === ore.id)?.scheduledReceiptTon).not.toBe('0.000');
  });

  it('순소요가 남은 계획·원료 줄에 같은 계획·원료의 기존 구매요청 번호를 붙인다', async () => {
    // 다른 테스트가 남긴 원료 LOT 잔량으로 다 채워지지 않도록 히트를 크게 잡는다 (합금철 400 × 5t = 2,000t)
    const plan = await createPlan(400, DUE);
    const smn = await prisma.item.findUniqueOrThrow({ where: { itemCode: 'SMN01' } });
    const requester = await prisma.employee.findUniqueOrThrow({ where: { employeeNo: '2207005' } });
    await prisma.purchaseRequisition.create({
      data: { purchaseRequisitionNo: `T-PR-MRP-${seq}`, itemId: smn.id, requestedTon: '1', desiredReceiptDate: new Date(`${DUE}T00:00:00.000Z`), requesterId: requester.id, productionPlanId: plan.id },
    });

    const view = await mrp.requirements({ from: DUE, to: DUE });
    const line = view.requisitionLines.find((l) => l.productionPlanId === plan.id && l.itemId === smn.id);
    expect(line?.existingPurchaseRequisitionNo).toBe(`T-PR-MRP-${seq}`);
    expect(view.requisitionLines.filter((l) => l.productionPlanId === plan.id && l.itemId !== smn.id).every((l) => l.existingPurchaseRequisitionNo === null)).toBe(true);
  });

  it('필요일이 종료일 뒤인 계획은 빼고, 시작일 전 계획은 밀린 소요로 보인다. 수주 연결이 없으면 필요일 = 계획 등록일', async () => {
    const later = await createPlan(1, '2099-12-31');
    const earlier = await createPlan(1, '2099-11-01');
    const unlinked = await createPlan(1, null);

    const view = await mrp.requirements({ from: DUE, to: DUE });
    const ids = view.plans.map((p) => p.productionPlanId);

    expect(ids).not.toContain(later.id);
    expect(view.plans.find((p) => p.productionPlanId === earlier.id)?.isBeforePeriod).toBe(true);
    expect(view.plans.find((p) => p.productionPlanId === unlinked.id)).toEqual(expect.objectContaining({ salesOrderNo: null, isBeforePeriod: true }));
  });

  it('없는 날짜거나 시작일이 종료일보다 뒤면 COM-004', async () => {
    expect(await codeOf(mrp.requirements({ from: '2026-02-30', to: '2026-03-01' }))).toBe('COM-004');
    expect(await codeOf(mrp.requirements({ from: '2026-10-10', to: '2026-10-01' }))).toBe('COM-004');
  });
});
