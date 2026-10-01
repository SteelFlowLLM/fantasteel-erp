// 날짜 직접 입력 해석 (SPEC 4장 2번: 납기는 달력으로 고르거나 숫자로 직접 입력). 옛 DateInput에서 옮겼다.
import { todayStr } from '@/lib/format';

const pad2 = (n: number) => String(n).padStart(2, '0');
export const toDateText = (year: number, month: number, day: number): string => `${year}-${pad2(month)}-${pad2(day)}`;

/**
 * "20261012", "2026.10.12", "26-10-12", "261012", "10/12", "1012" 같은 입력을 YYYY-MM-DD로 바꾼다.
 * 해석할 수 없거나 없는 날짜면 null.
 */
export function parseDateText(text: string, baseYear: number = Number(todayStr().slice(0, 4))): string | null {
  const source = text.trim();
  if (!source) return null;
  const digits = source.replace(/\D/g, '');
  const parts = source.split(/\D+/).filter(Boolean);
  let year: number;
  let month: number;
  let day: number;
  if (parts.length === 3) {
    [year, month, day] = parts.map(Number) as [number, number, number];
    if (year < 100) year += 2000;
  } else if (parts.length === 2) {
    year = baseYear;
    [month, day] = parts.map(Number) as [number, number];
  } else if (digits.length === 8) {
    year = Number(digits.slice(0, 4));
    month = Number(digits.slice(4, 6));
    day = Number(digits.slice(6, 8));
  } else if (digits.length === 6) {
    year = 2000 + Number(digits.slice(0, 2));
    month = Number(digits.slice(2, 4));
    day = Number(digits.slice(4, 6));
  } else if (digits.length === 4) {
    year = baseYear;
    month = Number(digits.slice(0, 2));
    day = Number(digits.slice(2, 4));
  } else {
    return null;
  }
  if (month < 1 || month > 12 || day < 1) return null;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > lastDay || year < 2000 || year > 2100) return null;
  return toDateText(year, month, day);
}
