// 외부 서비스 연결 훅. 연결 확인은 결과를 화면에 바로 보이므로 useAction이 아니라 useMutation을 쓴다.
import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';
import { integrationApi, integrationKeys, type DriveFileKind } from '@/api/integrations';

export function useIntegrations() {
  return useQuery({ queryKey: integrationKeys.list(), queryFn: integrationApi.list });
}

export function useIntegrationTest() {
  return useMutation({ mutationFn: integrationApi.test });
}

/** Drive 폴더의 파일을 쪽 단위로 읽는다 (더 보기). 창을 열었을 때만 부르도록 enabled로 막는다 */
export function useDriveFiles(kind: DriveFileKind, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: integrationKeys.driveFiles(kind),
    queryFn: ({ pageParam }) => integrationApi.driveFiles({ kind, pageToken: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextPageToken ?? undefined,
    enabled,
    // 열 때마다 새로 읽는다: 그 사이 팀이 올린 녹음이 보여야 한다
    staleTime: 0,
    gcTime: 0,
  });
}
