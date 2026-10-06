import { castingLoss, drawSampleLossRate, layoutSteps, seededRandom } from './simulation.calculator';

describe('실적 시뮬레이션 계산 (REQ-PRD-007, 8장)', () => {
  it('같은 시드면 같은 수열, 다른 시드면 다른 수열', () => {
    const a = seededRandom(42);
    const b = seededRandom(42);
    const c = seededRandom(43);
    const seqA = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(seqA);
    expect([c(), c(), c()]).not.toEqual(seqA);
  });

  it('샘플 손실률은 0~5% 안이다', () => {
    const random = seededRandom(7);
    for (let i = 0; i < 1000; i++) {
      const rate = Number(drawSampleLossRate(random));
      expect(rate).toBeGreaterThanOrEqual(0);
      expect(rate).toBeLessThanOrEqual(0.05);
    }
  });

  it('손실 매수 = floor(계획 × 손실률): 10매 × 4.9% = 0매, 30매 × 4.1% = 1매', () => {
    expect(castingLoss(10, '0.0490')).toEqual({ lossQty: 0, outputQty: 10, actualLossRate: '0.0000' });
    expect(castingLoss(30, '0.0410')).toEqual({ lossQty: 1, outputQty: 29, actualLossRate: '0.0333' });
  });

  it('작업 시간은 지금에서 끝나고, 0시를 넘으면 오늘 안으로 줄인다', () => {
    const now = new Date('2026-10-06T10:00:00Z');
    const todayStart = new Date('2026-10-05T15:00:00Z'); // 서울 10-06 0시
    const wide = layoutSteps([4, 1, 2], now, todayStart);
    expect(wide.at(-1)?.completedAt).toEqual(now);
    expect(wide[0].startedAt).toEqual(new Date('2026-10-06T03:00:00Z'));
    expect(wide[1].startedAt).toEqual(wide[0].completedAt);

    const early = new Date('2026-10-05T16:00:00Z'); // 서울 01:00
    const squeezed = layoutSteps([4, 1, 2], early, todayStart);
    expect(squeezed[0].startedAt.getTime()).toBeGreaterThanOrEqual(todayStart.getTime());
    expect(squeezed.at(-1)?.completedAt).toEqual(early);
  });
});
