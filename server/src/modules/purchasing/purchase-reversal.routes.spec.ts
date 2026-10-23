// 발주 취소·잔량 마감·입고 취소(API-284~286) 경로를 실제 앱을 띄워 HTTP로 부른다 (실제 DB fs_pur).
// 서비스 시험으로는 볼 수 없는 DTO 검증(사유 500자)·권한 데코레이터·전역 응답 모양을 확인한다.
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AuthUser } from '@fantasteel/shared';
import type { AddressInfo } from 'node:net';
import { AppModule } from '../../app.module';
import { AuthUserService } from '../../common/auth/auth-user.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PurchasingService } from './purchasing.service';

let app: INestApplication;
let baseUrl: string;
let purchasing: PurchasingService;
const cookies: Record<'purchase' | 'sales', string> = { purchase: '', sales: '' };
let purchaser: AuthUser;
let purchaseHead: AuthUser;
let ore: { id: number; defaultSupplierId: number | null };

type Body = { success: boolean; data?: Record<string, unknown>; error?: { code: string } };

async function login(employeeNo: string): Promise<string> {
  const res = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ employeeNo, password: process.env.SEED_PASSWORD! }),
  });
  if (!res.ok) throw new Error(`로그인 실패 ${employeeNo} (HTTP ${res.status})`);
  return (res.headers.get('set-cookie') ?? '').split(';')[0];
}

const post = async (who: keyof typeof cookies, path: string, body: unknown) => {
  const res = await fetch(`${baseUrl}${path}`, { method: 'POST', headers: { cookie: cookies[who], 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as Body };
};

/** 철광석 발주 1건. receivedTon을 주면 입고까지 하고 입고 id를 돌려준다 */
async function orderOre(ton: string, receivedTon?: string) {
  const pr = await purchasing.create(purchaser, { itemId: ore.id, requestedTon: ton, desiredReceiptDate: '2026-11-30' });
  await purchasing.approve(purchaseHead, pr.id);
  const order = await purchasing.createPurchaseOrder(purchaser, { supplierId: ore.defaultSupplierId ?? 0, items: [{ purchaseRequisitionId: pr.id, orderedTon: ton }] });
  const receipt = receivedTon ? await purchasing.confirmGoodsReceipt(purchaser, { purchaseOrderItemId: order.items[0].purchaseOrderItemId, receivedTon, receivedDate: '2026-09-15' }) : null;
  return { orderId: order.id, receiptId: receipt?.id ?? 0 };
}

/** main.ts와 같은 전역 설정으로 띄운다 */
beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(0);
  baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1`;
  purchasing = app.get(PurchasingService);
  const prisma = app.get(PrismaService);
  const load = async (employeeNo: string) => {
    const employee = await prisma.employee.findUniqueOrThrow({ where: { employeeNo } });
    const user = await app.get(AuthUserService).load(employee.id);
    if (!user) throw new Error(employeeNo);
    return user;
  };
  purchaser = await load('2207005');
  purchaseHead = await load('1702004');
  ore = await prisma.item.findUniqueOrThrow({ where: { itemCode: 'ORE01' }, select: { id: true, defaultSupplierId: true } });
  // 구매 담당은 발주·입고 USE, 영업 담당은 둘 다 조회(VIEW)만 (seed.md, 권한표)
  cookies.purchase = await login('2207005');
  cookies.sales = await login('2103003');
}, 60_000);

afterAll(async () => {
  await app?.close();
});

describe('발주 취소·잔량 마감·입고 취소 경로 (API-284~286)', () => {
  it('구매 담당은 사유와 함께 세 동작을 할 수 있다', async () => {
    const cancelled = await orderOre('5');
    const closing = await orderOre('5', '2');
    const receipt = await orderOre('5', '1');

    const cancel = await post('purchase', `/purchase-orders/${cancelled.orderId}/cancel`, { reason: '공급 중단' });
    expect([cancel.status, cancel.body.success, cancel.body.data?.purchaseOrderStatus]).toEqual([200, true, 'CANCELLED']);
    const close = await post('purchase', `/purchase-orders/${closing.orderId}/close`, { reason: '잔량 포기' });
    expect([close.status, close.body.data?.purchaseOrderStatus, close.body.data?.totalClosedTon]).toEqual([200, 'CLOSED', '3.000']);
    const reversal = await post('purchase', `/goods-receipts/${receipt.receiptId}/cancel`, { reason: '오입고' });
    expect([reversal.status, reversal.body.data?.receivedTon, reversal.body.data?.reversedGoodsReceiptId]).toEqual([200, '-1.000', receipt.receiptId]);
  });

  it('사유가 500자를 넘거나 없으면 400(COM-004), 바꾼 것은 없다', async () => {
    const { orderId, receiptId } = await orderOre('5', '1');
    const long = '가'.repeat(501);

    for (const [path, body] of [
      [`/purchase-orders/${orderId}/cancel`, { reason: long }],
      [`/purchase-orders/${orderId}/close`, { reason: long }],
      [`/goods-receipts/${receiptId}/cancel`, { reason: long }],
      [`/goods-receipts/${receiptId}/cancel`, {}],
    ] as const) {
      const res = await post('purchase', path, body);
      expect([path, res.status, res.body.error?.code]).toEqual([path, 400, 'COM-004']);
    }
    expect((await purchasing.purchaseOrderDetail(orderId)).purchaseOrderStatus).toBe('PARTIALLY_RECEIVED');
    // 500자 정확히는 받는다
    expect((await post('purchase', `/purchase-orders/${orderId}/close`, { reason: '가'.repeat(500) })).status).toBe(200);
  });

  it('발주·입고 조회 권한만 있는 역할(영업)은 403(COM-002)', async () => {
    const { orderId, receiptId } = await orderOre('5', '1');

    for (const path of [`/purchase-orders/${orderId}/cancel`, `/purchase-orders/${orderId}/close`, `/goods-receipts/${receiptId}/cancel`]) {
      const res = await post('sales', path, { reason: '권한 시험' });
      expect([path, res.status, res.body.error?.code]).toEqual([path, 403, 'COM-002']);
    }
    expect((await purchasing.purchaseOrderDetail(orderId)).purchaseOrderStatus).toBe('PARTIALLY_RECEIVED');
  });
});
