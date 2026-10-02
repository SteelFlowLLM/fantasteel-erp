// 열연 투입 배정 조회 훅 (코일 계획 목록과 계획 하나의 추천·배정·코일)
import { useQuery } from '@tanstack/react-query';
import { rollingApi, rollingKeys } from '@/api/rolling';

export function useRollingPlanList() {
  return useQuery({ queryKey: rollingKeys.plans(), queryFn: rollingApi.plans });
}

export function useRollingDetail(productionPlanId: number | null) {
  return useQuery({
    queryKey: rollingKeys.detail(productionPlanId ?? 0),
    queryFn: () => rollingApi.detail(productionPlanId ?? 0),
    enabled: productionPlanId !== null,
  });
}
