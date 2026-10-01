import { describe, expect, it } from 'vitest';
import {
  defaultMrpPeriod,
  earliestDate,
  groupBySupplier,
  isOverdue,
  mrpRequestReason,
  ratioPercent,
  rawMaterialLotNoPattern,
  summarizeItemNames,
  trimTonText,
} from '@/features/purchasing/lib/purchasingView';

describe('구매 화면 표시값', () => {
  it('MRP 기본 기간 = 이번 달 1일 ~ 다음 달 마지막 날 (해 넘김·윤년 포함)', () => {
    expect(defaultMrpPeriod('2026-10-01')).toEqual({ from: '2026-10-01', to: '2026-11-30' });
    expect(defaultMrpPeriod('2026-12-15')).toEqual({ from: '2026-12-01', to: '2027-01-31' });
    expect(defaultMrpPeriod('2028-01-20')).toEqual({ from: '2028-01-01', to: '2028-02-29' });
  });

  it('원료 요약과 톤 입력 초기값', () => {
    expect(summarizeItemNames([])).toBe('-');
    expect(summarizeItemNames([{ itemName: '철광석' }])).toBe('철광석');
    expect(summarizeItemNames([{ itemName: '철광석' }, { itemName: '석탄' }, { itemName: '석회석' }])).toBe('철광석 외 2종');
    expect(trimTonText('150.000')).toBe('150');
    expect(trimTonText('1.500')).toBe('1.5');
    expect(trimTonText('0.000')).toBe('0');
    expect(trimTonText('12')).toBe('12');
  });

  it('진행률은 십진 나눗셈으로, 분모 0이면 0', () => {
    expect(ratioPercent('4.500', '8.000')).toBeCloseTo(56.25);
    expect(ratioPercent('8.000', '8.000')).toBe(100);
    expect(ratioPercent('1.000', '0.000')).toBe(0);
  });

  it('기본 공급업체별 묶음: 이름순, 공급업체 없음은 맨 뒤', () => {
    const groups = groupBySupplier([
      { id: 1, supplierId: 2, supplierName: '하람합금철' },
      { id: 2, supplierId: null, supplierName: null },
      { id: 3, supplierId: 1, supplierName: '가온광업' },
      { id: 4, supplierId: 2, supplierName: '하람합금철' },
    ]);
    expect(groups.map((g) => [g.supplierName, g.items.map((i) => i.id)])).toEqual([
      ['가온광업', [3]],
      ['하람합금철', [1, 4]],
      [null, [2]],
    ]);
  });

  it('가장 이른 날짜·납기 지남·LOT 번호 형식·MRP 요청 근거', () => {
    expect(earliestDate([null, '2026-10-20', '', '2026-10-10'])).toBe('2026-10-10');
    expect(earliestDate([null])).toBeNull();
    expect(isOverdue('2026-09-30', '2026-10-01', '3.500')).toBe(true);
    expect(isOverdue('2026-09-30', '2026-10-01', '0.000')).toBe(false);
    expect(isOverdue('2026-10-01', '2026-10-01', '3.500')).toBe(false);
    expect(rawMaterialLotNoPattern('SMN01')).toBe('RM-SMN01-YYMMDD-NNN');
    expect(mrpRequestReason({ productionPlanNo: 'PP-2610-0001', itemName: '실리코망가니즈', netTon: '1.500', needDate: '2026-10-20' }, { from: '2026-10-01', to: '2026-11-30' })).toBe(
      'MRP 2026-10-01 ~ 2026-11-30 · PP-2610-0001 실리코망가니즈 순소요 1.500 t · 필요일 2026-10-20',
    );
  });
});
