// 관리자 조직 화면 조회 훅. 사원·부서·직급·역할 목록은 useDirectory.ts를 함께 쓴다.
import { useQuery } from '@tanstack/react-query';
import { adminOrgApi, adminOrgKeys } from '@/api/adminOrganization';

/** 조직도: 부서 트리 + 부서별 사용 중 인원 (직급 표시 순서) */
export function useAdminOrgChart() {
  return useQuery({ queryKey: adminOrgKeys.orgChart(), queryFn: adminOrgApi.getOrgChart });
}
