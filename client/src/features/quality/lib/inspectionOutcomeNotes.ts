// 검사 저장 뒤 결과 카드의 안내 문구. 화면 컴포넌트 테스트 도구가 없어 문구 규칙을 순수 함수로 두고 단위 테스트한다.
import type { RegisterInspectionOutcome } from '@/api/inspections';
import type { LotType } from '@/codes';

type OutcomeCounts = Pick<
  RegisterInspectionOutcome,
  'inspectionResult' | 'autoReservedQty' | 'surplusQty' | 'surplusLotNos' | 'excludedLotQty' | 'releasedAllocationCount' | 'releasedReservationQty'
>;

/**
 * 판정과 판정 뒤 재고 반영 결과로 안내 문구를 만든다.
 * 서버 모드는 여재 LOT 번호 없이 매수만 오므로(stockSync) 번호는 있을 때만 붙인다.
 */
export function inspectionOutcomeNotes(outcome: OutcomeCounts, lotType: LotType, heatPending: boolean): string[] {
  const notes: string[] = [];
  if (outcome.inspectionResult === 'PASS') {
    if (outcome.autoReservedQty > 0) notes.push(`원래 수주 품목에 ${outcome.autoReservedQty}매를 자동 예약했어요`);
    if (outcome.surplusQty > 0) {
      const lotNos = outcome.surplusLotNos.length > 0 ? ` (${outcome.surplusLotNos.join(', ')})` : '';
      notes.push(`수주에 필요한 매수를 넘는 ${outcome.surplusQty}매는 여재가 됐어요${lotNos}`);
    }
    if (lotType !== 'HEAT' && heatPending) notes.push('상위 히트가 합격하면 예약·배정할 수 있어요');
    if (lotType === 'HEAT') notes.push('이미 제품 검사에 합격한 하위 슬래브·코일이 있으면 같이 예약·배정할 수 있게 돼요');
  } else if (outcome.inspectionResult === 'FAIL') {
    notes.push(lotType === 'HEAT' ? '하위 슬래브·코일도 쓸 수 없어요' : '예약·배정·출고 대상에서 빠져요');
    if (outcome.excludedLotQty > 0) notes.push(`적격에서 빠진 LOT ${outcome.excludedLotQty}개${releaseTextOf(outcome)}`);
  } else {
    notes.push('필수 항목이 비어 있어 판정 대기로 저장했어요');
  }
  return notes;
}

/** 적격에서 빠지며 해제한 배정·예약. 없으면 그렇다고 알려 준다 */
function releaseTextOf(outcome: OutcomeCounts): string {
  const parts = [
    outcome.releasedAllocationCount > 0 ? `배정 ${outcome.releasedAllocationCount}건 해제` : null,
    outcome.releasedReservationQty > 0 ? `예약 ${outcome.releasedReservationQty}매 해제` : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? ` · ${parts.join(' · ')}` : ' · 걸려 있던 배정·예약은 없어요';
}
