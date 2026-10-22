// 통합 검색 서버 모드: 수주·LOT·출하요청 목록 API를 번호로 찾아 정렬한다. 조회 권한이 없는 목록은 부르지 않아 결과에서 빠진다.
import type { AuthUser } from '@fantasteel/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { fail, ok, page, stopFakeServer, useFakeServer, type ServerCall } from '@/api/server/serverTestKit';
import { canListSalesOrders, canListShipmentRequests, searchApi } from '@/api/search';
import { emptyHint } from '@/features/shell/SearchBox';
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

  it('조회 권한이 없는 목록은 부르지 않고(글자마다 403이 나지 않게) 나머지만 보인다. 두 글자보다 짧으면 서버를 부르지 않는다', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.quality, (c: ServerCall) => {
      if (c.path === '/auth/me') return ok(me({}));
      if (c.path === '/lots') return ok(lots);
      if (c.path === '/sales-orders' || c.path === '/shipment-requests') return denied();
      return undefined;
    });
    expect((await searchApi.search('2610')).map((h) => h.kind)).toEqual(['LOT']);
    expect(calls.map((c) => c.path).sort()).toEqual(['/auth/me', '/lots']);
    calls.length = 0;
    expect(await searchApi.search('S')).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('번호 조건보다 긴 글(31자 이상)은 수주·출하요청 목록을 부르지 않고 LOT만 찾는다', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.sales, (c: ServerCall) => {
      if (c.path === '/auth/me') return ok(me({ SALES_ORDER_CREATE: 'USE', SHIPMENT_REQUEST_MANAGE: 'USE' }));
      if (c.path === '/lots') return ok(lots);
      return undefined;
    });
    expect(await searchApi.search('X'.repeat(31))).toHaveLength(1);
    expect(calls.map((c) => c.path).sort()).toEqual(['/auth/me', '/lots']);
  });

  it('LOT 번호 조건(60자)보다 긴 글은 서버를 묻지 않고 빈 결과다 (서버 400이 결과를 통째로 지우지 않게, 이슈 #498)', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.sales, (c: ServerCall) => {
      if (c.path === '/auth/me') return ok(me({ SALES_ORDER_CREATE: 'USE', SHIPMENT_REQUEST_MANAGE: 'USE' }));
      if (c.path === '/lots') return c.query.lotNo && c.query.lotNo.length > 60 ? fail(400, 'COM-004', 'lotNo는 60자까지') : ok(lots);
      return undefined;
    });
    expect(await searchApi.search('X'.repeat(60))).toHaveLength(1);
    expect(await searchApi.search('X'.repeat(61))).toEqual([]);
    expect(calls.filter((c) => c.path === '/lots').map((c) => c.query.lotNo?.length)).toEqual([60]);
  });

  it('출하요청 목록은 보이지만(출고 확정 권한) 출하요청 화면을 열 권한이 없으면 LOT 추적으로 연결한다', async () => {
    useFakeServer(SEED_EMPLOYEE_NO.logistics, (c: ServerCall) => {
      if (c.path === '/auth/me') return ok(me({ GOODS_ISSUE_CONFIRM: 'USE' }));
      if (c.path === '/lots') return ok(page([]));
      if (c.path === '/shipment-requests') return ok(shipmentRequests);
      return undefined;
    });
    expect((await searchApi.search('2610')).map((h) => [h.kind, h.href])).toEqual([['SHIPMENT_REQUEST', '/lots/trace?shipmentRequestNo=DR-2610-0001']]);
  });

  it('목록 권한은 서버 조건과 같다: 수주 = 수주 등록 조회, 출하요청 = 출하요청 관리 또는 출고 확정 조회', () => {
    expect(canListSalesOrders(me({ SALES_ORDER_CREATE: 'VIEW' }))).toBe(true);
    expect(canListSalesOrders(me({ SALES_ORDER_CANCEL: 'USE' }))).toBe(false);
    expect(canListShipmentRequests(me({ GOODS_ISSUE_CONFIRM: 'VIEW' }))).toBe(true);
    expect(canListShipmentRequests(me({ INSPECTION_REGISTER: 'USE' }))).toBe(false);
  });

  it('결과가 없을 때 안내: LOT은 앞에서부터, 권한이 없어 빠진 종류를 말한다', () => {
    expect(emptyHint(me({}))).toBe('LOT 번호는 앞에서부터 입력해 주세요 · 수주·출하요청 번호는 조회 권한이 있어야 찾을 수 있어요');
    expect(emptyHint(me({ GOODS_ISSUE_CONFIRM: 'USE' }))).toBe('LOT 번호는 앞에서부터 입력해 주세요 · 수주 번호는 조회 권한이 있어야 찾을 수 있어요');
    expect(emptyHint(me({ SALES_ORDER_CREATE: 'USE', SHIPMENT_REQUEST_MANAGE: 'USE' }))).toBe('LOT 번호는 앞에서부터 입력해 주세요');
  });
});
