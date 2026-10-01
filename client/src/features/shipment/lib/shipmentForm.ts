// 출하요청 화면 계산 (순수 함수, Vitest). 규칙의 최종 판단은 core 서비스가 다시 한다.
import { ERROR_MESSAGE, PRODUCT_QTY_UNIT, type ProductItemType } from '@/codes';
import { calcWeightTon, sumTon } from '@/lib/weight';

const INTEGER_TEXT = /^\d+$/;

/**
 * 출하 매수 입력 확인 (업무 프로세스 4.1: 소수·0·음수·글자는 거부, 값을 바꾸지 않는다).
 * 정수가 아니면 SO-002 문구, 출하 가능 잔량을 넘으면 SHP-002 문구. 문제 없으면 null.
 */
export function requestQtyError(text: string, shippableQty: number, unit = '매'): string | null {
  const trimmed = text.trim();
  if (!INTEGER_TEXT.test(trimmed) || Number(trimmed) < 1 || !Number.isSafeInteger(Number(trimmed))) return ERROR_MESSAGE['SO-002'];
  if (Number(trimmed) > shippableQty) return `${ERROR_MESSAGE['SHP-002']} (출하 가능 ${shippableQty}${unit})`;
  return null;
}

/** 입력이 올바른 정수면 그 값, 아니면 0 (합계·이론중량 미리보기용) */
export function validQtyOf(text: string): number {
  const trimmed = text.trim();
  return INTEGER_TEXT.test(trimmed) && Number(trimmed) >= 1 && Number.isSafeInteger(Number(trimmed)) ? Number(trimmed) : 0;
}

/** 출하 매수 × 1매 이론중량 (십진 계산, 4.1). 올바르지 않은 입력은 0으로 본다. */
export function lineWeightTon(text: string, unitWeightTon: string): string {
  return calcWeightTon(validQtyOf(text), unitWeightTon);
}

/** 여러 줄의 이론중량 합계 */
export function totalWeightTon(lines: readonly { qtyText: string; unitWeightTon: string }[]): string {
  return sumTon(lines.map((l) => lineWeightTon(l.qtyText, l.unitWeightTon)));
}

/** 화면 단위: 한 가지 유형이면 매·개, 섞였으면 빈 글자 */
export function qtyUnitOf(itemTypes: readonly ProductItemType[]): string {
  const types = [...new Set(itemTypes)];
  return types.length === 1 ? PRODUCT_QTY_UNIT[types[0]] : '';
}

/** 고른 LOT이 FIFO 추천과 같은지 (순서와 관계없이) */
export function isSameAsRecommendation(chosenLotIds: readonly number[], recommendedLotIds: readonly number[]): boolean {
  if (chosenLotIds.length !== recommendedLotIds.length) return false;
  const recommended = new Set(recommendedLotIds);
  return chosenLotIds.every((id) => recommended.has(id));
}

/** 체크박스 토글: 최대 maxCount개까지만 고른다 (넘으면 그대로) */
export function toggleLot(selected: readonly number[], lotId: number, maxCount: number): number[] {
  if (selected.includes(lotId)) return selected.filter((id) => id !== lotId);
  if (selected.length >= maxCount) return [...selected];
  return [...selected, lotId];
}

/** 배정 카드에서 펼친 패널: 닫힘 · FIFO 추천 · 배정 변경 */
export type AllocationPanel = { kind: 'closed' } | { kind: 'recommend' } | { kind: 'change'; allocationId: number; lotNo: string };

export interface AllocationLineState {
  /** 요청 상태가 배정 대기·배정 확정인지 */
  editable: boolean;
  waitingAllocationQty: number;
  allocations: readonly { allocationId: number; allocationStatus: string }[];
  recommendedLotIds: readonly number[];
}

/** 다시 불러온 배정 데이터가 바뀌었는지 비교하는 키 (바꿀 수 있는지·배정 대기·확정 배정·추천 LOT) */
export function allocationLineSyncKey(line: AllocationLineState): string {
  return [
    line.editable ? 'E' : 'R',
    line.waitingAllocationQty,
    line.allocations.map((a) => `${a.allocationId}:${a.allocationStatus}`).join(','),
    line.recommendedLotIds.join(','),
  ].join('|');
}

/**
 * 배정 데이터를 다시 불러온 뒤 펼친 패널을 새 상태에 맞춘다 (REQ-INV-006, 확정 후 상태 갱신).
 * - 추천: 배정 대기가 남아 있고 바꿀 수 있는 상태일 때만 그대로, 아니면 닫는다([추천대로 모두 확정]·다른 탭의 확정 뒤).
 * - 변경: 바꾸려던 배정이 아직 배정 확정일 때만 그대로.
 */
export function panelAfterRefresh(panel: AllocationPanel, line: AllocationLineState): AllocationPanel {
  if (panel.kind === 'recommend') return line.editable && line.waitingAllocationQty > 0 ? panel : { kind: 'closed' };
  if (panel.kind === 'change') {
    const target = line.allocations.find((a) => a.allocationId === panel.allocationId);
    return line.editable && target?.allocationStatus === 'CONFIRMED' ? panel : { kind: 'closed' };
  }
  return panel;
}
