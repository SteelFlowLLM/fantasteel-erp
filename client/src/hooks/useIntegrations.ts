// 외부 서비스 연결 훅. 연결 확인은 결과를 화면에 바로 보이므로 useAction이 아니라 useMutation을 쓴다.
import { useMutation, useQuery } from '@tanstack/react-query';
import { integrationApi, integrationKeys } from '@/api/integrations';

export function useIntegrations() {
  return useQuery({ queryKey: integrationKeys.list(), queryFn: integrationApi.list });
}

export function useIntegrationTest() {
  return useMutation({ mutationFn: integrationApi.test });
}
