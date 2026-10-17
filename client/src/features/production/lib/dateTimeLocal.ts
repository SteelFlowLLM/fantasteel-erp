// 작업일시 입력칸(<input type="datetime-local">) 값과 ISO 시각을 서울 시각 기준으로 바꾼다 (컨벤션 5장: 화면 시각은 Asia/Seoul).
import { seoulDateParts } from '@/lib/seoulDate';

const LOCAL_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const pad = (n: number) => String(n).padStart(2, '0');

/** ISO 시각 → 'YYYY-MM-DDTHH:mm' (서울). 잘못된 값이면 '' */
export function toDateTimeLocal(value: string | Date | null | undefined): string {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const p = seoulDateParts(date);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** 'YYYY-MM-DDTHH:mm' (서울) → ISO 시각. 형식이 틀리면 '' (서버가 '…을 입력해 주세요'로 거부한다) */
export function fromDateTimeLocal(text: string): string {
  const m = LOCAL_PATTERN.exec(text.trim());
  if (!m) return '';
  const date = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00+09:00`);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

/** 지금부터 hours시간 전의 입력칸 값 (작업일시 기본값) */
export const dateTimeLocalHoursAgo = (hours: number, now: Date = new Date()): string => toDateTimeLocal(new Date(now.getTime() - hours * 3_600_000));

/**
 * 작업 시작 일시 기본값: hours시간 전. 앞 공정이나 같은 설비의 앞 작업(earliest)이 그보다 늦게 끝났으면 그 뒤 첫 분.
 * 입력칸이 분 단위라 올려야 서버의 시간 순서·설비 겹침 검증을 통과한다.
 */
export function defaultStartedLocal(hours: number, earliest: string | null, now: Date = new Date()): string {
  const from = now.getTime() - hours * 3_600_000;
  const ready = earliest ? new Date(earliest).getTime() : Number.NaN;
  return toDateTimeLocal(new Date(Number.isNaN(ready) ? from : Math.max(from, Math.ceil(ready / 60_000) * 60_000)));
}

/** 둘 중 늦은 입력칸 값 ('YYYY-MM-DDTHH:mm'은 글자 순서가 곧 시간 순서) */
export const laterLocal = (a: string, b: string): string => (a >= b ? a : b);
