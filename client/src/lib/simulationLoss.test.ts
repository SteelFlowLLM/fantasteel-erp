import { describe, expect, it } from 'vitest';
import { actualLossRateOf } from '@/lib/simulationLoss';

describe('실적 시뮬레이션 손실 표시 (BP-SEED-01)', () => {
  it('실제 감소율 = 손실 ÷ 계획, 계획이 0이면 0', () => {
    expect(actualLossRateOf(41, 2)).toBeLessThanOrEqual(0.05);
    expect(actualLossRateOf(100, 5)).toBe(0.05);
    expect(actualLossRateOf(0, 0)).toBe(0);
  });
});
