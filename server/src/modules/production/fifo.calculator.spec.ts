import { consumptionTon, planFifoDeduction } from './fifo.calculator';

describe('원료·용선 FIFO 차감 (REQ-LOT-002·004)', () => {
  const lots = [
    { id: 1, lotNo: 'RM-ORE01-261001-001', remainingTon: '300.000' },
    { id: 2, lotNo: 'RM-ORE01-261002-001', remainingTon: '300.000' },
  ];

  it('오래된 LOT부터 차감하고 잔량이 0이 되면 다음 LOT으로 넘어간다', () => {
    const r = planFifoDeduction(lots, '444.445');
    expect(r.shortageTon.toFixed(3)).toBe('0.000');
    expect(r.takes.map((t) => [t.lotId, t.ton.toFixed(3), t.remainingTon.toFixed(3)])).toEqual([
      [1, '300.000', '0.000'],
      [2, '144.445', '155.555'],
    ]);
  });

  it('모자라면 부족 톤을 돌려주고 잔량은 음수가 되지 않는다', () => {
    const r = planFifoDeduction(lots, '700');
    expect(r.shortageTon.toFixed(3)).toBe('100.000');
    expect(r.takes.every((t) => t.remainingTon.gte(0))).toBe(true);
  });

  it('잔량 0인 LOT은 건너뛴다', () => {
    const r = planFifoDeduction([{ id: 9, lotNo: 'X', remainingTon: '0' }, ...lots], '10');
    expect(r.takes.map((t) => t.lotId)).toEqual([1]);
  });
});

describe('원단위 투입량 (4.4)', () => {
  it('용선 277.778t × 철광석 1.6 t/t = 444.445t', () => {
    expect(consumptionTon('277.778', '1.6', false).toFixed(3)).toBe('444.445');
  });

  it('합금철: 히트 250t × 20 kg/t ÷ 1,000 = 5.000t (14.3 합금철 소요 계산)', () => {
    expect(consumptionTon('250', '20', true).toFixed(3)).toBe('5.000');
  });
});
