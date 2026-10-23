// 심층 조사 반복의 다음 차례 계산 (이슈 #521, DB 없음). 시각·요일은 Asia/Seoul(+09:00)로 본다
import { aiResearchScheduleText, nextAiResearchRunAt, normalizeWeekdays, type AiResearchScheduleRule } from '@fantasteel/shared';

/** 서울 시각 글 → Date */
const seoul = (text: string): Date => new Date(`${text}+09:00`);
const daily = (time: string): AiResearchScheduleRule => ({ frequency: 'DAILY', weekdays: [], time });
const weekly = (weekdays: number[], time: string): AiResearchScheduleRule => ({ frequency: 'WEEKLY', weekdays, time });

describe('다음 차례 시각 (서울)', () => {
  // 2026-10-22는 목요일
  it('매일: 오늘 시각이 아직이면 오늘, 지났거나 같은 시각이면 내일', () => {
    expect(nextAiResearchRunAt(daily('09:00'), seoul('2026-10-22T08:59:59'))).toEqual(seoul('2026-10-22T09:00:00'));
    expect(nextAiResearchRunAt(daily('09:00'), seoul('2026-10-22T09:00:00'))).toEqual(seoul('2026-10-23T09:00:00'));
    expect(nextAiResearchRunAt(daily('09:00'), seoul('2026-10-22T13:00:00'))).toEqual(seoul('2026-10-23T09:00:00'));
  });

  it('서울 날짜로 센다: UTC로는 전날인 서울 새벽에도 서울 오늘의 시각을 고른다', () => {
    // 서울 2026-10-22 07:30 = UTC 2026-10-21 22:30
    const after = new Date('2026-10-21T22:30:00Z');
    expect(nextAiResearchRunAt(daily('08:00'), after)?.toISOString()).toBe('2026-10-21T23:00:00.000Z');
    expect(nextAiResearchRunAt(daily('00:00'), seoul('2026-10-22T23:59:00'))).toEqual(seoul('2026-10-23T00:00:00'));
    expect(nextAiResearchRunAt(daily('23:59'), seoul('2026-12-31T23:59:00'))).toEqual(seoul('2027-01-01T23:59:00'));
  });

  it('매주: 고른 요일 중 가장 가까운 것, 같은 요일 시각이 지났으면 다음 주', () => {
    // 월(1)·수(3) → 목요일 다음은 다음 주 월요일
    expect(nextAiResearchRunAt(weekly([3, 1], '10:30'), seoul('2026-10-22T09:00:00'))).toEqual(seoul('2026-10-26T10:30:00'));
    // 목(4) 오늘 시각이 아직
    expect(nextAiResearchRunAt(weekly([4], '10:30'), seoul('2026-10-22T09:00:00'))).toEqual(seoul('2026-10-22T10:30:00'));
    // 목(4) 오늘 시각이 지났으면 7일 뒤
    expect(nextAiResearchRunAt(weekly([4], '10:30'), seoul('2026-10-22T11:00:00'))).toEqual(seoul('2026-10-29T10:30:00'));
    // 일(7)
    expect(nextAiResearchRunAt(weekly([7], '06:00'), seoul('2026-10-22T11:00:00'))).toEqual(seoul('2026-10-25T06:00:00'));
    // 평일 매일: 금요일 다음은 월요일
    expect(nextAiResearchRunAt(weekly([1, 2, 3, 4, 5], '09:00'), seoul('2026-10-23T09:30:00'))).toEqual(seoul('2026-10-26T09:00:00'));
  });

  it('요일이 없는 매주·형식이 틀린 시각은 null', () => {
    expect(nextAiResearchRunAt(weekly([], '09:00'), seoul('2026-10-22T09:00:00'))).toBeNull();
    expect(nextAiResearchRunAt(weekly([0, 8], '09:00'), seoul('2026-10-22T09:00:00'))).toBeNull();
    for (const time of ['24:00', '9:00', '09:60', '0900', '']) expect(nextAiResearchRunAt(daily(time), seoul('2026-10-22T09:00:00'))).toBeNull();
  });

  it('요일 정리와 사람이 읽는 글', () => {
    expect(normalizeWeekdays([5, 1, 3, 1, 9, 0, 2.5])).toEqual([1, 3, 5]);
    expect(aiResearchScheduleText(daily('09:00'))).toBe('매일 09:00');
    expect(aiResearchScheduleText(weekly([5, 1, 3], '18:30'))).toBe('매주 월·수·금 18:30');
    expect(aiResearchScheduleText(weekly([1, 2, 3, 4, 5], '09:00'))).toBe('매주 평일 09:00');
    expect(aiResearchScheduleText(weekly([7, 6], '09:00'))).toBe('매주 주말 09:00');
  });
});
