// 날짜 계산은 Asia/Seoul 기준이다 (코드 컨벤션 5장: LOT 채번의 YYMMDD와 "오늘" 계산).

export const SEOUL_TIME_ZONE = 'Asia/Seoul';

export interface SeoulDateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const partsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: SEOUL_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export function seoulDateParts(date: Date): SeoulDateParts {
  const map = new Map(partsFormatter.formatToParts(date).map((p) => [p.type, p.value]));
  const num = (type: Intl.DateTimeFormatPartTypes) => Number(map.get(type) ?? '0');
  return { year: num('year'), month: num('month'), day: num('day'), hour: num('hour') % 24, minute: num('minute') };
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** 2026-10-01 */
export function toSeoulDateString(date: Date): string {
  const p = seoulDateParts(date);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

/** 업무 번호의 YYMM (예: 2610) */
export function toSeoulYyMm(date: Date): string {
  const p = seoulDateParts(date);
  return `${pad2(p.year % 100)}${pad2(p.month)}`;
}

/** LOT 번호·작업 로그 번호의 YYMMDD (예: 261001) */
export function toSeoulYyMmDd(date: Date): string {
  const p = seoulDateParts(date);
  return `${pad2(p.year % 100)}${pad2(p.month)}${pad2(p.day)}`;
}
