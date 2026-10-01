// 작업 실적 조회 훅 (작업 실적 화면: 계획 목록과 계획 하나의 실적·입력 기준값)
import { useQuery } from '@tanstack/react-query';
import { productionResultApi, productionResultKeys } from '@/api/productionResults';

export function useWorkPlanList() {
  return useQuery({ queryKey: productionResultKeys.plans(), queryFn: productionResultApi.plans });
}

export function useWorkContext(productionPlanId: number | null) {
  return useQuery({
    queryKey: productionResultKeys.work(productionPlanId ?? 0),
    queryFn: () => productionResultApi.work(productionPlanId ?? 0),
    enabled: productionPlanId !== null,
  });
}
