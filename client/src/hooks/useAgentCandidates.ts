// AI Factory Agent 대응 후보 조회 훅 (변경은 화면에서 useAction(agentCandidateApi.…)으로)
import { useQuery } from '@tanstack/react-query';
import { agentCandidateApi, agentCandidateKeys } from '@/api/agentCandidates';
import { useMe } from '@/hooks/useMe';

export function useAgentCandidates() {
  const me = useMe();
  return useQuery({ queryKey: agentCandidateKeys.list(me.employeeId), queryFn: agentCandidateApi.list, retry: false });
}
