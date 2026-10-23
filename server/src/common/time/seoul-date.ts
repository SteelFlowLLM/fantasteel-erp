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

/**
 * 사람이 고른 시각 글을 시각으로. 시간대(Z·±hh:mm)가 없으면 서울 시각으로 읽는다 (일정 #487, 작업 실적 #496).
 * new Date는 시간대 없는 글을 서버 로컬 시간으로 읽어, 서버가 UTC(AWS)면 9시간 밀린다. 날짜와 시각 사이 공백(ISO 8601이 허용)은 T로 본다
 */
export function seoulDateTimeOf(text: string): Date {
  const value = text.trim().replace(/^(\d{4}-\d{2}-\d{2}) (?=\d)/, '$1T');
  if (/(Z|[+-]\d{2}:?\d{2})$/i.test(value)) return new Date(value);
  return new Date(value.includes('T') ? `${value}+09:00` : `${value}T00:00:00+09:00`);
}
