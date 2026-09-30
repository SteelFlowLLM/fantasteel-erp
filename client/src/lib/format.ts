// 표시용 포맷. 시간은 Asia/Seoul 기준으로 보여준다 (코드 컨벤션 5장).
const TZ = 'Asia/Seoul';
const parts = (d: Date, opts: Intl.DateTimeFormatOptions) =>
  Object.fromEntries(new Intl.DateTimeFormat('ko-KR', { timeZone: TZ, hour12: false, ...opts }).formatToParts(d).map((p) => [p.type, p.value]));
const toDate = (v: string | Date | null | undefined) => (v ? (v instanceof Date ? v : new Date(v)) : null);

/** 2026-09-30 */
export function fmtDate(v: string | Date | null | undefined): string {
  const d = toDate(v);
  if (!d || Number.isNaN(d.getTime())) return '-';
  const p = parts(d, { year: 'numeric', month: '2-digit', day: '2-digit' });
  return `${p.year}-${p.month}-${p.day}`;
}
/** 09-30 */
export function fmtMD(v: string | Date | null | undefined): string {
  const s = fmtDate(v);
  return s === '-' ? s : s.slice(5);
}
/** 14:05 */
export function fmtHM(v: string | Date | null | undefined): string {
  const d = toDate(v);
  if (!d || Number.isNaN(d.getTime())) return '-';
  const p = parts(d, { hour: '2-digit', minute: '2-digit' });
  return `${p.hour === '24' ? '00' : p.hour}:${p.minute}`;
}
/** 09-30 14:05 */
export const fmtMDHM = (v: string | Date | null | undefined) => (toDate(v) ? `${fmtMD(v)} ${fmtHM(v)}` : '-');
/** 2026-09-30 14:05 */
export const fmtDateTime = (v: string | Date | null | undefined) => (toDate(v) ? `${fmtDate(v)} ${fmtHM(v)}` : '-');
/** 09-30 (수) */
export function fmtMDdow(v: string | Date | null | undefined): string {
  const d = toDate(v);
  if (!d) return '-';
  return `${fmtMD(d)} (${new Intl.DateTimeFormat('ko-KR', { timeZone: TZ, weekday: 'short' }).format(d)})`;
}
/** 방금 · 5분 전 · 3시간 전 · 2일 전 · 그 이상은 날짜 */
export function relTime(v: string | Date | null | undefined, now = new Date()): string {
  const d = toDate(v);
  if (!d) return '-';
  const diff = Math.floor((now.getTime() - d.getTime()) / 1000);
  if (diff < 60) return '방금';
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}일 전`;
  return fmtMD(d);
}
/** 납기까지 남은 일수 라벨: D-3 / D-day / D+2 */
export function dLabel(due: string | Date | null | undefined, now = new Date()): string {
  const s = fmtDate(due);
  if (s === '-') return '';
  const days = Math.round((Date.parse(`${s}T00:00:00+09:00`) - Date.parse(`${fmtDate(now)}T00:00:00+09:00`)) / 86_400_000);
  return days === 0 ? 'D-day' : days > 0 ? `D-${days}` : `D+${-days}`;
}
/** 오늘 날짜 YYYY-MM-DD (KST) */
export const todayStr = () => fmtDate(new Date());

/** 톤 표시: "235.500 t" (서버가 준 문자열 그대로, 자리수만 맞춤) */
export function fmtTon(v: string | number | null | undefined, digits = 3): string {
  if (v === null || v === undefined || v === '') return '-';
  const n = Number(v);
  if (Number.isNaN(n)) return '-';
  return `${n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })} t`;
}
export const fmtInt = (n: number | null | undefined) => (n === null || n === undefined ? '-' : Math.round(n).toLocaleString('en-US'));
export const fmtNum = (v: string | number | null | undefined, digits = 1) =>
  v === null || v === undefined || v === '' ? '-' : Number(v).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
export const fmtPct = (ratio: number | null | undefined, digits = 0) => (ratio === null || ratio === undefined ? '-' : `${(ratio * 100).toFixed(digits)}%`);
/** 규격 치수: 250 × 1,200 × 10,000 */
export function fmtDims(t: string | number, w: string | number, l: string | number): string {
  const f = (x: string | number) => Number(x).toLocaleString('en-US', { maximumFractionDigits: 2 });
  return `${f(t)} × ${f(w)} × ${f(l)}`;
}
/** 파일 크기 */
export function fmtBytes(n: number | null | undefined): string {
  if (!n && n !== 0) return '-';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
