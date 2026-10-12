import { describe, expect, it } from 'vitest';
import { ageDays, bucketByDate, countRatio, dueLabel, groupRepeatedEvents, isWithin, ratioText, trendWindow, weightedPlannedYield } from '@/features/dashboard/lib/widgetMath';

describe('대시보드 집계 계산', () => {
  it('비율: 소수 4자리, 분모 0이면 null', () => {
    expect(ratioText('235.500', '250.000')).toBe('0.9420');
    expect(ratioText('1', '3')).toBe('0.3333');
    expect(ratioText('5', '0')).toBeNull();
    expect(countRatio(1, 4)).toBe(0.25);
    expect(countRatio(0, 0)).toBeNull();
  });

  it('최근 N일: 오늘 포함, 달이 바뀌어도 이어진다', () => {
    const window = trendWindow('2026-10-01', 30);
    expect(window.from).toBe('2026-09-02');
    expect(window.dates).toHaveLength(30);
    expect(window.dates.at(-1)).toBe('2026-10-01');
    expect(isWithin('2026-09-02', window)).toBe(true);
    expect(isWithin('2026-09-01', window)).toBe(false);
    expect(trendWindow('2026-10-01', 0).dates).toEqual(['2026-10-01']);
  });

  it('날짜별 묶음: 빈 날도 두고 기간 밖은 버린다', () => {
    const window = trendWindow('2026-10-03', 3);
    const buckets = bucketByDate(['2026-10-01', '2026-10-03', '2026-10-03', '2026-09-01'], (d) => d, window);
    expect([...buckets].map(([date, rows]) => [date, rows.length])).toEqual([
      ['2026-10-01', 1],
      ['2026-10-02', 0],
      ['2026-10-03', 2],
    ]);
  });

  it('보유 일수·납기 라벨', () => {
    expect(ageDays('2026-09-06', '2026-10-01')).toBe(25);
    expect(ageDays('2026-10-05', '2026-10-01')).toBe(0);
    expect(dueLabel(3)).toBe('D-3');
    expect(dueLabel(0)).toBe('D-day');
    expect(dueLabel(-2)).toBe('D+2');
  });

  it('투입량 가중 계획 수율', () => {
    expect(weightedPlannedYield([{ inputTon: '250.000', plannedYieldRate: '0.9800' }])).toBe('0.9800');
    expect(
      weightedPlannedYield([
        { inputTon: '100.000', plannedYieldRate: '0.9800' },
        { inputTon: '300.000', plannedYieldRate: '0.9400' },
      ]),
    ).toBe('0.9500');
    expect(weightedPlannedYield([{ inputTon: '100.000', plannedYieldRate: null }])).toBeNull();
    expect(weightedPlannedYield([])).toBeNull();
  });
});

describe('최근 작업 로그 묶음', () => {
  const row = (id: number, actorName: string, businessEventTypeLabel: string, isAiAssisted = false) => ({ id, actorType: 'USER' as const, actorName, businessEventTypeLabel, isAiAssisted });

  it('바로 이어진 같은 주체·같은 작업만 묶고, 순서는 그대로 둔다', () => {
    const groups = groupRepeatedEvents([
      row(9, '신현우', '밀시트 발행'),
      row(8, '신현우', '예약 전환'),
      row(7, '신현우', '예약 전환'),
      row(6, '신현우', '예약 전환'),
      row(5, '박서영', '예약 전환'),
      row(4, '신현우', '예약 전환'),
    ]);
    expect(groups.map((g) => g.map((r) => r.id))).toEqual([[9], [8, 7, 6], [5], [4]]);
  });

  it('AI 경유 여부가 다르면 따로 둔다', () => {
    expect(groupRepeatedEvents([row(2, '신현우', '출고 확정', true), row(1, '신현우', '출고 확정')])).toHaveLength(2);
    expect(groupRepeatedEvents([])).toEqual([]);
  });
});
