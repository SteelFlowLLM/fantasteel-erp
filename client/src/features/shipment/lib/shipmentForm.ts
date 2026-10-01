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
