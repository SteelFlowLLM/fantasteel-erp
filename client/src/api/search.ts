// 통합 검색 (상단 바, PLAN 5장에서 남기기로 함): 수주번호·LOT 번호·출하요청 번호를 찾아 해당 화면으로 보낸다.
// - 정확히 같은 번호가 맨 앞, 그다음 수주 → LOT → 출하요청 순. 최대 10건.
// - 이동할 화면을 열 수 없는 사원(조회 권한 없음)에게는 모든 사원이 여는 화면으로 보낸다:
//   수주 → 작업 로그의 수주 이력 재현, 출하요청 → 출하요청 번호로 LOT 추적.
import { requireActor } from '@/api/actor';
import { mockQuery } from '@/api/client';
import { lotTraceHref } from '@/features/businessEvents/lib/eventTargets';
import { SCREEN, canOpenScreen } from '@/features/shell/screens';

export type SearchHitKind = 'SALES_ORDER' | 'LOT' | 'SHIPMENT_REQUEST';

export const SEARCH_HIT_KIND_LABEL: Record<SearchHitKind, string> = {
  SALES_ORDER: '수주',
  LOT: 'LOT',
  SHIPMENT_REQUEST: '출하요청',
};

export interface SearchHit {
  kind: SearchHitKind;
  kindLabel: string;
  label: string;
  href: string;
}

export const SEARCH_MIN_LENGTH = 2;
const SEARCH_LIMIT = 10;

const KIND_ORDER: Record<SearchHitKind, number> = { SALES_ORDER: 0, LOT: 1, SHIPMENT_REQUEST: 2 };

export const searchApi = {
  search: (keyword: string): Promise<SearchHit[]> =>
    mockQuery((tables) => {
      const actor = requireActor(tables);
      const term = keyword.trim().toUpperCase();
      if (term.length < SEARCH_MIN_LENGTH) return [];
      const canOpenSalesOrder = canOpenScreen(actor, SCREEN.salesOrders.access);
      const canOpenShipmentRequest = canOpenScreen(actor, SCREEN.shipmentRequests.access);
      const hit = (kind: SearchHitKind, label: string, href: string): SearchHit & { exact: boolean } => ({
        kind,
        kindLabel: SEARCH_HIT_KIND_LABEL[kind],
        label,
        href,
        exact: label.toUpperCase() === term,
      });
      const hits = [
        ...tables.salesOrder
          .filter((so) => so.salesOrderNo.toUpperCase().includes(term))
          .map((so) => hit('SALES_ORDER', so.salesOrderNo, canOpenSalesOrder ? `/sales-orders/${so.id}` : `/business-events?salesOrderId=${so.id}`)),
        ...tables.lot.filter((lot) => lot.lotNo.toUpperCase().includes(term)).map((lot) => hit('LOT', lot.lotNo, lotTraceHref(lot.lotNo))),
        ...tables.shipmentRequest
          .filter((r) => r.shipmentRequestNo.toUpperCase().includes(term))
          .map((r) =>
            hit(
              'SHIPMENT_REQUEST',
              r.shipmentRequestNo,
              canOpenShipmentRequest ? `/shipment-requests/${r.id}` : `/lots/trace?shipmentRequestNo=${encodeURIComponent(r.shipmentRequestNo)}`,
            ),
          ),
      ];
      return hits
        .sort((a, b) => Number(b.exact) - Number(a.exact) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || b.label.localeCompare(a.label))
        .slice(0, SEARCH_LIMIT)
        .map(({ kind, kindLabel, label, href }) => ({ kind, kindLabel, label, href }));
    }),
};
