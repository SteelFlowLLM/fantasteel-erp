// 출고 확정 서버 어댑터: 출하요청·수주·LOT 상세 → 화면 모양, 출고 전 재검증 표시, 확정(POST issue) 결과.
import type { ShipmentRequestDetail } from '@fantasteel/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { goodsIssueApi } from '@/api/goodsIssues';
import { fail, ok, page, stopFakeServer, useFakeServer, type ServerCall } from '@/api/server/serverTestKit';
import { SEED_EMPLOYEE_NO } from '@/test/actors';

const request = (over: Partial<ShipmentRequestDetail> = {}): ShipmentRequestDetail => ({
  id: 70,
  shipmentRequestNo: 'DR-2610-0001',
  customerId: 3,
  customerName: '나래조선',
  shipDate: '2026-10-10',
  shipmentRequestStatus: 'ALLOCATED',
  totalRequestQty: 2,
  issuedAt: null,
  createdAt: '2026-10-05T01:00:00.000Z',
  updatedAt: '2026-10-05T02:00:00.000Z',
  issuedEmployeeId: null,
  issuedEmployeeName: null,
  items: [
    {
      id: 701,
      salesOrderItemId: 51,
      salesOrderId: 50,
      salesOrderNo: 'SO-2610-0001',
      itemId: 61,
      itemCode: 'CL-SS275-8x1500',
      itemName: '열연코일 SS275 8x1500',
      requestQty: 2,
      unallocatedQty: 0,
      allocations: [
        { allocationId: 801, lotId: 501, lotNo: 'CL-001', allocationStatus: 'CONFIRMED' },
        { allocationId: 802, lotId: 502, lotNo: 'CL-002', allocationStatus: 'CONFIRMED' },
      ],
    },
  ],
  ...over,
});

/** 수주 상세: 어댑터는 items만 읽는다 */
const salesOrder50 = {
  id: 50,
  salesOrderNo: 'SO-2610-0001',
  items: [
    { salesOrderItemId: 49, itemId: 60, itemType: 'SLAB', theoreticalWeightTon: '20.000', orderedQty: 1, shippedQty: 0, unshippedQty: 1, activeReservedQty: 1, salesOrderItemStatus: 'OPEN' },
    { salesOrderItemId: 51, itemId: 61, itemType: 'COIL', theoreticalWeightTon: '18.840', orderedQty: 5, shippedQty: 1, unshippedQty: 4, activeReservedQty: 4, salesOrderItemStatus: 'PARTIALLY_SHIPPED' },
  ],
};

const lot = (id: number, lotNo: string, over: Record<string, unknown> = {}) => ({
  id,
  lotNo,
  lotType: 'COIL',
  lotStatus: 'AVAILABLE',
  producedDate: '2026-10-03',
  inspectionResult: 'PASS',
  heat: { id: 401, lotNo: 'HT-401' },
  ...over,
});

const heat = (id: number, inspectionResult: string) => ({ id, lotNo: `HT-${id}`, lotType: 'HEAT', lotStatus: 'CONSUMED', producedDate: null, inspectionResult, heat: null });

const lots: Record<string, unknown> = {
  '/lots/501': lot(501, 'CL-001'),
  '/lots/502': lot(502, 'CL-002', { heat: { id: 402, lotNo: 'HT-402' } }),
  '/lots/401': heat(401, 'PASS'),
  '/lots/402': heat(402, 'FAIL'),
};

/** 출하요청 70을 가진 기본 서버 응답 */
function respond(call: ServerCall, detail: ShipmentRequestDetail = request()) {
  if (call.path === '/shipment-requests/70') return ok(detail);
  if (call.path === '/sales-orders/50') return ok(salesOrder50);
  if (call.path in lots) return ok(lots[call.path]);
  if (call.path === '/mill-sheets') return ok(page([]));
  return undefined;
}

afterEach(() => stopFakeServer());

describe('출고 확정 서버 어댑터 (api/server/goodsIssues.ts)', () => {
  it('상세: 수주 상세에서 이론중량·수주 줄 번호·출하 매수를, LOT 상세에서 검사·히트를 채운다', async () => {
    useFakeServer(SEED_EMPLOYEE_NO.logisticsHead, (c) => respond(c));
    const view = await goodsIssueApi.detail(70);
    expect(view).toMatchObject({ id: 70, customerName: '나래조선', requestedShipDate: '2026-10-10', requesterName: null, totalAllocatedQty: 2, waitingAllocationQty: 0, totalWeightTon: '37.680' });
    expect(view.lines[0]).toMatchObject({ lineNo: 1, salesOrderLineNo: 2, itemType: 'COIL', theoreticalWeightTon: '18.840', requestTon: '37.680', orderedQty: 5, shippedQty: 1, convertedQty: 1, salesOrderItemStatus: 'PARTIALLY_SHIPPED' });
    expect(view.lines[0].lots).toEqual([
      expect.objectContaining({ lotNo: 'CL-001', heatNo: 'HT-401', producedDate: '2026-10-03', productInspectionResult: 'PASS', heatInspectionResult: 'PASS', eligibility: 'ELIGIBLE' }),
      expect.objectContaining({ lotNo: 'CL-002', heatNo: 'HT-402', heatInspectionResult: 'FAIL', eligibility: 'HEAT_FAILED' }),
    ]);
    // 상위 히트 불합격 LOT이 있으면 출고 불가로 보인다 (확정은 서버가 다시 확인한다)
    expect(view.ready).toBe(false);
    expect(view.problems).toEqual([{ code: 'INV-002', message: '미검사·불합격 LOT은 출고할 수 없어요', lotNo: 'CL-002' }]);
  });

  it('재검증: 배정 대기는 INV-001, 소진 LOT은 INV-004, 미출하·예약보다 많으면 SHP-002', async () => {
    const detail = request({
      totalRequestQty: 5,
      items: [{ ...request().items[0], requestQty: 5, allocations: [{ allocationId: 801, lotId: 501, lotNo: 'CL-001', allocationStatus: 'CONFIRMED' }] }],
    });
    lots['/lots/501'] = lot(501, 'CL-001', { lotStatus: 'SHIPPED' });
    try {
      useFakeServer(SEED_EMPLOYEE_NO.logisticsHead, (c) => respond(c, detail));
      const view = await goodsIssueApi.detail(70);
      expect(view.problems.map((p) => [p.code, p.lotNo])).toEqual([
        ['INV-001', null],
        ['SHP-002', null],
        ['INV-004', 'CL-001'],
      ]);
    } finally {
      lots['/lots/501'] = lot(501, 'CL-001');
    }
  });

  it('수주 조회 권한이 없으면(품질) 규격 목록에서 이론중량을 읽고 수주 잔량 확인은 건너뛴다', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.quality, (c) => {
      if (c.path === '/sales-orders/50') return fail(403, 'COM-002', '권한이 없습니다');
      if (c.path === '/items') return ok([{ id: 61, itemCode: 'CL-SS275-8x1500', itemType: 'COIL', theoreticalWeightTon: '18.840' }]);
      return respond(c);
    });
    const view = await goodsIssueApi.detail(70);
    expect(view.totalWeightTon).toBe('37.680');
    expect(view.lines[0]).toMatchObject({ itemType: 'COIL', orderedQty: 0, shippedQty: 0, salesOrderLineNo: 0 });
    expect(view.problems.map((p) => p.code)).toEqual(['INV-002']);
    expect(calls.filter((c) => c.path === '/items')).toHaveLength(1);
  });

  it('목록: 취소는 빼고 배정 확정 → 배정 대기 → 출고 완료 순, 출고 완료는 LOT을 읽지 않는다', async () => {
    const summaries = [
      { id: 71, shipmentRequestStatus: 'ISSUED' },
      { id: 72, shipmentRequestStatus: 'REQUESTED' },
      { id: 73, shipmentRequestStatus: 'CANCELLED' },
      { id: 70, shipmentRequestStatus: 'ALLOCATED' },
    ];
    const issued = request({
      id: 71,
      shipmentRequestNo: 'DR-2610-0002',
      shipmentRequestStatus: 'ISSUED',
      issuedAt: '2026-10-06T01:00:00.000Z',
      issuedEmployeeName: '신현우',
      items: [{ ...request().items[0], allocations: [{ allocationId: 803, lotId: 503, lotNo: 'CL-003', allocationStatus: 'CONSUMED' }] }],
    });
    const waiting = request({ id: 72, shipmentRequestNo: 'DR-2610-0003', shipmentRequestStatus: 'REQUESTED', shipDate: '2026-10-08', items: [{ ...request().items[0], allocations: [] }] });
    const calls = useFakeServer(SEED_EMPLOYEE_NO.logisticsHead, (c) => {
      if (c.path === '/shipment-requests') return ok(page(summaries));
      if (c.path === '/shipment-requests/71') return ok(issued);
      if (c.path === '/shipment-requests/72') return ok(waiting);
      return respond(c);
    });
    const rows = await goodsIssueApi.queue();
    expect(rows.map((r) => [r.shipmentRequestId, r.shipmentRequestStatus, r.ready])).toEqual([
      [70, 'ALLOCATED', false],
      [72, 'REQUESTED', false],
      [71, 'ISSUED', false],
    ]);
    expect(rows[2]).toMatchObject({ issuedEmployeeName: '신현우', totalAllocatedQty: 1, totalWeightTon: '37.680', problems: [] });
    expect(rows[1].problems.map((p) => p.code)).toEqual(['INV-001']);
    expect(calls.some((c) => c.path === '/lots/503' || c.path === '/shipment-requests/73')).toBe(false);
    // 같은 수주는 한 번만 읽는다
    expect(calls.filter((c) => c.path === '/sales-orders/50')).toHaveLength(1);
  });

  it('확정: POST issue 뒤 출고 LOT 번호와 발행된 밀시트를 돌려준다', async () => {
    const issued = request({
      shipmentRequestStatus: 'ISSUED',
      items: [{ ...request().items[0], allocations: request().items[0].allocations.map((a) => ({ ...a, allocationStatus: 'CONSUMED' as const })) }],
    });
    const calls = useFakeServer(SEED_EMPLOYEE_NO.logisticsHead, (c) => {
      if (c.method === 'POST' && c.path === '/shipment-requests/70/issue') return ok(issued);
      if (c.path === '/mill-sheets') return ok(page([{ id: 9, millSheetNo: 'MS-2610-0001-1', shipmentRequestId: 70, salesOrderId: 50, issuedAt: '2026-10-07T01:00:00.000Z', pdfPath: null }]));
      return undefined;
    });
    const result = await goodsIssueApi.confirm({ shipmentRequestId: 70, expectedUpdatedAt: '2026-10-05T02:00:00.000Z' });
    expect(result).toEqual({ shipmentRequestNo: 'DR-2610-0001', issuedLotNos: ['CL-001', 'CL-002'], millSheets: [{ id: 9, millSheetNo: 'MS-2610-0001-1' }] });
    expect(calls.find((c) => c.method === 'POST')).toMatchObject({ path: '/shipment-requests/70/issue', body: undefined });
    expect(calls.find((c) => c.path === '/mill-sheets')?.query).toMatchObject({ shipmentRequestId: '70' });
  });

  it('확정 실패: 서버 업무 오류(INV-002)를 그대로 화면 오류로 던진다', async () => {
    useFakeServer(SEED_EMPLOYEE_NO.logisticsHead, (c) => (c.path === '/shipment-requests/70/issue' ? fail(409, 'INV-002', 'CL-002 · 상위 히트 불합격') : undefined));
    await expect(goodsIssueApi.confirm({ shipmentRequestId: 70 })).rejects.toMatchObject({ code: 'INV-002' });
  });
});
