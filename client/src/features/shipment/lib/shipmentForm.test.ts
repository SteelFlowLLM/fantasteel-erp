import { describe, expect, it } from 'vitest';
import { ERROR_MESSAGE } from '@/codes';
import {
  allocationLineSyncKey,
  isSameAsRecommendation,
  lineWeightTon,
  panelAfterRefresh,
  qtyUnitOf,
  requestQtyError,
  toggleLot,
  totalWeightTon,
  validQtyOf,
  type AllocationLineState,
} from '@/features/shipment/lib/shipmentForm';

describe('출하 매수 입력 (SO-002·SHP-002)', () => {
  it('소수·0·음수·글자·빈칸은 SO-002 문구로 거부하고 값을 바꾸지 않는다', () => {
    for (const text of ['10.5', '0', '-3', '3매', '', ' ', '1e3']) {
      expect(requestQtyError(text, 10)).toBe(ERROR_MESSAGE['SO-002']);
      expect(validQtyOf(text)).toBe(0);
    }
  });

  it('출하 가능 잔량을 넘으면 SHP-002 문구와 잔량', () => {
    expect(requestQtyError('7', 6)).toBe(`${ERROR_MESSAGE['SHP-002']} (출하 가능 6매)`);
    expect(requestQtyError('7', 6, '개')).toBe(`${ERROR_MESSAGE['SHP-002']} (출하 가능 6개)`);
    expect(requestQtyError('6', 6)).toBeNull();
    expect(requestQtyError(' 4 ', 6)).toBeNull();
  });
});

describe('이론중량 미리보기 (십진 계산)', () => {
  it('매수 × 1매 이론중량, 합계', () => {
    expect(lineWeightTon('4', '23.550')).toBe('94.200');
    expect(lineWeightTon('10.5', '23.550')).toBe('0.000');
    expect(totalWeightTon([{ qtyText: '4', theoreticalWeightTon: '23.550' }, { qtyText: '6', theoreticalWeightTon: '23.550' }])).toBe('235.500');
  });
});

describe('단위·추천 비교·선택', () => {
  it('유형이 하나면 매·개, 섞이면 빈 글자', () => {
    expect(qtyUnitOf(['SLAB', 'SLAB'])).toBe('매');
    expect(qtyUnitOf(['COIL'])).toBe('개');
    expect(qtyUnitOf(['SLAB', 'COIL'])).toBe('');
  });

  it('추천과 같은지 (순서 무관)', () => {
    expect(isSameAsRecommendation([3, 1, 2], [1, 2, 3])).toBe(true);
    expect(isSameAsRecommendation([1, 2], [1, 2, 3])).toBe(false);
    expect(isSameAsRecommendation([1, 2, 4], [1, 2, 3])).toBe(false);
  });

  it('필요 매수까지만 고른다', () => {
    expect(toggleLot([1, 2], 3, 3)).toEqual([1, 2, 3]);
    expect(toggleLot([1, 2, 3], 4, 3)).toEqual([1, 2, 3]);
    expect(toggleLot([1, 2, 3], 2, 3)).toEqual([1, 3]);
  });
});

describe('배정 카드 패널 — 다시 불러온 뒤 상태 맞추기 (REQ-INV-006)', () => {
  const waitingLine: AllocationLineState = { editable: true, waitingAllocationQty: 2, allocations: [], recommendedLotIds: [11, 12] };
  const allocatedLine: AllocationLineState = {
    editable: true,
    waitingAllocationQty: 0,
    allocations: [
      { allocationId: 1, allocationStatus: 'CONFIRMED' },
      { allocationId: 2, allocationStatus: 'CONFIRMED' },
    ],
    recommendedLotIds: [],
  };

  it('[추천대로 모두 확정] 뒤 배정 대기가 0이면 펼친 추천을 닫는다', () => {
    expect(allocationLineSyncKey(waitingLine)).not.toBe(allocationLineSyncKey(allocatedLine));
    expect(panelAfterRefresh({ kind: 'recommend' }, allocatedLine)).toEqual({ kind: 'closed' });
    expect(panelAfterRefresh({ kind: 'recommend' }, { ...waitingLine, waitingAllocationQty: 1 })).toEqual({ kind: 'recommend' });
    expect(panelAfterRefresh({ kind: 'recommend' }, { ...waitingLine, editable: false })).toEqual({ kind: 'closed' });
  });

  it('바꾸려던 배정이 해제·소진되면 변경 패널을 닫고, 그대로면 둔다', () => {
    const change = { kind: 'change', allocationId: 2, lotNo: 'L-2' } as const;
    expect(panelAfterRefresh(change, allocatedLine)).toBe(change);
    expect(panelAfterRefresh(change, { ...allocatedLine, allocations: [{ allocationId: 1, allocationStatus: 'CONFIRMED' }] })).toEqual({ kind: 'closed' });
    expect(panelAfterRefresh(change, { ...allocatedLine, editable: false, allocations: [{ allocationId: 2, allocationStatus: 'CONSUMED' }] })).toEqual({ kind: 'closed' });
    expect(panelAfterRefresh({ kind: 'closed' }, waitingLine)).toEqual({ kind: 'closed' });
  });

  it('추천 LOT이 바뀌면 비교 키가 달라진다 (고른 LOT을 새 추천으로 되돌림)', () => {
    expect(allocationLineSyncKey({ ...waitingLine, recommendedLotIds: [12, 13] })).not.toBe(allocationLineSyncKey(waitingLine));
    expect(allocationLineSyncKey({ ...waitingLine })).toBe(allocationLineSyncKey(waitingLine));
  });
});
