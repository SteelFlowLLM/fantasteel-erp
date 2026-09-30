import { distributeLoss, lossQtyOf, sampleLossRate, seededRandom } from './simulation-random';

describe('실적 시뮬레이션 난수 (REQ-PRD-007)', () => {
  it('같은 시드면 같은 손실률이 나온다', () => {
    for (const seed of [0, 1, 7, 20260930, 2_147_483_647]) {
      expect(sampleLossRate(seededRandom(seed))).toBe(sampleLossRate(seededRandom(seed)));
    }
    const rates = new Set(Array.from({ length: 50 }, (_, s) => sampleLossRate(seededRandom(s))));
    expect(rates.size).toBeGreaterThan(10);
  });

  it('손실률은 0~5% 범위다', () => {
    for (let seed = 0; seed < 2000; seed++) {
      const rate = Number(sampleLossRate(seededRandom(seed)));
      expect(rate).toBeGreaterThanOrEqual(0);
      expect(rate).toBeLessThanOrEqual(0.05);
    }
  });

  it('손실 매수 = floor(계획 매수 × 손실률): 감소율이 5%를 넘지 않고, 소량이면 0매다', () => {
    expect(lossQtyOf(10, '0.0499')).toBe(0);
    expect(lossQtyOf(20, '0.0500')).toBe(1);
    expect(lossQtyOf(30, '0.0333')).toBe(0);
    expect(lossQtyOf(30, '0.0334')).toBe(1);
    expect(lossQtyOf(100, '0.0290')).toBe(2);
    expect(lossQtyOf(100, '0.0500')).toBe(5);
    expect(lossQtyOf(100, '0.0000')).toBe(0);
  });

  it('손실 매수를 뒤 히트부터 1매씩 나눈다', () => {
    expect(distributeLoss([10, 10, 10], 0)).toEqual([0, 0, 0]);
    expect(distributeLoss([10, 10, 10], 1)).toEqual([0, 0, 1]);
    expect(distributeLoss([10, 10, 10], 4)).toEqual([1, 1, 2]);
    expect(distributeLoss([], 0)).toEqual([]);
  });
});
