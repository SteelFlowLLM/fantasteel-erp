// 밀시트 서버 어댑터: 목록(상세 스냅샷으로 채움)·상세(스냅샷 이름 맞춤, 수주 줄 번호)·PDF 생성(POST pdf).
import type { MillSheetDetail, MillSheetSnapshot } from '@fantasteel/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { millSheetApi } from '@/api/millSheets';
import { fail, ok, page, stopFakeServer, useFakeServer, type ServerCall } from '@/api/server/serverTestKit';
import { SEED_EMPLOYEE_NO } from '@/test/actors';

const inspection = {
  lotNo: 'SL-001',
  processType: 'CONTINUOUS_CASTING',
  inspectionStandardCode: 'QS-SS275-CC',
  version: 1,
  inspectionResult: 'PASS',
  inspectedAt: '2026-10-06T01:00:00.000Z',
  values: [{ inspectionItemCode: 'WIDTH_DEV', inspectionItemName: '폭 편차', unit: 'mm', minValue: '-5.0000', maxValue: '5.0000', measuredValue: '0.0000', isPassed: true }],
};

const snapshot = (over: Partial<MillSheetSnapshot> = {}): MillSheetSnapshot => ({
  millSheetNo: 'MS-2610-0001-1',
  issuedAt: '2026-10-07T01:00:00.000Z',
  issuedDate: '2026-10-07',
  customer: { customerId: 3, customerCode: 'C003', customerName: '나래조선' },
  salesOrder: { salesOrderId: 50, salesOrderNo: 'SO-2610-001' },
  shipmentRequest: { shipmentRequestId: 70, shipmentRequestNo: 'DR-2610-0001', shipDate: '2026-10-09', issuedAt: '2026-10-07T01:00:00.000Z', issuedEmployeeName: '신현우' },
  items: [
    {
      salesOrderItemId: 52,
      itemId: 61,
      itemCode: 'SL-SS275-250x1200x10000',
      itemName: '슬래브 SS275',
      itemType: 'SLAB',
      steelGradeCode: 'SS275',
      standardNo: 'KS D 3503:2026',
      thicknessMm: '250.00',
      widthMm: '1200.00',
      lengthMm: '10000.00',
      theoreticalWeightTon: '23.550',
      qty: 1,
      totalWeightTon: '23.550',
      lots: [{ lotId: 11, lotNo: 'SL-001', lotType: 'SLAB', producedDate: null, theoreticalWeightTon: '23.550', heatLotId: 10, heatNo: 'HT-001', slabNo: null, productInspection: inspection }],
    },
  ],
  heats: [{ heatLotId: 10, heatNo: 'HT-001', converterCode: 'BOF1', producedDate: null, steelGradeCode: 'SS275', inspection: { ...inspection, lotNo: 'HT-001', processType: 'STEELMAKING' } }],
  totalQty: 1,
  totalWeightTon: '23.550',
  lotIds: [11, 10],
  ...over,
});

const detail = (id: number, over: Partial<MillSheetDetail> = {}): MillSheetDetail => ({
  id,
  millSheetNo: `MS-2610-000${id}-1`,
  shipmentRequestId: 70,
  shipmentRequestNo: 'DR-2610-0001',
  salesOrderId: 50,
  salesOrderNo: 'SO-2610-001',
  issuedAt: '2026-10-07T01:00:00.000Z',
  pdfPath: null,
  snapshot: snapshot(),
  ...over,
});

/** 수주 상세: 어댑터는 items 순서만 본다. 밀시트 품목(52)은 수주의 둘째 줄 */
const salesOrder50 = { id: 50, items: [{ salesOrderItemId: 51 }, { salesOrderItemId: 52 }] };

/** 목록 한 줄 = 상세에서 스냅샷을 뺀 값 */
const summary = ({ snapshot: _snapshot, ...rest }: MillSheetDetail) => rest;

afterEach(() => stopFakeServer());

describe('밀시트 서버 어댑터 (api/server/millSheets.ts)', () => {
  it('목록: 밀시트마다 상세 스냅샷으로 고객사·매수·히트·규격을 채우고 최근 발행 순으로 둔다', async () => {
    const older = detail(1, { issuedAt: '2026-10-06T01:00:00.000Z' });
    const newer = detail(2, { pdfPath: 'mill-sheets/x-MS-2610-0002-1.pdf', snapshot: snapshot({ items: [{ ...snapshot().items[0], itemType: 'COIL', itemCode: 'CL-1' }] }) });
    const calls = useFakeServer(SEED_EMPLOYEE_NO.logisticsHead, (c) => {
      if (c.path === '/mill-sheets') return ok(page([summary(older), summary(newer)]));
      if (c.path === '/mill-sheets/1') return ok(older);
      if (c.path === '/mill-sheets/2') return ok(newer);
      return undefined;
    });
    const rows = await millSheetApi.list();
    expect(rows.map((r) => r.id)).toEqual([2, 1]);
    expect(rows[0]).toMatchObject({ customerName: '나래조선', totalQty: 1, totalWeightTon: '23.550', heatNos: ['HT-001'], itemTypes: ['COIL'], itemCodes: ['CL-1'], pdfPath: 'mill-sheets/x-MS-2610-0002-1.pdf' });
    expect(rows[1]).toMatchObject({ itemTypes: ['SLAB'], shipmentRequestNo: 'DR-2610-0001', salesOrderNo: 'SO-2610-001' });
    expect(calls.find((c) => c.path === '/mill-sheets')?.query).toMatchObject({ page: '1', size: '100' });
  });

  it('상세: 출하 예정일 이름을 맞추고, 빈 생산일은 빈 글자, 수주 줄 번호는 수주 상세 순서로 매긴다', async () => {
    useFakeServer(SEED_EMPLOYEE_NO.logisticsHead, (c) => {
      if (c.path === '/mill-sheets/1') return ok(detail(1));
      if (c.path === '/sales-orders/50') return ok(salesOrder50);
      return undefined;
    });
    const view = await millSheetApi.detail(1);
    expect(view).toMatchObject({ id: 1, shipmentRequestId: 70, salesOrderId: 50, pdfPath: null });
    expect(view.snapshot.shipmentRequest).toEqual({ shipmentRequestId: 70, shipmentRequestNo: 'DR-2610-0001', requestedShipDate: '2026-10-09', issuedAt: '2026-10-07T01:00:00.000Z', issuedEmployeeName: '신현우' });
    expect(view.snapshot.items[0]).toMatchObject({ lineNo: 2, itemCode: 'SL-SS275-250x1200x10000' });
    expect(view.snapshot.items[0].lots[0]).toMatchObject({ producedDate: '', heatNo: 'HT-001', productInspection: inspection });
    expect(view.snapshot.heats[0]).toMatchObject({ producedDate: '', converterCode: 'BOF1' });
    expect(view.snapshot.lotIds).toEqual([11, 10]);
  });

  it('수주 조회 권한이 없으면(품질) 밀시트 안의 품목 순서로 줄 번호를 매긴다', async () => {
    const twoItems = snapshot({ items: [snapshot().items[0], { ...snapshot().items[0], salesOrderItemId: 53, itemCode: 'SL-2' }] });
    useFakeServer(SEED_EMPLOYEE_NO.quality, (c) => {
      if (c.path === '/mill-sheets/1') return ok(detail(1, { snapshot: twoItems }));
      if (c.path === '/sales-orders/50') return fail(403, 'COM-002', '권한이 없습니다');
      return undefined;
    });
    const view = await millSheetApi.detail(1);
    expect(view.snapshot.items.map((i) => [i.itemCode, i.lineNo])).toEqual([
      ['SL-SS275-250x1200x10000', 1],
      ['SL-2', 2],
    ]);
  });

  it('PDF 생성: POST mill-sheets/:id/pdf를 부르고 서버가 저장한 경로를 돌려준다', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.logisticsHead, (c: ServerCall) =>
      c.method === 'POST' && c.path === '/mill-sheets/1/pdf' ? ok(detail(1, { pdfPath: 'mill-sheets/abc-MS-2610-0001-1_나래조선_20261007.pdf' })) : undefined,
    );
    const result = await millSheetApi.markPdfGenerated({ millSheetId: 1 });
    expect(result).toEqual({ id: 1, millSheetNo: 'MS-2610-0001-1', pdfPath: 'mill-sheets/abc-MS-2610-0001-1_나래조선_20261007.pdf' });
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(['POST /mill-sheets/1/pdf']);
  });

  it('PDF 생성 실패(SHP-001)와 권한 없음(COM-002)은 화면 오류로 던진다', async () => {
    useFakeServer(SEED_EMPLOYEE_NO.sales, (c) => (c.path === '/mill-sheets/1/pdf' ? fail(500, 'SHP-001', 'PDF를 만들지 못했어요') : c.path === '/mill-sheets/2/pdf' ? fail(403, 'COM-002', '권한이 없습니다') : undefined));
    await expect(millSheetApi.markPdfGenerated({ millSheetId: 1 })).rejects.toMatchObject({ code: 'SHP-001' });
    await expect(millSheetApi.markPdfGenerated({ millSheetId: 2 })).rejects.toMatchObject({ code: 'COM-002' });
  });
});
