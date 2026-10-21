// 발주 취소·잔량 마감·입고 취소(BP-PUR-02 반대 거래, 이슈 #500)를 실제 DB(fs_pur)로 확인한다. 요청 → 승인 → 발주 → 입고는 서비스로 만든다.
// 같은 묶음 DB를 함께 쓰므로 이 파일이 만든 발주·계획으로만 확인한다.
import { Test, type TestingModule } from '@nestjs/testing';
import { BUSINESS_EVENT_TYPE, type AuthUser } from '@fantasteel/shared';
import { AppModule } from '../../app.module';
import { AuthUserService } from '../../common/auth/auth-user.service';
import { AppException } from '../../common/errors/app.exception';
import { seoulToday } from '../../common/time/seoul-date';
import { Prisma } from '../../generated/prisma/client';
import { findOpenPurchaseOrderItemsForMrp } from '../../generated/prisma/sql';
import { PrismaService } from '../../prisma/prisma.service';
import { MrpService } from '../mrp/mrp.service';
import { SalesOrderService } from '../sales-order/sales-order.service';
import { PurchasingService, receiptStatusOf } from './purchasing.service';

let moduleRef: TestingModule;
let prisma: PrismaService;
let purchasing: PurchasingService;
let purchaser: AuthUser;
let purchaseHead: AuthUser;
let sales: AuthUser;
let ore: { id: number; defaultSupplierId: number | null };

const RECEIVED = '2026-09-15';
// 다른 테스트의 계획보다 필요일을 늦게 두어 MRP에서 이 계획의 순소요만 본다 (mrp-purchase-flow는 2099-12-20)
const PLAN_DUE = '2098-06-30';

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (e) {
    if (e instanceof AppException) return e.code;
    throw e;
  }
  throw new Error('오류가 나지 않았습니다');
}

/** 철광석 발주 1건. 톤마다 구매요청 1건 → 승인 → 한 발주로 묶는다 */
async function orderOre(tons: string[], productionPlanId?: number) {
  const requisitionIds: number[] = [];
  for (const ton of tons) {
    const pr = await prisma.$transaction((tx) => purchasing.createRequisition(tx, { itemId: ore.id, requestedTon: ton, desiredReceiptDate: '2026-11-30', productionPlanId }, purchaser));
    requisitionIds.push((await purchasing.approve(purchaseHead, pr.id)).id);
  }
  const order = await purchasing.createPurchaseOrder(purchaser, { supplierId: ore.defaultSupplierId ?? 0, items: requisitionIds.map((id, n) => ({ purchaseRequisitionId: id, orderedTon: tons[n] })) });
  return { orderId: order.id, lineIds: order.items.map((i) => i.purchaseOrderItemId), requisitionIds };
}

const receive = (purchaseOrderItemId: number, receivedTon: string) => purchasing.confirmGoodsReceipt(purchaser, { purchaseOrderItemId, receivedTon, receivedDate: RECEIVED });
const detailOf = (orderId: number) => purchasing.purchaseOrderDetail(orderId);
const requisitionStatusOf = async (id: number) => (await prisma.purchaseRequisition.findUniqueOrThrow({ where: { id } })).purchaseRequisitionStatus;
/** MRP 입고예정 SQL이 센 이 발주 품목의 입고예정 톤 (안 세면 null) */
async function scheduledTonOf(purchaseOrderItemId: number): Promise<string | null> {
  const row = (await prisma.$queryRawTyped(findOpenPurchaseOrderItemsForMrp())).find((r) => r.purchase_order_item_id === purchaseOrderItemId);
  return row?.scheduled_receipt_ton ? new Prisma.Decimal(row.scheduled_receipt_ton).toFixed(3) : null;
}

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  await moduleRef.init();
  prisma = moduleRef.get(PrismaService);
  purchasing = moduleRef.get(PurchasingService);
  const load = async (employeeNo: string) => {
    const employee = await prisma.employee.findUniqueOrThrow({ where: { employeeNo } });
    const user = await moduleRef.get(AuthUserService).load(employee.id);
    if (!user) throw new Error(employeeNo);
    return user;
  };
  purchaser = await load('2207005');
  purchaseHead = await load('1702004');
  sales = await load('2103003');
  ore = await prisma.item.findUniqueOrThrow({ where: { itemCode: 'ORE01' }, select: { id: true, defaultSupplierId: true } });
}, 60_000);

afterAll(async () => {
  await moduleRef?.close();
});

describe('입고 누계로 정하는 발주 상태 (단위)', () => {
  const line = (ordered: string, received: string) => ({ orderedTon: new Prisma.Decimal(ordered), receivedTon: new Prisma.Decimal(received) });

  it('모두 받으면 입고 완료, 하나라도 받으면 부분 입고, 입고 취소로 0이 되면 발주 확정', () => {
    expect(receiptStatusOf([line('10', '10'), line('5', '5')])).toBe('RECEIVED');
    expect(receiptStatusOf([line('10', '10'), line('5', '0')])).toBe('PARTIALLY_RECEIVED');
    expect(receiptStatusOf([line('10', '0.001'), line('5', '0')])).toBe('PARTIALLY_RECEIVED');
    expect(receiptStatusOf([line('10', '0'), line('5', '0')])).toBe('CONFIRMED');
  });
});

describe('발주 취소 (API-284)', () => {
  it('입고가 없는 발주를 취소하면 CANCELLED, 연결 구매요청은 ORDER_CANCELLED, 작업 로그에 사유를 남긴다', async () => {
    const { orderId, requisitionIds } = await orderOre(['12', '8']);
    const cancelled = await purchasing.cancelPurchaseOrder(purchaser, orderId, { reason: '  공급업체 납품 불가  ' });

    expect(cancelled).toMatchObject({ purchaseOrderStatus: 'CANCELLED', totalRemainingTon: '0.000', totalClosedTon: '20.000', statusChange: { reason: '공급업체 납품 불가', employeeName: purchaser.employeeName } });
    expect(await Promise.all(requisitionIds.map(requisitionStatusOf))).toEqual(['ORDER_CANCELLED', 'ORDER_CANCELLED']);
    const event = await prisma.businessEvent.findFirstOrThrow({ where: { businessEventType: BUSINESS_EVENT_TYPE.PURCHASE_ORDER_CANCELLED, targetType: 'purchase_order', targetId: orderId } });
    expect(event).toMatchObject({ actorEmployeeId: purchaser.employeeId, reason: '공급업체 납품 불가', beforeData: { purchaseOrderStatus: 'CONFIRMED' }, afterData: expect.objectContaining({ purchaseOrderStatus: 'CANCELLED' }) });
    expect((event.afterData as { items: { purchaseRequisitionId: number; purchaseRequisitionStatus: string }[] }).items).toEqual(
      requisitionIds.map((id) => expect.objectContaining({ purchaseRequisitionId: id, purchaseRequisitionStatus: 'ORDER_CANCELLED' })),
    );
    // 목록에서도 취소 기록이 보이고, 상태로 거를 수 있다
    const listed = await purchasing.listPurchaseOrders({ purchaseOrderStatus: 'CANCELLED' });
    expect(listed.items.find((po) => po.id === orderId)?.statusChange?.reason).toBe('공급업체 납품 불가');
  });

  it('취소한 발주에는 입고할 수 없고(PUR-007), 그 구매요청은 다시 발주하지 않는다(COM-001)', async () => {
    const { orderId, lineIds, requisitionIds } = await orderOre(['5']);
    await purchasing.cancelPurchaseOrder(purchaser, orderId, { reason: '중복 발주' });

    expect(await codeOf(receive(lineIds[0], '1'))).toBe('PUR-007');
    expect(await codeOf(purchasing.createPurchaseOrder(purchaser, { supplierId: ore.defaultSupplierId ?? 0, items: [{ purchaseRequisitionId: requisitionIds[0], orderedTon: '5' }] }))).toBe('COM-001');
    expect(await prisma.goodsReceipt.count({ where: { purchaseOrderItemId: lineIds[0] } })).toBe(0);
  });

  it('입고가 있으면 PUR-004, 이미 취소했으면 COM-001, 사유가 비면 COM-004, 없는 발주는 COM-003', async () => {
    const partial = await orderOre(['10']);
    await receive(partial.lineIds[0], '3');
    const full = await orderOre(['4']);
    await receive(full.lineIds[0], '4');
    const done = await orderOre(['2']);
    await purchasing.cancelPurchaseOrder(purchaser, done.orderId, { reason: '취소' });

    expect(await codeOf(purchasing.cancelPurchaseOrder(purchaser, partial.orderId, { reason: '취소' }))).toBe('PUR-004');
    expect(await codeOf(purchasing.cancelPurchaseOrder(purchaser, full.orderId, { reason: '취소' }))).toBe('PUR-004');
    expect(await codeOf(purchasing.cancelPurchaseOrder(purchaser, done.orderId, { reason: '취소' }))).toBe('COM-001');
    expect(await codeOf(purchasing.cancelPurchaseOrder(purchaser, partial.orderId, { reason: '   ' }))).toBe('COM-004');
    expect(await codeOf(purchasing.cancelPurchaseOrder(purchaser, 999_999, { reason: '취소' }))).toBe('COM-003');
    expect((await detailOf(partial.orderId)).purchaseOrderStatus).toBe('PARTIALLY_RECEIVED');
  });

  it('입고를 모두 취소해 입고 누계가 0이 되면 다시 발주 취소할 수 있다', async () => {
    const { orderId, lineIds } = await orderOre(['6']);
    const receipt = await receive(lineIds[0], '6');
    await purchasing.cancelGoodsReceipt(purchaser, receipt.id, { reason: '오입고' });

    expect((await detailOf(orderId)).purchaseOrderStatus).toBe('CONFIRMED');
    expect((await purchasing.cancelPurchaseOrder(purchaser, orderId, { reason: '공급 중단' })).purchaseOrderStatus).toBe('CANCELLED');
  });
});

describe('잔량 마감 (API-285)', () => {
  it('일부 입고된 발주를 마감하면 CLOSED, 남은 양은 닫은 양이 되고 더는 입고하지 않는다', async () => {
    const { orderId, lineIds, requisitionIds } = await orderOre(['30', '10']);
    await receive(lineIds[0], '18.5');

    const closed = await purchasing.closePurchaseOrder(purchaser, orderId, { reason: '공급업체 잔량 납품 포기' });
    expect(closed).toMatchObject({ purchaseOrderStatus: 'CLOSED', totalReceivedTon: '18.500', totalRemainingTon: '0.000', totalClosedTon: '21.500', statusChange: { reason: '공급업체 잔량 납품 포기' } });
    expect(closed.items.map((i) => [i.receivedTon, i.remainingTon, i.closedTon])).toEqual([
      ['18.500', '0.000', '11.500'],
      ['0.000', '0.000', '10.000'],
    ]);
    // 구매요청은 발주 완료 그대로
    expect(await Promise.all(requisitionIds.map(requisitionStatusOf))).toEqual(['ORDERED', 'ORDERED']);
    const event = await prisma.businessEvent.findFirstOrThrow({ where: { businessEventType: BUSINESS_EVENT_TYPE.PURCHASE_ORDER_CLOSED, targetType: 'purchase_order', targetId: orderId } });
    expect(event).toMatchObject({ reason: '공급업체 잔량 납품 포기', beforeData: { purchaseOrderStatus: 'PARTIALLY_RECEIVED', remainingTon: '21.500' }, afterData: expect.objectContaining({ purchaseOrderStatus: 'CLOSED', closedTon: '21.500' }) });

    expect(await codeOf(receive(lineIds[0], '1'))).toBe('PUR-007');
    expect(await codeOf(purchasing.closePurchaseOrder(purchaser, orderId, { reason: '다시' }))).toBe('COM-001');
    expect(await codeOf(purchasing.cancelPurchaseOrder(purchaser, orderId, { reason: '다시' }))).toBe('COM-001');
  });

  it('입고가 없거나(발주 취소를 쓴다) 전량 입고됐으면 PUR-005', async () => {
    const none = await orderOre(['3']);
    const full = await orderOre(['3']);
    await receive(full.lineIds[0], '3');

    expect(await codeOf(purchasing.closePurchaseOrder(purchaser, none.orderId, { reason: '마감' }))).toBe('PUR-005');
    expect(await codeOf(purchasing.closePurchaseOrder(purchaser, full.orderId, { reason: '마감' }))).toBe('PUR-005');
  });
});

describe('입고 취소 (API-286)', () => {
  it('음수 입고(반대 거래)를 남기고 원료 LOT은 잔량 0·입고 취소, 발주 입고 누계·상태를 되돌린다', async () => {
    const { orderId, lineIds } = await orderOre(['20', '5']);
    const first = await receive(lineIds[0], '20');
    await receive(lineIds[1], '5');
    expect((await detailOf(orderId)).purchaseOrderStatus).toBe('RECEIVED');

    const reversal = await purchasing.cancelGoodsReceipt(purchaser, first.id, { reason: '품목 오입고' });
    expect(reversal).toMatchObject({
      goodsReceiptNo: expect.stringMatching(/^GR-\d{4}-\d{4}$/),
      purchaseOrderItemId: lineIds[0],
      receivedTon: '-20.000',
      receivedDate: seoulToday(),
      lotId: null,
      reversedGoodsReceiptId: first.id,
      reversedGoodsReceiptNo: first.goodsReceiptNo,
      cancelReason: '품목 오입고',
      confirmedEmployeeName: purchaser.employeeName,
    });
    const lot = await prisma.lot.findUniqueOrThrow({ where: { id: first.lotId ?? 0 } });
    expect([lot.lotStatus, lot.initialTon?.toFixed(3), lot.remainingTon?.toFixed(3)]).toEqual(['RECEIPT_CANCELLED', '20.000', '0.000']);
    // 원래 입고는 그대로 남는다
    expect((await prisma.goodsReceipt.findUniqueOrThrow({ where: { id: first.id } })).receivedTon.toFixed(3)).toBe('20.000');

    const detail = await detailOf(orderId);
    expect(detail).toMatchObject({ purchaseOrderStatus: 'PARTIALLY_RECEIVED', totalReceivedTon: '5.000', totalRemainingTon: '20.000' });
    const event = await prisma.businessEvent.findFirstOrThrow({ where: { businessEventType: BUSINESS_EVENT_TYPE.GOODS_RECEIPT_CANCELLED, targetType: 'goods_receipt', targetId: first.id }, include: { businessEventLots: true } });
    expect(event).toMatchObject({
      reason: '품목 오입고',
      beforeData: { purchaseOrderStatus: 'RECEIVED', cumulativeReceivedTon: '20.000', lotStatus: 'AVAILABLE', remainingTon: '20.000' },
      afterData: expect.objectContaining({ goodsReceiptNo: first.goodsReceiptNo, reversalGoodsReceiptNo: reversal.goodsReceiptNo, lotStatus: 'RECEIPT_CANCELLED', purchaseOrderStatus: 'PARTIALLY_RECEIVED', cumulativeReceivedTon: '0.000' }),
    });
    expect(event.businessEventLots.map((l) => l.lotId)).toEqual([first.lotId]);

    // 목록: 취소 행은 원래 입고를, 원래 입고는 취소 행을 가리키고 둘 다 사유를 보인다
    const listed = await purchasing.listGoodsReceipts({ purchaseOrderId: orderId });
    expect(listed.items.find((r) => r.id === first.id)).toMatchObject({ reversalGoodsReceiptNo: reversal.goodsReceiptNo, cancelReason: '품목 오입고', confirmedEmployeeName: purchaser.employeeName });
    expect(listed.items.find((r) => r.id === reversal.id)).toMatchObject({ reversedGoodsReceiptNo: first.goodsReceiptNo, cancelReason: '품목 오입고' });

    // 되돌린 양만큼 다시 입고할 수 있다
    expect((await receive(lineIds[0], '20')).receivedTon).toBe('20.000');
    expect((await detailOf(orderId)).purchaseOrderStatus).toBe('RECEIVED');
  });

  it('원료 LOT을 썼으면(잔량 감소·투입 기록) PUR-006, 아무것도 바꾸지 않는다', async () => {
    const { lineIds } = await orderOre(['9', '9']);
    const used = await receive(lineIds[0], '9');
    const input = await receive(lineIds[1], '9');
    // 원료 FIFO 투입이 잔량을 줄인 것처럼
    await prisma.lot.update({ where: { id: used.lotId ?? 0 }, data: { remainingTon: new Prisma.Decimal('8.5') } });
    // 잔량은 그대로지만 다음 공정에 투입한 기록(lot_relation)이 있는 것처럼. 용선 LOT은 실적이 있어야 만들 수 있어 자식은 다른 원료 LOT으로 둔다
    await prisma.lotRelation.create({ data: { parentLotId: input.lotId ?? 0, childLotId: used.lotId ?? 0, lotRelationEvidence: 'PERIOD_BASED', inputTon: new Prisma.Decimal(0) } });
    const receipts = await prisma.goodsReceipt.count();

    expect(await codeOf(purchasing.cancelGoodsReceipt(purchaser, used.id, { reason: '취소' }))).toBe('PUR-006');
    expect(await codeOf(purchasing.cancelGoodsReceipt(purchaser, input.id, { reason: '취소' }))).toBe('PUR-006');
    expect(await prisma.goodsReceipt.count()).toBe(receipts);
    expect((await prisma.lot.findUniqueOrThrow({ where: { id: used.lotId ?? 0 } })).lotStatus).toBe('AVAILABLE');
  });

  it('이미 취소한 입고는 COM-001, 취소 행은 COM-004, 마감한 발주의 입고는 PUR-007', async () => {
    const { orderId, lineIds } = await orderOre(['10']);
    const first = await receive(lineIds[0], '4');
    const second = await receive(lineIds[0], '3');
    const reversal = await purchasing.cancelGoodsReceipt(purchaser, first.id, { reason: '중복 등록' });

    expect(await codeOf(purchasing.cancelGoodsReceipt(purchaser, first.id, { reason: '다시' }))).toBe('COM-001');
    expect(await codeOf(purchasing.cancelGoodsReceipt(purchaser, reversal.id, { reason: '다시' }))).toBe('COM-004');
    expect(await codeOf(purchasing.cancelGoodsReceipt(purchaser, 999_999, { reason: '다시' }))).toBe('COM-003');
    await purchasing.closePurchaseOrder(purchaser, orderId, { reason: '마감' });
    expect(await codeOf(purchasing.cancelGoodsReceipt(purchaser, second.id, { reason: '다시' }))).toBe('PUR-007');
  });
});

describe('입고 확정과 겹칠 때 (조건부 UPDATE·발주 행 잠금)', () => {
  it('발주 취소와 입고 확정이 동시에 오면 한쪽만 성공한다', async () => {
    for (let round = 0; round < 3; round++) {
      const { orderId, lineIds } = await orderOre(['10']);
      const [cancel, receipt] = await Promise.allSettled([purchasing.cancelPurchaseOrder(purchaser, orderId, { reason: '경합' }), receive(lineIds[0], '4')]);

      expect([cancel.status, receipt.status].sort()).toEqual(['fulfilled', 'rejected']);
      const detail = await detailOf(orderId);
      const receipts = await prisma.goodsReceipt.count({ where: { purchaseOrderItemId: lineIds[0] } });
      if (cancel.status === 'fulfilled') {
        expect([detail.purchaseOrderStatus, receipts]).toEqual(['CANCELLED', 0]);
        expect(receipt.status === 'rejected' && (receipt.reason as AppException).code).toBe('PUR-007');
      } else {
        expect([detail.purchaseOrderStatus, receipts]).toEqual(['PARTIALLY_RECEIVED', 1]);
        expect(['COM-001', 'PUR-004']).toContain((cancel.reason as AppException).code);
      }
    }
  });

  it('잔량 마감과 남은 양 전부 입고가 동시에 오면 한쪽만 성공한다', async () => {
    for (let round = 0; round < 3; round++) {
      const { orderId, lineIds } = await orderOre(['10']);
      await receive(lineIds[0], '4');
      const [close, receipt] = await Promise.allSettled([purchasing.closePurchaseOrder(purchaser, orderId, { reason: '경합' }), receive(lineIds[0], '6')]);

      expect([close.status, receipt.status].sort()).toEqual(['fulfilled', 'rejected']);
      const detail = await detailOf(orderId);
      if (close.status === 'fulfilled') expect([detail.purchaseOrderStatus, detail.totalReceivedTon, detail.totalClosedTon]).toEqual(['CLOSED', '4.000', '6.000']);
      else expect([detail.purchaseOrderStatus, detail.totalReceivedTon]).toEqual(['RECEIVED', '10.000']);
    }
  });

  it('같은 입고를 동시에 두 번 취소해도 취소 행은 하나다', async () => {
    const { orderId, lineIds } = await orderOre(['8']);
    const receipt = await receive(lineIds[0], '8');
    const results = await Promise.allSettled([purchasing.cancelGoodsReceipt(purchaser, receipt.id, { reason: '경합' }), purchasing.cancelGoodsReceipt(purchaser, receipt.id, { reason: '경합' })]);

    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(await prisma.goodsReceipt.count({ where: { reversedGoodsReceiptId: receipt.id } })).toBe(1);
    expect((await detailOf(orderId)).totalReceivedTon).toBe('0.000');
  });
});

describe('MRP 입고예정·같은 계획 재요청 (BP-PUR-02 → MRP)', () => {
  /** 슬래브 400매 수주의 생산계획. 원료 소요가 커서 이 파일의 발주 몇 톤으로는 순소요가 0이 되지 않는다 */
  async function makePlan() {
    const slab = await prisma.item.findUniqueOrThrow({ where: { itemCode: 'SL-SS275-250x1200x10000' } });
    const customerId = (await prisma.customer.findFirstOrThrow({ orderBy: { id: 'asc' } })).id;
    const order = await moduleRef.get(SalesOrderService).create(sales, { customerId, items: [{ itemId: slab.id, orderedQty: 400, dueDate: PLAN_DUE }] });
    return prisma.productionPlan.findUniqueOrThrow({ where: { productionPlanNo: order.items[0].productionPlanNo ?? '' } });
  }
  const oreLineOf = async (planId: number) => {
    const mrp = await moduleRef.get(MrpService).requirements({ from: PLAN_DUE, to: PLAN_DUE });
    return {
      line: mrp.requisitionLines.find((l) => l.productionPlanId === planId && l.itemId === ore.id),
      netTon: mrp.plans.find((p) => p.productionPlanId === planId)?.materials.find((m) => m.itemId === ore.id)?.netRequirementTon,
    };
  };

  it('입고 취소는 입고예정을 되살리고, 잔량 마감은 남은 양을 입고예정에서 빼고 같은 계획·원료로 다시 요청하게 한다', async () => {
    const plan = await makePlan();
    const { orderId, lineIds, requisitionIds } = await orderOre(['10'], plan.id);
    const requisitionNo = (await prisma.purchaseRequisition.findUniqueOrThrow({ where: { id: requisitionIds[0] } })).purchaseRequisitionNo;
    expect(await scheduledTonOf(lineIds[0])).toBe('10.000');
    expect((await oreLineOf(plan.id)).line?.existingPurchaseRequisitionNo).toBe(requisitionNo);

    const receipt = await receive(lineIds[0], '4');
    expect(await scheduledTonOf(lineIds[0])).toBe('6.000');
    await purchasing.cancelGoodsReceipt(purchaser, receipt.id, { reason: '오입고' });
    expect(await scheduledTonOf(lineIds[0])).toBe('10.000');

    await receive(lineIds[0], '4');
    const beforeClose = await oreLineOf(plan.id);
    await purchasing.closePurchaseOrder(purchaser, orderId, { reason: '잔량 포기' });
    const afterClose = await oreLineOf(plan.id);
    expect(await scheduledTonOf(lineIds[0])).toBeNull();
    // 이 계획 몫 입고예정 6t이 빠져 순소요가 그만큼 늘고, 기존 요청이 더는 막지 않는다
    expect(new Prisma.Decimal(afterClose.netTon ?? 0).minus(beforeClose.netTon ?? 0).toFixed(3)).toBe('6.000');
    expect(afterClose.line?.existingPurchaseRequisitionNo).toBeNull();
    const again = await purchasing.create(purchaser, { itemId: ore.id, requestedTon: '6', desiredReceiptDate: '2026-11-30', productionPlanId: plan.id });
    expect(again.purchaseRequisitionStatus).toBe('WAITING_APPROVAL');
    expect((await oreLineOf(plan.id)).line?.existingPurchaseRequisitionNo).toBe(again.purchaseRequisitionNo);
  }, 60_000);

  it('발주 취소하면 입고예정에서 빠지고 같은 계획·원료로 새로 요청할 수 있다', async () => {
    const plan = await makePlan();
    const { orderId, lineIds } = await orderOre(['7'], plan.id);
    // 진행 중인 요청이 있으면 같은 계획·원료로 또 요청할 수 없다
    expect(await codeOf(purchasing.create(purchaser, { itemId: ore.id, requestedTon: '7', desiredReceiptDate: '2026-11-30', productionPlanId: plan.id }))).toBe('COM-004');

    await purchasing.cancelPurchaseOrder(purchaser, orderId, { reason: '공급업체 변경' });
    expect(await scheduledTonOf(lineIds[0])).toBeNull();
    expect((await oreLineOf(plan.id)).line?.existingPurchaseRequisitionNo).toBeNull();
    expect((await purchasing.create(purchaser, { itemId: ore.id, requestedTon: '7', desiredReceiptDate: '2026-11-30', productionPlanId: plan.id })).purchaseRequisitionStatus).toBe('WAITING_APPROVAL');
  }, 60_000);
});
