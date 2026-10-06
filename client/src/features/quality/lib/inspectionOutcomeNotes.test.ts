import { describe, expect, it } from 'vitest';
import { inspectionOutcomeNotes } from './inspectionOutcomeNotes';

const none = { autoReservedQty: 0, surplusQty: 0, surplusLotNos: [], excludedLotQty: 0, releasedAllocationCount: 0, releasedReservationQty: 0 };

describe('검사 저장 뒤 안내 문구', () => {
  it('합격: 자동 예약 매수와 여재 매수를 알린다. 서버 모드처럼 여재 LOT 번호가 없으면 매수만', () => {
    const notes = inspectionOutcomeNotes({ ...none, inspectionResult: 'PASS', autoReservedQty: 2, surplusQty: 1 }, 'HEAT', false);
    expect(notes).toEqual([
      '원래 수주 품목에 2매를 자동 예약했어요',
      '수주에 필요한 매수를 넘는 1매는 여재가 됐어요',
      '이미 제품 검사에 합격한 하위 슬래브·코일이 있으면 같이 예약·배정할 수 있게 돼요',
    ]);
  });

  it('합격: 가짜 DB처럼 여재 LOT 번호를 알면 괄호로 붙인다', () => {
    const notes = inspectionOutcomeNotes({ ...none, inspectionResult: 'PASS', surplusQty: 2, surplusLotNos: ['HT-A-01', 'HT-A-02'] }, 'SLAB', false);
    expect(notes).toEqual(['수주에 필요한 매수를 넘는 2매는 여재가 됐어요 (HT-A-01, HT-A-02)']);
  });

  it('합격이어도 상위 히트가 판정 전인 슬래브면 예약·배정은 히트 합격 뒤라고 알린다', () => {
    expect(inspectionOutcomeNotes({ ...none, inspectionResult: 'PASS' }, 'SLAB', true)).toEqual(['상위 히트가 합격하면 예약·배정할 수 있어요']);
  });

  it('불합격: 적격에서 빠진 LOT과 해제한 배정 건수·예약 매수를 숫자로 알린다', () => {
    const notes = inspectionOutcomeNotes({ ...none, inspectionResult: 'FAIL', excludedLotQty: 3, releasedAllocationCount: 1, releasedReservationQty: 2 }, 'HEAT', false);
    expect(notes).toEqual(['하위 슬래브·코일도 쓸 수 없어요', '적격에서 빠진 LOT 3개 · 배정 1건 해제 · 예약 2매 해제']);
  });

  it('불합격: 해제할 배정·예약이 없었으면 그렇다고 알린다', () => {
    const notes = inspectionOutcomeNotes({ ...none, inspectionResult: 'FAIL', excludedLotQty: 1 }, 'COIL', false);
    expect(notes).toEqual(['예약·배정·출고 대상에서 빠져요', '적격에서 빠진 LOT 1개 · 걸려 있던 배정·예약은 없어요']);
  });

  it('판정 대기: 필수 항목이 비었다고 알린다', () => {
    expect(inspectionOutcomeNotes({ ...none, inspectionResult: 'PENDING' }, 'COIL', false)).toEqual(['필수 항목이 비어 있어 판정 대기로 저장했어요']);
  });
});
