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
