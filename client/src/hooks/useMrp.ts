// MRP 조회 훅: 기간을 바꾸면 바로 다시 계산한다 (저장하지 않음).
import { useQuery } from '@tanstack/react-query';
import { mrpApi, mrpKeys, type MrpPeriod } from '@/api/mrp';

export function useMrpRequirements(period: MrpPeriod, enabled = true) {
  return useQuery({ queryKey: mrpKeys.requirements(period), queryFn: () => mrpApi.requirements(period), enabled });
}
