import { describe, expect, it } from 'vitest';
import { pickFifo, planFifoDeduction, sortFifo } from '@/lib/fifo';

describe('FIFO', () => {
  it('생산완료일 → LOT 번호 순', () => {
    const lots = [
      { id: 3, lotNo: 'HT-BOF1-261003-001-02', producedDate: '2026-10-03' },
      { id: 1, lotNo: 'HT-BOF1-260905-001-10', producedDate: '2026-09-05' },
      { id: 2, lotNo: 'HT-BOF1-260905-001-09', producedDate: '2026-09-05' },
    ];
    expect(sortFifo(lots).map((l) => l.id)).toEqual([2, 1, 3]);
    expect(pickFifo(lots, 2).map((l) => l.lotNo)).toEqual(['HT-BOF1-260905-001-09', 'HT-BOF1-260905-001-10']);
  });
  it('원료 차감: 입고일 순으로 실제 빼는 LOT만, 모자라면 shortage', () => {
    const lots = [
      { id: 1, lotNo: 'RM-SMN01-261002-001', producedDate: '2026-10-02', remainingTon: '1.000' },
      { id: 2, lotNo: 'RM-SMN01-260916-001', producedDate: '2026-09-16', remainingTon: '1.000' },
      { id: 3, lotNo: 'RM-SMN01-261003-001', producedDate: '2026-10-03', remainingTon: '0.500' },
      { id: 4, lotNo: 'RM-SMN01-261004-001', producedDate: '2026-10-04', remainingTon: '9.000' },
    ];
    const plan = planFifoDeduction(lots, '2.500');
    expect(plan.deductions.map((d) => [d.lot.id, d.ton, d.remainingAfterTon])).toEqual([
      [2, '1.000', '0.000'],
      [1, '1.000', '0.000'],
      [3, '0.500', '0.000'],
    ]);
    expect(plan.shortageTon).toBe('0.000');
    expect(planFifoDeduction(lots.slice(0, 2), '2.500').shortageTon).toBe('0.500');
  });
});
