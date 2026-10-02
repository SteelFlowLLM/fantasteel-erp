import { describe, expect, it } from 'vitest';
import {
  allocationLabelOf,
  dispositionLabelOf,
  isEmptyProductRow,
  lotStatusTone,
  matchesLotNo,
  productTotalsOf,
  qualityDisplayOf,
} from '@/features/inventory/lib/inventoryDisplay';

describe('품질 결과 표시 (공통 코드 INSPECTION_RESULT 표시명)', () => {
  it('합격, 판정 대기, 불합격, 히트 불합격 = 불합격(히트)', () => {
    expect(qualityDisplayOf('PASS')).toMatchObject({ label: '합격', tone: 'ok' });
    expect(qualityDisplayOf('PENDING')).toMatchObject({ label: '판정 대기', tone: 'wait' });
    expect(qualityDisplayOf('FAIL')).toMatchObject({ label: '불합격', tone: 'danger' });
    expect(qualityDisplayOf('HEAT_FAILED')).toMatchObject({ label: '불합격(히트)', tone: 'danger' });
  });

  it('원료·용선(null)은 표시하지 않는다', () => {
    expect(qualityDisplayOf(null)).toBeNull();
  });

  it("'검사 대기'·'귀속' 같은 옛 문구를 쓰지 않는다", () => {
    const labels = (['PENDING', 'HEAT_FAILED', 'PASS', 'FAIL'] as const).map((q) => qualityDisplayOf(q)?.label ?? '');
    expect(labels.join(' ')).not.toMatch(/검사 대기|귀속/);
  });
});

describe('배정·처리 상태·LOT 상태', () => {
  it('배정 여부는 ALLOCATION_PURPOSE 표시명 + 배정 (+ ALLOCATION_STATUS 표시명), 없으면 미배정', () => {
    expect(allocationLabelOf('SHIPMENT')).toBe('출하 배정');
    expect(allocationLabelOf('HOT_ROLLING')).toBe('열연 투입 배정');
    expect(allocationLabelOf('SHIPMENT', 'CONSUMED')).toBe('출하 배정 · 소진');
    expect(allocationLabelOf('HOT_ROLLING', 'CONSUMED')).toBe('열연 투입 배정 · 소진');
    expect(allocationLabelOf('SHIPMENT', 'CONFIRMED')).toBe('출하 배정 · 배정 확정');
    expect(allocationLabelOf(null)).toBe('미배정');
  });

  it('처리 상태는 DISPOSITION_STATUS 표시명, 없으면 null', () => {
    expect(dispositionLabelOf('HOLD')).toBe('보류');
    expect(dispositionLabelOf('DOWNGRADED')).toBe('격하');
    expect(dispositionLabelOf('SCRAPPED')).toBe('폐기');
    expect(dispositionLabelOf(null)).toBeNull();
  });

  it('재고 LOT만 강조 색', () => {
    expect(lotStatusTone('AVAILABLE')).toBe('run');
    expect(lotStatusTone('CONSUMED')).toBe('neutral');
    expect(lotStatusTone('SHIPPED')).toBe('neutral');
  });
});

describe('제품 합계·빈 줄·LOT 번호 검색', () => {
  const rows = [
    { itemType: 'SLAB' as const, onHandQty: 10, passedQty: 8, reservedQty: 3, hotRollingAllocatedQty: 2, availableQty: 3 },
    { itemType: 'SLAB' as const, onHandQty: 6, passedQty: 6, reservedQty: 0, hotRollingAllocatedQty: 0, availableQty: 6 },
    { itemType: 'COIL' as const, onHandQty: 3, passedQty: 3, reservedQty: 3, hotRollingAllocatedQty: 0, availableQty: 0 },
  ];

  it('유형별 합계', () => {
    expect(productTotalsOf(rows, 'SLAB')).toEqual({ specCount: 2, onHandQty: 16, passedQty: 14, reservedQty: 3, hotRollingAllocatedQty: 2, availableQty: 9 });
    expect(productTotalsOf(rows, 'COIL')).toEqual({ specCount: 1, onHandQty: 3, passedQty: 3, reservedQty: 3, hotRollingAllocatedQty: 0, availableQty: 0 });
    expect(productTotalsOf([], 'COIL').specCount).toBe(0);
  });

  it('재고·예약·열연 배정이 모두 0이면 빈 줄', () => {
    expect(isEmptyProductRow({ onHandQty: 0, reservedQty: 0, hotRollingAllocatedQty: 0 })).toBe(true);
    expect(isEmptyProductRow({ onHandQty: 0, reservedQty: 1, hotRollingAllocatedQty: 0 })).toBe(false);
  });

  it('LOT 번호 부분 일치 (공백 무시, 대소문자 무시)', () => {
    expect(matchesLotNo('HT-BOF1-260905-001-05', '')).toBe(true);
    expect(matchesLotNo('HT-BOF1-260905-001-05', '260905')).toBe(true);
    expect(matchesLotNo('HT-BOF1-260905-001-05', ' ht-bof1 ')).toBe(true);
    expect(matchesLotNo('RM-ORE01-260902-001', 'COL01')).toBe(false);
  });
});
