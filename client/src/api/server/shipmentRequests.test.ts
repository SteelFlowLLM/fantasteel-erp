// 출하요청·출하 배정 서버 어댑터(api/server/shipmentRequests.ts): 상세 화면 모양(톤·배정 대기·LOT 야드·추천), 배정 확정, 목록 합계.
import { afterEach, describe, expect, it } from 'vitest';
import { fail, ok, page, stopFakeServer, useFakeServer, type ServerCall } from '@/api/server/serverTestKit';
import { shipmentRequestApi } from '@/api/shipmentRequests';
import { SEED_EMPLOYEE_NO } from '@/test/actors';

afterEach(() => stopFakeServer());

const line = (id: number, requestQty: number, allocations: { allocationId: number; lotId: number }[]) => ({
  id,
  salesOrderItemId: 72,
  salesOrderId: 9,
  salesOrderNo: 'SO-2610-0009',
  itemId: 301,
  itemCode: 'SL-SM355C-250x1500x10000',
  itemName: 'SM355C 슬래브',
  itemType: 'SLAB',
  theoreticalWeightTon: '29.438',
  steelGradeCode: 'SM355C',
  requestQty,
  unallocatedQty: requestQty - allocations.length,
  allocations: allocations.map((a) => ({ ...a, lotNo: `SL-${a.lotId}`, allocationStatus: 'CONFIRMED' })),
});
const request = (id: number, shipmentRequestStatus: string, items = [line(701, 4, [{ allocationId: 801, lotId: 501 }])]) => ({
  id,
  shipmentRequestNo: `DR-2610-000${id}`,
  customerId: 52,
  customerName: '새고객',
  shipDate: '2026-10-20',
  shipmentRequestStatus,
  totalRequestQty: items.reduce((sum, i) => sum + i.requestQty, 0),
  issuedAt: null,
  createdAt: '2026-10-13T00:00:00.000Z',
  updatedAt: '2026-10-13T00:00:00.000Z',
  issuedEmployeeId: null,
  issuedEmployeeName: null,
  items,
});
const salesOrder = { items: [{ salesOrderItemId: 72, orderedQty: 6, shippedQty: 0, dueDate: '2026-11-30', salesOrderItemStatus: 'OPEN' }] };
const allocationView = { id: 801, lotId: 501, lotNo: 'SL-501', producedDate: '2026-10-01', heatNo: 'HT-BOF1-261001-001', yardId: 7, yardName: '슬래브 1야드', createdAt: '2026-10-13T01:00:00.000Z' };
const candidate = (lotId: number, isRecommended: boolean) => ({ lotId, lotNo: `SL-${lotId}`, producedDate: '2026-10-02', heatNo: 'HT-BOF1-261002-001', yardId: 7, yardName: '슬래브 1야드', isRecommended });

describe('출하요청 서버 어댑터', () => {
  it('상세: 요청 톤 = 매수 × 이론중량, 배정 대기 = 요청 − 배정, 배정 LOT의 야드는 LOT 자체 야드, 추천 LOT은 후보 중 추천된 것', async () => {
    useFakeServer(SEED_EMPLOYEE_NO.sales, (c: ServerCall) => {
      if (c.path === '/shipment-requests/1') return ok(request(1, 'REQUESTED'));
      if (c.path === '/sales-orders/9') return ok(salesOrder);
      if (c.path === '/allocations') return ok([allocationView]);
      if (c.path === '/allocations/recommendations') return ok([{ shipmentRequestItemId: 701, candidates: [candidate(502, true), candidate(503, false)] }]);
      if (c.path === '/mill-sheets') return ok(page([]));
      return undefined;
    });
    const detail = await shipmentRequestApi.detail(1);
    expect(detail.editable).toBe(true);
    expect(detail.lines[0]).toMatchObject({ itemType: 'SLAB', steelGradeCode: 'SM355C', requestTon: '117.752', allocatedQty: 1, waitingAllocationQty: 3, orderedQty: 6, dueDate: '2026-11-30' });
    expect(detail.lines[0].allocations[0]).toMatchObject({ lotNo: 'SL-501', yardId: 7, yardName: '슬래브 1야드', heatNo: 'HT-BOF1-261001-001' });
    expect(detail.lines[0].recommendedLots.map((l) => l.lotId)).toEqual([502]);
    expect(detail.lines[0].candidateLots.map((l) => [l.lotId, l.yardName])).toEqual([
      [502, '슬래브 1야드'],
      [503, '슬래브 1야드'],
    ]);
  });

  it('상세: 출고한 요청은 고칠 수 없어 배정 후보를 읽지 않고, 배정 조회 권한이 없으면 배정 LOT 정보는 비운다', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.sales, (c: ServerCall) => {
      if (c.path === '/shipment-requests/1') return ok(request(1, 'ISSUED'));
      if (c.path === '/sales-orders/9') return ok(salesOrder);
      if (c.path === '/allocations') return fail(403, 'COM-002', '권한이 없어요');
      if (c.path === '/mill-sheets') return ok(page([]));
      return undefined;
    });
    const detail = await shipmentRequestApi.detail(1);
    expect(detail.editable).toBe(false);
    expect(detail.lines[0].allocations[0]).toMatchObject({ lotNo: 'SL-501', yardName: null, producedDate: '' });
    expect(calls.some((c) => c.path === '/allocations/recommendations')).toBe(false);
  });

  it('배정 확정: 고른 LOT이 있는 품목만 추천을 로그로 남기고 POST하고, 확정 매수와 다시 읽은 상태를 돌려준다', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.sales, (c: ServerCall) => {
      if (c.method === 'POST' && c.path === '/allocations/recommend') return ok({ allocationPurpose: 'SHIPMENT', shipmentRequestItemId: 701, itemId: 1, unallocatedQty: 2, candidates: [] });
      if (c.method === 'POST' && c.path === '/allocations') return ok([allocationView, { ...allocationView, id: 802, lotId: 502 }]);
      if (c.path === '/shipment-requests/1') return ok(request(1, 'ALLOCATED'));
      return undefined;
    });
    const result = await shipmentRequestApi.confirmAllocations({ shipmentRequestId: 1, lines: [{ shipmentRequestItemId: 701, lotIds: [501, 502] }, { shipmentRequestItemId: 702, lotIds: [] }] });
    expect(result).toEqual({ confirmedQty: 2, shipmentRequestStatus: 'ALLOCATED' });
    expect(calls.filter((c) => c.method === 'POST').map((c) => [c.path, c.body])).toEqual([
      ['/allocations/recommend', { allocationPurpose: 'SHIPMENT', shipmentRequestItemId: 701 }],
      ['/allocations', { allocationPurpose: 'SHIPMENT', shipmentRequestItemId: 701, lotIds: [501, 502] }],
    ]);
  });

  it('목록: 요청 톤 합계, 취소된 요청은 배정 대기 0', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.sales, (c: ServerCall) => {
      if (c.path === '/shipment-requests') return ok(page([request(1, 'REQUESTED'), request(2, 'CANCELLED')]));
      if (c.path === '/mill-sheets') return ok(page([]));
      return undefined;
    });
    const rows = await shipmentRequestApi.list();
    // 목록 한 번에 줄마다 상세(품목·배정)까지 받는다: 건마다 상세를 따로 부르지 않는다 (N+1 없음, 이슈 #476)
    expect(calls.filter((c) => c.path === '/shipment-requests')[0].query).toMatchObject({ withItems: 'true' });
    expect(calls.filter((c) => /^\/shipment-requests\/\d+$/.test(c.path))).toEqual([]);
    expect(rows.map((r) => [r.shipmentRequestNo, r.totalWeightTon, r.waitingAllocationQty])).toEqual([
      ['DR-2610-0001', '117.752', 3],
      ['DR-2610-0002', '117.752', 0],
    ]);
  });
});
