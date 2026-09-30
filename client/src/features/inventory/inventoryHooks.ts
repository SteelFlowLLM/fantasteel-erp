// 재고 조회 훅. 쿼리 키 첫 요소는 실시간 주제 'inventories' — 예약·출고·검사로 재고가 바뀌면 자동으로 다시 불린다.
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { inventoryApi, type ListInventoriesQuery, type ListSurplusQuery } from '@/api/inventories';

export function useInventories(q: ListInventoriesQuery = {}, enabled = true) {
  return useQuery({ queryKey: ['inventories', 'list', q], queryFn: () => inventoryApi.list(q), enabled, placeholderData: keepPreviousData });
}

export function useSurplus(q: ListSurplusQuery = {}, enabled = true) {
  return useQuery({ queryKey: ['inventories', 'surplus', q], queryFn: () => inventoryApi.surplus(q), enabled, placeholderData: keepPreviousData });
}
