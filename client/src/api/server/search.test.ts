// 통합 검색 서버 모드: 수주·LOT·출하요청 목록 API를 번호로 찾아 정렬한다. 조회 권한이 없는 목록은 결과에서 빠진다.
import type { AuthUser } from '@fantasteel/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { fail, ok, page, stopFakeServer, useFakeServer, type ServerCall } from '@/api/server/serverTestKit';
import { searchApi } from '@/api/search';
import { SEED_EMPLOYEE_NO } from '@/test/actors';

afterEach(() => stopFakeServer());

const me = (permissions: AuthUser['permissions']): AuthUser => ({
  employeeId: 900,
  employeeNo: '9999001',
  employeeName: '서버 사원',
  departmentId: 1,
  jobGradeId: 1,
  roleCode: 'SALES',
  headDepartmentIds: [],
  permissions,
});
const denied = () => fail(403, 'COM-002', '권한이 없어요');

const salesOrders = page([
  { id: 11, salesOrderNo: 'SO-2610-001' },
  { id: 12, salesOrderNo: 'SO-2610-0010' },
]);
const lots = page([{ id: 501, lotNo: 'SL-2610-001' }]);
const shipmentRequests = page([{ id: 71, shipmentRequestNo: 'DR-2610-0001' }]);

describe('통합 검색 서버 모드 (api/server/search.ts)', () => {
  it('세 목록을 번호로 찾아 정확히 같은 번호를 맨 앞, 그다음 수주 → LOT → 출하요청 순으로 보인다', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.sales, (c: ServerCall) => {
      if (c.path === '/auth/me') return ok(me({ SALES_ORDER_CREATE: 'USE', SHIPMENT_REQUEST_MANAGE: 'USE' }));
      if (c.path === '/sales-orders') return ok(salesOrders);
      if (c.path === '/lots') return ok(lots);
      if (c.path === '/shipment-requests') return ok(shipmentRequests);
      return undefined;
    });
    const hits = await searchApi.search(' so-2610-0010 ');
    expect(hits.map((h) => [h.kind, h.label, h.href])).toEqual([
      ['SALES_ORDER', 'SO-2610-0010', '/sales-orders/12'],
      ['SALES_ORDER', 'SO-2610-001', '/sales-orders/11'],
      ['LOT', 'SL-2610-001', '/lots/trace?lot=SL-2610-001'],
      ['SHIPMENT_REQUEST', 'DR-2610-0001', '/shipment-requests/71'],
    ]);
    expect(calls.find((c) => c.path === '/sales-orders')?.query).toMatchObject({ salesOrderNo: 'SO-2610-0010', size: '10' });
    expect(calls.find((c) => c.path === '/lots')?.query).toMatchObject({ lotNo: 'SO-2610-0010' });
    expect(calls.find((c) => c.path === '/shipment-requests')?.query).toMatchObject({ shipmentRequestNo: 'SO-2610-0010' });
  });

  it('조회 권한이 없는 목록(403)은 빼고 나머지만 보인다. 두 글자보다 짧으면 서버를 부르지 않는다', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.quality, (c: ServerCall) => {
      if (c.path === '/auth/me') return ok(me({}));
      if (c.path === '/lots') return ok(lots);
      if (c.path === '/sales-orders' || c.path === '/shipment-requests') return denied();
      return undefined;
    });
    expect((await searchApi.search('2610')).map((h) => h.kind)).toEqual(['LOT']);
    calls.length = 0;
    expect(await searchApi.search('S')).toEqual([]);
    expect(calls).toEqual([]);
  });
});
