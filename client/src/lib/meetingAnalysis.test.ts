import type { MeetingCandidate, MeetingMinutesView } from '@fantasteel/shared';
import { describe, expect, it } from 'vitest';
import { analyzeAvailability, approvalBlocker, decisionCounts, evidenceLabel, formatSchedule, groupCandidates, registerPreview } from '@/lib/meetingAnalysis';

const minutes = (over: Partial<MeetingMinutesView> = {}): MeetingMinutesView => ({
  id: 1,
  meetingMinutesTitle: '회의',
  meetingDate: '2026-10-15',
  meetingMinutesStatus: 'TRANSCRIBED',
  transcript: '글',
  transcriptSegments: [],
  summary: null,
  analysisResult: null,
  failureReason: null,
  creator: { id: 5, name: '정다은' },
  attendees: [],
  confirmedAt: null,
  createdAt: '2026-10-15T00:00:00.000Z',
  updatedAt: '2026-10-15T00:00:00.000Z',
  ...over,
});

const candidate = (kind: MeetingCandidate['kind'], key: string): MeetingCandidate => ({
  key, kind, title: key, description: null, evidence: [0], sourceText: null, assigneeId: null, assigneeName: null, dueDate: null, startAt: null, endAt: null,
  endAssumed: false, attendeeIds: [], purchase: null, itemName: null, relatedSalesOrderNo: null, salesOrderId: null, issues: [], decision: 'PENDING',
});

describe('analyzeAvailability', () => {
  it('작성자가 전사 완료·검토 대기·실패(전사 있음)일 때만 정리할 수 있다', () => {
    for (const status of ['TRANSCRIBED', 'REVIEW', 'FAILED'] as const) expect(analyzeAvailability(minutes({ meetingMinutesStatus: status }), 5)).toEqual({ ok: true });
    for (const status of ['TRANSCRIBING', 'ANALYZING', 'CONFIRMED'] as const) expect(analyzeAvailability(minutes({ meetingMinutesStatus: status }), 5).ok).toBe(false);
  });

  it('작성자가 아니거나 전사가 없으면 안내 없이 막는다', () => {
    expect(analyzeAvailability(minutes(), 6)).toEqual({ ok: false, reason: null });
    expect(analyzeAvailability(minutes({ meetingMinutesStatus: 'FAILED', transcript: null }), 5)).toEqual({ ok: false, reason: null });
  });

  it('4만 자를 넘으면 사유를 알린다', () => {
    expect(analyzeAvailability(minutes({ transcript: '가'.repeat(40_001) }), 5)).toEqual({ ok: false, reason: expect.stringContaining('4만 자') });
  });
});

describe('후보 표시 계산', () => {
  it('할 일 → 일정 → 구매요청 초안 순으로 묶고 빈 묶음은 뺀다', () => {
    const groups = groupCandidates([candidate('PURCHASE', 'c1'), candidate('TASK', 'c2'), candidate('PURCHASE', 'c3')]);
    expect(groups.map((g) => [g.label, g.items.map((i) => i.key)])).toEqual([['할 일', ['c2']], ['구매요청 초안', ['c1', 'c3']]]);
  });

  it('일정 시각은 시간대 변환 없이 잘라 보인다', () => {
    expect(formatSchedule('2026-10-20T14:00:00+09:00', '2026-10-20T15:00:00+09:00')).toBe('2026-10-20 14:00 ~ 15:00');
    expect(formatSchedule('2026-10-20T23:30:00+09:00', '2026-10-21T00:30:00+09:00')).toBe('2026-10-20 23:30 ~ 2026-10-21 00:30');
    expect(formatSchedule(null, null)).toBe('-');
  });

  it('발언 번호는 1부터', () => {
    expect(evidenceLabel(0)).toBe('#1');
  });
});

describe('허가·제외 계산', () => {
  const task = (over: Partial<MeetingCandidate> = {}) => ({ ...candidate('TASK', 'c1'), assigneeId: 7, dueDate: '2026-10-22', ...over });

  it('허가·제외·남음 수를 센다', () => {
    const list = [task({ decision: 'APPROVED' }), task({ key: 'c2', decision: 'EXCLUDED' }), task({ key: 'c3' }), task({ key: 'c4' })];
    expect(decisionCounts(list)).toEqual({ approved: 1, excluded: 1, pending: 2 });
  });

  it('허가를 막는 이유는 서버 규칙과 같다 (종류별 필수 칸)', () => {
    expect(approvalBlocker(task())).toBeNull();
    expect(approvalBlocker(task({ assigneeId: null }))).toBe('담당자을(를) 채워야 허가할 수 있어요');
    expect(approvalBlocker({ ...candidate('EVENT', 'c1'), startAt: '2026-10-20T14:00:00+09:00', endAt: '2026-10-20T14:00:00+09:00', attendeeIds: [1] })).toContain('끝 시각');
    expect(approvalBlocker({ ...candidate('EVENT', 'c1'), startAt: '2026-10-20T14:00:00+09:00', endAt: '2026-10-20T15:00:00+09:00' })).toContain('참석자');
    expect(approvalBlocker(candidate('PURCHASE', 'c1'))).toBe('원료 품목, 수량(톤), 희망 입고일을(를) 채워야 허가할 수 있어요');
  });

  it('확정 확인창에는 허가한 후보만 종류별로 보인다', () => {
    const list = [task({ title: '견적 정리', decision: 'APPROVED' }), task({ key: 'c2', title: '제외', decision: 'EXCLUDED' }), { ...candidate('EVENT', 'c3'), title: '방문', decision: 'APPROVED' as const }];
    expect(registerPreview(list)).toEqual([
      { label: '할 일 1건', titles: ['견적 정리'] },
      { label: '일정 1건', titles: ['방문'] },
    ]);
  });
});
