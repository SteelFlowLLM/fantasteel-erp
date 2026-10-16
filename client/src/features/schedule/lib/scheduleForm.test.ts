import { describe, expect, it } from 'vitest';
import type { ScheduleEventView } from '@fantasteel/shared';
import { canEditEvent, emptyForm, formOf, formProblem, inputOf, seoulIso } from '@/features/schedule/lib/scheduleForm';

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
  ...over,
});

describe('내 일정 직접 등록·수정 입력', () => {
  it('서울 날짜·시각을 ISO로 보낸다 (자정 근처도 날짜가 밀리지 않게)', () => {
    expect(seoulIso('2026-11-03', '14:00')).toBe('2026-11-03T05:00:00.000Z');
    expect(seoulIso('2026-11-03', '00:30')).toBe('2026-11-02T15:30:00.000Z');
  });

  it('새 일정은 고른 날 09:00~10:00, 고칠 일정은 서울 날짜·시각으로 채운다', () => {
    expect(emptyForm('2026-11-03')).toEqual({ title: '', description: '', date: '2026-11-03', start: '09:00', end: '10:00' });
    expect(formOf(event({ scheduleEventDescription: '메모' }))).toEqual({ title: '거래처 미팅', description: '메모', date: '2026-11-03', start: '14:00', end: '15:30' });
  });

  it('제목이 비거나 끝이 시작과 같거나 앞이면 저장을 막는다', () => {
    const ok = { ...emptyForm('2026-11-03'), title: '회의' };
    expect(formProblem(ok)).toBeNull();
    expect(formProblem({ ...ok, title: '  ' })).toBe('제목을 입력해 주세요');
    expect(formProblem({ ...ok, end: '09:00' })).toBe('끝나는 시각은 시작 시각보다 뒤여야 해요');
    expect(formProblem({ ...ok, end: '08:30' })).toBe('끝나는 시각은 시작 시각보다 뒤여야 해요');
  });

  it('보낼 값: 제목은 앞뒤 공백을 지우고 빈 메모는 null', () => {
    expect(inputOf({ title: ' 회의 ', description: '  ', date: '2026-11-03', start: '14:00', end: '15:30' })).toEqual({
      scheduleEventTitle: '회의',
      scheduleEventDescription: null,
      startAt: '2026-11-03T05:00:00.000Z',
      endAt: '2026-11-03T06:30:00.000Z',
    });
  });

  it('내가 직접 등록한 일정만 고칠 수 있다 (참석만 한 일정·회의록 일정은 안 됨)', () => {
    expect(canEditEvent(event(), 3)).toBe(true);
    expect(canEditEvent(event(), 5)).toBe(false);
    expect(canEditEvent(event({ meetingMinutes: { id: 9, title: '주간 회의' } }), 3)).toBe(false);
  });
});
