// 음성 인식 연결 설정 훅. 연결 확인·파일 시험은 결과를 화면에 바로 보이므로 useAction이 아니라 useMutation을 쓴다.
import { useMutation, useQuery } from '@tanstack/react-query';
import { sttApi, sttKeys } from '@/api/stt';

export function useSttSettings() {
  return useQuery({ queryKey: sttKeys.settings(), queryFn: sttApi.getSettings });
}

/** 철강맨 부르기 회사 설정 (이슈 #457) */
export function useSteelmanWakeSettings() {
  return useQuery({ queryKey: sttKeys.wakeSettings(), queryFn: sttApi.getWakeSettings });
}

/**
 * 저장된 음성 설정으로 음성 서버에 닿는지 (철강맨 부르기 카드, 이슈 #457). 1초 무음을 실제로 보내 보므로 탭을 열었을 때만 부른다.
 * 연결 확인은 설정 사용 권한(ORG_MANAGE USE)이 있어야 해서 enabled로 막는다
 */
export function useSttSavedConnection(enabled: boolean) {
  return useQuery({
    queryKey: sttKeys.savedConnection(),
    queryFn: async () => sttApi.testConnection({ baseUrl: (await sttApi.getSettings()).baseUrl }),
    enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}

export function useSttConnectionTest() {
  return useMutation({ mutationFn: sttApi.testConnection });
}

export function useSttTranscribeTest() {
  return useMutation({ mutationFn: sttApi.testTranscribe });
}

/** 켜는 중(켜졌지만 아직 응답 없음)일 때만 2초마다 다시 본다 */
export function useSttLocalServer() {
  return useQuery({
    queryKey: sttKeys.localServer(),
    queryFn: sttApi.getLocalServer,
    refetchInterval: (query) => (query.state.data?.running && !query.state.data.healthy ? 2_000 : false),
  });
}
