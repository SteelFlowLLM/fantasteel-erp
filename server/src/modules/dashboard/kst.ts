// 대시보드의 "오늘"·"하루"는 한국 시간(UTC+9) 기준이다 (시드·LOT 번호의 날짜 기준과 같다).
export const DAY_MS = 86_400_000;
const KST_OFFSET_MS = 9 * 3_600_000;

/** 한국 시간 기준 그날 00:00을 가리키는 시각. */
export function kstDayStart(now: Date): Date {
  return new Date(Math.floor((now.getTime() + KST_OFFSET_MS) / DAY_MS) * DAY_MS - KST_OFFSET_MS);
}

/** YYYY-MM-DD (한국 시간). */
export function kstDateString(d: Date): string {
  return new Date(d.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 오늘 날짜(한국 시간)를 UTC 자정으로 만든 값 — `@db.Date` 컬럼 값과 바로 비교한다. */
export function kstTodayDate(now: Date): Date {
  return new Date(`${kstDateString(now)}T00:00:00.000Z`);
}

/** 오늘을 포함해 최근 days일의 한국 날짜 목록 (오래된 날 → 오늘). */
export function lastDays(days: number, now: Date): string[] {
  const start = kstDayStart(now).getTime() - (days - 1) * DAY_MS;
  return Array.from({ length: days }, (_, i) => kstDateString(new Date(start + i * DAY_MS)));
}
