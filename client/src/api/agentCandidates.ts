// AI Factory Agent 대응 후보 api (REQ-AGT-005·006, BP-AGT-01). 서버를 부른다 (api/server/agentCandidates.ts).
// 후보는 Action Draft라 목록·확정·반려는 초안 API를 함께 쓴다. 감지는 서버가 스케줄·이벤트로 돌리고, 관리자만 화면에서 지금 바로 돌릴 수 있다(scan).
import type { AgentCandidateExecutionResult, AgentCandidateView, AgentExplainView, AgentScanView } from '@fantasteel/shared';
import { serverAgentCandidateApi } from '@/api/server/agentCandidates';

export type { AgentCandidateExecutionResult, AgentCandidateView, AgentExplainView, AgentScanView };

export const agentCandidateKeys = {
  all: ['action-drafts', 'agent'] as const,
  list: (employeeId: number) => ['action-drafts', 'agent', 'list', employeeId] as const,
};

export const agentCandidateApi = {
  /** 관리자만: 스케줄을 기다리지 않고 위험 감지를 지금 돌린다. 같은 대상의 처리 전 후보는 새로 만들지 않는다 */
  scan: (): Promise<AgentScanView> => serverAgentCandidateApi.scan(),
  list: (): Promise<AgentCandidateView[]> => serverAgentCandidateApi.list(),
  explain: (input: { id: number }): Promise<AgentExplainView> => serverAgentCandidateApi.explain(input.id),
  confirm: (input: { id: number; expectedUpdatedAt: string }): Promise<AgentCandidateExecutionResult> => serverAgentCandidateApi.confirm(input.id, input.expectedUpdatedAt),
  reject: (input: { id: number; rejectReason: string; expectedUpdatedAt: string }): Promise<AgentCandidateView> => serverAgentCandidateApi.reject(input.id, input.rejectReason, input.expectedUpdatedAt),
};
