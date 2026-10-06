// 입고 확정·목록을 실제 DB(fs_pur)로 확인한다. 요청 → 승인 → 발주는 서비스로 만든다.
// 같은 묶음 DB를 함께 쓰므로 이 파일이 만든 발주로만 확인한다.
import { Test, type TestingModule } from '@nestjs/testing';
import { BUSINESS_EVENT_TYPE, type AuthUser } from '@fantasteel/shared';
import { AppModule } from '../../app.module';
import { AuthUserService } from '../../common/auth/auth-user.service';
import { AppException } from '../../common/errors/app.exception';
import { seoulToday } from '../../common/time/seoul-date';
import { PrismaService } from '../../prisma/prisma.service';
import { PurchasingService } from './purchasing.service';

let moduleRef: TestingModule;
let prisma: PrismaService;
let purchasing: PurchasingService;
let purchaser: AuthUser;
let purchaseHead: AuthUser;
let ore: { id: number; defaultYardId: number; defaultSupplierId: number | null };

const RECEIVED = '2026-09-15';

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (e) {
    if (e instanceof AppException) return e.code;
    throw e;
  }
  throw new Error('오류가 나지 않았습니다');
}

/** 철광석 발주 1건. 톤마다 구매요청 1건 → 승인 → 한 발주로 묶는다. 발주 품목 id를 같은 순서로 돌려준다 */
async function orderOre(...tons: string[]) {
  const ids: number[] = [];
  for (const ton of tons) {
    const pr = await prisma.$transaction((tx) => purchasing.createRequisition(tx, { itemId: ore.id, requestedTon: ton, desiredReceiptDate: '2026-11-30' }, purchaser));
    ids.push((await purchasing.approve(purchaseHead, pr.id)).id);
  }
  const order = await purchasing.createPurchaseOrder(purchaser, { supplierId: ore.defaultSupplierId ?? 0, items: ids.map((id, n) => ({ purchaseRequisitionId: id, orderedTon: tons[n] })) });
  return { orderId: order.id, lineIds: order.items.map((i) => i.purchaseOrderItemId) };
}

const receive = (purchaseOrderItemId: number, receivedTon: string, receivedDate = RECEIVED) => purchasing.confirmGoodsReceipt(purchaser, { purchaseOrderItemId, receivedTon, receivedDate });
const statusOf = async (orderId: number) => (await purchasing.purchaseOrderDetail(orderId)).purchaseOrderStatus;

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
  ore = await prisma.item.findUniqueOrThrow({ where: { itemCode: 'ORE01' }, select: { id: true, defaultYardId: true, defaultSupplierId: true } });
}, 60_000);

afterAll(async () => {
  await moduleRef?.close();
});

describe('입고 확정 (API-151·220, REQ-PUR-004, BP-PUR-02)', () => {
  it('부분 입고: 입고 기록과 원료 LOT(입고일 번호·기본 야드·잔량 = 입고량)을 만들고 발주는 PARTIALLY_RECEIVED', async () => {
    const { orderId, lineIds } = await orderOre('100');
    const receipt = await receive(lineIds[0], '30.5');

    expect(receipt).toEqual(
      expect.objectContaining({ goodsReceiptNo: expect.stringMatching(/^GR-\d{4}-\d{4}$/), purchaseOrderId: orderId, itemCode: 'ORE01', receivedTon: '30.500', receivedDate: RECEIVED, yardId: ore.defaultYardId, lotNo: expect.stringMatching(/^RM-ORE01-260915-\d{3}$/) }),
    );
    const lot = await prisma.lot.findUniqueOrThrow({ where: { id: receipt.lotId ?? 0 } });
    expect(lot).toEqual(expect.objectContaining({ lotType: 'RAW_MATERIAL', lotStatus: 'AVAILABLE', itemId: ore.id, goodsReceiptId: receipt.id, yardId: ore.defaultYardId }));
    expect([lot.initialTon?.toFixed(3), lot.remainingTon?.toFixed(3)]).toEqual(['30.500', '30.500']);
    expect(await statusOf(orderId)).toBe('PARTIALLY_RECEIVED');
    expect((await purchasing.purchaseOrderDetail(orderId)).items[0]).toEqual(expect.objectContaining({ receivedTon: '30.500', remainingTon: '69.500' }));
  });

  it('작업 로그 GOODS_RECEIPT_CONFIRMED를 남기고 생성된 LOT 타임라인에도 보인다', async () => {
    const { lineIds } = await orderOre('10');
    const receipt = await receive(lineIds[0], '4');
    const event = await prisma.businessEvent.findFirstOrThrow({ where: { targetType: 'goods_receipt', targetId: receipt.id }, include: { businessEventLots: true } });

    expect(event).toEqual(
      expect.objectContaining({
        businessEventType: BUSINESS_EVENT_TYPE.GOODS_RECEIPT_CONFIRMED,
        actorEmployeeId: purchaser.employeeId,
        beforeData: expect.objectContaining({ purchaseOrderStatus: 'CONFIRMED', receivedTon: '0.000' }),
        afterData: expect.objectContaining({ lotNo: receipt.lotNo, purchaseOrderStatus: 'PARTIALLY_RECEIVED', cumulativeReceivedTon: '4.000' }),
      }),
    );
    expect(event.businessEventLots.map((l) => l.lotId)).toEqual([receipt.lotId]);
  });

  it('모든 품목이 다 들어와야 RECEIVED, 한 품목만 끝나면 PARTIALLY_RECEIVED', async () => {
    const { orderId, lineIds } = await orderOre('20', '10');

    await receive(lineIds[0], '20');
    expect(await statusOf(orderId)).toBe('PARTIALLY_RECEIVED');
    await receive(lineIds[1], '4');
    await receive(lineIds[1], '6');
    expect(await statusOf(orderId)).toBe('RECEIVED');
  });

  it('미입고량보다 많으면 PUR-003, 입고·LOT을 만들지 않는다', async () => {
    const { lineIds } = await orderOre('50');
    await receive(lineIds[0], '40');
    const [receipts, lots] = [await prisma.goodsReceipt.count(), await prisma.lot.count()];

    expect(await codeOf(receive(lineIds[0], '10.001'))).toBe('PUR-003');
    expect([await prisma.goodsReceipt.count(), await prisma.lot.count()]).toEqual([receipts, lots]);
  });

  it('같은 품목에 동시에 입고해도 잠금으로 미입고량을 넘지 않는다 (확정 재시도·중복 클릭)', async () => {
    const { lineIds } = await orderOre('100');
    const results = await Promise.allSettled([receive(lineIds[0], '60'), receive(lineIds[0], '60')]);

    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    const rejected = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(rejected?.reason).toBeInstanceOf(AppException);
    expect((rejected?.reason as AppException).code).toBe('PUR-003');
    const lots = await prisma.lot.findMany({ where: { goodsReceipt: { purchaseOrderItemId: lineIds[0] } } });
    expect(lots).toHaveLength(1);
  });

  it('입고량 0 이하·없는 날짜·미래 입고일은 COM-004, 없는 발주 품목은 COM-003', async () => {
    const { lineIds } = await orderOre('10');
    const tomorrow = new Date(`${seoulToday()}T00:00:00.000Z`);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

    expect(await codeOf(receive(lineIds[0], '0'))).toBe('COM-004');
    expect(await codeOf(receive(lineIds[0], '1', '2026-02-30'))).toBe('COM-004');
    expect(await codeOf(receive(lineIds[0], '1', tomorrow.toISOString().slice(0, 10)))).toBe('COM-004');
    expect(await codeOf(receive(999_999, '1'))).toBe('COM-003');
  });
});

describe('입고 목록 (API-150·219)', () => {
  it('발주로 거르고 최신 입고가 먼저, 생성된 원료 LOT·야드를 함께 보여 준다', async () => {
    const { orderId, lineIds } = await orderOre('30');
    const first = await receive(lineIds[0], '10');
    const second = await receive(lineIds[0], '5');
    const result = await purchasing.listGoodsReceipts({ purchaseOrderId: orderId });

    expect(result.total).toBe(2);
    expect(result.items.map((r) => r.id)).toEqual([second.id, first.id]);
    // 입고 확정자는 ERD에 칸이 없어 작업 로그 GOODS_RECEIPT_CONFIRMED의 사원을 준다
    expect(result.items[0]).toEqual(expect.objectContaining({ lotNo: second.lotNo, yardName: expect.any(String), purchaseOrderId: orderId, confirmedEmployeeName: purchaser.employeeName }));
    expect(second.confirmedEmployeeName).toBe(purchaser.employeeName);
  });
});
