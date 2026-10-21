// factory-agent 모듈 응답 타입 (docs/backend/factory-agent.md). 톤은 소수 3자리 문자열, 날짜는 'YYYY-MM-DD', 시각은 ISO 8601.
import type { ActionType, AgentRiskType, DraftStatus } from './codes';

/** 규칙이 초안 payload의 `agent` 칸에 남기는 감지 근거. 같은 대상(targetKey)의 미처리 초안은 하나만 둔다 (REQ-AGT-005) */
export interface AgentDraftMeta {
  riskType: AgentRiskType;
  /** 중복 방지 키. 예: RAW_SHORTAGE:plan:3:item:7 */
  targetKey: string;
  /** 감지한 날짜 (서울) */
  detectedOn: string;
  /** 규칙이 만든 한 줄 요약 (숫자는 조회 값 그대로) */
  summary: string;
  /** 설명의 근거가 되는 조회 값 */
  evidence: Record<string, string | number | null>;
}

/** GET action-drafts?source=agent 한 줄, 초안 상세 (Agent 대응 후보) */
export interface AgentCandidateView {
  id: number;
  actionType: ActionType;
  draftStatus: DraftStatus;
  riskType: AgentRiskType;
  summary: string;
  evidence: Record<string, string | number | null>;
  /** 후보가 만들 업무의 입력값 (유형별) */
  payload: Record<string, unknown>;
  /** 확정한 사원. 확정 전에는 null */
  confirmerId: number | null;
  confirmerName: string | null;
  /** 실행 결과로 만들어진 업무 */
  result: { kind: 'PURCHASE_REQUISITION' | 'PRODUCTION_PLAN'; id: number; no: string } | null;
  executionErrorCode: string | null;
  executionAttemptCount: number;
  rejectReason: string | null;
  confirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** POST action-drafts/:id/confirm·execute (Agent 후보) */
export interface AgentCandidateExecutionResult {
  draft: AgentCandidateView;
  executed: boolean;
  errorCode: string | null;
  errorMessage: string | null;
}

/** POST action-drafts/:id/explain (API-264). 설명만 하고 후보를 바꾸지 않는다 */
export interface AgentExplainView {
  draftId: number;
  explanation: string;
  /** 설명에 쓴 조회 근거 (표시용) */
  basis: string[];
  /** LLM이 쓴 설명이면 true, LLM 설정이 없거나 실패해 규칙 요약을 그대로 돌려줬으면 false */
  generatedByAi: boolean;
}
