import { describe, expect, it } from 'vitest';
import { pickNextPendingLot } from '@/features/quality/lib/nextPendingLot';

const heat = (lotId: number) => ({ lotId, lotType: 'HEAT' as const, heatLotId: null });
const slab = (lotId: number, heatLotId: number) => ({ lotId, lotType: 'SLAB' as const, heatLotId });
const coil = (lotId: number, heatLotId: number) => ({ lotId, lotType: 'COIL' as const, heatLotId });

// 먼저 생긴 LOT부터: 다른 히트(1)의 슬래브가 더 오래됐다
const pending = [slab(11, 1), heat(20), coil(25, 20), slab(21, 20), slab(22, 20), slab(23, 20)];

describe('다음 판정 대기 LOT', () => {
  it('슬래브를 저장하면 같은 히트의 다음 슬래브 (더 오래된 다른 히트 슬래브보다 먼저)', () => {
    expect(pickNextPendingLot(pending, slab(21, 20))?.lotId).toBe(22);
  });
  it('같은 히트에 같은 유형이 없으면 같은 히트의 다른 LOT', () => {
    expect(pickNextPendingLot([slab(11, 1), coil(25, 20)], slab(23, 20))?.lotId).toBe(25);
  });
  it('히트를 저장하면 그 히트의 슬래브·코일부터', () => {
    expect(pickNextPendingLot(pending, heat(20))?.lotId).toBe(25);
  });
  it('같은 히트에 남은 대기가 없으면 가장 먼저 생긴 대기 LOT, 지금 LOT은 고르지 않는다', () => {
    expect(pickNextPendingLot([slab(11, 1), slab(23, 20)], slab(23, 20))?.lotId).toBe(11);
    expect(pickNextPendingLot([slab(23, 20)], slab(23, 20))).toBeNull();
    expect(pickNextPendingLot(pending, null)?.lotId).toBe(11);
  });
});
