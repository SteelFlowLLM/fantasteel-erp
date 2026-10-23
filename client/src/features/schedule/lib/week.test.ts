import { describe, expect, it } from 'vitest';
import { addDays, isDateString, mondayOf, overlapsDay, seoulDayOf, weekDays, weekFromParam } from '@/features/schedule/lib/week';

describe('주 계산 (월요일 시작, Asia/Seoul)', () => {
  it('월요일은 그대로, 수요일·일요일은 그 주 월요일로', () => {
    expect(mondayOf('2026-10-19')).toBe('2026-10-19');
    expect(mondayOf('2026-10-21')).toBe('2026-10-19');
    expect(mondayOf('2026-10-25')).toBe('2026-10-19');
    expect(mondayOf('2026-10-26')).toBe('2026-10-26');
  });

  it('달·해가 바뀌어도 맞다', () => {
    expect(mondayOf('2026-11-01')).toBe('2026-10-26');
    expect(mondayOf('2027-01-01')).toBe('2026-12-28');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(weekDays('2026-10-26')).toEqual(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01']);
  });

  it('?week 값: 잘못되거나 없으면 오늘이 속한 주', () => {
    expect(weekFromParam('2026-10-22', '2026-11-03')).toBe('2026-10-19');
    expect(weekFromParam(null, '2026-11-03')).toBe('2026-11-02');
    expect(weekFromParam('abc', '2026-11-03')).toBe('2026-11-02');
    expect(weekFromParam('2026-02-30', '2026-11-03')).toBe('2026-11-02');
    expect(isDateString('2026-10-20')).toBe(true);
    expect(isDateString('2026-13-01')).toBe(false);
  });

  it('UTC로는 전날인 시각도 서울 날짜로 센다', () => {
    expect(seoulDayOf('2026-10-19T15:30:00.000Z')).toBe('2026-10-20');
    expect(seoulDayOf('2026-10-20T05:00:00.000Z')).toBe('2026-10-20');
  });
});

describe('overlapsDay (#487)', () => {
  const lateSunday = { startAt: '2026-11-08T14:30:00.000Z', endAt: '2026-11-08T15:30:00.000Z' }; // 서울 일 23:30 ~ 월 00:30
  it('날을 넘기는 일정은 두 날에 모두, 지난주에 시작해 걸친 일정은 이번 주 첫날에 보인다', () => {
    expect(overlapsDay(lateSunday, '2026-11-08')).toBe(true);
    expect(overlapsDay(lateSunday, '2026-11-09')).toBe(true);
    expect(overlapsDay(lateSunday, '2026-11-10')).toBe(false);
  });

  it('끝이 그날 0시 정각이면 그날에는 넣지 않는다', () => {
    const untilMidnight = { startAt: '2026-11-08T14:00:00.000Z', endAt: '2026-11-08T15:00:00.000Z' }; // 일 23:00 ~ 월 00:00
    expect(overlapsDay(untilMidnight, '2026-11-08')).toBe(true);
    expect(overlapsDay(untilMidnight, '2026-11-09')).toBe(false);
  });
});

