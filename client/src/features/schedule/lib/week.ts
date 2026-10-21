// 내 일정 주 계산. 날짜는 모두 'YYYY-MM-DD' 문자열이고 기준은 Asia/Seoul이다 (요일은 UTC 자정으로 읽어도 달력이 같다).
import { toSeoulDateString } from '@/lib/seoulDate';

const DAY_MS = 86_400_000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const parse = (date: string): number => Date.parse(`${date}T00:00:00.000Z`);

export function isDateString(value: string | null | undefined): value is string {
  return !!value && DATE_PATTERN.test(value) && !Number.isNaN(parse(value)) && new Date(parse(value)).toISOString().slice(0, 10) === value;
}

export function addDays(date: string, days: number): string {
  return new Date(parse(date) + days * DAY_MS).toISOString().slice(0, 10);
}

/** 그 날짜가 속한 주의 월요일 */
export function mondayOf(date: string): string {
  const weekday = new Date(parse(date)).getUTCDay();
  return addDays(date, -((weekday + 6) % 7));
}

/** 월~일 7일 */
export function weekDays(monday: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** 주소의 ?week= 값을 그 주의 월요일로. 없거나 잘못되면 오늘이 속한 주 */
export function weekFromParam(param: string | null, today: string): string {
  return mondayOf(isDateString(param) ? param : today);
}

/** ISO 시각이 서울 기준으로 어느 날인지 */
export const seoulDayOf = (iso: string): string => toSeoulDateString(new Date(iso));

/** 서울 그날 0시의 시각(ms) */
const seoulMidnightMs = (day: string): number => Date.parse(`${day}T00:00:00+09:00`);

/**
 * 일정이 그날(서울 0~24시)과 겹치는지. 날을 넘기는 일정(일 23:30~월 00:30)은 두 날에 모두 보이고,
 * 지난주에 시작해 이번 주에 걸친 일정도 이번 주 첫날에 보인다 (#487)
 */
export function overlapsDay(event: { startAt: string; endAt: string }, day: string): boolean {
  const start = Date.parse(event.startAt);
  const end = Date.parse(event.endAt);
  return start < seoulMidnightMs(addDays(day, 1)) && end > seoulMidnightMs(day);
}
