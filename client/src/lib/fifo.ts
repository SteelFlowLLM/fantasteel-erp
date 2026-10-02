// FIFO (REQ-INV-006, TRM-061, 업무 프로세스 4.2·16장).
// - 제품(슬래브·코일) 배정 추천: 생산완료일 오름차순, 같으면 LOT 번호 순.
// - 원료 차감(제선·합금철): 입고일 오름차순, 같으면 LOT 번호 순. 용선 투입(제강): 생산 순. 모두 lot.produced_date를 쓴다.
import { decAdd, decCmp, decMin, decSub, TON_DIGITS, decRound } from '@/lib/decimal';

export interface FifoLot {
  id: number;
  lotNo: string;
  /** 생산완료일·원료 입고일 (YYYY-MM-DD) */
  producedDate: string;
}

export function compareFifo(a: FifoLot, b: FifoLot): number {
  return a.producedDate.localeCompare(b.producedDate) || (a.lotNo < b.lotNo ? -1 : a.lotNo > b.lotNo ? 1 : 0) || a.id - b.id;
}

export const sortFifo = <T extends FifoLot>(lots: readonly T[]): T[] => [...lots].sort(compareFifo);

/** 앞에서부터 count개 */
export const pickFifo = <T extends FifoLot>(lots: readonly T[], count: number): T[] => sortFifo(lots).slice(0, Math.max(0, count));

export interface DeductibleLot extends FifoLot {
  remainingTon: string;
}

export interface FifoDeduction<T extends DeductibleLot> {
  lot: T;
  /** 이 LOT에서 빼는 톤 */
  ton: string;
  /** 뺀 뒤 남는 톤 */
  remainingAfterTon: string;
}

/**
 * requiredTon만큼 FIFO로 뺄 계획을 세운다. 잔량이 모자라면 shortageTon > 0 (음수 잔량을 만들지 않는다, REQ-LOT-004).
 * 실제로 빼는 LOT만 결과에 넣는다 (REQ-LOT-002 "차감된 LOT만 연결").
 */
export function planFifoDeduction<T extends DeductibleLot>(lots: readonly T[], requiredTon: string): { deductions: FifoDeduction<T>[]; shortageTon: string } {
  let need = decRound(requiredTon, TON_DIGITS);
  const deductions: FifoDeduction<T>[] = [];
  for (const lot of sortFifo(lots)) {
    if (decCmp(need, 0) <= 0) break;
    if (decCmp(lot.remainingTon, 0) <= 0) continue;
    const ton = decMin(need, lot.remainingTon);
    deductions.push({ lot, ton, remainingAfterTon: decSub(lot.remainingTon, ton) });
    need = decSub(need, ton);
  }
  return { deductions, shortageTon: decCmp(need, 0) > 0 ? need : '0.000' };
}

/** 잔량 합계 */
export const totalRemainingTon = (lots: readonly DeductibleLot[]): string => lots.reduce((sum, lot) => decAdd(sum, lot.remainingTon), '0.000');
