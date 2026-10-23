// 상단 통합 검색 ↔ 서버 목록 API: 수주(salesOrderNo)·LOT(lotNo, 앞부분 일치)·출하요청(shipmentRequestNo)을 번호로 찾아 후보를 만든다.
// 정렬·자르기는 api/search.ts가 한다. 조회 권한이 없는 목록(수주·출하요청)은 부르지 않으므로 그 종류는 결과에 나오지 않는다.
import { LOT_NO_FILTER_MAX, type AuthUser, type LotSummary, type PageResult, type SalesOrderSummary, type ShipmentRequestSummary } from '@fantasteel/shared';
import { serverRequest } from '@/api/http';
import { orEmpty } from '@/api/server/inspections';
import type { SearchCandidate } from '@/api/search';
import { PERMISSION } from '@/codes';
import { lotTraceHref } from '@/features/businessEvents/lib/eventTargets';
import { SCREEN, canOpenScreen } from '@/features/shell/screens';
import { canView, type PermissionMap } from '@/lib/permissions';

const empty = { items: [], page: 1, size: 0, total: 0 };
/** 수주·출하요청 번호 조건의 최대 길이(서버 DTO). 더 긴 글은 그 번호일 수 없어 묻지 않는다(400이 다른 종류 결과까지 지우지 않게) */
const NUMBER_FILTER_MAX = 30;

/**
 * 목록 API를 부를 수 있는 권한 (서버 컨트롤러·서비스와 같은 조건). 권한이 없는 목록을 부르면 글자를 칠 때마다 403이 났다.
 * 수주 목록 = SALES_ORDER_CREATE 조회, 출하요청 목록 = SHIPMENT_REQUEST_MANAGE 또는 GOODS_ISSUE_CONFIRM 조회. LOT 목록은 모든 사원
 */
export const canListSalesOrders = (user: { permissions: PermissionMap }): boolean => canView(user, PERMISSION.SALES_ORDER_CREATE);
export const canListShipmentRequests = (user: { permissions: PermissionMap }): boolean => canView(user, PERMISSION.SHIPMENT_REQUEST_MANAGE, PERMISSION.GOODS_ISSUE_CONFIRM);

export async function serverSearchCandidates(term: string, limit: number): Promise<SearchCandidate[]> {
  const page = (query: Record<string, string>) => ({ query: { ...query, page: 1, size: limit } });
  const byNumber = term.length <= NUMBER_FILTER_MAX;
  // LOT 번호 조건도 서버 상한(LOT_NO_FILTER_MAX)을 넘으면 400이라 묻지 않는다: 그 400이 수주·출하요청 결과까지 지웠다 (이슈 #498)
  const byLotNo = term.length <= LOT_NO_FILTER_MAX;
  // 권한으로 부를 목록을 정해야 해서 내 정보를 먼저 읽는다 (LOT은 권한과 상관없어 같이 부른다)
  const [me, lots] = await Promise.all([
    serverRequest<AuthUser>('GET', '/auth/me'),
    byLotNo ? orEmpty(() => serverRequest<PageResult<LotSummary>>('GET', '/lots', page({ lotNo: term })), empty) : empty,
  ]);
  const [salesOrders, shipmentRequests] = await Promise.all([
    byNumber && canListSalesOrders(me) ? orEmpty(() => serverRequest<PageResult<SalesOrderSummary>>('GET', '/sales-orders', page({ salesOrderNo: term })), empty) : empty,
    byNumber && canListShipmentRequests(me)
      ? orEmpty(() => serverRequest<PageResult<ShipmentRequestSummary>>('GET', '/shipment-requests', page({ shipmentRequestNo: term })), empty)
      : empty,
  ]);
  const canOpenSalesOrder = canOpenScreen(me, SCREEN.salesOrders.access);
  const canOpenShipmentRequest = canOpenScreen(me, SCREEN.shipmentRequests.access);
  return [
    ...salesOrders.items.map((so): SearchCandidate => ({
      kind: 'SALES_ORDER',
      label: so.salesOrderNo,
      href: canOpenSalesOrder ? `/sales-orders/${so.id}` : `/business-events?salesOrderId=${so.id}`,
    })),
    ...lots.items.map((lot): SearchCandidate => ({ kind: 'LOT', label: lot.lotNo, href: lotTraceHref(lot.lotNo) })),
    ...shipmentRequests.items.map((r): SearchCandidate => ({
      kind: 'SHIPMENT_REQUEST',
      label: r.shipmentRequestNo,
      href: canOpenShipmentRequest ? `/shipment-requests/${r.id}` : `/lots/trace?shipmentRequestNo=${encodeURIComponent(r.shipmentRequestNo)}`,
    })),
  ];
}
