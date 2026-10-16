// 철강맨AI 승인 카드(이슈 #362)의 상태 계산. 카드의 상태는 서버 이벤트(approval_required → approval_resolved → tool_execution)로만 바뀐다.
// 허용·거부를 눌러도 화면이 먼저 결과를 정하지 않는다: 서버가 approval_resolved를 보낼 때까지 '보내는 중'일 뿐이다.
import {
  AI_APPROVAL_RESOLUTION_LABEL,
  type AiApprovalDecision,
  type AiApprovalDetail,
  type AiApprovalResolution,
  type AiAssistantStreamEvent,
  type AiToolExecutionResult,
  type AiToolExecutionStatus,
} from '@fantasteel/shared';

export interface AiApprovalExecution {
  status: AiToolExecutionStatus;
  message: string;
  result: AiToolExecutionResult | null;
  attempts: number;
}

export interface AiApprovalCard {
  approvalId: string;
  /** 같은 도구 호출의 tool_start.id */
  toolId: string;
  toolName: string;
  title: string;
  details: AiApprovalDetail[];
  /** 이 시각까지 고르지 않으면 거부(TIMEOUT)로 끝난다. ISO 8601 */
  expiresAt: string;
  /** 허용·거부를 서버에 보내고 approval_resolved를 기다리는 중이면 보낸 값 */
  sending: AiApprovalDecision | null;
  /** approval_resolved로 끝난 이유. null이면 아직 고르는 중 */
  resolution: AiApprovalResolution | null;
  /** 허용한 뒤 tool_execution으로 받은 실행 결과 */
  execution: AiApprovalExecution | null;
  /** 허용했지만 연결이 끊겨 실행 결과를 받지 못한 채 닫힌 카드 */
  interrupted: boolean;
}

const mapCard = (cards: readonly AiApprovalCard[], approvalId: string, change: (card: AiApprovalCard) => AiApprovalCard): AiApprovalCard[] =>
  cards.map((card) => (card.approvalId === approvalId ? change(card) : card));

/** 승인 이벤트 하나를 카드 목록에 반영한다. 다른 이벤트나 모르는 카드의 이벤트는 그대로 둔다 */
export function reduceAiApprovals(cards: readonly AiApprovalCard[], event: AiAssistantStreamEvent): AiApprovalCard[] {
  switch (event.type) {
    case 'approval_required':
      if (cards.some((card) => card.approvalId === event.approvalId)) return [...cards];
      return [
        ...cards,
        {
          approvalId: event.approvalId,
          toolId: event.toolId,
          toolName: event.toolName,
          title: event.title,
          details: event.details,
          expiresAt: event.expiresAt,
          sending: null,
          resolution: null,
          execution: null,
          interrupted: false,
        },
      ];
    case 'approval_resolved':
      return mapCard(cards, event.approvalId, (card) => ({ ...card, resolution: event.decision, sending: null }));
    case 'tool_execution':
      return mapCard(cards, event.approvalId, (card) => ({
        ...card,
        execution: { status: event.status, message: event.message, result: event.result, attempts: event.attempts },
      }));
    default:
      return [...cards];
  }
}

/** 허용·거부를 보내는 중(decision)이거나 보내기가 끝난 것(null)을 표시한다 */
export function setAiApprovalSending(cards: readonly AiApprovalCard[], approvalId: string, decision: AiApprovalDecision | null): AiApprovalCard[] {
  return mapCard(cards, approvalId, (card) => (card.resolution === null ? { ...card, sending: decision } : card));
}

/**
 * 스트림이 끝났는데(멈추기·연결 끊김·오류) 아직 고르는 중인 카드는 서버가 연결이 끊길 때 거부로 끝내므로 화면도 거부됨으로 닫는다.
 * 허용했지만 실행 결과를 못 받은 카드는 결과를 모른다고 표시한다.
 */
export function settleAiApprovalsOnDisconnect(cards: readonly AiApprovalCard[]): AiApprovalCard[] {
  return cards.map((card) => {
    if (card.resolution === null) return { ...card, resolution: 'DENY', sending: null };
    if (card.resolution === 'ALLOW' && card.execution === null) return { ...card, interrupted: true };
    return card;
  });
}

/** 이 도구 호출(tool_start.id)에 붙은 카드 */
export const aiApprovalsForTool = (cards: readonly AiApprovalCard[], toolId: string): AiApprovalCard[] => cards.filter((card) => card.toolId === toolId);

/** 도구 줄에 붙지 않은 카드(예: 단계가 접힌 뒤의 답). 모든 카드가 어느 줄엔가 보이도록 */
export const aiApprovalsWithoutTool = (cards: readonly AiApprovalCard[], toolIds: ReadonlySet<string>): AiApprovalCard[] => cards.filter((card) => !toolIds.has(card.toolId));

/** 카드가 끝난 이유의 표시: 허용됨 · 거부됨 · 시간이 지나 거부됨 */
export function aiApprovalResolutionText(resolution: AiApprovalResolution): string {
  if (resolution === 'TIMEOUT') return '시간이 지나 거부됨';
  return `${AI_APPROVAL_RESOLUTION_LABEL[resolution]}됨`;
}

/** 남은 시간 문구: "9분 안에 결정", 1분 밑이면 "42초 안에 결정", 지났으면 안내. 시각을 못 읽으면 빈 문구 */
export function aiApprovalCountdownText(expiresAt: string, now: number): string {
  const expires = Date.parse(expiresAt);
  if (Number.isNaN(expires)) return '';
  const remaining = expires - now;
  if (remaining <= 0) return '결정할 시간이 지났어요';
  if (remaining < 60_000) return `${Math.ceil(remaining / 1000)}초 안에 결정`;
  return `${Math.ceil(remaining / 60_000)}분 안에 결정`;
}

/** 서버가 알려 준 이동 주소가 이 앱 안의 경로인지 (//나 http:로 시작하는 바깥 주소는 링크로 만들지 않는다) */
export const isInternalLinkPath = (path: string): boolean => path.startsWith('/') && !path.startsWith('//') && !path.includes('\\');
