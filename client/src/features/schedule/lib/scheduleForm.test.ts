import { describe, expect, it } from 'vitest';
import type { ScheduleEventView } from '@fantasteel/shared';
import { canEditEvent, emptyForm, endOptions, formOf, formProblem, inputOf, seoulIso, shiftEnd, startOptions } from '@/features/schedule/lib/scheduleForm';

const event = (over: Partial<ScheduleEventView> = {}): ScheduleEventView => ({
  id: 1,
  scheduleEventTitle: '거래처 미팅',
  scheduleEventDescription: null,
  startAt: '2026-11-03T05:00:00.000Z',
  endAt: '2026-11-03T06:30:00.000Z',
  linkPath: null,
  meetingMinutes: null,
  attendees: [{ employeeId: 3, employeeName: '박서영' }],
  creator: { id: 3, name: '박서영' },
  notionSync: true,
  notionPageUrl: null,
  ...over,
});

describe('내 일정 직접 등록·수정 입력', () => {
  it('서울 날짜·시각을 ISO로 보낸다 (자정 근처도 날짜가 밀리지 않게)', () => {
    expect(seoulIso('2026-11-03', '14:00')).toBe('2026-11-03T05:00:00.000Z');
    expect(seoulIso('2026-11-03', '00:30')).toBe('2026-11-02T15:30:00.000Z');
  });

  it('새 일정은 고른 날 09:00~10:00, 고칠 일정은 서울 날짜·시각으로 채운다', () => {
    expect(emptyForm('2026-11-03')).toEqual({ title: '', description: '', date: '2026-11-03', start: '09:00', end: '10:00', notionSync: true });
    expect(formOf(event({ scheduleEventDescription: '메모', notionSync: false }))).toEqual({ title: '거래처 미팅', description: '메모', date: '2026-11-03', start: '14:00', end: '15:30', notionSync: false });
  });

  it('제목이 비거나 끝이 시작과 같거나 앞이면 저장을 막는다', () => {
    const ok = { ...emptyForm('2026-11-03'), title: '회의' };
    expect(formProblem(ok)).toBeNull();
    expect(formProblem({ ...ok, title: '  ' })).toBe('제목을 입력해 주세요');
    expect(formProblem({ ...ok, end: '09:00' })).toBe('끝나는 시각은 시작 시각보다 뒤여야 해요');
    expect(formProblem({ ...ok, end: '08:30' })).toBe('끝나는 시각은 시작 시각보다 뒤여야 해요');
  });

  it('보낼 값: 제목은 앞뒤 공백을 지우고 빈 메모는 null', () => {
    expect(inputOf({ title: ' 회의 ', description: '  ', date: '2026-11-03', start: '14:00', end: '15:30', notionSync: false })).toEqual({
      scheduleEventTitle: '회의',
      scheduleEventDescription: null,
      startAt: '2026-11-03T05:00:00.000Z',
      endAt: '2026-11-03T06:30:00.000Z',
      notionSync: false,
    });
  });

  it('시각은 30분 단위 목록에서 고르고, 끝 목록은 시작 뒤 시각과 하루 끝(23:59)', () => {
    const starts = startOptions();
    expect(starts).toHaveLength(48);
    expect([starts[0], starts[1], starts.at(-1)]).toEqual(['00:00', '00:30', '23:30']);
    expect(startOptions('14:15')).toContain('14:15');
    expect(endOptions('22:30')).toEqual(['23:00', '23:30', '23:59']);
    expect(endOptions('23:30')).toEqual(['23:59']);
    expect(endOptions('09:00', '10:45')).toContain('10:45');
  });

  it('시작을 바꾸면 끝도 원래 길이만큼 옮기고, 하루를 넘으면 23:59', () => {
    expect(shiftEnd('09:00', '10:30', '13:00')).toBe('14:30');
    expect(shiftEnd('09:00', '09:00', '13:00')).toBe('14:00');
    expect(shiftEnd('09:00', '11:00', '23:00')).toBe('23:59');
  });

  it('내가 직접 등록한 일정만 고칠 수 있다 (참석만 한 일정·회의록 일정은 안 됨)', () => {
    expect(canEditEvent(event(), 3)).toBe(true);
    expect(canEditEvent(event(), 5)).toBe(false);
    expect(canEditEvent(event({ meetingMinutes: { id: 9, title: '주간 회의' } }), 3)).toBe(false);
  });
});
