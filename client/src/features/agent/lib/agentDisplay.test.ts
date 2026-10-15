import { describe, expect, it } from 'vitest';
import type { AgentCandidateView } from '@fantasteel/shared';
import { isConfirmable, isOpenCandidate, recommendationsOf, sortCandidates } from '@/features/agent/lib/agentDisplay';

const candidate = (id: number, draftStatus: AgentCandidateView['draftStatus']): AgentCandidateView => ({
  id,
  actionType: 'PURCHASE_REQUISITION_CREATE',
  draftStatus,
  riskType: 'RAW_SHORTAGE',
  summary: '',
  evidence: {},
  payload: {},
  confirmerId: null,
  confirmerName: null,
  result: null,
  executionErrorCode: null,
  executionAttemptCount: 0,
  rejectReason: null,
  confirmedAt: null,
  createdAt: '2026-10-15T00:00:00.000Z',
  updatedAt: '2026-10-15T00:00:00.000Z',
});

describe('Agent 대응 후보 표시 규칙', () => {
  it('열린 후보를 앞에, 같은 그룹에서는 최근(id 큰) 것을 앞에 둔다', () => {
    const sorted = sortCandidates([candidate(1, 'EXECUTED'), candidate(2, 'WAITING_APPROVAL'), candidate(3, 'REJECTED'), candidate(4, 'APPROVED')]);
    expect(sorted.map((c) => c.id)).toEqual([4, 2, 3, 1]);
  });

  it('확정·반려는 확정 전 상태만, 확정했지만 실행 전(APPROVED)은 열린 후보지만 확정 대상이 아니다', () => {
    expect(isConfirmable(candidate(1, 'WAITING_APPROVAL'))).toBe(true);
    expect(isConfirmable(candidate(1, 'APPROVED'))).toBe(false);
    expect(isOpenCandidate(candidate(1, 'APPROVED'))).toBe(true);
    expect(isOpenCandidate(candidate(1, 'EXECUTED'))).toBe(false);
  });

  it('여재 추천 목록은 모양이 맞는 줄만 읽는다', () => {
    expect(recommendationsOf({ recommendations: [{ salesOrderItemId: 1, salesOrderNo: 'SO-1', lineNo: 1, dueDate: '2026-11-01', unsecuredQty: 2 }, { salesOrderItemId: 'x' }, null] })).toHaveLength(1);
    expect(recommendationsOf({})).toEqual([]);
  });
});
