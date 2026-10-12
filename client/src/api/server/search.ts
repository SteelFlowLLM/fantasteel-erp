// 상단 통합 검색 ↔ 서버 목록 API: 수주(salesOrderNo)·LOT(lotNo, 앞부분 일치)·출하요청(shipmentRequestNo)을 번호로 찾아 후보를 만든다.
// 정렬·자르기는 api/search.ts가 한다. 조회 권한이 없는 목록(수주·출하요청)은 비워 두므로 그 종류는 결과에 나오지 않는다.
import type { AuthUser, LotSummary, PageResult, SalesOrderSummary, ShipmentRequestSummary } from '@fantasteel/shared';
import { serverRequest } from '@/api/http';
import { orEmpty } from '@/api/server/inspections';
import type { SearchCandidate } from '@/api/search';
import { lotTraceHref } from '@/features/businessEvents/lib/eventTargets';
import { SCREEN, canOpenScreen } from '@/features/shell/screens';

const empty = { items: [], page: 1, size: 0, total: 0 };

export async function serverSearchCandidates(term: string, limit: number): Promise<SearchCandidate[]> {
  const page = (query: Record<string, string>) => ({ query: { ...query, page: 1, size: limit } });
  const [me, salesOrders, lots, shipmentRequests] = await Promise.all([
    serverRequest<AuthUser>('GET', '/auth/me'),
    orEmpty(() => serverRequest<PageResult<SalesOrderSummary>>('GET', '/sales-orders', page({ salesOrderNo: term })), empty),
    orEmpty(() => serverRequest<PageResult<LotSummary>>('GET', '/lots', page({ lotNo: term })), empty),
    orEmpty(() => serverRequest<PageResult<ShipmentRequestSummary>>('GET', '/shipment-requests', page({ shipmentRequestNo: term })), empty),
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
