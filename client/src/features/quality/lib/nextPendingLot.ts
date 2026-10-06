// 검사 저장 뒤 "다음 판정 대기 LOT" 고르기. 한 히트의 슬래브를 연달아 검사하는 흐름을 끊지 않게 같은 히트를 먼저 고른다.
import type { InspectionQueueRow } from '@/mock/services';

type QueueLot = Pick<InspectionQueueRow, 'lotId' | 'lotType' | 'heatLotId'>;

/**
 * 판정 대기 목록(먼저 생긴 LOT부터)에서 다음 LOT:
 * 1) 같은 히트의 같은 유형(슬래브 다음 슬래브) 2) 같은 히트의 LOT(히트 다음 그 슬래브·코일) 3) 가장 먼저 생긴 대기 LOT.
 * 지금 LOT은 고르지 않는다.
 */
export function pickNextPendingLot<T extends QueueLot>(pending: readonly T[], active: QueueLot | null): T | null {
  const others = pending.filter((r) => r.lotId !== active?.lotId);
  const heatId = active === null ? null : active.lotType === 'HEAT' ? active.lotId : active.heatLotId;
  if (heatId !== null) {
    const sameHeat = others.filter((r) => r.heatLotId === heatId);
    const sameType = sameHeat.find((r) => r.lotType === active?.lotType);
    if (sameType) return sameType;
    if (sameHeat[0]) return sameHeat[0];
  }
  return others[0] ?? null;
}
