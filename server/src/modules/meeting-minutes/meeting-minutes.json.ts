import type { MeetingAnalysis, MeetingCandidate, TranscriptSegment } from '@fantasteel/shared';
import type { Prisma } from '../../generated/prisma/client';

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNumbers = (v: unknown): v is number[] => Array.isArray(v) && v.every((n) => typeof n === 'number');

/** DB의 JSON을 구간 배열로 읽는다. 모양이 다르면 빈 배열 */
export function readSegments(value: Prisma.JsonValue | null): TranscriptSegment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry) || typeof entry.text !== 'string') return [];
    return [{ start: typeof entry.start === 'number' ? entry.start : null, end: typeof entry.end === 'number' ? entry.end : null, text: entry.text }];
  });
}

function isCandidate(v: unknown): v is MeetingCandidate {
  return (
    isObject(v) &&
    typeof v.key === 'string' &&
    (v.kind === 'TASK' || v.kind === 'EVENT' || v.kind === 'PURCHASE') &&
    typeof v.title === 'string' &&
    isNumbers(v.evidence) &&
    isNumbers(v.attendeeIds) &&
    Array.isArray(v.issues) &&
    (v.decision === 'PENDING' || v.decision === 'APPROVED' || v.decision === 'EXCLUDED')
  );
}

/** DB의 분석 결과 JSON을 읽는다. 서버가 쓴 값이지만 모양이 다르면 null (화면이 깨지지 않게) */
export function readAnalysis(value: Prisma.JsonValue | null): MeetingAnalysis | null {
  if (!isObject(value) || typeof value.summary !== 'string' || !Array.isArray(value.decisions) || !Array.isArray(value.candidates)) return null;
  return {
    summary: value.summary,
    decisions: value.decisions.flatMap((d) => (isObject(d) && typeof d.text === 'string' && isNumbers(d.evidence) ? [{ text: d.text, evidence: d.evidence }] : [])),
    candidates: value.candidates.flatMap((c: unknown) => (isCandidate(c) ? [c] : [])),
    model: typeof value.model === 'string' ? value.model : '',
    analyzedAt: typeof value.analyzedAt === 'string' ? value.analyzedAt : '',
  };
}
