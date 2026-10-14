// MRP → 구매요청 → 부서장 승인 → 발주 → 입고 → 제선·제강 투입을 실제 DB(fs_pur)로 끝까지 잇는다 (BP-PUR-01·02, 업무 프로세스 4.4).
// 단계별 세부 규칙은 MRP·구매요청·발주·입고·실적 테스트가 확인한다.
// 같은 DB의 다른 테스트가 원료 LOT을 남기므로, 이 계획은 히트를 크게 잡아 순소요가 남게 하고 필요일도 가장 늦게 둔다.
import { Test, type TestingModule } from '@nestjs/testing';
import type { AuthUser } from '@fantasteel/shared';
import { AppModule } from '../../app.module';
import { AuthUserService } from '../../common/auth/auth-user.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MrpService } from '../mrp/mrp.service';
import { ProductionResultService } from '../production/production-result.service';
import { SalesOrderService } from '../sales-order/sales-order.service';
import { PurchasingService } from './purchasing.service';

let moduleRef: TestingModule;
let prisma: PrismaService;
const users: Record<'sales' | 'production' | 'purchase' | 'purchaseHead', AuthUser> = {} as never;

const DUE = '2099-12-20';
const EXPECTED_RECEIPT = '2099-12-01';
// 원료 투입은 입고일 FIFO라 다른 테스트의 원료 LOT보다 먼저 쓰이도록 입고일·작업일을 과거로 둔다
const RECEIVED = '2019-03-04';
const at = (hhmm: string) => `2019-03-05T${hhmm}:00.000Z`;

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
  Object.assign(users, { sales: await load('2103003'), production: await load('1401006'), purchase: await load('2207005'), purchaseHead: await load('1702004') });
}, 60_000);

afterAll(async () => {
  await moduleRef?.close();
});

describe('MRP → 구매 → 입고 → 생산 투입 흐름 (핵심)', () => {
  it('MRP 순소요로 구매요청 → 승인 → 발주하면 순소요가 0이 되고, 입고한 원료 LOT이 제선·제강에 투입된다', async () => {
    // 1. 수주 부족분 생산계획 (SS275 슬래브 400매 → 히트 39개)
    const slab = await prisma.item.findUniqueOrThrow({ where: { itemCode: 'SL-SS275-250x1200x10000' } });
    const customerId = (await prisma.customer.findFirstOrThrow({ orderBy: { id: 'asc' } })).id;
    const order = await moduleRef.get(SalesOrderService).create(users.sales, { customerId, items: [{ itemId: slab.id, orderedQty: 400, dueDate: DUE }] });
    const plan = await prisma.productionPlan.findUniqueOrThrow({ where: { productionPlanNo: order.items[0].productionPlanNo ?? '' } });

    // 2. MRP: 원료 4종 모두 순소요가 남아 구매요청 줄이 된다
    const mrp = moduleRef.get(MrpService);
    const linesOf = async () => (await mrp.requirements({ from: DUE, to: DUE })).requisitionLines.filter((l) => l.productionPlanId === plan.id);
    const before = await mrp.requirements({ from: DUE, to: DUE });
    expect(before.plans.find((p) => p.productionPlanId === plan.id)).toMatchObject({ requiredDate: DUE, remainingHeatCount: plan.heatCount });
    const lines = await linesOf();
    expect(lines.map((l) => l.itemCode).sort()).toEqual(['COL01', 'LIM01', 'ORE01', 'SMN01']);
    expect(lines.every((l) => Number(l.netRequirementTon) > 0 && l.existingPurchaseRequisitionNo === null)).toBe(true);

    // 3. 줄마다 순소요만큼 구매요청 → MRP 줄에 기존 구매요청 번호가 붙는다
    const purchasing = moduleRef.get(PurchasingService);
    const requisitions = [];
    for (const line of lines) {
      requisitions.push(await purchasing.create(users.purchase, { itemId: line.itemId, requestedTon: line.netRequirementTon, desiredReceiptDate: EXPECTED_RECEIPT, productionPlanId: plan.id }));
    }
    expect(requisitions.every((r) => r.purchaseRequisitionStatus === 'WAITING_APPROVAL' && r.salesOrderNo === order.salesOrderNo)).toBe(true);
    expect(Object.fromEntries((await linesOf()).map((l) => [l.itemId, l.existingPurchaseRequisitionNo]))).toEqual(Object.fromEntries(requisitions.map((r) => [r.itemId, r.purchaseRequisitionNo])));

    // 4. 구매부장 승인 → 원료의 기본 공급업체별 발주(필요일 전 입고 예정) → 계획 몫 입고예정을 먼저 써서 순소요 0
    const orders = [];
    for (const requisition of requisitions) {
      expect((await purchasing.approve(users.purchaseHead, requisition.id)).purchaseRequisitionStatus).toBe('APPROVED');
      orders.push(
        await purchasing.createPurchaseOrder(users.purchase, {
          supplierId: requisition.defaultSupplierId ?? 0,
          items: [{ purchaseRequisitionId: requisition.id, orderedTon: requisition.requestedTon, expectedReceiptDate: EXPECTED_RECEIPT }],
        }),
      );
    }
    expect(orders.every((o) => o.purchaseOrderStatus === 'CONFIRMED')).toBe(true);
    expect(await linesOf()).toEqual([]);
    const afterOrder = (await mrp.requirements({ from: DUE, to: DUE })).plans.find((p) => p.productionPlanId === plan.id);
    expect(afterOrder?.materials.every((m) => m.netRequirementTon === '0.000')).toBe(true);

    // 5. 입고 확정 → 원료 LOT(잔량 = 입고량), 발주 입고 완료, 구매요청은 계획과 이어진다
    const received = new Map<string, number>();
    for (const po of orders) {
      const [line] = po.items;
      await purchasing.confirmGoodsReceipt(users.purchase, { purchaseOrderItemId: line.purchaseOrderItemId, receivedTon: line.orderedTon, receivedDate: RECEIVED });
      expect((await purchasing.purchaseOrderDetail(po.id)).purchaseOrderStatus).toBe('RECEIVED');
      const lot = await prisma.lot.findFirstOrThrow({ where: { goodsReceipt: { purchaseOrderItemId: line.purchaseOrderItemId } }, include: { goodsReceipt: { include: { purchaseOrderItem: { include: { purchaseRequisition: true } } } } } });
      expect([lot.lotType, lot.remainingTon?.toFixed(3)]).toEqual(['RAW_MATERIAL', line.orderedTon]);
      expect(lot.goodsReceipt?.purchaseOrderItem.purchaseRequisition.productionPlanId).toBe(plan.id);
      received.set(line.itemCode, lot.id);
    }

    // 6. 제선: 용선 277.778t → 원단위만큼 입고한 철광석·석탄·석회석 LOT에서 차감 (입고일 FIFO)
    const results = moduleRef.get(ProductionResultService);
    const ironmaking = await results.register(users.production, { processType: 'IRONMAKING', productionPlanId: plan.id, blastFurnaceCode: 'BF2', startedAt: at('00:00'), completedAt: at('04:00'), hotMetalTon: '277.778' });
    expect(ironmaking.inputs.map((i) => i.lotId).sort()).toEqual(['ORE01', 'COL01', 'LIM01'].map((code) => received.get(code)).sort());
    const usedTon = async (itemCode: string) => {
      const lot = await prisma.lot.findUniqueOrThrow({ where: { id: received.get(itemCode) ?? 0 } });
      return lot.initialTon?.sub(lot.remainingTon ?? 0).toFixed(3);
    };
    expect([await usedTon('ORE01'), await usedTon('COL01'), await usedTon('LIM01')]).toEqual(['444.445', '166.667', '41.667']);

    // 7. 제강: 그 용선과 입고한 합금철로 히트 1개 → MRP 남은 히트가 1개 줄고, 히트를 역추적하면 입고한 원료 LOT 4개가 나온다
    const steelmaking = await results.register(users.production, { processType: 'STEELMAKING', productionPlanId: plan.id, converterCode: 'BOF2', startedAt: at('05:00'), completedAt: at('06:00'), inputHotMetalTon: '277.778' });
    expect(await usedTon('SMN01')).toBe('2.500');
    const afterHeat = (await mrp.requirements({ from: DUE, to: DUE })).plans.find((p) => p.productionPlanId === plan.id);
    expect(afterHeat?.remainingHeatCount).toBe(plan.heatCount - 1);
    const heatId = steelmaking.outputs[0].lotId;
    const rawParents = await prisma.lotRelation.findMany({ where: { OR: [{ childLotId: heatId }, { childLotId: { in: ironmaking.outputs.map((o) => o.lotId) } }], parentLot: { lotType: 'RAW_MATERIAL' } } });
    expect(rawParents.map((r) => r.parentLotId).sort()).toEqual([...received.values()].sort());
  }, 60_000);
});
