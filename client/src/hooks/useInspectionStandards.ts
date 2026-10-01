// 검사 기준 조회 훅 (api/inspectionStandards.ts). 새 버전 만들기는 useAction(inspectionStandardApi.createVersion)으로 한다.
import { useQuery } from '@tanstack/react-query';
import { inspectionStandardApi, inspectionStandardKeys, type InspectionStandardListQuery } from '@/api/inspectionStandards';

export function useInspectionStandardList(query: InspectionStandardListQuery = {}) {
  return useQuery({ queryKey: inspectionStandardKeys.list(query), queryFn: () => inspectionStandardApi.list(query) });
}

export function useInspectionStandardDetail(id: number | null) {
  return useQuery({
    queryKey: inspectionStandardKeys.detail(id ?? 0),
    queryFn: () => inspectionStandardApi.get(id ?? 0),
    enabled: id !== null,
  });
}
