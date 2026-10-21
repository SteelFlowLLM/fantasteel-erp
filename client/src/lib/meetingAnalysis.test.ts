import type { MeetingCandidate, MeetingMinutesView } from '@fantasteel/shared';
import { describe, expect, it } from 'vitest';
import { analyzeAvailability, approvalBlocker, contextLinesOf, decisionCounts, evidenceLabel, formatDuration, formatSchedule, groupCandidates, registerPreview, reviewSummaryText, traceSummaryText } from '@/lib/meetingAnalysis';

const minutes = (over: Partial<MeetingMinutesView> = {}): MeetingMinutesView => ({
  id: 1,
  meetingMinutesTitle: '회의',
  meetingDate: '2026-10-15',
  meetingMinutesStatus: 'TRANSCRIBED',
  transcript: '글',
  transcriptSegments: [],
  speakers: [],
  summary: null,
  analysisResult: null,
  failureReason: null,
  creator: { id: 5, name: '정다은' },
  attendees: [],
  confirmedAt: null,
  notionPageUrl: null,
  notionExportedAt: null,
  createdAt: '2026-10-15T00:00:00.000Z',
  updatedAt: '2026-10-15T00:00:00.000Z',
  ...over,
});

const candidate = (kind: MeetingCandidate['kind'], key: string): MeetingCandidate => ({
  key, kind, title: key, description: null, evidence: [0], sourceText: null, assigneeId: null, assigneeName: null, dueDate: null, startAt: null, endAt: null,
  endAssumed: false, attendeeIds: [], purchase: null, itemName: null, relatedSalesOrderNo: null, salesOrderId: null, issues: [], context: [], decision: 'PENDING',
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
      { label: '일정 1건 (Notion 캘린더에도 1건)', titles: ['방문'] },
    ]);
    const offline = [{ ...candidate('EVENT', 'c3'), title: '방문', decision: 'APPROVED' as const, notionSync: false }];
    expect(registerPreview(offline)).toEqual([{ label: '일정 1건', titles: ['방문'] }]);
  });
});

describe('contextLinesOf', () => {
  it('서버가 준 현황 줄을 그대로 읽는다', () => {
    const lines = [{ label: '현재 재고', value: '12.500 톤', tone: 'info' as const }, { label: '일정 겹침', value: '최준혁 · 14:30~15:30 회의', tone: 'warn' as const }];
    expect(contextLinesOf({ ...candidate('PURCHASE', 'c1'), context: lines })).toEqual(lines);
  });

  it('옛 분석 결과(칸 없음)·모양이 틀린 값은 빈 배열이나 걸러낸 줄로 읽는다', () => {
    const old = { ...candidate('TASK', 'c1') } as Partial<MeetingCandidate>;
    delete old.context;
    expect(contextLinesOf(old as MeetingCandidate)).toEqual([]);
    expect(contextLinesOf({ ...candidate('TASK', 'c1'), context: 'x' as unknown as MeetingCandidate['context'] })).toEqual([]);
    const messy = [null, { label: 1 }, { label: '업무', value: '3건', tone: 'bogus' }] as unknown as MeetingCandidate['context'];
    expect(contextLinesOf({ ...candidate('TASK', 'c1'), context: messy })).toEqual([{ label: '업무', value: '3건', tone: 'info' }]);
  });
});

describe('reviewSummaryText', () => {
  it('성공하면 빠진 후보·지적 건수, 실패하면 1차 결과만 보인다고 알린다', () => {
    expect(reviewSummaryText({ ok: true, missedCount: 2, concernCount: 0 })).toBe('2차 검토: 빠진 후보 2건 · 지적 0건');
    expect(reviewSummaryText({ ok: false, error: '시간 초과' })).toBe('2차 검토 실패 — 1차 결과만 보여요');
  });

  it('2차 검토를 하지 않은 옛 결과는 아무것도 보이지 않는다', () => {
    expect(reviewSummaryText(undefined)).toBeNull();
  });
});

describe('AI 실행 기록 표시', () => {
  it('formatDuration: 1분 미만은 소수 한 자리 초, 넘으면 분·초', () => {
    expect(formatDuration(8400)).toBe('8.4초');
    expect(formatDuration(72_300)).toBe('1분 12초');
    expect(formatDuration(-5)).toBe('0.0초');
  });

  it('traceSummaryText: 호출 수·전체 시간·버림·고침 수, 없는 것은 뺀다', () => {
    const step = (changes: { action: 'DROPPED' | 'CHANGED' }[]) => ({
      stage: 'ANALYSIS' as const,
      model: 'm',
      durationMs: 1000,
      ok: true,
      error: null,
      rawAnswer: null,
      thinking: null,
      truncated: false,
      changes: changes.map((c) => ({ ...c, title: null, reason: '이유' })),
    });
    expect(traceSummaryText({ steps: [step([{ action: 'DROPPED' }, { action: 'CHANGED' }]), step([{ action: 'DROPPED' }])], totalMs: 90_000 })).toBe('AI 호출 2번 · 1분 30초 · 버림 2 · 고침 1');
    expect(traceSummaryText({ steps: [step([])], totalMs: 1500 })).toBe('AI 호출 1번 · 1.5초');
  });
});
