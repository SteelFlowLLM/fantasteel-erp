import { describe, expect, it } from 'vitest';
import {
  defaultMrpPeriod,
  earliestDate,
  groupBySupplier,
  isOverdue,
  mrpOnHandNotes,
  mrpRequestReason,
  mrpScheduledReceiptNotes,
  plannedPurchaseOrders,
  ratioPercent,
  rawMaterialLotNoPattern,
  receiptRowLabel,
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

  it('입고예정 목록 줄 단추 이름: 발주번호·구매요청·품목·공급업체·상태·입고예정·입고 예정일을 한 줄로 (화면 낭독기용)', () => {
    const line = { purchaseOrderNo: 'PO-2609-0001', purchaseRequisitionNo: 'PR-2609-0001', itemName: '철광석', supplierName: '가온광업', purchaseOrderStatus: 'CONFIRMED', isFullyReceived: false, remainingTon: '500.000', expectedReceiptDate: '2026-10-10' } as const;
    expect(receiptRowLabel(line)).toBe('PO-2609-0001 PR-2609-0001 · 철광석 · 가온광업 · 발주 확정 · 입고예정 500.000 t · 입고 예정 10-10');
    expect(receiptRowLabel({ ...line, purchaseOrderStatus: 'RECEIVED', isFullyReceived: true, expectedReceiptDate: null })).toBe('PO-2609-0001 PR-2609-0001 · 철광석 · 가온광업 · 입고 완료 · 입고 끝');
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

  it('만들어질 발주: 공급업체마다 1건, 납기를 비우면 그 공급업체 묶음의 가장 이른 희망 입고일 (BP-PUR-01)', () => {
    const chosen = [
      { supplierId: 1, supplierName: '가온광업', desiredReceiptDate: '2026-10-25', requestedTon: '100' },
      { supplierId: 2, supplierName: '하람합금철', desiredReceiptDate: '2026-10-20', requestedTon: '2.5' },
      { supplierId: 1, supplierName: '가온광업', desiredReceiptDate: null, requestedTon: '50' },
      { supplierId: null, supplierName: null, desiredReceiptDate: '2026-10-01', requestedTon: '9' },
    ];
    expect(plannedPurchaseOrders(chosen, '')).toEqual([
      { supplierId: 1, supplierName: '가온광업', expectedReceiptDate: '2026-10-25', itemCount: 2, totalTon: '150.000' },
      { supplierId: 2, supplierName: '하람합금철', expectedReceiptDate: '2026-10-20', itemCount: 1, totalTon: '2.500' },
    ]);
    // 입고 예정일을 넣으면 모든 발주가 그 날짜
    expect(plannedPurchaseOrders(chosen, '2026-10-30').map((p) => p.expectedReceiptDate)).toEqual(['2026-10-30', '2026-10-30']);
    // 희망 입고일이 하나도 없으면 입고 예정일 없음
    expect(plannedPurchaseOrders([{ supplierId: 1, supplierName: '가온광업', desiredReceiptDate: null, requestedTon: '1' }], '')[0]?.expectedReceiptDate).toBeNull();
  });

  it('MRP 원료 줄: 입고예정·잔량 칸에 넣지 않은 몫을 이유별 작은 글씨로 (0인 이유는 빼고 천 단위 쉼표)', () => {
    const none = { onHandEarlierPlansTon: '0.000', scheduledOtherPlansTon: '0.000', scheduledAfterNeedDateTon: '0.000', scheduledEarlierPlansTon: '0.000', scheduledSpareTon: '0.000' };
    expect(mrpScheduledReceiptNotes(none)).toEqual([]);
    expect(mrpOnHandNotes(none)).toEqual([]);
    expect(mrpScheduledReceiptNotes({ ...none, scheduledAfterNeedDateTon: '3.500' })).toEqual(['필요일 뒤 도착 3.500 t 제외']);
    expect(mrpScheduledReceiptNotes({ ...none, scheduledOtherPlansTon: '3.500', scheduledEarlierPlansTon: '1.000', scheduledSpareTon: '1200.000' })).toEqual([
      '다른 계획 몫 3.500 t 제외',
      '앞선 계획 몫 1.000 t 제외',
      '남는 몫 1,200.000 t',
    ]);
    expect(mrpOnHandNotes({ onHandEarlierPlansTon: '444.445' })).toEqual(['앞선 계획 몫 444.445 t 제외']);
  });
});
