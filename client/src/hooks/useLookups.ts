// 기준정보 조회 훅 (고객사·공급업체·야드·강종·품목·제품 규격·매핑·라우팅·원단위·생산 설정값)
import { useQuery } from '@tanstack/react-query';
import { lookupApi } from '@/api/lookups';
import { queryKeys, type ItemListQuery, type ProductSpecListQuery } from '@/api/queryKeys';

export function useCustomerList() {
  return useQuery({ queryKey: queryKeys.customers(), queryFn: lookupApi.listCustomers });
}

export function useSupplierList() {
  return useQuery({ queryKey: queryKeys.suppliers(), queryFn: lookupApi.listSuppliers });
}

export function useYardList() {
  return useQuery({ queryKey: queryKeys.yards(), queryFn: lookupApi.listYards });
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

export function useSpecMappingList() {
  return useQuery({ queryKey: queryKeys.specMappings(), queryFn: lookupApi.listSpecMappings });
}

export function useRoutingList() {
  return useQuery({ queryKey: queryKeys.routings(), queryFn: lookupApi.listRoutings });
}

export function useSpecificConsumptionList() {
  return useQuery({ queryKey: queryKeys.specificConsumptions(), queryFn: lookupApi.listSpecificConsumptions });
}

export function useProductionSetting() {
  return useQuery({ queryKey: queryKeys.productionSetting(), queryFn: lookupApi.getProductionSetting });
}
