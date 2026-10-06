import { describe, expect, it } from 'vitest';
import { ageDays, bucketByDate, countRatio, dueLabel, isOverRejectRateAlert, isWithin, ratioText, REJECT_RATE_ALERT, trendWindow, weightedPlannedYield } from '@/features/dashboard/lib/widgetMath';

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

describe('강종별 불합격률 주의 기준 (5%)', () => {
  it('기준을 넘을 때만 기준 초과 — 같으면 넘지 않음, 판정 없음(null)은 아님', () => {
    expect(REJECT_RATE_ALERT).toBe(0.05);
    expect(isOverRejectRateAlert(1 / 18)).toBe(true); // 5.6%
    expect(isOverRejectRateAlert(0.05)).toBe(false);
    expect(isOverRejectRateAlert(1 / 32)).toBe(false); // 3.1%
    expect(isOverRejectRateAlert(null)).toBe(false);
  });
});
