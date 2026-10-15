// 후보 고치기: 사용자가 바꾼 칸만 서버로 보낸다 (건드리지 않은 칸을 보내면 서버가 그 칸의 확인 사유를 지운다).
import type { MeetingCandidate } from '@fantasteel/shared';
import { describe, expect, it } from 'vitest';
import { changesOf } from '@/features/meetings/components/MeetingCandidateEditor';

const base: MeetingCandidate = {
  key: 'c1', kind: 'EVENT', title: '방문', description: null, evidence: [0], sourceText: null, assigneeId: null, assigneeName: null, dueDate: null,
  startAt: '2026-10-20T14:00:00+09:00', endAt: '2026-10-20T15:00:00+09:00', endAssumed: true, attendeeIds: [1, 2], purchase: null, itemName: null,
  relatedSalesOrderNo: null, salesOrderId: null, issues: ['끝 시각은 말이 없어 1시간으로 가정했어요'], context: [], decision: 'PENDING',
};

const same = {
  title: '방문', description: '', assigneeId: '', dueDate: '', startAt: '2026-10-20T14:00', endAt: '2026-10-20T15:00', attendeeIds: [1, 2], itemId: '', requestedTon: '', desiredReceiptDate: '',
};

describe('changesOf', () => {
  it('아무것도 안 바꾸면 빈 객체', () => {
    expect(changesOf(base, same)).toEqual({});
  });

  it('바꾼 칸만 담는다 (끝 시각만 바꾸면 시작은 보내지 않는다)', () => {
    expect(changesOf(base, { ...same, endAt: '2026-10-20T16:30' })).toEqual({ endAt: '2026-10-20T16:30' });
    expect(changesOf(base, { ...same, attendeeIds: [2, 1] })).toEqual({});
    expect(changesOf(base, { ...same, attendeeIds: [1] })).toEqual({ attendeeIds: [1] });
  });

  it('제목은 다듬고, 설명을 지우면 null', () => {
    expect(changesOf({ ...base, description: '메모' }, { ...same, title: '  새 방문 ', description: '' })).toEqual({ title: '새 방문', description: null });
  });

  it('할 일은 담당자·마감일, 구매요청은 품목·수량·희망 입고일만 담는다', () => {
    const task: MeetingCandidate = { ...base, kind: 'TASK', assigneeId: null, dueDate: '2026-10-22' };
    expect(changesOf(task, { ...same, assigneeId: '9', dueDate: '2026-10-23' })).toEqual({ assigneeId: 9, dueDate: '2026-10-23' });
    const purchase: MeetingCandidate = { ...base, kind: 'PURCHASE', purchase: { itemId: null, requestedTon: '20.000', desiredReceiptDate: null, requestReason: null, sourceText: null } };
    expect(changesOf(purchase, { ...same, itemId: '41', requestedTon: '20.000', desiredReceiptDate: '2026-11-05' })).toEqual({ purchase: { itemId: 41, desiredReceiptDate: '2026-11-05' } });
  });
});
