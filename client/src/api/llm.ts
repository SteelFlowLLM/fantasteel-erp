// LLM 연결 설정 (문서에 없는 기능, 2026-10-07 추가). LM Studio 로컬 서버 → 나중에 API 키를 쓰는 외부 LLM.
// 가짜 DB 모드에서도 늘 실제 서버를 부른다: LM Studio는 바깥 프로그램이라 브라우저 안에서 흉내 낼 수 없고,
// 브라우저가 LM Studio를 직접 부르면 CORS 설정과 사용자 PC마다 LM Studio(LM Link)가 필요해진다.
import type { LlmChatTestView, LlmConnectionTestInput, LlmConnectionView, LlmSettingsInput, LlmSettingsView } from '@fantasteel/shared';
import { serverRequest } from '@/api/http';

export const llmKeys = {
  settings: () => ['llm', 'settings'] as const,
};

export const llmApi = {
  getSettings: (): Promise<LlmSettingsView> => serverRequest('GET', '/llm/settings'),
  updateSettings: (input: LlmSettingsInput): Promise<LlmSettingsView> => serverRequest('PUT', '/llm/settings', { body: input }),
  testConnection: (input: LlmConnectionTestInput): Promise<LlmConnectionView> => serverRequest('POST', '/llm/connection-test', { body: input }),
  testChat: (): Promise<LlmChatTestView> => serverRequest('POST', '/llm/chat-test'),
};
