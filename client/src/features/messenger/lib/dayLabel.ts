// 목록·대화의 날짜 구분선과 짧은 시각 (Asia/Seoul). 메신저와 알림함이 함께 쓴다.
import { fmtDate, fmtHM, fmtMD, fmtMDdow } from '@/lib/format';
import { daysBetween } from '@/features/tasks/lib/taskDue';

/** 오늘 · 어제 · 09-28 (월) */
export function dayLabelOf(value: string, now: Date = new Date()): string {
  const days = daysBetween(fmtDate(value), fmtDate(now));
  if (days === 0) return '오늘';
  if (days === 1) return '어제';
  return fmtMDdow(value);
}

/** 방 목록 시각: 오늘이면 14:05, 어제면 '어제', 그 전은 09-28 */
export function shortTimeOf(value: string, now: Date = new Date()): string {
  const days = daysBetween(fmtDate(value), fmtDate(now));
  if (days === 0) return fmtHM(value);
  if (days === 1) return '어제';
  return fmtMD(value);
}
