// 발주 목록·상세를 실제 DB(fs_pur)로 확인한다.
// 발주 등록·입고 확정 API 전이라 발주·입고 행은 테스트가 직접 만든다. 같은 묶음 DB를 함께 쓰므로 이 파일이 만든 발주로만 확인한다.
import { Test, type TestingModule } from '@nestjs/testing';
import { PURCHASE_ORDER_STATUS, PURCHASE_REQUISITION_STATUS, type AuthUser, type PurchaseOrderStatus } from '@fantasteel/shared';
import { AppModule } from '../../app.module';
import { AuthUserService } from '../../common/auth/auth-user.service';
import { AppException } from '../../common/errors/app.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { PurchasingService } from './purchasing.service';

let moduleRef: TestingModule;
let prisma: PrismaService;
let purchasing: PurchasingService;
let purchaser: AuthUser;
let oreId: number;
let coalId: number;
let supplierA: number;
let supplierB: number;
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

/** 발주 1건: 품목마다 구매요청을 만들어 ORDERED로 두고, 입고 기록(톤 목록)을 붙인다 */
async function createPurchaseOrder(
  supplierId: number,
  lines: { itemId: number; orderedTon: string; expectedReceiptDate?: string; receipts?: string[] }[],
  purchaseOrderStatus: PurchaseOrderStatus = PURCHASE_ORDER_STATUS.CONFIRMED,
) {
  seq += 1;
  const order = await prisma.purchaseOrder.create({ data: { purchaseOrderNo: `T-PO-${seq}`, supplierId, purchaseOrderStatus } });
  for (const [n, line] of lines.entries()) {
    const requisition = await prisma.purchaseRequisition.create({
      data: {
        purchaseRequisitionNo: `T-PR-${seq}-${n}`,
        itemId: line.itemId,
        requestedTon: line.orderedTon,
        desiredReceiptDate: new Date('2026-11-30T00:00:00.000Z'),
        requesterId: purchaser.employeeId,
        purchaseRequisitionStatus: PURCHASE_REQUISITION_STATUS.ORDERED,
      },
    });
    const orderItem = await prisma.purchaseOrderItem.create({
      data: {
        purchaseOrderId: order.id,
        purchaseRequisitionId: requisition.id,
        itemId: line.itemId,
        orderedTon: line.orderedTon,
        expectedReceiptDate: line.expectedReceiptDate ? new Date(`${line.expectedReceiptDate}T00:00:00.000Z`) : null,
      },
    });
    for (const [r, receivedTon] of (line.receipts ?? []).entries()) {
      await prisma.goodsReceipt.create({ data: { goodsReceiptNo: `T-GR-${seq}-${n}-${r}`, purchaseOrderItemId: orderItem.id, receivedTon, receivedDate: new Date('2026-10-06T00:00:00.000Z') } });
    }
  }
  return order;
}

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  await moduleRef.init();
  prisma = moduleRef.get(PrismaService);
  purchasing = moduleRef.get(PurchasingService);
  const employee = await prisma.employee.findUniqueOrThrow({ where: { employeeNo: '2207005' } });
  const user = await moduleRef.get(AuthUserService).load(employee.id);
  if (!user) throw new Error('2207005');
  purchaser = user;
  oreId = (await prisma.item.findUniqueOrThrow({ where: { itemCode: 'ORE01' } })).id;
  coalId = (await prisma.item.findUniqueOrThrow({ where: { itemCode: 'COL01' } })).id;
  [supplierA, supplierB] = (await prisma.supplier.findMany({ orderBy: { id: 'asc' }, take: 2 })).map((s) => s.id);
}, 60_000);

afterAll(async () => {
  await moduleRef?.close();
});

describe('발주 상세 (API-148·218, REQ-PUR-003·004)', () => {
  it('품목별 발주량·입고 누계·미입고량과 연결된 구매요청, 발주 합계를 계산해 보여 준다', async () => {
    const order = await createPurchaseOrder(
      supplierA,
      [
        { itemId: oreId, orderedTon: '100', expectedReceiptDate: '2026-11-20', receipts: ['30', '20.5'] },
        { itemId: coalId, orderedTon: '40.25' },
      ],
      PURCHASE_ORDER_STATUS.PARTIALLY_RECEIVED,
    );
    const view = await purchasing.purchaseOrderDetail(order.id);

    expect(view).toEqual(
      expect.objectContaining({
        purchaseOrderNo: order.purchaseOrderNo,
        purchaseOrderStatus: 'PARTIALLY_RECEIVED',
        supplierId: supplierA,
        totalOrderedTon: '140.250',
        totalReceivedTon: '50.500',
        totalRemainingTon: '89.750',
      }),
    );
    expect(view.items).toEqual([
      expect.objectContaining({ itemCode: 'ORE01', purchaseRequisitionNo: `T-PR-${seq}-0`, orderedTon: '100.000', expectedReceiptDate: '2026-11-20', receivedTon: '50.500', remainingTon: '49.500' }),
      expect.objectContaining({ itemCode: 'COL01', purchaseRequisitionNo: `T-PR-${seq}-1`, orderedTon: '40.250', expectedReceiptDate: null, receivedTon: '0.000', remainingTon: '40.250' }),
    ]);
  });

  it('없는 발주는 COM-003', async () => {
    expect(await codeOf(purchasing.purchaseOrderDetail(999_999))).toBe('COM-003');
  });
});

describe('발주 목록 (API-147·216)', () => {
  let confirmedA: number;
  let receivedB: number;

  beforeAll(async () => {
    confirmedA = (await createPurchaseOrder(supplierA, [{ itemId: oreId, orderedTon: '10' }])).id;
    receivedB = (await createPurchaseOrder(supplierB, [{ itemId: coalId, orderedTon: '5', receipts: ['5'] }], PURCHASE_ORDER_STATUS.RECEIVED)).id;
  });

  it('최신 발주가 먼저 오고, 목록에도 품목별 미입고량이 있다', async () => {
    const result = await purchasing.listPurchaseOrders({ size: 100 });
    const ids = result.items.map((o) => o.id);

    expect(ids).toEqual(expect.arrayContaining([confirmedA, receivedB]));
    expect(ids).toEqual([...ids].sort((a, b) => b - a));
    expect(result.items.find((o) => o.id === receivedB)?.items).toEqual([expect.objectContaining({ receivedTon: '5.000', remainingTon: '0.000' })]);
  });

  it('상태와 공급업체로 거른다', async () => {
    const received = await purchasing.listPurchaseOrders({ purchaseOrderStatus: 'RECEIVED', size: 100 });
    const ofSupplierA = await purchasing.listPurchaseOrders({ supplierId: supplierA, size: 100 });

    expect(received.items.map((o) => o.id)).toContain(receivedB);
    expect(received.items.every((o) => o.purchaseOrderStatus === 'RECEIVED')).toBe(true);
    expect(ofSupplierA.items.map((o) => o.id)).toContain(confirmedA);
    expect(ofSupplierA.items.every((o) => o.supplierId === supplierA)).toBe(true);
    expect(ofSupplierA.total).toBe(ofSupplierA.items.length);
  });
});
