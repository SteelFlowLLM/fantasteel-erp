// AI 어시스턴트 (REQ-AST, API-262·263). 서버가 LM Studio를 불러 답한다 (LLM 연결 설정은 api/llm.ts).
import type {
  AiActionCardExecuteRequest,
  AiActionCardExecuteResult,
  AiAssistantCapabilitiesView,
  AiAssistantMessageInput,
  AiAssistantReplyView,
  AiAssistantStreamEvent,
  AiAssistantSuggestedQuestionsView,
  AiChatThreadSummaryView,
  AiChatThreadView,
  AiScreenActionResultInput,
  PageResult,
} from '@fantasteel/shared';
import { serverRequest, serverStream } from '@/api/http';

export const aiAssistantKeys = {
  suggestedQuestions: (employeeId: number) => ['ai-assistant', 'suggested-questions', employeeId] as const,
  capabilities: ['ai-assistant', 'capabilities'] as const,
  /** 저장한 대화 목록 (이슈 #399). 사원마다 따로 */
  threads: (employeeId: number) => ['ai-assistant', 'threads', employeeId] as const,
};

/** 대화 목록 한 번에 읽는 수 */
export const AI_CHAT_THREAD_PAGE_SIZE = 20;

const STREAM_EVENT_TYPES: readonly string[] = ['thinking', 'answer', 'tool_start', 'tool_end', 'browser_frame', 'ui_action', 'done', 'error'];

/**
 * 스트림 한 줄을 이벤트로 읽는다. JSON이 아니면 오류, 모르는 종류의 이벤트는 null(서버가 새 종류를 더해도 화면이 멈추지 않게 건너뛴다).
 */
export function parseAiAssistantStreamEvent(line: string): AiAssistantStreamEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    throw new Error('서버 응답을 읽을 수 없어요');
  }
  if (typeof value !== 'object' || value === null || !('type' in value) || typeof value.type !== 'string') {
    throw new Error('서버 응답을 읽을 수 없어요');
  }
  // 종류만 확인한다: 필드 모양은 shared 타입을 서버와 화면이 함께 쓰므로 믿는다
  return STREAM_EVENT_TYPES.includes(value.type) ? (value as AiAssistantStreamEvent) : null;
}

export const aiAssistantApi = {
  ask: (input: AiAssistantMessageInput): Promise<AiAssistantReplyView> => serverRequest('POST', '/ai-assistant/messages', { body: input }),
  /** 실행 카드의 [실행]. 사용자가 확인·수정한 값을 보내면 서버가 다시 검증해 업무·일정·구매요청 초안을 만든다. chat이 있으면 저장한 카드를 실행됨으로 남긴다 */
  executeActionCard: (input: AiActionCardExecuteRequest): Promise<AiActionCardExecuteResult> => serverRequest('POST', '/ai-assistant/action-cards/execute', { body: input }),
  /** 저장한 대화 목록 (이슈 #399). 내 대화만, 마지막으로 묻고 답한 순서 */
  listThreads: (page: number, size = AI_CHAT_THREAD_PAGE_SIZE): Promise<PageResult<AiChatThreadSummaryView>> => serverRequest('GET', '/ai-assistant/threads', { query: { page, size } }),
  getThread: (id: number): Promise<AiChatThreadView> => serverRequest('GET', `/ai-assistant/threads/${id}`),
  /** 대화와 메시지를 모두 지운다 (되살릴 수 없다) */
  deleteThread: (id: number): Promise<AiChatThreadSummaryView> => serverRequest('DELETE', `/ai-assistant/threads/${id}`),
  /** 답을 만드는 과정을 이벤트로 받는다. 마지막 이벤트는 done 또는 error. signal로 멈추면 AbortError가 던져진다 */
  askStream: (input: AiAssistantMessageInput, onEvent: (event: AiAssistantStreamEvent) => void, signal?: AbortSignal): Promise<void> =>
    serverStream('POST', '/ai-assistant/messages/stream', {
      body: input,
      signal,
      onLine: (line) => {
        const event = parseAiAssistantStreamEvent(line);
        if (event) onEvent(event);
      },
    }),
  /** 화면 조작 결과 (이슈 #382). 실시간 답이 보낸 ui_action을 이 화면에서 실행한 결과를 돌려준다 */
  sendUiActionResult: (actionId: string, result: AiScreenActionResultInput): Promise<{ accepted: true }> =>
    serverRequest('POST', `/ai-assistant/ui-actions/${encodeURIComponent(actionId)}`, { body: result }),
  /** 지금 모델이 사진을 보는지·생각 정도를 바꿀 수 있는지. LM Studio가 아니면 알 수 없어 null */
  getCapabilities: (): Promise<AiAssistantCapabilitiesView> => serverRequest('GET', '/ai-assistant/capabilities'),
  getSuggestedQuestions: (): Promise<AiAssistantSuggestedQuestionsView> => serverRequest('GET', '/ai-assistant/suggested-questions'),
};
