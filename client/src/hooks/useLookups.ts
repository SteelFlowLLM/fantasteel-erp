// 선택 목록용 기준정보 조회 훅 (고객사·강종·품목·제품 규격). 기준정보 화면은 hooks/useMasterData.ts를 쓴다
import { useQuery } from '@tanstack/react-query';
import { lookupApi } from '@/api/lookups';
import { queryKeys, type ItemListQuery, type ProductSpecListQuery } from '@/api/queryKeys';

export function useCustomerList() {
  return useQuery({ queryKey: queryKeys.customers(), queryFn: lookupApi.listCustomers });
}

export function useSteelGradeList() {
  return useQuery({ queryKey: queryKeys.steelGrades(), queryFn: lookupApi.listSteelGrades });
}

export function useItemList(query: ItemListQuery = {}) {
  return useQuery({ queryKey: queryKeys.items(query), queryFn: () => lookupApi.listItems(query) });
}

export function useProductSpecList(query: ProductSpecListQuery = {}) {
  return useQuery({ queryKey: queryKeys.productSpecs(query), queryFn: () => lookupApi.listProductSpecs(query) });
}
