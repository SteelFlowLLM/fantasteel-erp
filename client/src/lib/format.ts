// 화면 표시용 포맷. 시각은 Asia/Seoul 기준으로 보여 준다 (코드 컨벤션 5장).
// 옛 client/src/lib/format.ts를 옮겼다. 톤은 숫자로 바꾸지 않고 문자열 그대로 자리수만 맞춘다.
import { SEOUL_TIME_ZONE, toSeoulDateString } from '@/lib/seoulDate';
import { formatDecimal } from '@/lib/weight';

type DateInputValue = string | Date | null | undefined;

const toDate = (value: DateInputValue): Date | null => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const timeFormatter = new Intl.DateTimeFormat('ko-KR', {
  timeZone: SEOUL_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const weekdayFormatter = new Intl.DateTimeFormat('ko-KR', { timeZone: SEOUL_TIME_ZONE, weekday: 'short' });

/** 2026-09-30. 날짜만 있는 값(YYYY-MM-DD)은 그대로 쓴다. */
export function fmtDate(value: DateInputValue): string {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = toDate(value);
  return date ? toSeoulDateString(date) : '-';
}

/** 09-30 */
export function fmtMD(value: DateInputValue): string {
  const text = fmtDate(value);
  return text === '-' ? text : text.slice(5);
}

/** 14:05 */
export function fmtHM(value: DateInputValue): string {
  const date = toDate(value);
  if (!date) return '-';
  const parts = new Map(timeFormatter.formatToParts(date).map((p) => [p.type, p.value]));
  const hour = parts.get('hour') ?? '00';
  return `${hour === '24' ? '00' : hour}:${parts.get('minute') ?? '00'}`;
}

/** 09-30 14:05 */
export const fmtMDHM = (value: DateInputValue): string => (toDate(value) ? `${fmtMD(value)} ${fmtHM(value)}` : '-');

/** 2026-09-30 14:05 */
export const fmtDateTime = (value: DateInputValue): string => (toDate(value) ? `${fmtDate(value)} ${fmtHM(value)}` : '-');

/** 09-30 (수) */
export function fmtMDdow(value: DateInputValue): string {
  const date = toDate(value);
  if (!date) return '-';
  return `${fmtMD(date)} (${weekdayFormatter.format(date)})`;
}

/** 방금 · 5분 전 · 3시간 전 · 2일 전 · 그 이상은 날짜 */
export function relTime(value: DateInputValue, now: Date = new Date()): string {
  const date = toDate(value);
  if (!date) return '-';
  const diff = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (diff < 60) return '방금';
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}일 전`;
  return fmtMD(date);
}

/** 오늘 날짜 YYYY-MM-DD (Asia/Seoul) */
export const todayStr = (): string => toSeoulDateString(new Date());

/** 납기까지 남은 일수 라벨: D-3 / D-day / D+2 */
export function dLabel(due: DateInputValue, now: Date = new Date()): string {
  const dueText = fmtDate(due);
  if (dueText === '-') return '';
  const days = Math.round((Date.parse(`${dueText}T00:00:00+09:00`) - Date.parse(`${toSeoulDateString(now)}T00:00:00+09:00`)) / 86_400_000);
  if (days === 0) return 'D-day';
  return days > 0 ? `D-${days}` : `D+${-days}`;
}

/** 정수 부분에 천 단위 쉼표를 넣는다 ("1234567.500" → "1,234,567.500") */
function groupThousands(text: string): string {
  const [integerPart, fractionPart] = text.split('.');
  const negative = integerPart.startsWith('-');
  const digits = negative ? integerPart.slice(1) : integerPart;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${grouped}${fractionPart !== undefined ? `.${fractionPart}` : ''}`;
}

/** 톤 표시: "235.500 t" */
export function fmtTon(value: string | number | null | undefined, digits = 3): string {
  if (value === null || value === undefined || value === '') return '-';
  try {
    return `${groupThousands(formatDecimal(value, digits))} t`;
  } catch {
    return '-';
  }
}

/** 소수 표시 (자리수 맞춤, 천 단위 쉼표) */
export function fmtNum(value: string | number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || value === '') return '-';
  try {
    return groupThousands(formatDecimal(value, digits));
  } catch {
    return '-';
  }
}

/** 정수 표시: 1,234 */
export const fmtInt = (value: number | null | undefined): string =>
  value === null || value === undefined ? '-' : Math.round(value).toLocaleString('en-US');

/** 비율 표시: 0.98 → 98% */
export const fmtPct = (ratio: number | null | undefined, digits = 0): string =>
  ratio === null || ratio === undefined ? '-' : `${(ratio * 100).toFixed(digits)}%`;

/** 규격 치수: 250 × 1,200 × 10,000 (소수 끝의 0은 지운다) */
export function fmtDims(thickness: string | number, width: string | number, length: string | number): string {
  const one = (value: string | number) => {
    const text = typeof value === 'number' ? String(value) : value;
    const trimmed = text.includes('.') ? text.replace(/\.?0+$/, '') : text;
    return groupThousands(trimmed);
  };
  return `${one(thickness)} × ${one(width)} × ${one(length)}`;
}

/** 파일 크기 */
export function fmtBytes(size: number | null | undefined): string {
  if (size === null || size === undefined) return '-';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
