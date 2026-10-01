// 여재 슬래브 고르기 (순수 함수). 용어 사전 TRM-048 "수주에 쓰이지 않고 남은 미배정 합격 슬래브", REQ-INV-008,
// 업무 프로세스 4.3 구현 제안("이미 다른 수주에 ACTIVE 예약된 매수를 자유 재고로 노출하지 않는다").
// core 재고 조회(mock/services/inventoryViews.ts surplusSlabs)가 쓰고, 재고 화면·대시보드는 그 결과를 그대로 보인다(숫자가 한 곳에서 나온다).
import { compareFifo } from '@/lib/fifo';

/** 여재 후보: 그 규격의 미배정 합격 슬래브 (적격 + CONFIRMED 배정 없음) */
export interface SurplusCandidate {
  lotId: number;
  lotNo: string;
  producedDate: string;
  /** 여재 전환 시각 (core 가정값: 원래 수주에 쓰이지 않게 된 합격 슬래브에만 있다) */
  surplusAt: string | null;
}

const byFifo = (a: SurplusCandidate, b: SurplusCandidate) =>
  compareFifo({ id: a.lotId, lotNo: a.lotNo, producedDate: a.producedDate }, { id: b.lotId, lotNo: b.lotNo, producedDate: b.producedDate });

/**
 * 규격별 여재 슬래브 (선입선출 순).
 * - 여재 = 미배정 합격 슬래브 중 여재로 전환된(surplus_at) LOT. 원래 수주의 예약 몫·코일 계획의 열연 대기 슬래브는 여재가 아니다.
 * - 여재로 다른 수주를 예약하면 그만큼은 "수주에 쓰인" 것이라 여재에서 빠진다 → 여재 매수 = min(여재 전환 LOT 수, 가용재고).
 *   그래서 여재는 늘 가용재고 안에 있다(TRM-055 "여재 포함").
 * - 예약은 매수 단위라 어느 LOT이 예약 몫인지 정해지지 않는다. 배정은 선입선출(오래된 LOT부터)로 쓰이므로
 *   여재로 남는 LOT은 여재 전환 LOT 중 최근 것부터 여재 매수만큼으로 본다(가정값).
 */
export function pickSurplusLots<T extends SurplusCandidate>(candidates: readonly T[], availableQty: number): T[] {
  const converted = candidates.filter((l) => l.surplusAt !== null).sort(byFifo);
  const surplusQty = Math.min(converted.length, Math.max(0, availableQty));
  return surplusQty === 0 ? [] : converted.slice(converted.length - surplusQty);
}
