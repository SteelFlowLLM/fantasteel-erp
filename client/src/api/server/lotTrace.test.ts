// LOT 추적 서버 어댑터: 번호 → id 찾기, 추적 응답 → 화면 모양, 출하요청 번호로 시작하는 추적(LOT별 역추적 합치기), LOT 상세.
import { afterEach, describe, expect, it } from 'vitest';
import { lotTraceApi } from '@/api/lotTrace';
import { fail, ok, page, stopFakeServer, useFakeServer, type ServerCall } from '@/api/server/serverTestKit';
import { SEED_EMPLOYEE_NO } from '@/test/actors';

const summary = (id: number, lotNo: string, lotType: string, over: Record<string, unknown> = {}) => ({
  id,
  lotNo,
  lotType,
  lotStatus: 'AVAILABLE',
  itemId: null,
  itemCode: null,
  itemName: null,
  steelGradeCode: null,
  yardName: null,
  producedDate: '2026-10-06',
  initialTon: null,
  remainingTon: null,
  inspectionResult: null,
  ...over,
});

const heat = summary(10, 'HT-001', 'HEAT', { steelGradeCode: 'SS275', inspectionResult: 'PASS' });
const slab1 = summary(11, 'HT-001-01', 'SLAB', { itemCode: 'SL-1', itemName: '슬래브', steelGradeCode: 'SS275', lotStatus: 'SHIPPED', inspectionResult: 'PASS', producedDate: null });
const slab2 = summary(12, 'HT-001-02', 'SLAB', { itemCode: 'SL-1', itemName: '슬래브', steelGradeCode: 'SS275', inspectionResult: 'PASS' });
const hotMetal = summary(5, 'HM-001', 'HOT_METAL');
const node = (lot: Record<string, unknown>, depth: number, isStart: boolean, over: Record<string, unknown> = {}) => ({ ...lot, depth, isStart, rawMaterialType: null, blastFurnaceCode: null, converterCode: null, ...over });
const edge = (id: number, parentLotId: number, childLotId: number) => ({ id, parentLotId, childLotId, lotRelationEvidence: 'ACTUAL_INPUT', inputTon: null, periodStartedAt: null, periodEndedAt: null });

const shipmentRow = (salesOrderId: number, salesOrderNo: string, lotIds: number[], millSheetId: number) => ({
  shipmentRequestId: 1,
  shipmentRequestNo: 'DR-2610-0001',
  shipmentRequestStatus: 'ISSUED',
  allocationStatus: 'CONSUMED',
  issuedAt: '2026-10-07T01:00:00.000Z',
  customerName: '가람중공업',
  salesOrder: { salesOrderId, salesOrderNo },
  millSheets: [{ id: millSheetId, millSheetNo: `MS-2610-0001-${millSheetId}`, salesOrderId }],
  lotIds,
});

const impact = { slabCount: 2, coilCount: 0, shippedLotCount: 1, unshippedLotCount: 1, consumedLotCount: 0, salesOrders: [] };

const forwardTrace = {
  start: heat,
  direction: 'forward',
  nodes: [node(heat, 0, true, { converterCode: 'BOF1' }), node(slab1, 1, false), node(slab2, 1, false)],
  edges: [edge(1, 10, 11), edge(2, 10, 12)],
  shipments: [shipmentRow(2, 'SO-2610-002', [12], 2), shipmentRow(1, 'SO-2610-001', [11], 1)],
  impact,
};

const items = [{ id: 61, itemCode: 'SL-1', itemType: 'SLAB', thicknessMm: '250.00', widthMm: '1200.00', lengthMm: '10000.00', theoreticalWeightTon: '23.550' }];

/** GET /lots?lotNo=는 앞부분 일치 */
function lotsByPrefix(call: ServerCall, all: readonly { lotNo: string }[]) {
  const prefix = (call.query.lotNo ?? '').toUpperCase();
  return ok(page(all.filter((l) => l.lotNo.toUpperCase().startsWith(prefix))));
}

afterEach(() => stopFakeServer());

describe('LOT 추적 서버 어댑터 (api/server/lotTrace.ts)', () => {
  it('LOT 검색: 서버 앞부분 검색, 정확히 같은 번호가 맨 앞, 한 줄 요약은 가짜 DB와 같은 규칙', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.steelmaking, (c) =>
      c.path === '/lots' ? ok(page([slab1, heat, summary(1, 'ORE-1', 'RAW_MATERIAL', { itemCode: 'ORE01', itemName: '철광석' })], 3)) : undefined,
    );
    const result = await lotTraceApi.searchLots({ keyword: ' ht-001 ', lotType: '', limit: 20 });
    expect(calls[0].query).toEqual({ lotNo: 'HT-001', page: '1', size: '20' });
    expect(result.total).toBe(3);
    expect(result.items.map((l) => [l.lotNo, l.summary, l.producedDate])).toEqual([
      ['HT-001', 'SS275', '2026-10-06'],
      ['HT-001-01', 'SS275 · SL-1', ''],
      ['ORE-1', '철광석 (ORE01)', '2026-10-06'],
    ]);
    await lotTraceApi.searchLots({ lotType: 'COIL', limit: 500 });
    expect(calls[1].query).toEqual({ lotType: 'COIL', page: '1', size: '100' });
  });

  it('번호로 추적: 정확히 같은 번호의 id로 trace를 부르고 출하는 출하요청 한 줄에 수주를 모은다', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.steelmaking, (c) => {
      if (c.path === '/lots') return lotsByPrefix(c, [slab1, slab2, heat]);
      if (c.path === '/lots/10/trace') return ok(forwardTrace);
      if (c.path === '/items') return ok(items);
      return undefined;
    });
    const view = await lotTraceApi.trace({ lotNo: 'HT-001', direction: 'forward' });
    expect(calls.find((c) => c.path === '/lots/10/trace')?.query).toEqual({ direction: 'forward' });
    expect(view.start).toEqual({ kind: 'LOT', lotId: 10, lotNo: 'HT-001', lotType: 'HEAT', lotStatus: 'AVAILABLE', inspectionResult: 'PASS', summary: 'BOF1 · SS275' });
    expect(view.nodes.map((n) => [n.lotNo, n.depth, n.isStart, n.theoreticalWeightTon, n.producedDate])).toEqual([
      ['HT-001', 0, true, null, '2026-10-06'],
      ['HT-001-01', 1, false, '23.550', ''],
      ['HT-001-02', 1, false, '23.550', '2026-10-06'],
    ]);
    expect(view.edges).toHaveLength(2);
    expect(view.impact).toEqual(impact);
    expect(view.shipments).toEqual([
      {
        shipmentRequestId: 1,
        shipmentRequestNo: 'DR-2610-0001',
        shipmentRequestStatus: 'ISSUED',
        customerName: '가람중공업',
        requestedShipDate: '',
        issuedAt: '2026-10-07T01:00:00.000Z',
        salesOrders: [
          { salesOrderId: 1, salesOrderNo: 'SO-2610-001' },
          { salesOrderId: 2, salesOrderNo: 'SO-2610-002' },
        ],
        lotIds: [12, 11],
        millSheets: [
          { id: 1, millSheetNo: 'MS-2610-0001-1', salesOrderId: 1 },
          { id: 2, millSheetNo: 'MS-2610-0001-2', salesOrderId: 2 },
        ],
      },
    ]);
  });

  it('없는 LOT 번호는 COM-003 (앞부분만 같은 LOT은 고르지 않는다)', async () => {
    useFakeServer(SEED_EMPLOYEE_NO.steelmaking, (c) => (c.path === '/lots' ? lotsByPrefix(c, [slab1, slab2]) : undefined));
    await expect(lotTraceApi.trace({ lotNo: 'HT-001' })).rejects.toMatchObject({ code: 'COM-003' });
  });

  it('출하요청 번호로 추적: 배정 LOT마다 역추적해 합치고, 같은 LOT은 가장 가까운 거리로 한 번만 둔다', async () => {
    const request = {
      id: 1,
      shipmentRequestNo: 'DR-2610-0001',
      customerId: 2,
      customerName: '가람중공업',
      shipDate: '2026-10-09',
      shipmentRequestStatus: 'ISSUED',
      issuedAt: '2026-10-07T01:00:00.000Z',
      items: [
        { id: 1, salesOrderId: 1, salesOrderNo: 'SO-2610-001', allocations: [{ allocationId: 1, lotId: 11, lotNo: 'HT-001-01', allocationStatus: 'CONSUMED' }] },
        { id: 2, salesOrderId: 1, salesOrderNo: 'SO-2610-001', allocations: [{ allocationId: 2, lotId: 12, lotNo: 'HT-001-02', allocationStatus: 'CONSUMED' }] },
      ],
    };
    const backward = (start: Record<string, unknown>, id: number) => ({
      start,
      direction: 'backward',
      nodes: [node(start, 0, true), node(heat, 1, false), node(hotMetal, 2, false)],
      edges: [edge(id, 10, id), edge(9, 5, 10)],
      shipments: [],
      impact: null,
    });
    const calls = useFakeServer(SEED_EMPLOYEE_NO.logisticsHead, (c) => {
      if (c.path === '/shipment-requests') return ok(page([{ id: 2, shipmentRequestNo: 'DR-2610-0002' }, request]));
      if (c.path === '/shipment-requests/1') return ok(request);
      if (c.path === '/mill-sheets') return ok(page([{ id: 7, millSheetNo: 'MS-2610-0001-1', salesOrderId: 1 }]));
      if (c.path === '/lots/11/trace') return ok(backward(slab1, 11));
      if (c.path === '/lots/12/trace') return ok(backward(slab2, 12));
      // 물류는 규격 목록 권한이 없다 → 이론중량은 비운다
      if (c.path === '/items') return fail(403, 'COM-002', '권한이 없습니다');
      return undefined;
    });
    const view = await lotTraceApi.trace({ shipmentRequestNo: 'dr-2610-0001' });
    expect(calls.filter((c) => c.path.endsWith('/trace')).map((c) => c.query.direction)).toEqual(['backward', 'backward']);
    expect(view.direction).toBe('backward');
    expect(view.impact).toBeNull();
    expect(view.start).toEqual({ kind: 'SHIPMENT_REQUEST', shipment: view.shipments[0] });
    expect(view.shipments[0]).toMatchObject({ requestedShipDate: '2026-10-09', salesOrders: [{ salesOrderId: 1, salesOrderNo: 'SO-2610-001' }], lotIds: [11, 12], millSheets: [{ id: 7, millSheetNo: 'MS-2610-0001-1', salesOrderId: 1 }] });
    expect(view.nodes.map((n) => [n.id, n.depth, n.isStart, n.theoreticalWeightTon])).toEqual([
      [11, 0, true, null],
      [12, 0, true, null],
      [10, 1, false, null],
      [5, 2, false, null],
    ]);
    expect(view.edges.map((e) => e.id)).toEqual([9, 11, 12]);
  });

  it('출하요청 번호: 없으면 COM-003, 출하요청 조회 권한이 없으면 COM-002, 검색은 권한이 없으면 빈 결과', async () => {
    useFakeServer(SEED_EMPLOYEE_NO.logisticsHead, (c) => (c.path === '/shipment-requests' ? ok(page([{ id: 1, shipmentRequestNo: 'DR-2610-0001', shipmentRequestStatus: 'ISSUED', customerName: '가람중공업' }])) : undefined));
    await expect(lotTraceApi.trace({ shipmentRequestNo: 'DR-2610-0009' })).rejects.toMatchObject({ code: 'COM-003' });
    expect(await lotTraceApi.searchShipmentRequests('0001')).toEqual([{ id: 1, shipmentRequestNo: 'DR-2610-0001', shipmentRequestStatus: 'ISSUED', customerName: '가람중공업' }]);
    expect(await lotTraceApi.searchShipmentRequests('  ')).toEqual([]);
    stopFakeServer();

    useFakeServer(SEED_EMPLOYEE_NO.steelmaking, (c) => (c.path === '/shipment-requests' ? fail(403, 'COM-002', '권한이 없습니다') : undefined));
    await expect(lotTraceApi.trace({ shipmentRequestNo: 'DR-2610-0001' })).rejects.toMatchObject({ code: 'COM-002' });
    expect(await lotTraceApi.searchShipmentRequests('DR')).toEqual([]);
  });

  it('LOT 상세: 서버 값을 화면 모양으로 옮기고, 서버에 없는 값은 비우며 치수·이론중량은 규격 목록에서 채운다', async () => {
    const detail = {
      ...slab1,
      steelGradeName: 'SS275',
      rawMaterialType: null,
      goodsReceiptNo: null,
      blastFurnaceCode: null,
      converterCode: null,
      yardName: '슬래브 야드',
      heat: { id: 10, lotNo: 'HT-001' },
      isEligible: true,
      disposition: { dispositionStatus: 'HOLD', dispositionReason: '재검사' },
      inspection: {
        inspectionResult: 'PASS',
        inspectedAt: '2026-10-07T00:00:00.000Z',
        inspectorName: '서민지',
        processType: 'CONTINUOUS_CASTING',
        inspectionStandardCode: 'QS-SS275-CC',
        standardVersion: 1,
        values: [
          { inspectionItemCode: 'A', inspectionItemName: '가', unit: null, minValue: null, maxValue: '1.0000', measuredValue: '0.5000', isPassed: true },
          { inspectionItemCode: 'B', inspectionItemName: '나', unit: null, minValue: null, maxValue: null, measuredValue: '2.0000', isPassed: null },
        ],
      },
      allocations: [{ id: 3, allocationPurpose: 'SHIPMENT', allocationStatus: 'CONSUMED', shipmentRequest: { id: 1, shipmentRequestNo: 'DR-2610-0001' }, productionPlan: null }],
      parents: [{ relationId: 1, lotId: 10, lotNo: 'HT-001', lotType: 'HEAT', lotRelationEvidence: 'ACTUAL_INPUT', inputTon: null, periodStartedAt: null, periodEndedAt: null }],
      children: [],
      shipments: [shipmentRow(1, 'SO-2610-001', [11], 1)].map(({ lotIds: _lotIds, ...s }) => s),
    };
    useFakeServer(SEED_EMPLOYEE_NO.quality, (c) => (c.path === '/lots/11' ? ok(detail) : c.path === '/items' ? ok(items) : undefined));
    const view = await lotTraceApi.detail(11);
    expect(view).toMatchObject({
      lotNo: 'HT-001-01',
      lotStatus: 'SHIPPED',
      producedDate: '',
      item: { itemCode: 'SL-1', itemName: '슬래브', rawMaterialType: null, thicknessMm: '250.00', widthMm: '1200.00', lengthMm: '10000.00', theoreticalWeightTon: '23.550' },
      steelGrade: { steelGradeCode: 'SS275', steelGradeName: 'SS275' },
      heatLot: { id: 10, lotNo: 'HT-001' },
      yardName: '슬래브 야드',
      supplierName: null,
      productionPlan: null,
      consumedAt: null,
      shippedAt: null,
      disposition: { dispositionStatus: 'HOLD', dispositionReason: '재검사', dispositionAt: null },
    });
    expect(view.allocations).toEqual([{ id: 3, allocationPurpose: 'SHIPMENT', allocationStatus: 'CONSUMED', confirmedAt: '', consumedAt: null, salesOrder: null, shipmentRequest: { id: 1, shipmentRequestNo: 'DR-2610-0001' }, productionPlan: null }]);
    expect(view.parents[0]).toMatchObject({ lotId: 10, rawMaterialType: null });
    expect(view.inspection).toMatchObject({ id: 11, inspectorName: '서민지', standardVersion: 1 });
    expect(view.inspection?.values.map((v) => [v.id, v.inspectionItemCode])).toEqual([
      [1, 'A'],
      [2, 'B'],
    ]);
    expect(view.shipments[0]).toMatchObject({ shipmentRequestNo: 'DR-2610-0001', salesOrder: { salesOrderId: 1, salesOrderNo: 'SO-2610-001' } });
  });
});
