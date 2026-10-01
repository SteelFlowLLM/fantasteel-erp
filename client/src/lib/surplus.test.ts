import { describe, expect, it } from 'vitest';
import { pickSurplusLots } from '@/lib/surplus';

const lot = (lotId: number, producedDate: string, surplusAt: string | null) => ({ lotId, lotNo: `HT-BOF1-260905-001-${String(lotId).padStart(2, '0')}`, producedDate, surplusAt });

describe('여재 슬래브 고르기 (TRM-048, 4.3)', () => {
  const candidates = [
    lot(3, '2026-09-06', '2026-09-07T10:00:00+09:00'),
    lot(1, '2026-09-05', '2026-09-07T10:00:00+09:00'),
    lot(2, '2026-09-05', '2026-09-07T10:00:00+09:00'),
    lot(4, '2026-09-08', null), // 원래 수주 예약 몫 또는 열연 대기 — 여재 전환 전
  ];

  it('여재 전환된 미배정 합격 슬래브만, 선입선출 순', () => {
    expect(pickSurplusLots(candidates, 10).map((l) => l.lotId)).toEqual([1, 2, 3]);
  });

  it('가용재고를 넘지 않는다: 예약에 쓰인 몫은 오래된 LOT부터 빠지고 최근 LOT이 여재로 남는다', () => {
    expect(pickSurplusLots(candidates, 2).map((l) => l.lotId)).toEqual([2, 3]);
    expect(pickSurplusLots(candidates, 1).map((l) => l.lotId)).toEqual([3]);
  });

  it('가용재고 0(또는 음수)이거나 여재 전환 LOT이 없으면 여재 없음', () => {
    expect(pickSurplusLots(candidates, 0)).toEqual([]);
    expect(pickSurplusLots(candidates, -3)).toEqual([]);
    expect(pickSurplusLots([lot(5, '2026-09-10', null)], 5)).toEqual([]);
  });
});
