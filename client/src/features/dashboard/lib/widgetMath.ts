// 대시보드 위젯 집계 계산 (순수 함수, REQ-DSH-001·002).
// 업무 규칙(가용·충족 현황·납기 위험·MRP 순소요·수율 계산식)은 core 서비스와 lib가 계산한다. 여기서는 위젯이 그 값을 묶는 방법만 둔다:
// 비율(분모 0이면 없음), 최근 N일 기간과 날짜별 묶음, 보유 일수, 가중 평균 계획 수율.
import { decCmp, decDiv, decMul, decSum, RATE_DIGITS, TON_DIGITS, type DecimalInput } from '@/lib/decimal';
import { addDays, daysBetween } from '@/lib/salesOrderStatus';

/** 비율 문자열(소수 4자리, 예: '0.9420'). 분모가 0 이하이면 null */
export function ratioText(part: DecimalInput, whole: DecimalInput): string | null {
  if (decCmp(whole, 0) <= 0) return null;
  return decDiv(part, whole, RATE_DIGITS);
}

/** 건수 비율 (0~1). 분모가 0이면 null */
export function countRatio(part: number, whole: number): number | null {
  return whole > 0 ? part / whole : null;
}

export interface TrendWindow {
  /** 시작일 (오늘 포함 days일 전) */
  from: string;
  to: string;
  /** from ~ to 날짜 (오름차순) */
  dates: string[];
}

/** 최근 days일 (오늘 포함). days는 1 이상 */
export function trendWindow(today: string, days: number): TrendWindow {
  const length = Math.max(1, Math.floor(days));
  const from = addDays(today, -(length - 1));
  return { from, to: today, dates: Array.from({ length }, (_, index) => addDays(from, index)) };
}

export const isWithin = (date: string, window: Pick<TrendWindow, 'from' | 'to'>): boolean => date >= window.from && date <= window.to;

/** 날짜별로 묶는다. 기간 밖 날짜는 버리고, 값이 없는 날도 빈 배열로 둔다. */
export function bucketByDate<T>(rows: readonly T[], dateOf: (row: T) => string, window: TrendWindow): Map<string, T[]> {
  const buckets = new Map<string, T[]>(window.dates.map((date) => [date, []]));
  for (const row of rows) buckets.get(dateOf(row))?.push(row);
  return buckets;
}

/** 납기까지 남은 일수 → D-3 / D-day / D+2 */
export const dueLabel = (daysToDue: number): string => (daysToDue === 0 ? 'D-day' : daysToDue > 0 ? `D-${daysToDue}` : `D+${-daysToDue}`);

/** 보유 일수 = 오늘 − 시작일 (0 이상) */
export const ageDays = (sinceDate: string, today: string): number => Math.max(0, daysBetween(sinceDate, today));

export interface YieldPart {
  inputTon: DecimalInput;
  /** 이 실적에 적용하는 계획 수율 (없으면 null) */
  plannedYieldRate: DecimalInput | null;
}

/**
 * 투입량 가중 계획 수율 = Σ(투입 × 계획 수율) ÷ Σ투입.
 * 공정 하나에 계획 수율이 다른 실적(예: 열연은 규격마다 다름)이 섞여 있을 때 막대 눈금 하나로 보이려고 쓴다.
 * 계획 수율이 없는 실적이 하나라도 있으면 null.
 */
export function weightedPlannedYield(parts: readonly YieldPart[]): string | null {
  if (parts.length === 0 || parts.some((p) => p.plannedYieldRate === null)) return null;
  const input = decSum(parts.map((p) => p.inputTon), TON_DIGITS);
  const planned = decSum(
    parts.map((p) => decMul(p.inputTon, p.plannedYieldRate ?? 0, 6)),
    6,
  );
  return ratioText(planned, input);
}

/**
 * Agent 위험 감지 예시(불합격률 상승, REQ-AGT-004)에 보이는 불합격률 기준 (0~1).
 * 문서에 정한 값이 없어 예시용으로 5%를 둔다. 불합격률 위젯에는 기준 초과 표시를 하지 않는다(막대·숫자로 충분)
 */
export const REJECT_RATE_ALERT = 0.05;
