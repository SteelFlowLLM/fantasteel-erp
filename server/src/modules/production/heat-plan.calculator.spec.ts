import { calcHeatPlan, hotRollingYieldRateOf } from './heat-plan.calculator';

describe('히트 편성 계산 (업무 프로세스 4.4)', () => {
  it('14.1-2 예시: 슬래브 부족 4매 × 23.550t → 히트 1개, 250t, 필요 용선 277.778t', () => {
    const plan = calcHeatPlan({
      shortageQty: 4,
      theoreticalWeightTon: '23.550',
      castingYieldRate: '0.98',
      hotRollingYieldRate: null,
      steelmakingYieldRate: '0.90',
      heatCapacityTon: '250',
    });
    expect(plan).toEqual({ targetTon: '94.200', requiredMoltenSteelTon: '96.122', heatCount: 1, heatTon: '250.000', requiredHotMetalTon: '277.778' });
  });

  it('히트 용량을 넘으면 올림해서 히트를 늘린다', () => {
    const plan = calcHeatPlan({ shortageQty: 11, theoreticalWeightTon: '23.550', castingYieldRate: '0.98', hotRollingYieldRate: null, steelmakingYieldRate: '0.90', heatCapacityTon: '250' });
    // 259.050 ÷ 0.98 = 264.337 → 2히트
    expect(plan.heatCount).toBe(2);
    expect(plan.heatTon).toBe('500.000');
  });

  it('코일은 연주 × 열연 수율로 나눈다', () => {
    const rolling = hotRollingYieldRateOf('23.079', '23.550');
    const plan = calcHeatPlan({ shortageQty: 10, theoreticalWeightTon: '23.079', castingYieldRate: '0.98', hotRollingYieldRate: rolling, steelmakingYieldRate: '0.90', heatCapacityTon: '250' });
    // 230.790 ÷ (0.98 × 0.98) = 240.306 → 1히트
    expect(plan.requiredMoltenSteelTon).toBe('240.306');
    expect(plan.heatCount).toBe(1);
  });
});
