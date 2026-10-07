// LLM 연결 설정 훅. 연결 확인·응답 확인은 결과를 화면에 바로 보이므로 useAction이 아니라 useMutation을 쓴다.
import { useMutation, useQuery } from '@tanstack/react-query';
import { llmApi, llmKeys } from '@/api/llm';

export function useLlmSettings() {
  return useQuery({ queryKey: llmKeys.settings(), queryFn: llmApi.getSettings });
}

export function useLlmConnectionTest() {
  return useMutation({ mutationFn: llmApi.testConnection });
}

export function useLlmChatTest() {
  return useMutation({ mutationFn: llmApi.testChat });
}
