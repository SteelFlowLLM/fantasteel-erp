// 수주 날짜 계산·납기 위험 표시 (REQ-SO-005, BP-SO-02, 업무 프로세스 10장).
// 품목·헤더 상태는 서버가 계산해 준다 (ERD sales_order note, sales-order fulfillment.calculator).
import type { SalesOrderItemStatus } from '@/codes';

/** 날짜 차이(일): b − a. 'YYYY-MM-DD' */
export function daysBetween(a: string, b: string): number {
  const toUtc = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}

/**
 * 납기 위험 (계산 표시값, 공통 코드 비고·TRM-107): 미출하가 남았고 납기까지 남은 날이 납기 위험 기준일 이하(지난 납기 포함).
 * 기준일은 production_setting.delivery_risk_days (초기 3일).
 */
export function isDueRisk(input: { dueDate: string; today: string; deliveryRiskDays: number; unshippedQty: number; status: SalesOrderItemStatus }): boolean {
  if (input.status === 'CANCELLED' || input.status === 'SHIPPED' || input.unshippedQty <= 0) return false;
  return daysBetween(input.today, input.dueDate) <= input.deliveryRiskDays;
}

/** 'YYYY-MM-DD'에 일수를 더한다 */
export function addDays(date: string, days: number): string {
  const utc = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) + days * 86_400_000;
  const d = new Date(utc);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
