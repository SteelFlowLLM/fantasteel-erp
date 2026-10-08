// 구매 트랜잭션이 한 연결에 쿼리를 겹쳐 보내지 않는지 실제 DB(fs_pur)로 확인한다.
// 트랜잭션 안에서 관계를 여러 개 읽으면 Prisma가 쿼리를 동시에 보내 pg가 "already executing a query" 경고를 낸다.
// 경고는 한 번만 나고 Jest 안에서는 받을 수 없어, pg가 경고하는 조건(대기열에 쿼리가 있는데 또 보냄)을 직접 센다.
import { Test, type TestingModule } from '@nestjs/testing';
import type { AuthUser } from '@fantasteel/shared';
import { Client } from 'pg';
import { AppModule } from '../../app.module';
import { AuthUserService } from '../../common/auth/auth-user.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PurchasingService } from './purchasing.service';

let moduleRef: TestingModule;
let prisma: PrismaService;
let purchasing: PurchasingService;
let purchaser: AuthUser;
let purchaseHead: AuthUser;
let ore: { id: number; defaultSupplierId: number | null };

const originalQuery = Client.prototype.query;
let overlaps = 0;
function watchedQuery(this: Client & { _queryQueue: unknown[] }, ...args: unknown[]): unknown {
  if (this._queryQueue.length > 0) overlaps += 1;
  return Reflect.apply(originalQuery, this, args);
}

beforeAll(async () => {
  Client.prototype.query = watchedQuery as unknown as typeof originalQuery;
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
  ore = await prisma.item.findUniqueOrThrow({ where: { itemCode: 'ORE01' }, select: { id: true, defaultSupplierId: true } });
}, 60_000);

afterAll(async () => {
  Client.prototype.query = originalQuery;
  await moduleRef?.close();
});

describe('구매 트랜잭션 쿼리', () => {
  it('등록 → 반려 → 재요청 → 승인 → 발주 → 입고 동안 쿼리가 겹치지 않고, 응답은 커밋 뒤 모양 그대로다', async () => {
    overlaps = 0;
    const created = await purchasing.create(purchaser, { itemId: ore.id, requestedTon: '5', desiredReceiptDate: '2026-11-30' });
    expect(created).toMatchObject({ purchaseRequisitionStatus: 'WAITING_APPROVAL', itemCode: 'ORE01', requesterName: purchaser.employeeName });

    expect(await purchasing.reject(purchaseHead, created.id, { rejectReason: '수량 확인' })).toMatchObject({ purchaseRequisitionStatus: 'REJECTED', rejectReason: '수량 확인', rejectedAt: expect.any(String) });
    await purchasing.resubmit(purchaser, created.id, { requestedTon: '4', desiredReceiptDate: '2026-11-30' });
    expect(await purchasing.approve(purchaseHead, created.id)).toMatchObject({ purchaseRequisitionStatus: 'APPROVED', approverName: purchaseHead.employeeName, requestedTon: '4.000' });

    const order = await purchasing.createPurchaseOrder(purchaser, { supplierId: ore.defaultSupplierId ?? 0, items: [{ purchaseRequisitionId: created.id, orderedTon: '4' }] });
    expect(order).toMatchObject({ purchaseOrderStatus: 'CONFIRMED', orderedEmployeeName: purchaser.employeeName, totalRemainingTon: '4.000' });

    const receipt = await purchasing.confirmGoodsReceipt(purchaser, { purchaseOrderItemId: order.items[0].purchaseOrderItemId, receivedTon: '1.5', receivedDate: '2026-09-15' });
    expect(receipt).toMatchObject({ itemCode: 'ORE01', receivedTon: '1.500', yardName: expect.any(String), confirmedEmployeeName: purchaser.employeeName });

    expect(overlaps).toBe(0);
  });
});
