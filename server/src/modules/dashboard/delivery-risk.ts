import { DAY_MS } from './kst';

/** 납기까지 남은 일수 (오늘 = 0, 지났으면 음수). dueDate·today는 둘 다 UTC 자정 날짜 값. */
export function daysToDue(dueDate: Date, today: Date): number {
  return Math.round((dueDate.getTime() - today.getTime()) / DAY_MS);
}

/**
 * 납기 위험 규칙 (REQ-AGT-004, AI 아님): 납기까지 남은 일수 ≤ 기준일 이고 출하 매수 < 주문 매수.
 * 납기가 지난 미출하 품목(음수)도 위험이다.
 */
export function isDeliveryRisk(item: { dueDate: Date; orderedQty: number; shippedQty: number }, today: Date, riskDays: number): boolean {
  return item.shippedQty < item.orderedQty && daysToDue(item.dueDate, today) <= riskDays;
}
