// 기준정보 화면 조회 훅 (api/masterData.ts). 변경은 useAction(masterDataApi.…)으로 한다.
import { useQuery } from '@tanstack/react-query';
import { masterDataApi, masterDataKeys } from '@/api/masterData';

export function useMasterReadiness() {
  return useQuery({ queryKey: masterDataKeys.readiness(), queryFn: masterDataApi.getReadiness });
}

export function useMasterProductSpecs() {
  return useQuery({ queryKey: masterDataKeys.productSpecs(), queryFn: masterDataApi.listProductSpecs });
}

export function useMasterSpecMappings() {
  return useQuery({ queryKey: masterDataKeys.specMappings(), queryFn: masterDataApi.listSpecMappings });
}

export function useMasterSteelGrades() {
  return useQuery({ queryKey: masterDataKeys.steelGrades(), queryFn: masterDataApi.listSteelGrades });
}

export function useMasterRoutings() {
  return useQuery({ queryKey: masterDataKeys.routings(), queryFn: masterDataApi.listRoutings });
}

export function useMasterSpecificConsumptions() {
  return useQuery({ queryKey: masterDataKeys.specificConsumptions(), queryFn: masterDataApi.listSpecificConsumptions });
}

export function useMasterRawMaterials() {
  return useQuery({ queryKey: masterDataKeys.rawMaterials(), queryFn: masterDataApi.listRawMaterials });
}

export function useMasterCustomers() {
  return useQuery({ queryKey: masterDataKeys.customers(), queryFn: masterDataApi.listCustomers });
}

export function useMasterSuppliers() {
  return useQuery({ queryKey: masterDataKeys.suppliers(), queryFn: masterDataApi.listSuppliers });
}

export function useMasterYards() {
  return useQuery({ queryKey: masterDataKeys.yards(), queryFn: masterDataApi.listYards });
}

export function useMasterProductionSetting() {
  return useQuery({ queryKey: masterDataKeys.productionSetting(), queryFn: masterDataApi.getProductionSetting });
}
