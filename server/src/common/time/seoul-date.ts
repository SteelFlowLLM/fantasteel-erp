// "오늘"과 채번 날짜는 서버에서 Asia/Seoul 기준으로 계산한다 (코드 컨벤션 5장).
// DB에는 timestamptz(UTC)로 저장하고, date 컬럼(납기일 등)은 아래 seoulDateOnly 값을 쓴다.

const SEOUL_OFFSET_MS = 9 * 60 * 60 * 1000;
const pad = (n: number) => String(n).padStart(2, '0');

export interface SeoulDateParts {
  yyyy: string;
  yy: string;
  mm: string;
  dd: string;
}

export function seoulDateParts(at: Date = new Date()): SeoulDateParts {
  const k = new Date(at.getTime() + SEOUL_OFFSET_MS);
  const yyyy = String(k.getUTCFullYear());
  return { yyyy, yy: yyyy.slice(2), mm: pad(k.getUTCMonth() + 1), dd: pad(k.getUTCDate()) };
}

/** 서울 날짜 'YYYY-MM-DD' (date 컬럼·납기 위험 계산용) */
export function seoulToday(at: Date = new Date()): string {
  const { yyyy, mm, dd } = seoulDateParts(at);
  return `${yyyy}-${mm}-${dd}`;
}

/** 서울 날짜를 Prisma date 컬럼에 넣을 Date(UTC 자정)로 만든다 */
export function seoulDateOnly(at: Date = new Date()): Date {
  return new Date(`${seoulToday(at)}T00:00:00.000Z`);
}
