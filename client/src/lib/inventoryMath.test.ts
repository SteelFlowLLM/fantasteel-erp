import { describe, expect, it } from 'vitest';
import { progressOf, reproductionNeedQty, reservationAvailableQty, shortageOf, stockFirstSplit } from '@/lib/inventoryMath';

describe('예약 가용·재고 우선 예약·부족 (4.2·4.5)', () => {
  it('예약 가용 = 합격 − ACTIVE 예약 − 예약 밖 열연 배정', () => {
    expect(reservationAvailableQty({ eligibleQty: 15, activeReservedQty: 12, uncoveredHotRollingQty: 2 })).toBe(1);
    expect(reservationAvailableQty({ eligibleQty: 7, activeReservedQty: 15, uncoveredHotRollingQty: 0 })).toBe(-8);
  });
  it('재고 우선: 부분 예약 허용, 부족분만 생산', () => {
    expect(stockFirstSplit(10, 6)).toEqual({ reserveQty: 6, shortageQty: 4 });
    expect(stockFirstSplit(3, 8)).toEqual({ reserveQty: 3, shortageQty: 0 });
    expect(stockFirstSplit(5, -2)).toEqual({ reserveQty: 0, shortageQty: 5 });
    expect(() => stockFirstSplit(0, 1)).toThrow();
  });
  it('미출하·현재 미확보·추가 계획 필요 (단계를 더하지 않는다)', () => {
    expect(shortageOf({ orderedQty: 10, shippedQty: 4, activeReservedQty: 6, openPlanRemainingQty: 0 })).toEqual({ unshippedQty: 6, unsecuredQty: 0, additionalPlanQty: 0 });
    expect(shortageOf({ orderedQty: 10, shippedQty: 0, activeReservedQty: 6, openPlanRemainingQty: 4 })).toEqual({ unshippedQty: 10, unsecuredQty: 4, additionalPlanQty: 0 });
    expect(shortageOf({ orderedQty: 12, shippedQty: 0, activeReservedQty: 4, openPlanRemainingQty: 3 })).toEqual({ unshippedQty: 12, unsecuredQty: 8, additionalPlanQty: 5 });
    expect(reproductionNeedQty(5, 2)).toBe(3);
    expect(reproductionNeedQty(5, 9)).toBe(0);
  });
  it('진행률은 분모를 함께', () => {
    expect(progressOf(6, 10)).toEqual({ qty: 6, denominatorQty: 10, ratio: 0.6 });
    expect(progressOf(1, 0).ratio).toBeNull();
  });
});
