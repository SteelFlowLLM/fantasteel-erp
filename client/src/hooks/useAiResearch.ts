// 철강맨AI 심층 조사 조회 훅. 진행은 화면이 2~3초마다 afterSeq 다음 이벤트만 받아 이어 붙인다 (회의록 AI 정리와 같은 폴링).
import { keepPreviousData, skipToken, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AiResearchRunSummaryView, AiResearchRunView } from '@fantasteel/shared';
import { aiResearchApi, aiResearchKeys } from '@/api/aiResearch';
import { useMe } from '@/hooks/useMe';
import { isRunActive, mergeRunView, nextAfterSeq, RUN_POLL_MS, shouldPollRun } from '@/lib/aiResearch';

export function useAiResearchList() {
  const me = useMe();
  return useQuery({
    queryKey: aiResearchKeys.list(me.employeeId),
    queryFn: aiResearchApi.list,
    placeholderData: keepPreviousData,
    // 목록의 상태 배지도 진행 중인 조사가 있는 동안은 따라간다
    refetchInterval: (query) => ((query.state.data?.items ?? []).some((row: AiResearchRunSummaryView) => isRunActive(row.status)) ? RUN_POLL_MS : false),
  });
}

export function useAiResearchRun(id: number | null) {
  const me = useMe();
  const queryClient = useQueryClient();
  const key = aiResearchKeys.detail(me.employeeId, id ?? 0);
  return useQuery({
    queryKey: key,
    queryFn:
      id === null
        ? skipToken
        : async () => {
            const previous = queryClient.getQueryData<AiResearchRunView>(key);
            const next = await aiResearchApi.get(id, previous ? nextAfterSeq(previous.events) : 0);
            return mergeRunView(previous, next);
          },
    retry: false,
    refetchInterval: (query) => (shouldPollRun(query.state.data?.status) ? RUN_POLL_MS : false),
  });
}
