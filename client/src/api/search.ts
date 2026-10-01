// 통합 검색 (상단 바, PLAN 5장에서 남기기로 함): 수주번호·LOT번호를 찾아 해당 화면으로 보낸다.
import { mockQuery } from '@/api/client';

export type SearchHitKind = 'SALES_ORDER' | 'LOT';

export interface SearchHit {
  kind: SearchHitKind;
  kindLabel: string;
  label: string;
  href: string;
}

export const SEARCH_MIN_LENGTH = 2;
const SEARCH_LIMIT = 10;

export const searchApi = {
  search: (keyword: string): Promise<SearchHit[]> =>
    mockQuery((tables) => {
      const term = keyword.trim().toUpperCase();
      if (term.length < SEARCH_MIN_LENGTH) return [];
      const salesOrders: SearchHit[] = tables.salesOrder
        .filter((so) => so.salesOrderNo.toUpperCase().includes(term))
        .map((so) => ({ kind: 'SALES_ORDER', kindLabel: '수주', label: so.salesOrderNo, href: `/sales-orders/${so.id}` }));
      const lots: SearchHit[] = tables.lot
        .filter((lot) => lot.lotNo.toUpperCase().includes(term))
        .map((lot) => ({ kind: 'LOT', kindLabel: 'LOT', label: lot.lotNo, href: `/lots/trace?lot=${encodeURIComponent(lot.lotNo)}` }));
      return [...salesOrders, ...lots].slice(0, SEARCH_LIMIT);
    }),
};
