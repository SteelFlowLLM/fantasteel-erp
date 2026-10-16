// AI 어시스턴트 (REQ-AST, API-262·263). 서버가 LM Studio를 불러 답한다 (LLM 연결 설정은 api/llm.ts).
import type { AiApprovalDecision, AiApprovalDecisionInput, AiApprovalDecisionView, AiAssistantCapabilitiesView, AiAssistantMessageInput, AiAssistantReplyView, AiAssistantStreamEvent, AiAssistantSuggestedQuestionsView } from '@fantasteel/shared';
import { serverRequest, serverStream } from '@/api/http';

export const aiAssistantKeys = {
  suggestedQuestions: (employeeId: number) => ['ai-assistant', 'suggested-questions', employeeId] as const,
  capabilities: ['ai-assistant', 'capabilities'] as const,
};

const STREAM_EVENT_TYPES: readonly string[] = ['thinking', 'answer', 'tool_start', 'tool_end', 'approval_required', 'approval_resolved', 'tool_execution', 'done', 'error'];

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
  /** 승인 카드의 허용·거부를 서버에 보낸다 (이슈 #362). 카드가 끝나는 건 스트림의 approval_resolved 이벤트로 안다 */
  decideApproval: (approvalId: string, decision: AiApprovalDecision): Promise<AiApprovalDecisionView> => {
    const body: AiApprovalDecisionInput = { decision };
    return serverRequest('POST', `/ai-assistant/approvals/${encodeURIComponent(approvalId)}`, { body });
  },
  /** 지금 모델이 사진을 보는지·생각 정도를 바꿀 수 있는지. LM Studio가 아니면 알 수 없어 null */
  getCapabilities: (): Promise<AiAssistantCapabilitiesView> => serverRequest('GET', '/ai-assistant/capabilities'),
  getSuggestedQuestions: (): Promise<AiAssistantSuggestedQuestionsView> => serverRequest('GET', '/ai-assistant/suggested-questions'),
};
