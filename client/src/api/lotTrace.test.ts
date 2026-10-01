import { beforeEach, describe, expect, it } from 'vitest';
import { setActingEmployeeForTest } from '@/api/actor';
import { lotTraceApi } from '@/api/lotTrace';
import { buildTraceFixture, type TraceFixture } from '@/features/lotTrace/testing/traceFixture';
import { getMockDb } from '@/mock/db';
import { actAs, employeeIdOf, SEED_EMPLOYEE_NO } from '@/test/actors';

let f: TraceFixture;

beforeEach(() => {
  f = buildTraceFixture();
  actAs(SEED_EMPLOYEE_NO.quality);
});

describe('lotTraceApi.trace', () => {
  it('역추적: 코일 → 슬래브 → 히트 → 용선·합금철 → 원료, 근거와 투입량을 그대로 준다', async () => {
    const trace = await lotTraceApi.trace({ lotNo: f.coilLotNos[0] });
    expect(trace.direction).toBe('backward');
    expect(trace.start).toMatchObject({ kind: 'LOT', lotNo: f.coilLotNos[0], lotType: 'COIL', lotStatus: 'SHIPPED', inspectionResult: 'PASS' });
    expect(trace.nodes.map((n) => n.lotType)).toEqual(['COIL', 'SLAB', 'HEAT', 'HOT_METAL', 'RAW_MATERIAL', 'RAW_MATERIAL']);
    expect(trace.nodes.find((n) => n.id === f.heatLotId)).toMatchObject({ converterCode: 'BOF1', steelGradeCode: 'SS275', depth: 2 });
    expect(trace.nodes.find((n) => n.id === f.hotMetalLotId)).toMatchObject({ blastFurnaceCode: 'BF2' });
    expect(trace.nodes.find((n) => n.id === f.alloyLotId)).toMatchObject({ rawMaterialType: 'FERROALLOY' });
    const period = trace.edges.find((e) => e.parentLotId === f.oreLotId);
    expect(period).toMatchObject({ lotRelationEvidence: 'PERIOD_BASED', inputTon: null });
    expect(period?.periodStartedAt).not.toBeNull();
    expect(trace.edges.find((e) => e.parentLotId === f.alloyLotId)).toMatchObject({ lotRelationEvidence: 'ACTUAL_INPUT', inputTon: '2.500' });
    expect(trace.shipments).toEqual([]);
    expect(trace.impact).toBeNull();
  });

  it('슬래브 출하는 코일 단계 없이 역추적한다', async () => {
    const trace = await lotTraceApi.trace({ lotNo: f.slabLotNos[2] });
    expect(trace.nodes.map((n) => n.lotType)).toEqual(['SLAB', 'HEAT', 'HOT_METAL', 'RAW_MATERIAL', 'RAW_MATERIAL']);
  });

  it('정추적: 원료에서 영향받은 슬래브·코일, 출하요청, 수주까지', async () => {
    const trace = await lotTraceApi.trace({ lotNo: f.oreLotNo });
    expect(trace.direction).toBe('forward');
    expect(trace.nodes.filter((n) => n.lotType === 'SLAB')).toHaveLength(3);
    expect(trace.nodes.filter((n) => n.lotType === 'COIL')).toHaveLength(2);
    expect(trace.nodes.some((n) => n.id === f.alloyLotId)).toBe(false);
    expect(trace.shipments.map((s) => [s.shipmentRequestNo, s.shipmentRequestStatus, s.lotIds])).toEqual([
      [f.issuedRequestNo, 'ISSUED', [f.coilLotIds[0]]],
      [f.allocatedRequestNo, 'ALLOCATED', [f.slabLotIds[2]]],
    ]);
    expect(trace.shipments[0]?.millSheets.map((m) => m.millSheetNo)).toEqual([f.millSheetNo]);
    expect(trace.impact).toMatchObject({ slabCount: 3, coilCount: 2, shippedLotCount: 1, unshippedLotCount: 4 });
    expect(trace.impact?.salesOrders).toEqual([
      { salesOrderId: f.salesOrderId, salesOrderNo: f.salesOrderNo, customerName: '가람중공업', hasShipped: true, lotCount: 5, dueDate: '2026-10-15' },
    ]);
  });

  it('방향을 바꿀 수 있다 (히트에서 역추적)', async () => {
    const trace = await lotTraceApi.trace({ lotNo: f.heatLotNo, direction: 'backward' });
    expect(trace.nodes.map((n) => n.lotType)).toEqual(['HEAT', 'HOT_METAL', 'RAW_MATERIAL', 'RAW_MATERIAL']);
  });

  it('출하요청 번호로 찾으면 그 요청의 LOT에서 역추적한다 (대소문자·공백 무시)', async () => {
    const trace = await lotTraceApi.trace({ shipmentRequestNo: ` ${f.issuedRequestNo.toLowerCase()} ` });
    expect(trace.start.kind).toBe('SHIPMENT_REQUEST');
    if (trace.start.kind !== 'SHIPMENT_REQUEST') return;
    expect(trace.start.shipment).toMatchObject({ shipmentRequestNo: f.issuedRequestNo, customerName: '가람중공업', lotIds: [f.coilLotIds[0]] });
    expect(trace.start.shipment.salesOrders).toEqual([{ salesOrderId: f.salesOrderId, salesOrderNo: f.salesOrderNo }]);
    expect(trace.nodes.filter((n) => n.isStart).map((n) => n.id)).toEqual([f.coilLotIds[0]]);
    expect(trace.nodes.some((n) => n.lotType === 'RAW_MATERIAL')).toBe(true);
  });

  it('없는 LOT 번호·출하요청 번호는 COM-003', async () => {
    await expect(lotTraceApi.trace({ lotNo: 'HT-BOF1-000000-999' })).rejects.toMatchObject({ code: 'COM-003' });
    await expect(lotTraceApi.trace({ shipmentRequestNo: 'DR-2610-9999' })).rejects.toMatchObject({ code: 'COM-003' });
  });

  it('계정을 고르지 않았거나 사용 안 함 사원이면 COM-002', async () => {
    setActingEmployeeForTest(null);
    await expect(lotTraceApi.trace({ lotNo: f.heatLotNo })).rejects.toMatchObject({ code: 'COM-002' });
    const id = employeeIdOf(SEED_EMPLOYEE_NO.logistics);
    getMockDb().transact((tx) => {
      const employee = tx.tables.employee.find((e) => e.id === id);
      if (employee) employee.isActive = false;
    });
    setActingEmployeeForTest(id);
    await expect(lotTraceApi.searchLots()).rejects.toMatchObject({ code: 'COM-002' });
  });
});

describe('lotTraceApi.detail', () => {
  it('원료 LOT: 공급업체는 입고 → 발주에서, 바로 아래 용선은 기간 기반', async () => {
    const detail = await lotTraceApi.detail(f.oreLotId);
    expect(detail).toMatchObject({ lotType: 'RAW_MATERIAL', supplierName: '가온광업', remainingTon: '120.000', yardName: '원료 1야드' });
    expect(detail.item?.itemCode).toBe('ORE01');
    expect(detail.children).toEqual([expect.objectContaining({ lotId: f.hotMetalLotId, lotRelationEvidence: 'PERIOD_BASED' })]);
    expect(detail.inspection).toBeNull();
  });

  it('코일 LOT: 상위 히트, 배정(소진), 출하·밀시트, 검사 값', async () => {
    const detail = await lotTraceApi.detail(f.coilLotIds[0]);
    expect(detail.heatLot).toEqual({ id: f.heatLotId, lotNo: f.heatLotNo });
    expect(detail.allocations).toEqual([
      expect.objectContaining({ allocationPurpose: 'SHIPMENT', allocationStatus: 'CONSUMED', shipmentRequest: { id: f.issuedRequestId, shipmentRequestNo: f.issuedRequestNo } }),
    ]);
    expect(detail.shipments).toEqual([
      expect.objectContaining({ shipmentRequestNo: f.issuedRequestNo, salesOrder: { salesOrderId: f.salesOrderId, salesOrderNo: f.salesOrderNo } }),
    ]);
    expect(detail.shipments[0]?.millSheets.map((m) => m.millSheetNo)).toEqual([f.millSheetNo]);
    expect(detail.inspection).toMatchObject({ inspectionResult: 'PASS', inspectionStandardCode: 'QS-SS275-HR', standardVersion: 1 });
    expect(detail.inspection?.values).toEqual([expect.objectContaining({ inspectionItemName: '인장강도', measuredValue: '450', isPassed: true })]);
    expect(detail.parents.map((p) => p.lotId)).toEqual([f.slabLotIds[0]]);
  });

  it('없는 LOT id는 COM-003', async () => {
    await expect(lotTraceApi.detail(99999)).rejects.toMatchObject({ code: 'COM-003' });
  });
});

describe('lotTraceApi.searchLots · searchShipmentRequests', () => {
  it('번호 일부로 찾고, 정확히 같은 번호를 맨 앞에 둔다', async () => {
    const result = await lotTraceApi.searchLots({ keyword: f.slabLotNos[0].toLowerCase() });
    expect(result.items[0]?.lotNo).toBe(f.slabLotNos[0]);
    const heats = await lotTraceApi.searchLots({ keyword: 'bof1', lotType: 'HEAT' });
    expect(heats.items.map((l) => l.lotNo)).toEqual([f.heatLotNo]);
    expect(heats.items[0]?.summary).toBe('BOF1 · SS275');
  });

  it('검색어가 없으면 최근 생산 순, 개수 제한과 전체 수', async () => {
    const result = await lotTraceApi.searchLots({ limit: 3 });
    expect(result.items).toHaveLength(3);
    expect(result.total).toBe(9);
  });

  it('출하요청 번호 찾기', async () => {
    const hits = await lotTraceApi.searchShipmentRequests(f.allocatedRequestNo.slice(-4));
    expect(hits).toEqual([{ id: f.allocatedRequestId, shipmentRequestNo: f.allocatedRequestNo, shipmentRequestStatus: 'ALLOCATED', customerName: '가람중공업' }]);
    expect(await lotTraceApi.searchShipmentRequests('  ')).toEqual([]);
  });
});
