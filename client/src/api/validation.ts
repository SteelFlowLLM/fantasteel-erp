// 가짜 API의 입력 확인 도우미. 실제 서버의 DTO 검증(class-validator)과 서비스의 참조·버전 확인을 흉내 낸다 (컨벤션 5장·7-2).
// - 참조 대상이 없으면 COM-003 (컨벤션 7-2 "요청으로 받은 ID는 반드시 조회해서 확인")
// - 화면을 연 뒤 다른 곳(다른 탭)에서 바뀌었으면 COM-001 (검토 이후 데이터 변경)
// - 그 밖의 입력 오류는 InputError(입력칸별 안내)
import { ApiError, type FieldErrors } from '@/api/client';
import { withEulReul, withEunNeun, withIGa } from '@/lib/josa';
import { compareDecimal } from '@/lib/weight';
import type { MockTables, RowOf, TableName } from '@/mock/schema';

/** 요청으로 받은 id의 행을 찾는다. 없으면 COM-003. */
export function requireRow<K extends TableName>(tables: Readonly<MockTables>, table: K, id: number | null | undefined, what?: string): RowOf<K> {
  const row = id === null || id === undefined ? undefined : (tables[table] as RowOf<K>[]).find((r) => r.id === id);
  if (!row) throw new ApiError('COM-003', what ?? null);
  return row;
}

/** 화면이 본 수정 시각과 지금 수정 시각이 다르면 COM-001 */
export function assertUnchanged(currentUpdatedAt: string, expectedUpdatedAt: string | null | undefined, what?: string): void {
  if (expectedUpdatedAt && expectedUpdatedAt !== currentUpdatedAt) {
    throw new ApiError('COM-001', what ? `${withIGa(what)} 다른 곳에서 먼저 바뀌었어요. 새로 불러온 내용을 확인하고 다시 저장해 주세요` : null);
  }
}

/** 앞뒤 공백을 뺀 필수 글자. 비었거나 너무 길면 입력칸 오류를 남기고 null. */
export function requiredText(errors: FieldErrors, field: string, value: string | null | undefined, label: string, maxLength: number): string | null {
  const text = (value ?? '').trim();
  if (!text) {
    errors.add(field, `${withEulReul(label)} 입력해 주세요`);
    return null;
  }
  if (text.length > maxLength) {
    errors.add(field, `${withEunNeun(label)} ${maxLength}자까지 입력할 수 있어요`);
    return null;
  }
  return text;
}

/** 선택 글자. 비면 null, 너무 길면 입력칸 오류. */
export function optionalText(errors: FieldErrors, field: string, value: string | null | undefined, label: string, maxLength: number): string | null {
  const text = (value ?? '').trim();
  if (!text) return null;
  if (text.length > maxLength) {
    errors.add(field, `${withEunNeun(label)} ${maxLength}자까지 입력할 수 있어요`);
    return null;
  }
  return text;
}

export interface DecimalRule {
  label: string;
  /** 소수 자리수 (ERD decimal(p, s)의 s) */
  scale: number;
  /** 정수 자리수 (ERD decimal(p, s)의 p − s) */
  integerDigits: number;
  /** 0보다 커야 한다 */
  positive?: boolean;
  /** 음수를 허용한다 (허용차처럼 차이를 적는 값) */
  allowNegative?: boolean;
  /** 이 값 이하 */
  max?: string;
}

const DECIMAL_TEXT = /^([+-])?(\d+)(?:\.(\d+))?$/;

/** 십진수 글자를 확인한다. 비었으면 null(필수 확인은 부르는 쪽에서). 형식이 틀리면 입력칸 오류를 남기고 undefined. */
export function decimalText(errors: FieldErrors, field: string, value: string | null | undefined, rule: DecimalRule): string | null | undefined {
  const text = (value ?? '').trim().replace(/,/g, '');
  if (!text) return null;
  const match = DECIMAL_TEXT.exec(text);
  if (!match) {
    errors.add(field, `${withEunNeun(rule.label)} 숫자로 입력해 주세요`);
    return undefined;
  }
  const [, sign = '', integerPart = '', fraction = ''] = match;
  if (sign === '-' && !rule.allowNegative) {
    errors.add(field, `${withEunNeun(rule.label)} 0 이상으로 입력해 주세요`);
    return undefined;
  }
  if (fraction.length > rule.scale) {
    errors.add(field, rule.scale === 0 ? `${withEunNeun(rule.label)} 정수로 입력해 주세요` : `${withEunNeun(rule.label)} 소수 ${rule.scale}자리까지 입력할 수 있어요`);
    return undefined;
  }
  if (integerPart.replace(/^0+(?=\d)/, '').length > rule.integerDigits) {
    errors.add(field, `${withIGa(rule.label)} 너무 커요`);
    return undefined;
  }
  const normalized = `${sign === '-' ? '-' : ''}${integerPart.replace(/^0+(?=\d)/, '')}${fraction ? `.${fraction}` : ''}`;
  if (rule.positive && compareDecimal(normalized, '0') <= 0) {
    errors.add(field, `${withEunNeun(rule.label)} 0보다 커야 해요`);
    return undefined;
  }
  if (rule.max !== undefined && compareDecimal(normalized, rule.max) > 0) {
    errors.add(field, `${withEunNeun(rule.label)} ${rule.max} 이하로 입력해 주세요`);
    return undefined;
  }
  return normalized;
}

/** 0 이상의 정수 (정렬 순서·일수). 형식이 틀리면 입력칸 오류를 남기고 null. */
export function nonNegativeInteger(errors: FieldErrors, field: string, value: number | string | null | undefined, label: string): number | null {
  const number = typeof value === 'number' ? value : Number(String(value ?? '').trim());
  if (value === null || value === undefined || String(value).trim() === '' || !Number.isInteger(number) || number < 0) {
    errors.add(field, `${withEunNeun(label)} 0 이상의 정수로 입력해 주세요`);
    return null;
  }
  if (number > 2_147_483_647) {
    errors.add(field, `${withIGa(label)} 너무 커요`);
    return null;
  }
  return number;
}

/** 'YYYY-MM-DD' 날짜. 비면 null, 틀리면 입력칸 오류를 남기고 undefined. */
export function optionalDate(errors: FieldErrors, field: string, value: string | null | undefined, label: string): string | null | undefined {
  const text = (value ?? '').trim();
  if (!text) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  const valid = match && (() => {
    const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  })();
  if (!valid) {
    errors.add(field, `${withEunNeun(label)} YYYY-MM-DD 형식의 날짜로 입력해 주세요`);
    return undefined;
  }
  return text;
}
