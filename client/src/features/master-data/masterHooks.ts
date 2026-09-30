// 기준정보 조회 훅. 쿼리 키 첫 요소는 실시간 주제 'master-data' (다른 창의 변경도 바로 반영된다).
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  masterApi,
  type InspectionItemQuery, type ItemListQuery, type ListMasterQuery, type ProductSpecQuery, type RawMaterialListQuery, type YardListQuery,
} from '@/api/masterData';

const K = 'master-data';

export const useValidation = () => useQuery({ queryKey: [K, 'validation'], queryFn: masterApi.validation });
export const useSteelGrades = (q: ListMasterQuery = {}) => useQuery({ queryKey: [K, 'steel-grades', q], queryFn: () => masterApi.steelGrades.list(q) });
export const useProductSpecs = (q: ProductSpecQuery = {}) =>
  useQuery({ queryKey: [K, 'product-specs', q], queryFn: () => masterApi.productSpecs.list(q), placeholderData: keepPreviousData });
export const useSpecMappings = () => useQuery({ queryKey: [K, 'spec-mappings'], queryFn: () => masterApi.specMappings.list() });
export const useRoutings = () => useQuery({ queryKey: [K, 'routings'], queryFn: masterApi.routings.list });
export const useConsumptions = () => useQuery({ queryKey: [K, 'specific-consumptions'], queryFn: () => masterApi.consumptions.list() });
export const useItems = (q: ItemListQuery = {}) => useQuery({ queryKey: [K, 'items', q], queryFn: () => masterApi.items.list(q) });
export const useRawMaterials = (q: RawMaterialListQuery = {}) => useQuery({ queryKey: [K, 'raw-materials', q], queryFn: () => masterApi.rawMaterials.list(q) });
export const useCustomers = (q: ListMasterQuery = {}) => useQuery({ queryKey: [K, 'customers', q], queryFn: () => masterApi.customers.list(q) });
export const useSuppliers = (q: ListMasterQuery = {}) => useQuery({ queryKey: [K, 'suppliers', q], queryFn: () => masterApi.suppliers.list(q) });
export const useYards = (q: YardListQuery = {}) => useQuery({ queryKey: [K, 'yards', q], queryFn: () => masterApi.yards.list(q) });
export const useProductionSetting = () => useQuery({ queryKey: [K, 'production-settings'], queryFn: masterApi.productionSettings.get });
export const useInspectionItems = (q: InspectionItemQuery = {}) => useQuery({ queryKey: [K, 'inspection-items', q], queryFn: () => masterApi.inspectionItems.list(q) });
