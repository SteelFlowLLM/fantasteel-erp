// 작업 로그의 변경 전·후(before_data · after_data)를 "항목 → 값" 줄로 펴서 비교한다 (REQ-LOG-001).
import { fmtDateTime } from '@/lib/format';
import type { JsonValue } from '@/mock/schema';

export interface DiffRow {
  /** 점으로 이은 경로 (예: inventory.onHandQty) */
  key: string;
  before: string | undefined;
  after: string | undefined;
  changed: boolean;
}

const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

const isPlainObject = (value: JsonValue): value is { [key: string]: JsonValue } =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isScalar = (value: JsonValue) => value === null || typeof value !== 'object';

export function formatDiffValue(value: JsonValue): string {
  if (value === null) return '-';
  if (typeof value === 'boolean') return value ? '예' : '아니오';
  if (typeof value === 'number') return value.toLocaleString('en-US', { maximumFractionDigits: 6 });
  if (typeof value === 'string') return value === '' ? '(빈 값)' : ISO_DATE_TIME.test(value) ? fmtDateTime(value) : value;
  if (Array.isArray(value)) {
    if (value.length === 0) return '(없음)';
    return value.every(isScalar) ? value.map(formatDiffValue).join(', ') : JSON.stringify(value);
  }
  return JSON.stringify(value);
}

/** JSON을 경로 → 값 표로 편다. 배열은 한 칸에 이어 쓴다. */
export function flattenJson(value: JsonValue, prefix = '', out: Map<string, string> = new Map()): Map<string, string> {
  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    if (keys.length === 0 && prefix) out.set(prefix, '{}');
    for (const key of keys) flattenJson(value[key] ?? null, prefix ? `${prefix}.${key}` : key, out);
    return out;
  }
  out.set(prefix || '값', formatDiffValue(value));
  return out;
}

/** 변경 전·후 비교 줄. 둘 다 없으면 빈 배열. 키 순서는 변경 전 → 변경 후에 처음 나온 순서. */
export function diffRows(before: JsonValue | null, after: JsonValue | null): DiffRow[] {
  const b = before === null ? null : flattenJson(before);
  const a = after === null ? null : flattenJson(after);
  if (!b && !a) return [];
  const keys = [...new Set([...(b?.keys() ?? []), ...(a?.keys() ?? [])])];
  return keys.map((key) => {
    const beforeValue = b?.get(key);
    const afterValue = a?.get(key);
    return { key, before: beforeValue, after: afterValue, changed: beforeValue !== afterValue };
  });
}
