// 발주·입고 서버 어댑터: 발주 목록에 입고 내역 붙이기, 발주 후보, 공급업체별 차례 발주(중간 실패), 입고 줄·내역·확정, 구매요청 상세의 연결 발주.
import type { GoodsReceiptView, PurchaseOrderView, PurchaseRequisitionDetail, PurchaseRequisitionSummary } from '@fantasteel/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { goodsReceiptApi } from '@/api/goodsReceipts';
import { purchaseOrderApi, purchaseRequisitionApi } from '@/api/purchasing';
import { fail, ok, page, stopFakeServer, useFakeServer, type ServerCall } from '@/api/server/serverTestKit';
import { getMockDb } from '@/mock/db';
import { SEED_EMPLOYEE_NO } from '@/test/actors';

const mockItem = (itemCode: string) => getMockDb().read((t) => t.item.find((i) => i.itemCode === itemCode));
const mockYardName = (itemCode: string) => getMockDb().read((t) => t.yard.find((y) => y.id === mockItem(itemCode)?.defaultYardId)?.yardName);

const order: PurchaseOrderView = {
  id: 31,
  purchaseOrderNo: 'PO-2610-0001',
  purchaseOrderStatus: 'PARTIALLY_RECEIVED',
  supplierId: 8,
  supplierName: '한국합금철',
  orderedEmployeeName: '정다은',
  totalOrderedTon: '5.000',
  totalReceivedTon: '1.500',
  totalRemainingTon: '3.500',
  createdAt: '2026-10-06T01:00:00.000Z',
  updatedAt: '2026-10-06T02:00:00.000Z',
  items: [
    { purchaseOrderItemId: 61, purchaseRequisitionId: 901, purchaseRequisitionNo: 'PR-2610-0001', itemId: 41, itemCode: 'SMN01', itemName: '실리코망가니즈', orderedTon: '5.000', expectedReceiptDate: '2026-10-10', receivedTon: '1.500', remainingTon: '3.500' },
  ],
};
const receipt: GoodsReceiptView = {
  id: 71,
  goodsReceiptNo: 'GR-2610-0001',
  purchaseOrderId: 31,
  purchaseOrderNo: 'PO-2610-0001',
  purchaseOrderItemId: 61,
  itemId: 41,
  itemCode: 'SMN01',
  itemName: '실리코망가니즈',
  receivedTon: '1.500',
  receivedDate: '2026-10-06',
  lotId: 501,
  lotNo: 'RM-SMN01-261006-001',
  yardId: 2,
  yardName: '원료 야드',
  confirmedEmployeeName: '정다은',
  createdAt: '2026-10-06T02:00:00.000Z',
};
const approved: PurchaseRequisitionSummary = {
  id: 902,
  purchaseRequisitionNo: 'PR-2610-0002',
  purchaseRequisitionStatus: 'APPROVED',
  itemId: 41,
  itemCode: 'SMN01',
  itemName: '실리코망가니즈',
  defaultSupplierId: 8,
  defaultSupplierName: '한국합금철',
  requestedTon: '2.000',
  desiredReceiptDate: '2026-10-20',
  requesterId: 77,
  requesterName: '정다은',
  departmentId: 55,
  departmentName: '구매부',
  approverId: 74,
  approverName: '최준혁',
  approvedAt: '2026-10-06T03:00:00.000Z',
  productionPlanId: null,
  productionPlanNo: null,
  actionDraftId: null,
  purchaseOrderNo: null,
  rejectedAt: null,
  createdAt: '2026-10-06T01:00:00.000Z',
  updatedAt: '2026-10-06T03:00:00.000Z',
};

function respond(c: ServerCall) {
  if (c.path === '/purchase-orders' && c.method === 'GET') return ok(page([order]));
  if (c.path === '/purchase-orders/31') return ok(order);
  if (c.path === '/goods-receipts' && c.method === 'GET') return ok(page([receipt]));
  return undefined;
}

afterEach(() => stopFakeServer());

describe('발주·입고 서버 어댑터 (api/server/purchaseOrders.ts)', () => {
  it('발주 목록: 품목별 입고 내역을 입고 목록에서 붙이고 원료 id는 화면 id, 발주자는 서버 값 그대로. 입고 조회 권한이 없으면 입고 내역만 빈다', async () => {
    useFakeServer(SEED_EMPLOYEE_NO.purchase, respond);
    const [po] = await purchaseOrderApi.list();
    expect(po).toMatchObject({ id: 31, supplierId: 8, orderedEmployeeName: '정다은' });
    expect(po.items[0]).toMatchObject({ id: 61, itemId: mockItem('SMN01')?.id, remainingTon: '3.500', goodsReceipts: [{ id: 71, receivedDate: '2026-10-06', lotNo: 'RM-SMN01-261006-001' }] });
    stopFakeServer();

    useFakeServer(SEED_EMPLOYEE_NO.purchase, (c) => (c.path === '/goods-receipts' ? fail(403, 'COM-002', '권한이 없어요') : respond(c)));
    expect((await purchaseOrderApi.list())[0].items[0].goodsReceipts).toEqual([]);
  });

  it('발주 후보: 승인된 요청을 원료의 기본 공급업체와 함께', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.purchase, (c) => (c.path === '/purchase-requisitions' ? ok(page([approved])) : undefined));
    expect(await purchaseOrderApi.candidateItems()).toEqual([expect.objectContaining({ id: 902, supplierId: 8, supplierName: '한국합금철', source: 'DIRECT' })]);
    expect(calls[0].query.purchaseRequisitionStatus).toBe('APPROVED');
  });

  it('발주 확정: 공급업체마다 차례로 보내고, 입고 예정일을 비우면 보내지 않는다. 중간에 실패하면 먼저 만든 발주 번호를 알린다', async () => {
    let posted = 0;
    const calls = useFakeServer(SEED_EMPLOYEE_NO.purchase, (c) => {
      if (c.method !== 'POST') return undefined;
      posted += 1;
      return posted === 1 ? ok(order) : fail(409, 'COM-001', '이미 발주된 구매요청이에요');
    });
    const items = [{ purchaseRequisitionId: 902, orderedTon: '2.000', expectedReceiptDate: '' }];
    const failure = await purchaseOrderApi.create([{ supplierId: 8, items }, { supplierId: 9, items }]).catch((e: unknown) => e);

    expect(calls.map((c) => c.body)).toEqual([
      { supplierId: 8, items: [{ purchaseRequisitionId: 902, orderedTon: '2.000' }] },
      { supplierId: 9, items: [{ purchaseRequisitionId: 902, orderedTon: '2.000' }] },
    ]);
    expect(failure).toMatchObject({ code: 'COM-001', detail: expect.stringContaining('PO-2610-0001') });
  });

  it('입고 줄·내역: 기본 야드는 원료 코드로, 공급업체는 발주에서 채우고 확정자는 서버 값 그대로', async () => {
    useFakeServer(SEED_EMPLOYEE_NO.purchase, respond);
    expect(await goodsReceiptApi.lines()).toEqual([expect.objectContaining({ purchaseOrderItemId: 61, supplierName: '한국합금철', defaultYardName: mockYardName('SMN01'), isFullyReceived: false })]);
    expect(await goodsReceiptApi.list()).toEqual([expect.objectContaining({ id: 71, supplierName: '한국합금철', confirmedEmployeeName: '정다은', itemId: mockItem('SMN01')?.id })]);
  });

  it('입고 확정: 입력 그대로 보내고, 발주를 다시 읽어 상태·입고 누계·미입고량을 채운다', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.purchase, (c) => (c.path === '/goods-receipts' && c.method === 'POST' ? ok(receipt) : respond(c)));
    const result = await goodsReceiptApi.receive({ purchaseOrderItemId: 61, receivedTon: '1.5', receivedDate: '2026-10-06' });

    expect(calls[0].body).toEqual({ purchaseOrderItemId: 61, receivedTon: '1.5', receivedDate: '2026-10-06' });
    expect(result).toMatchObject({ lotNo: 'RM-SMN01-261006-001', yardName: '원료 야드', purchaseOrderStatus: 'PARTIALLY_RECEIVED', lineReceivedTon: '1.500', lineRemainingTon: '3.500' });
  });

  it('구매요청 상세: 발주됐으면 연결 발주 줄을 발주 목록에서 채운다', async () => {
    const detail: PurchaseRequisitionDetail = { ...approved, id: 901, purchaseRequisitionStatus: 'ORDERED', purchaseOrderNo: 'PO-2610-0001', requestReason: null, rejectReason: null, salesOrderId: null, salesOrderNo: null };
    useFakeServer(SEED_EMPLOYEE_NO.purchase, (c) => (c.path === '/purchase-requisitions/901' ? ok(detail) : respond(c)));
    expect((await purchaseRequisitionApi.detail(901)).purchaseOrderLines).toEqual([
      { purchaseOrderId: 31, purchaseOrderNo: 'PO-2610-0001', purchaseOrderStatus: 'PARTIALLY_RECEIVED', supplierName: '한국합금철', expectedReceiptDate: '2026-10-10', itemName: '실리코망가니즈', orderedTon: '5.000', receivedTon: '1.500', remainingTon: '3.500' },
    ]);
  });
});
