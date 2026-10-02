// LOT 추적 조회 훅 (REQ-LOT-005)
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { lotTraceApi, lotTraceKeys, type LotSearchQuery, type LotTraceInput } from '@/api/lotTrace';

export function useLotSearch(query: LotSearchQuery) {
  return useQuery({ queryKey: lotTraceKeys.search(query), queryFn: () => lotTraceApi.searchLots(query), placeholderData: keepPreviousData });
}

export function useShipmentRequestSearch(keyword: string) {
  const term = keyword.trim();
  return useQuery({
    queryKey: lotTraceKeys.shipmentRequestSearch(term),
    queryFn: () => lotTraceApi.searchShipmentRequests(term),
    enabled: term.length > 0,
    placeholderData: keepPreviousData,
  });
}

/** input이 null이면 부르지 않는다 (추적할 번호를 고르기 전) */
export function useLotTrace(input: LotTraceInput | null) {
  return useQuery({
    queryKey: input ? lotTraceKeys.trace(input) : [...lotTraceKeys.all, 'trace', 'none'],
    queryFn: () => (input ? lotTraceApi.trace(input) : Promise.reject(new Error('추적할 번호가 없어요'))),
    enabled: input !== null,
    retry: false,
  });
}

export function useLotDetail(lotId: number | null) {
  return useQuery({
    queryKey: lotTraceKeys.detail(lotId ?? 0),
    queryFn: () => lotTraceApi.detail(lotId ?? 0),
    enabled: lotId !== null,
  });
}
