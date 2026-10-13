import type { Permission } from '@fantasteel/shared';
import type { LlmToolDefinition } from '../../llm/llm.client';

/**
 * 데이터 조회 도구 (REQ-AST-004). 각 모듈의 조회 service를 감싸고, 모델이 읽기 쉽게 한글 이름의 짧은 결과로 바꾼다.
 * 도구는 조회만 한다: 업무 데이터를 바꾸는 service는 부르지 않는다.
 */
export interface AssistantTool {
  definition: LlmToolDefinition;
  /** 조회에 필요한 권한(VIEW 이상). 같은 데이터를 보여 주는 API의 권한과 같게 둔다. null이면 로그인한 전 역할 */
  permission: Permission | null;
  run(args: Record<string, unknown>): Promise<ToolOutput>;
}

export interface ToolOutput {
  /** 답 아래 출처 줄에 보일 이름 (예: 재고 · SS275) */
  label: string;
  /** 모델에 JSON으로 넘길 결과 */
  data: unknown;
}

/** 모델이 넘긴 인자가 틀렸을 때. 이유를 모델에 돌려줘 다시 부르게 한다 */
export class ToolArgumentError extends Error {}

/** 한 번에 넘기는 목록 줄 수. 작은 로컬 모델의 문맥 길이를 넘지 않게 한다 */
export const TOOL_ROW_LIMIT = 15;

export function optionalString(args: Record<string, unknown>, key: string, maxLength = 60): string | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new ToolArgumentError(`${key}는 문자열이어야 해요`);
  const trimmed = value.trim();
  if (trimmed.length > maxLength) throw new ToolArgumentError(`${key}는 ${maxLength}자까지예요`);
  return trimmed || undefined;
}

export function requiredString(args: Record<string, unknown>, key: string, maxLength = 60): string {
  const value = optionalString(args, key, maxLength);
  if (value === undefined) throw new ToolArgumentError(`${key}가 필요해요`);
  return value;
}

export function optionalPositiveInt(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key];
  if (value === undefined || value === null || value === '') return undefined;
  const number = typeof value === 'string' ? Number(value) : value;
  if (typeof number !== 'number' || !Number.isInteger(number) || number < 1) throw new ToolArgumentError(`${key}는 1 이상의 정수여야 해요`);
  return number;
}

export function optionalBoolean(args: Record<string, unknown>, key: string): boolean | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === 'false') return value === 'true';
  throw new ToolArgumentError(`${key}는 true 또는 false여야 해요`);
}

export function optionalEnum<T extends string>(args: Record<string, unknown>, key: string, values: readonly T[]): T | undefined {
  const value = args[key];
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !values.includes(value as T)) throw new ToolArgumentError(`${key}는 ${values.join(', ')} 중 하나예요`);
  return value as T;
}

export function optionalDate(args: Record<string, unknown>, key: string): string | undefined {
  const value = optionalString(args, key, 10);
  if (value === undefined) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ToolArgumentError(`${key}는 YYYY-MM-DD 형식이에요`);
  return value;
}

/** 띄어쓰기·대소문자를 무시한 부분 일치 */
export function looseIncludes(haystack: (string | null | undefined)[], needle: string): boolean {
  const n = needle.toLowerCase().replace(/\s+/g, '');
  return haystack.some((h) => h?.toLowerCase().replace(/\s+/g, '').includes(n));
}

/** 0~1 비율을 '50%'로. 분모가 0이면 null */
export function percentText(ratio: number | null): string | null {
  return ratio === null ? null : `${Math.round(ratio * 100)}%`;
}

/** 목록을 상한까지 자르고 잘린 줄 수를 함께 준다 */
export function limitRows<T>(rows: readonly T[], limit = TOOL_ROW_LIMIT): { rows: T[]; omitted: number } {
  return { rows: rows.slice(0, limit), omitted: Math.max(0, rows.length - limit) };
}

const SEOUL = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

/** ISO 시각 → 서울 'YYYY-MM-DD HH:mm' */
export function seoulDateTimeText(iso: string): string {
  return SEOUL.format(new Date(iso));
}

/** 오늘(서울 'YYYY-MM-DD')부터 날짜까지 남은 일수. 지났으면 음수 */
export function daysUntil(date: string, today: string): number {
  return Math.round((Date.parse(`${date.slice(0, 10)}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}
