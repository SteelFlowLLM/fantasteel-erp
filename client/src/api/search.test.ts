import { beforeEach, describe, expect, it } from 'vitest';
import { setActingEmployeeForTest } from '@/api/actor';
import { searchApi } from '@/api/search';
import { buildTraceFixture, type TraceFixture } from '@/features/lotTrace/testing/traceFixture';
import { actAs, SEED_EMPLOYEE_NO } from '@/test/actors';

let f: TraceFixture;

beforeEach(() => {
  f = buildTraceFixture();
});

describe('통합 검색', () => {
  it('수주번호·LOT 번호·출하요청 번호를 찾고 정확히 같은 번호를 맨 앞에 둔다', async () => {
    actAs(SEED_EMPLOYEE_NO.sales);
    const hits = await searchApi.search(f.issuedRequestNo.toLowerCase());
    expect(hits[0]).toEqual({ kind: 'SHIPMENT_REQUEST', kindLabel: '출하요청', label: f.issuedRequestNo, href: `/shipment-requests/${f.issuedRequestId}` });
    const so = await searchApi.search(f.salesOrderNo);
    expect(so[0]).toEqual({ kind: 'SALES_ORDER', kindLabel: '수주', label: f.salesOrderNo, href: `/sales-orders/${f.salesOrderId}` });
    const lots = await searchApi.search('BOF1');
    expect(lots.every((h) => h.kind === 'LOT')).toBe(true);
    expect(lots[0]?.href).toMatch(/^\/lots\/trace\?lot=/);
    expect(lots).toHaveLength(6);
  });

  it('화면을 열 수 없는 사원은 모든 사원이 여는 화면(이력 재현·LOT 추적)으로 보낸다', async () => {
    actAs(SEED_EMPLOYEE_NO.quality);
    const so = await searchApi.search(f.salesOrderNo);
    expect(so[0]?.href).toBe(`/business-events?salesOrderId=${f.salesOrderId}`);
    const dr = await searchApi.search(f.allocatedRequestNo);
    expect(dr[0]?.href).toBe(`/lots/trace?shipmentRequestNo=${encodeURIComponent(f.allocatedRequestNo)}`);
  });

  it('두 글자보다 짧으면 찾지 않고, 계정이 없으면 COM-002', async () => {
    actAs(SEED_EMPLOYEE_NO.sales);
    expect(await searchApi.search('S')).toEqual([]);
    setActingEmployeeForTest(null);
    await expect(searchApi.search('SO')).rejects.toMatchObject({ code: 'COM-002' });
  });
});
