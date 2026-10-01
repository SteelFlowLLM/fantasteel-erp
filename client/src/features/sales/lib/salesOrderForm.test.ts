import { describe, expect, it } from 'vitest';
import { ERROR_MESSAGE } from '@/codes';
import { progressOf } from '@/lib/inventoryMath';
import {
  activeFilterCount,
  cancellationEffectsText,
  draftLineErrors,
  EMPTY_FILTER,
  filterSalesOrders,
  measureText,
  parseOrderedQty,
  percentOf,
  previewLinesOf,
  qtyUnitOf,
  type DraftLine,
} from '@/features/sales/lib/salesOrderForm';

const line = (patch: Partial<DraftLine> = {}): DraftLine => ({
  key: 'k',
  itemType: 'SLAB',
  steelGradeId: null,
  itemId: 1,
  qtyText: '10',
  dueDate: '2026-10-20',
  ...patch,
});

describe('매수 입력 (4.1, SO-002)', () => {
  it('1 이상 정수만 받고, 글자를 지우거나 반올림하지 않는다', () => {
    expect(parseOrderedQty('10')).toBe(10);
    expect(parseOrderedQty('007')).toBe(7);
    for (const text of ['10.5', '0', '-1', '', ' 3', '3매', '1e3', '１０']) expect(parseOrderedQty(text)).toBeNull();
  });

  it('줄 오류: 저장 전에는 입력한 칸만, 저장을 누른 뒤에는 빈칸도. 매수 문구는 SO-002 그대로', () => {
    expect(draftLineErrors(line({ itemId: null, qtyText: '', dueDate: '' }), false)).toEqual({});
    expect(draftLineErrors(line({ qtyText: '3매' }), false)).toEqual({ qty: ERROR_MESSAGE['SO-002'] });
    expect(draftLineErrors(line({ itemId: null, qtyText: '', dueDate: '' }), true)).toEqual({
      itemId: '규격을 선택해 주세요',
      qty: ERROR_MESSAGE['SO-002'],
      dueDate: '납기를 입력해 주세요',
    });
  });

  it('미리보기에는 규격·매수가 맞는 줄만, 원래 위치와 함께 넘긴다 (납기는 미리보기에 쓰지 않는다)', () => {
    expect(previewLinesOf([line({ itemId: null }), line({ qtyText: '4', dueDate: '' }), line({ qtyText: 'x' })])).toEqual([
      { index: 1, itemId: 1, orderedQty: 4 },
    ]);
  });
});

describe('표시', () => {
  it('수량 단위: 슬래브 매 · 코일 개 · 섞이면 매·개', () => {
    expect(qtyUnitOf(['SLAB'])).toBe('매');
    expect(qtyUnitOf(['COIL', 'COIL'])).toBe('개');
    expect(qtyUnitOf(['SLAB', 'COIL'])).toBe('매·개');
    expect(qtyUnitOf([])).toBe('매');
  });

  it('지표는 분모를 함께 보이고 %는 버림, 분모 0이면 null (4.5)', () => {
    expect(measureText(progressOf(6, 10), '매')).toBe('6 / 10매');
    expect(percentOf(progressOf(2, 3))).toBe(66);
    expect(percentOf(progressOf(0, 0))).toBeNull();
  });
});

describe('목록 거르기', () => {
  const rows = [
    { salesOrderNo: 'SO-2609-001', customerId: 1, customerName: '가람중공업', status: 'SHIPPED' as const, itemTypes: ['SLAB' as const], isDueRisk: false },
    {
      salesOrderNo: 'SO-2609-003',
      customerId: 3,
      customerName: '다온건설',
      status: 'OPEN' as const,
      itemTypes: ['COIL' as const, 'SLAB' as const],
      isDueRisk: false,
    },
    { salesOrderNo: 'SO-2609-004', customerId: 2, customerName: '나래조선', status: 'OPEN' as const, itemTypes: ['SLAB' as const], isDueRisk: true },
  ];

  it('상태·고객사·품목 유형·납기 위험·키워드(수주번호·고객사)', () => {
    expect(filterSalesOrders(rows, EMPTY_FILTER)).toHaveLength(3);
    expect(filterSalesOrders(rows, { ...EMPTY_FILTER, status: 'OPEN' }).map((r) => r.salesOrderNo)).toEqual(['SO-2609-003', 'SO-2609-004']);
    expect(filterSalesOrders(rows, { ...EMPTY_FILTER, itemType: 'COIL' }).map((r) => r.salesOrderNo)).toEqual(['SO-2609-003']);
    expect(filterSalesOrders(rows, { ...EMPTY_FILTER, riskOnly: true }).map((r) => r.salesOrderNo)).toEqual(['SO-2609-004']);
    expect(filterSalesOrders(rows, { ...EMPTY_FILTER, customerId: 1 }).map((r) => r.salesOrderNo)).toEqual(['SO-2609-001']);
    expect(filterSalesOrders(rows, { ...EMPTY_FILTER, keyword: '나래' }).map((r) => r.salesOrderNo)).toEqual(['SO-2609-004']);
    expect(filterSalesOrders(rows, { ...EMPTY_FILTER, keyword: '2609-003' }).map((r) => r.salesOrderNo)).toEqual(['SO-2609-003']);
    expect(activeFilterCount({ ...EMPTY_FILTER, riskOnly: true, customerId: 2, keyword: 'x' })).toBe(2);
  });
});

describe('취소된 수주 안내 띠 (BP-SO-02: 실제로 일어난 일만)', () => {
  it('예약 해제 매수(슬래브 매·코일 개)·취소한 계획·연결을 푼 진행중 계획을 있는 것만 말한다', () => {
    expect(cancellationEffectsText({ releasedReserved: [{ itemType: 'SLAB', qty: 6 }], cancelledPlanNos: ['PP-2610-0001'], unlinkedPlanNos: [] })).toBe(
      '예약 6매를 해제했어요 · 시작 전 생산계획 1건(PP-2610-0001)을 취소했어요',
    );
    expect(
      cancellationEffectsText({
        releasedReserved: [
          { itemType: 'COIL', qty: 3 },
          { itemType: 'SLAB', qty: 0 },
        ],
        cancelledPlanNos: [],
        unlinkedPlanNos: ['PP-2609-0003', 'PP-2609-0004'],
      }),
    ).toBe('예약 3개를 해제했어요 · 진행중이던 생산계획 2건(PP-2609-0003, PP-2609-0004)은 수주 연결을 풀어 완료 후 여재가 돼요');
    expect(cancellationEffectsText({ releasedReserved: [{ itemType: 'SLAB', qty: 0 }], cancelledPlanNos: [], unlinkedPlanNos: [] })).toBe(
      '해제할 예약이나 취소·연결 해제할 생산계획은 없었어요',
    );
  });
});
