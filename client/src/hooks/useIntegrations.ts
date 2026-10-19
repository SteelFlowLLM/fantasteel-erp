// 외부 서비스 연결 훅. 연결 확인은 결과를 화면에 바로 보이므로 useAction이 아니라 useMutation을 쓴다.
import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';
import { integrationApi, integrationKeys, type DriveFileListKind } from '@/api/integrations';
import { googleDriveConnection, isDriveReady } from '@/lib/integrations';

export function useIntegrations() {
  return useQuery({ queryKey: integrationKeys.list(), queryFn: integrationApi.list });
}

export function useIntegrationTest() {
  return useMutation({ mutationFn: integrationApi.test });
}

/** Drive 폴더의 파일을 쪽 단위로 읽는다 (더 보기). 창을 열었을 때만 부르도록 enabled로 막는다 */
export function useDriveFiles(kind: DriveFileListKind, enabled: boolean) {
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

/** 회사 Google Drive가 연결되고 폴더가 정해졌는지. 읽는 중에는 ready가 false다 */
export function useDriveReady(): { ready: boolean; loading: boolean } {
  const integrations = useIntegrations();
  return { ready: isDriveReady(googleDriveConnection(integrations.data)), loading: integrations.isPending };
}

/** Drive 파일 내용을 Blob으로 받는다. 한 번 본 파일을 다시 열 때 새로 받는다 (Blob을 캐시에 오래 두지 않는다) */
export function useDriveFileBlob(fileId: string, enabled = true) {
  return useQuery({
    queryKey: integrationKeys.driveBlob(fileId),
    queryFn: () => integrationApi.driveFileBlob(fileId),
    enabled,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
}
