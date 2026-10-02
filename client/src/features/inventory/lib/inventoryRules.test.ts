import { describe, expect, it } from 'vitest';
import { currentAllocationOf, heatInspectionResult, productInspectionResult } from '@/features/inventory/lib/inventoryRules';

// 여재 슬래브 고르기(pickSurplusLots) 시험은 함수와 함께 `lib/surplus.test.ts`로 옮겼다.

describe('배정 여부 (REQ-INV-006 ALLOCATION_STATUS)', () => {
  it('해제되지 않은 마지막 배정 — 배정 확정 또는 소진', () => {
    expect(
      currentAllocationOf([
        { id: 1, allocationPurpose: 'SHIPMENT', allocationStatus: 'RELEASED' },
        { id: 2, allocationPurpose: 'SHIPMENT', allocationStatus: 'CONSUMED' },
      ]),
    ).toMatchObject({ id: 2, allocationStatus: 'CONSUMED' });
    expect(
      currentAllocationOf([
        { id: 7, allocationPurpose: 'HOT_ROLLING', allocationStatus: 'CONFIRMED' },
        { id: 3, allocationPurpose: 'SHIPMENT', allocationStatus: 'RELEASED' },
      ]),
    ).toMatchObject({ id: 7, allocationPurpose: 'HOT_ROLLING' });
  });

  it('배정이 없거나 모두 해제면 null', () => {
    expect(currentAllocationOf([])).toBeNull();
    expect(currentAllocationOf([{ id: 1, allocationPurpose: 'SHIPMENT', allocationStatus: 'RELEASED' }])).toBeNull();
  });
});

describe('검사 결과 (적격 여부와 따로)', () => {
  it('제품: 자기 검사 + 상위 히트 성분 판정, LOT 상태는 보지 않는다', () => {
    expect(productInspectionResult({ isPassed: true }, { isPassed: true })).toBe('PASS');
    expect(productInspectionResult({ isPassed: null }, { isPassed: true })).toBe('PENDING');
    expect(productInspectionResult({ isPassed: true }, { isPassed: null })).toBe('PENDING');
    expect(productInspectionResult({ isPassed: true }, null)).toBe('PENDING');
    expect(productInspectionResult({ isPassed: false }, { isPassed: false })).toBe('FAIL');
    expect(productInspectionResult({ isPassed: true }, { isPassed: false })).toBe('HEAT_FAILED');
    expect(productInspectionResult({ isPassed: null }, { isPassed: false })).toBe('HEAT_FAILED');
  });

  it('히트: 성분 판정', () => {
    expect(heatInspectionResult(true)).toBe('PASS');
    expect(heatInspectionResult(false)).toBe('FAIL');
    expect(heatInspectionResult(null)).toBe('PENDING');
  });
});
