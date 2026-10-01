import { beforeEach, describe, expect, it } from 'vitest';
import { setActingEmployeeForTest } from '@/api/actor';
import { businessEventApi } from '@/api/businessEvents';
import { buildTraceFixture, type TraceFixture } from '@/features/lotTrace/testing/traceFixture';
import { actAs, SEED_EMPLOYEE_NO } from '@/test/actors';

let f: TraceFixture;

beforeEach(() => {
  f = buildTraceFixture();
  actAs(SEED_EMPLOYEE_NO.logistics);
});

describe('이력 재현 (REQ-LOG-003)', () => {
  it('수주 단위: 오래된 순, 같은 시각이면 id 순', async () => {
    const page = await businessEventApi.list({ salesOrderId: f.salesOrderId });
    expect(page.sort).toBe('asc');
    expect(page.salesOrder).toEqual({ id: f.salesOrderId, salesOrderNo: f.salesOrderNo, customerName: '가람중공업' });
    expect(page.items.map((e) => e.businessEventType)).toEqual([
      'SALES_ORDER_CREATED',
      'PRODUCTION_RESULT_REGISTERED',
      'INSPECTION_REGISTERED',
      'INSPECTION_REGISTERED',
      'GOODS_ISSUE_CONFIRMED',
      'MILL_SHEET_ISSUED',
      'ALLOCATION_CONFIRMED',
    ]);
    const tied = page.items.filter((e) => e.businessEventType === 'INSPECTION_REGISTERED').map((e) => e.id);
    expect(tied).toEqual(f.tiedEventIds);
    expect(page.total).toBe(7);
  });

  it('LOT 단위: business_event_lot으로 묶인 이벤트만', async () => {
    const page = await businessEventApi.list({ lotId: f.coilLotIds[0] });
    expect(page.lot).toMatchObject({ id: f.coilLotIds[0], lotNo: f.coilLotNos[0], lotType: 'COIL' });
    expect(page.items.map((e) => e.businessEventType)).toEqual(['INSPECTION_REGISTERED', 'GOODS_ISSUE_CONFIRMED', 'MILL_SHEET_ISSUED']);
  });

  it('한 줄에 필요한 값: EV- 번호, 주체, 대상 테이블·번호·링크, 전후 값, 사유, 관련 LOT', async () => {
    const page = await businessEventApi.list({ salesOrderId: f.salesOrderId });
    const issue = page.items.find((e) => e.businessEventType === 'GOODS_ISSUE_CONFIRMED');
    expect(issue).toMatchObject({
      businessEventTypeLabel: '출고 확정',
      actorType: 'USER',
      actor: { employeeName: '권예진', departmentName: '물류부' },
      targetType: 'shipment_request',
      targetTypeLabel: '출하요청',
      targetNo: f.issuedRequestNo,
      targetHref: `/shipment-requests/${f.issuedRequestId}`,
      salesOrderNo: f.salesOrderNo,
      beforeData: { shipmentRequestStatus: 'ALLOCATED' },
      afterData: { shipmentRequestStatus: 'ISSUED' },
      isAiAssisted: false,
      lots: [{ id: f.coilLotIds[0], lotNo: f.coilLotNos[0], lotType: 'COIL' }],
    });
    expect(issue?.eventNo).toMatch(/^EV-261002-\d{3}$/);
    const millSheet = page.items.find((e) => e.businessEventType === 'MILL_SHEET_ISSUED');
    expect(millSheet).toMatchObject({ actorType: 'SYSTEM', actor: null, targetTypeLabel: '밀시트' });
    const failed = page.items.find((e) => e.targetNo === f.coilLotNos[1]);
    expect(failed).toMatchObject({ reasonCode: 'QUALITY_FAILURE', targetTypeLabel: '품질검사', targetHref: `/quality/inspections?lot=${f.coilLotIds[1]}` });
  });
});

describe('작업 로그 목록 필터 (REQ-LOG-001·002)', () => {
  it('조건이 없으면 최신순', async () => {
    const page = await businessEventApi.list();
    expect(page.sort).toBe('desc');
    expect(page.items[0]?.businessEventType).toBe('ALLOCATION_CONFIRMED');
    expect(page.items.at(-1)?.businessEventType).toBe('SALES_ORDER_CREATED');
  });

  it('유형·주체·대상·기간', async () => {
    expect((await businessEventApi.list({ businessEventType: 'INSPECTION_REGISTERED' })).total).toBe(2);
    expect((await businessEventApi.list({ actorType: 'SYSTEM' })).items.map((e) => e.businessEventType)).toEqual(['MILL_SHEET_ISSUED']);
    expect((await businessEventApi.list({ targetType: 'quality_inspection' })).total).toBe(2);
    const day = await businessEventApi.list({ from: '2026-10-01', to: '2026-10-01' });
    expect(day.items.map((e) => e.businessEventType).sort()).toEqual(['INSPECTION_REGISTERED', 'INSPECTION_REGISTERED', 'PRODUCTION_RESULT_REGISTERED']);
    expect((await businessEventApi.list({ from: '2026-10-03' })).total).toBe(1);
  });

  it('건수 제한 (더 보기)', async () => {
    const page = await businessEventApi.list({ limit: 2 });
    expect(page.items).toHaveLength(2);
    expect(page.total).toBe(7);
  });

  it('없는 수주·LOT은 COM-003, 계정이 없으면 COM-002', async () => {
    await expect(businessEventApi.list({ salesOrderId: 9999 })).rejects.toMatchObject({ code: 'COM-003' });
    await expect(businessEventApi.list({ lotId: 9999 })).rejects.toMatchObject({ code: 'COM-003' });
    setActingEmployeeForTest(null);
    await expect(businessEventApi.list()).rejects.toMatchObject({ code: 'COM-002' });
  });
});

describe('수주 고르기', () => {
  it('수주번호 일부로 찾는다', async () => {
    expect(await businessEventApi.searchSalesOrders(f.salesOrderNo.slice(-3))).toEqual([
      { id: f.salesOrderId, salesOrderNo: f.salesOrderNo, customerName: '가람중공업' },
    ]);
    expect(await businessEventApi.searchSalesOrders('SO-9999')).toEqual([]);
  });
});
