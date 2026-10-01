import { describe, expect, it } from 'vitest';
import { cumulativeYieldRate, planHeats, maxSlabQtyFromHeat } from '@/lib/heatPlanning';

describe('히트 편성 (업무 프로세스 4.4)', () => {
  it('14.1: 부족 4매 × 23.550t ÷ 연주 0.98 → 필요 용강 96.122t, 히트 1개(250t), 슬래브 10매·예상 여재 6매', () => {
    expect(planHeats({ productType: 'SLAB', shortageQty: 4, theoreticalWeightTon: '23.550', castingYieldRate: '0.9800', hotRollingYieldRate: null, heatCapacityTon: '250.000', slabTheoreticalWeightTon: '23.550' })).toEqual({
      shortageQty: 4,
      targetWeightTon: '94.200',
      cumulativeYieldRate: '0.9800',
      requiredSteelTon: '96.122',
      heatCount: 1,
      heatCapacityTon: '250.000',
      heatTon: '250.000',
      slabQtyPerHeat: 10,
      plannedSlabQty: 10,
      neededSlabQty: 4,
      expectedSurplusSlabQty: 6,
      expectedSlabShortageQty: 0,
    });
  });
  it('슬래브 수주는 연주 수율만, 코일은 연주 × 열연(매핑 계산값)', () => {
    expect(cumulativeYieldRate('SLAB', '0.9800', '0.9792')).toBe('0.9800');
    expect(cumulativeYieldRate('COIL', '0.9800', '0.9792')).toBe('0.9596');
    expect(() => cumulativeYieldRate('COIL', '0.9800', null)).toThrow();
    const coil = planHeats({ productType: 'COIL', shortageQty: 3, theoreticalWeightTon: '28.825', castingYieldRate: '0.9800', hotRollingYieldRate: '0.9792', heatCapacityTon: '250', slabTheoreticalWeightTon: '29.438' });
    expect(coil).toMatchObject({ targetWeightTon: '86.475', requiredSteelTon: '90.116', heatCount: 1, slabQtyPerHeat: 8, expectedSurplusSlabQty: 5 });
  });
  it('히트 수는 올림, 경계에서 정확히', () => {
    expect(planHeats({ productType: 'SLAB', shortageQty: 12, theoreticalWeightTon: '29.438', castingYieldRate: '0.98', hotRollingYieldRate: null, heatCapacityTon: '250', slabTheoreticalWeightTon: '29.438' })).toMatchObject({ requiredSteelTon: '360.465', heatCount: 2, heatTon: '500.000', plannedSlabQty: 16 });
    expect(maxSlabQtyFromHeat('250.000', '0.98', '22.969')).toBe(10);
    expect(() => planHeats({ productType: 'SLAB', shortageQty: 0, theoreticalWeightTon: '1', castingYieldRate: '1', hotRollingYieldRate: null, heatCapacityTon: '1', slabTheoreticalWeightTon: '1' })).toThrow();
  });
});
