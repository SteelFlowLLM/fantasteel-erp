import { describe, expect, it } from 'vitest';
import { currentAllocationOf, heatInspectionResult, pickSurplusLots, productInspectionResult } from '@/features/inventory/lib/inventoryRules';

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
