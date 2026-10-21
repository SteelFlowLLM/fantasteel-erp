// 유형 정의가 같이 쓰는 값 읽기·검증: 저장된 payload(jsonb), LLM이 준 값, 수정 요청. 업무 규칙(어떤 칸이 필수인지 등)은 각 유형 정의에 둔다.
import type { AiExtractionStatus } from '@fantasteel/shared';
import { AppException } from '../../../common/errors/app.exception';
import { isValidDate } from '../../purchasing/purchasing.service';

/** 초안 한 장의 품목 줄 수 상한. LLM이 긴 목록을 지어내거나 화면이 너무 많은 줄을 보내지 않게 */
export const MAX_DRAFT_LINES = 20;

export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
export const textOrNull = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);
/** 저장된 id 칸: 양의 정수만 */
export const idOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null);
/** 저장된 매수 칸: 1 이상 정수만 */
export const qtyOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 1 ? v : null);
/** 저장된 날짜 칸: 실제 있는 YYYY-MM-DD만 */
export const dateOrNull = (v: unknown): string | null => (typeof v === 'string' && isValidDate(v.trim()) ? v.trim() : null);
/** 저장된 id 목록: 양의 정수만, 겹치면 하나로 */
export const idsOf = (v: unknown): number[] => (Array.isArray(v) ? [...new Set(v.map(idOrNull).filter((id): id is number => id !== null))] : []);
/** 저장된 품목 줄 목록 (객체만, 상한까지) */
export const linesOf = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter(isRecord).slice(0, MAX_DRAFT_LINES) : []);

const AI_EXTRACTION_STATUSES: readonly AiExtractionStatus[] = ['FILLED', 'NOTHING_FOUND', 'NO_MODEL', 'TIMEOUT', 'NOT_JSON', 'FAILED'];

/** 저장된 AI 추출 결과 (없거나 모르는 값이면 null) */
export const aiExtractionOf = (v: unknown): AiExtractionStatus | null => (AI_EXTRACTION_STATUSES.includes(v as AiExtractionStatus) ? (v as AiExtractionStatus) : null);

/** 모든 확장 유형 payload에 있는 원본 글·AI가 채운 칸·AI 추출 결과 */
export function draftBaseOf(raw: Record<string, unknown>): { sourceText: string | null; aiFilledFields: string[]; aiExtraction: AiExtractionStatus | null } {
  return {
    sourceText: textOrNull(raw.sourceText),
    aiFilledFields: Array.isArray(raw.aiFilledFields) ? raw.aiFilledFields.filter((f): f is string => typeof f === 'string') : [],
    aiExtraction: aiExtractionOf(raw.aiExtraction),
  };
}

// ── LLM이 준 값 ─────────────────────────────────────────

/** LLM이 준 매수(숫자나 '20', '20매', '1,200')를 1 이상 정수로. 소수·0 이하·형식 오류면 null (톤을 매수로 바꾸지 않는다) */
export function extractedQtyOf(value: unknown): number | null {
  if (typeof value === 'number') return qtyOrNull(value);
  if (typeof value !== 'string') return null;
  const text = value.trim().replace(/,/g, '').replace(/매$/, '').trim();
  return /^\d{1,9}$/.test(text) ? qtyOrNull(Number(text)) : null;
}

/** LLM이 준 날짜: 실제 있는 YYYY-MM-DD만 */
export const extractedDateOf = (value: unknown): string | null => dateOrNull(value);

/**
 * LLM이 준 이름·코드가 후보 하나와 정확히 맞을 때만 그 후보 (대소문자·앞뒤 공백 무시).
 * 맞는 것이 없거나 여럿이면 null — 미확정 칸으로 남겨 사람이 고른다 (BP-ACT-02)
 */
export function matchOne<T>(candidates: readonly T[], value: unknown, keysOf: (candidate: T) => (string | null | undefined)[]): T | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const key = value.trim().toLowerCase();
  const matches = candidates.filter((c) => keysOf(c).some((k) => typeof k === 'string' && k.trim().toLowerCase() === key));
  return matches.length === 1 ? matches[0] : null;
}

// ── 수정 요청 (PATCH action-drafts/:id) ─────────────────

/** 그 유형에 없는 칸이 오면 COM-004 */
export function rejectUnknownFields(patch: Record<string, unknown>, allowed: ReadonlySet<string>, typeLabel: string): void {
  const unknown = Object.keys(patch).filter((key) => !allowed.has(key));
  if (unknown.length > 0) throw new AppException('COM-004', `${typeLabel} 초안에 없는 칸이에요: ${unknown.join(', ')}`);
}

/** id 칸: 보내지 않으면 undefined, null이면 비움. 양의 정수가 아니면 COM-004 */
export function idPatch(value: unknown, message: string): number | null | undefined {
  if (value === undefined || value === null) return value;
  if (idOrNull(value) === null) throw new AppException('COM-004', message);
  return value as number;
}

/** 매수 칸: null·빈 값이면 비움. 1 이상 정수가 아니면 COM-004 (톤을 매수로 바꾸거나 반올림하지 않는다) */
export function qtyPatch(value: unknown, message: string): number | null {
  if (value === undefined || value === null || value === '') return null;
  const qty = qtyOrNull(value);
  if (qty === null) throw new AppException('COM-004', message);
  return qty;
}

/** 날짜 칸: null·빈 글이면 비움. 실제 있는 YYYY-MM-DD가 아니면 COM-004 */
export function datePatch(value: unknown, message: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new AppException('COM-004', message);
  const text = value.trim();
  if (!text) return null;
  if (!isValidDate(text)) throw new AppException('COM-004', message);
  return text;
}

/** 품목 줄 목록: 통째로 바꾼다. null이면 빈 목록. 객체 배열(상한 이내)이 아니면 COM-004 */
export function linesPatch(value: unknown): Record<string, unknown>[] | undefined {
  if (value === undefined) return undefined;
  if (value === null) return [];
  if (!Array.isArray(value) || !value.every(isRecord)) throw new AppException('COM-004', '품목은 줄 목록으로 보내 주세요');
  if (value.length > MAX_DRAFT_LINES) throw new AppException('COM-004', `품목은 ${MAX_DRAFT_LINES}줄까지 넣을 수 있어요`);
  return value;
}
