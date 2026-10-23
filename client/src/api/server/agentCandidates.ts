// AI Factory Agent 대응 후보 화면 ↔ 서버 API (server/src/modules/factory-agent, docs/backend/factory-agent.md).
// 목록·확정·반려는 초안 API(API-252·255·256)를 쓰고, 상황 설명은 API-264다. 권한(후보 업무의 권한)·재검증·실행은 서버가 맡는다.
import type { AgentCandidateExecutionResult, AgentCandidateView, AgentExplainView, AgentScanView } from '@fantasteel/shared';
import { serverRequest } from '@/api/http';

export const serverAgentCandidateApi = {
  /** API-283 (관리자만) 위험 감지를 지금 돌린다 */
  scan: () => serverRequest<AgentScanView>('POST', '/agent/scan'),
  list: () => serverRequest<AgentCandidateView[]>('GET', '/action-drafts', { query: { source: 'agent' } }),
  explain: (id: number) => serverRequest<AgentExplainView>('POST', `/action-drafts/${id}/explain`),
  confirm: (id: number, expectedUpdatedAt: string) => serverRequest<AgentCandidateExecutionResult>('POST', `/action-drafts/${id}/confirm`, { body: { expectedUpdatedAt } }),
  reject: (id: number, rejectReason: string, expectedUpdatedAt: string) =>
    serverRequest<AgentCandidateView>('POST', `/action-drafts/${id}/reject`, { body: { rejectReason, expectedUpdatedAt } }),
};
