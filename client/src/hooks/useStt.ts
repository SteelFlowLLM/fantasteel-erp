// 음성 인식 연결 설정 훅. 연결 확인·파일 시험은 결과를 화면에 바로 보이므로 useAction이 아니라 useMutation을 쓴다.
import { useMutation, useQuery } from '@tanstack/react-query';
import { sttApi, sttKeys } from '@/api/stt';

export function useSttSettings() {
  return useQuery({ queryKey: sttKeys.settings(), queryFn: sttApi.getSettings });
}

export function useSttConnectionTest() {
  return useMutation({ mutationFn: sttApi.testConnection });
}

export function useSttTranscribeTest() {
  return useMutation({ mutationFn: sttApi.testTranscribe });
}
