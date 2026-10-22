import { describe, expect, it } from 'vitest';
import type { AgentCandidateView, AgentScanView } from '@fantasteel/shared';
import { ALERT_ONLY_NOTE, CANDIDATE_RISKS, candidateWaitingDays, isConfirmable, isOpenCandidate, recommendationsOf, scanOutcomeText, scanSummary, sortCandidates, staleCandidateLabel, STALE_CANDIDATE_DAYS } from '@/features/agent/lib/agentDisplay';

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

describe('지금 감지 뒤 남는 결과 (이슈 #532)', () => {
  const view = (results: AgentScanView['results']): AgentScanView => ({ ranAt: '2026-10-21T00:00:00.000Z', results });

  it('새 후보 수와 알림 수를 따로 세고, 실패한 규칙 수를 붙인다', () => {
    expect(
      scanOutcomeText(view([{ riskType: 'RAW_SHORTAGE', detected: 4, created: 2, error: null }, { riskType: 'AGED_SURPLUS', detected: 1, created: 1, error: null }, { riskType: 'DUE_RISK', detected: 1, created: 3, error: null }, { riskType: 'GOOD_QTY_SHORTAGE', detected: 0, created: 0, error: 'boom' }])),
    ).toBe('새 후보 3건 · 알림 3건 · 실패한 규칙 1개');
  });

  it('아무것도 만들지 않았으면 이유를 함께 알린다 (같은 대상의 처리 전 후보가 있으면 새로 만들지 않는다)', () => {
    const text = scanOutcomeText(view([{ riskType: 'RAW_SHORTAGE', detected: 2, created: 0, error: null }, { riskType: 'QUALITY_RATE_RISE', detected: 0, created: 0, error: null }]));
    expect(text).toContain('새 후보 0건 · 알림 0건');
    expect(text).toContain('같은 대상의 처리 전 후보가 이미 있거나');
    // 실패가 있으면 0건 설명을 붙이지 않는다
    expect(scanOutcomeText(view([{ riskType: 'RAW_SHORTAGE', detected: 0, created: 0, error: 'x' }]))).not.toContain('이미 있거나');
  });

  it('후보 목록에 없는 위험(납기 위험·불합격률 상승)은 알림만 보낸다고 화면에 적는다', () => {
    expect(ALERT_ONLY_NOTE).toBe('납기 위험·불합격률 상승은 대응 후보 없이 알림만 보내요');
    expect(CANDIDATE_RISKS).not.toContain('QUALITY_RATE_RISE');
  });

  it('확정 전 후보가 3일 이상 기다리면 며칠째인지 알린다. 처리한 후보·최근 후보는 알리지 않는다', () => {
    const now = new Date('2026-10-22T09:00:00.000Z');
    expect(STALE_CANDIDATE_DAYS).toBe(3);
    expect(candidateWaitingDays('2026-10-12T00:00:00.000Z', now)).toBe(10);
    expect(candidateWaitingDays('bad', now)).toBe(0);
    expect(staleCandidateLabel({ draftStatus: 'AI_GENERATED', createdAt: '2026-10-12T00:00:00.000Z' }, now)).toBe('10일째 확인 대기');
    expect(staleCandidateLabel({ draftStatus: 'WAITING_APPROVAL', createdAt: '2026-10-19T09:00:00.000Z' }, now)).toBe('3일째 확인 대기');
    expect(staleCandidateLabel({ draftStatus: 'AI_GENERATED', createdAt: '2026-10-19T10:00:00.000Z' }, now)).toBeNull();
    expect(staleCandidateLabel({ draftStatus: 'EXECUTED', createdAt: '2026-10-01T00:00:00.000Z' }, now)).toBeNull();
    expect(staleCandidateLabel({ draftStatus: 'APPROVED', createdAt: '2026-10-01T00:00:00.000Z' }, now)).toBeNull();
  });
});
