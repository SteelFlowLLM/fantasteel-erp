import type { MeetingCandidate, MeetingMinutesView } from '@fantasteel/shared';
import { describe, expect, it } from 'vitest';
import { analyzeAvailability, evidenceLabel, formatSchedule, groupCandidates } from '@/lib/meetingAnalysis';

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
