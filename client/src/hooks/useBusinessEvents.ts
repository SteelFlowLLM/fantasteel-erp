// 작업 로그·이력 재현 조회 훅 (REQ-LOG-001~003)
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { businessEventApi, businessEventKeys, type BusinessEventFilter } from '@/api/businessEvents';

export function useBusinessEvents(filter: BusinessEventFilter, enabled = true) {
  return useQuery({
    queryKey: businessEventKeys.list(filter),
    queryFn: () => businessEventApi.list(filter),
    enabled,
    placeholderData: keepPreviousData,
    retry: false,
  });
}

export function useSalesOrderOptions(keyword: string, enabled = true) {
  const term = keyword.trim();
  return useQuery({
    queryKey: businessEventKeys.salesOrderOptions(term),
    queryFn: () => businessEventApi.searchSalesOrders(term),
    enabled,
    placeholderData: keepPreviousData,
  });
}

/** 고른 수주·LOT의 번호와 고객사 (머리·칩 표시용). 없는 id면 error가 COM-003이다. */
export function useBusinessEventSubject(filter: { salesOrderId?: number; lotId?: number }) {
  const enabled = filter.salesOrderId !== undefined || filter.lotId !== undefined;
  const query = useBusinessEvents({ salesOrderId: filter.salesOrderId, lotId: filter.lotId, limit: 1 }, enabled);
  return { salesOrder: query.data?.salesOrder ?? null, lot: query.data?.lot ?? null, error: enabled ? query.error : null, isPending: enabled && query.isPending };
}
