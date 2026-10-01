import { describe, expect, it } from 'vitest';
import { addDays, daysBetween, headerStatusOf, isDueRisk, itemStatusOf } from '@/lib/salesOrderStatus';

describe('수주 상태 (REQ-SO-005)', () => {
  it('품목: OPEN → PARTIALLY_SHIPPED → SHIPPED, 취소', () => {
    expect(itemStatusOf({ orderedQty: 10, shippedQty: 0, cancelled: false })).toBe('OPEN');
    expect(itemStatusOf({ orderedQty: 10, shippedQty: 4, cancelled: false })).toBe('PARTIALLY_SHIPPED');
    expect(itemStatusOf({ orderedQty: 10, shippedQty: 10, cancelled: false })).toBe('SHIPPED');
    expect(itemStatusOf({ orderedQty: 10, shippedQty: 0, cancelled: true })).toBe('CANCELLED');
  });
  it('헤더는 품목에서 계산', () => {
    expect(headerStatusOf(['OPEN', 'OPEN'])).toBe('OPEN');
    expect(headerStatusOf(['SHIPPED', 'OPEN'])).toBe('PARTIALLY_SHIPPED');
    expect(headerStatusOf(['SHIPPED', 'SHIPPED'])).toBe('SHIPPED');
    expect(headerStatusOf(['SHIPPED', 'CANCELLED'])).toBe('SHIPPED');
    expect(headerStatusOf(['CANCELLED', 'CANCELLED'])).toBe('CANCELLED');
  });
  it('납기 위험: 미출하가 있고 남은 날 ≤ 기준일(지난 납기 포함)', () => {
    expect(daysBetween('2026-10-01', '2026-10-04')).toBe(3);
    expect(isDueRisk({ dueDate: '2026-10-04', today: '2026-10-01', deliveryRiskDays: 3, unshippedQty: 1, status: 'OPEN' })).toBe(true);
    expect(isDueRisk({ dueDate: '2026-10-05', today: '2026-10-01', deliveryRiskDays: 3, unshippedQty: 1, status: 'OPEN' })).toBe(false);
    expect(isDueRisk({ dueDate: '2026-09-01', today: '2026-10-01', deliveryRiskDays: 3, unshippedQty: 0, status: 'SHIPPED' })).toBe(false);
    expect(addDays('2026-09-30', 2)).toBe('2026-10-02');
  });
});
