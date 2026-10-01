// 생산계획 조회 훅 (생산계획 화면)
import { useQuery } from '@tanstack/react-query';
import { productionPlanApi, productionPlanKeys } from '@/api/production';

export function useProductionPlanList() {
  return useQuery({ queryKey: productionPlanKeys.list(), queryFn: productionPlanApi.list });
}

export function useProductionPlanDetail(productionPlanId: number | null) {
  return useQuery({
    queryKey: productionPlanKeys.detail(productionPlanId ?? 0),
    queryFn: () => productionPlanApi.detail(productionPlanId ?? 0),
    enabled: productionPlanId !== null,
  });
}
