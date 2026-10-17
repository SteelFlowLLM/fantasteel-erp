import { describe, expect, it } from 'vitest';
import { budgetOfScope, chartXLabels, niceScale, pointTitle, researchChipLabel, researchIdField, scaleLinear } from '@/lib/aiResearchChart';

describe('budgetOfScope', () => {
  it('기본은 예산을 보내지 않는다', () => expect(budgetOfScope('default')).toBeUndefined());
  it('넓게·최대', () => {
    expect(budgetOfScope('wide')).toEqual({ maxSteps: 16, maxSources: 60 });
    expect(budgetOfScope('max')).toEqual({ maxSteps: 30, maxSources: 100 });
  });
});

describe('niceScale', () => {
  it('눈금이 1·2·5 간격이고 값을 덮는다', () => {
    const s = niceScale([12, 87], false);
    expect(s.min).toBeLessThanOrEqual(12);
    expect(s.max).toBeGreaterThanOrEqual(87);
    expect(s.ticks[0]).toBe(s.min);
    expect(s.ticks.at(-1)).toBe(s.max);
  });
  it('막대는 0을 포함한다', () => expect(niceScale([50, 90], true).min).toBe(0));
  it('값이 하나뿐이어도 범위가 생긴다', () => {
    const s = niceScale([5], false);
    expect(s.max).toBeGreaterThan(s.min);
  });
  it('값이 없으면 기본 범위', () => expect(niceScale([], true).ticks).toEqual([0, 1]));
  it('소수 눈금 오차가 없다', () => expect(niceScale([0.1, 0.7], true).ticks).toContain(0.2));
});

describe('scaleLinear', () => {
  it('위가 큰 값', () => expect(scaleLinear(5, 0, 10, 100, 0)).toBe(50));
  it('범위가 0이면 가운데', () => expect(scaleLinear(3, 3, 3, 0, 10)).toBe(5));
});

describe('chart labels and titles', () => {
  const chart = {
    title: 't', type: 'line' as const, unit: '원', xLabel: '연도',
    series: [{ name: 'A', points: [{ x: '2024', y: 1, sourceId: 1 }, { x: '2025', y: 2, sourceId: 1 }] }, { name: 'B', points: [{ x: '2025', y: 3, sourceId: 2 }, { x: '2026', y: 4, sourceId: 2 }] }],
  };
  it('x 라벨은 처음 나온 순서로 합친다', () => expect(chartXLabels(chart)).toEqual(['2024', '2025', '2026']));
  it('툴팁에 값·단위·출처가 들어간다', () => {
    const text = pointTitle('A', { x: '2024', y: 1234.5, sourceId: 1 }, '원', [{ id: 1, title: '철강 보고', url: 'https://a.test/x' }]);
    expect(text).toContain('1,234.5 원');
    expect(text).toContain('출처 [1] 철강 보고');
  });
  it('모르는 출처 번호도 번호는 보인다', () => expect(pointTitle('A', { x: 'x', y: 1, sourceId: 9 }, '', [])).toContain('출처 [9]'));
});

describe('research chip', () => {
  it('긴 제목은 줄인다', () => expect(researchChipLabel({ id: 1, title: 'ㄱ'.repeat(40) })).toBe(`보고서: ${'ㄱ'.repeat(24)}…`));
  it('칩이 있을 때만 researchRunId를 보낸다', () => {
    expect(researchIdField({ id: 7, title: 't' })).toEqual({ researchRunId: 7 });
    expect(researchIdField(null)).toEqual({});
  });
});
