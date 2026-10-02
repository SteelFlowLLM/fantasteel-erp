import { describe, expect, it } from 'vitest';
import { actualLossRateOf, createSeededRandom, drawSampleLossRate, lossQtyOf } from '@/lib/simulationLoss';

describe('실적 시뮬레이션 손실 (BP-SEED-01)', () => {
  it('같은 시드 → 같은 난수열, 손실률은 0.0000~0.0500', () => {
    const a = createSeededRandom(42);
    const b = createSeededRandom(42);
    const rates = Array.from({ length: 200 }, () => drawSampleLossRate(a));
    expect(rates).toEqual(Array.from({ length: 200 }, () => drawSampleLossRate(b)));
    expect(rates.every((r) => Number(r) >= 0 && Number(r) <= 0.05 && /^\d\.\d{4}$/.test(r))).toBe(true);
    expect(new Set(rates).size).toBeGreaterThan(20);
  });
  it('손실 매수 = floor(계획 × 손실률) → 감소율 5% 이하, 소량이면 0', () => {
    expect(lossQtyOf(10, '0.0499')).toBe(0);
    expect(lossQtyOf(100, '0.0500')).toBe(5);
    expect(lossQtyOf(41, '0.0499')).toBe(2);
    expect(actualLossRateOf(41, 2)).toBeLessThanOrEqual(0.05);
  });
});
