/** 일정 등록 알림 문구용 `M/D HH:mm` (+09:00 ISO에서 그대로 읽는다) */
export function shortSeoulTime(iso: string): string {
  return `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))} ${iso.slice(11, 16)}`;
}

/** 알림이 여는 내 일정 주: 일정이 있는 날(+09:00 ISO의 날짜)이 속한 주의 월요일 */
export function scheduleWeekLink(iso: string): string {
  const day = new Date(`${iso.slice(0, 10)}T00:00:00.000Z`);
  const monday = new Date(day.getTime() - ((day.getUTCDay() + 6) % 7) * 86_400_000);
  return `/schedule?week=${monday.toISOString().slice(0, 10)}`;
}
