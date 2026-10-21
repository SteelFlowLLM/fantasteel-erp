import { describe, expect, it } from 'vitest';
import type { AgentCandidateView, AgentScanView } from '@fantasteel/shared';
import { isConfirmable, isOpenCandidate, recommendationsOf, scanSummary, sortCandidates } from '@/features/agent/lib/agentDisplay';

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

describe('지금 감지 결과 한 줄', () => {
  const view = (results: AgentScanView['results']): AgentScanView => ({ ranAt: '2026-10-21T00:00:00.000Z', results });

  it('후보를 만드는 위험은 후보, 알림만 보내는 위험은 알림으로 센다', () => {
    expect(
      scanSummary(
        view([
          { riskType: 'RAW_SHORTAGE', detected: 4, created: 2, error: null },
          { riskType: 'DUE_RISK', detected: 1, created: 1, error: null },
        ]),
      ),
    ).toBe('원료 부족 후보 2건 · 납기 위험 알림 1건');
  });

  it('실패한 규칙은 이름만 뒤에 붙인다', () => {
    expect(scanSummary(view([{ riskType: 'AGED_SURPLUS', detected: 0, created: 0, error: 'boom' }, { riskType: 'QUALITY_RATE_RISE', detected: 0, created: 0, error: null }]))).toBe('불합격률 상승 알림 0건 · 실패: 여재 장기 보유');
    expect(scanSummary(view([]))).toBe('돌린 규칙이 없어요');
  });
});
