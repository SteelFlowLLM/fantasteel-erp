import type { MeetingAnalysis, MeetingAnalysisTrace, MeetingCandidate, MeetingCandidateContextLine, MeetingReviewResult, MeetingSpeakerSummary, MeetingTraceChange, MeetingTraceStep, TranscriptSegment } from '@fantasteel/shared';
import type { Prisma } from '../../generated/prisma/client';

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNumbers = (v: unknown): v is number[] => Array.isArray(v) && v.every((n) => typeof n === 'number');

/** DB의 JSON을 구간 배열로 읽는다. 모양이 다르면 빈 배열 */
export function readSegments(value: Prisma.JsonValue | null): TranscriptSegment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry) || typeof entry.text !== 'string') return [];
    const segment: TranscriptSegment = { start: typeof entry.start === 'number' ? entry.start : null, end: typeof entry.end === 'number' ? entry.end : null, text: entry.text };
    // 화자 칸은 화자 분리를 한 전사에만 있다: 없는 전사의 응답 모양을 그대로 둔다
    if (typeof entry.speaker === 'string') {
      segment.speaker = entry.speaker;
      segment.speakerEmployeeId = typeof entry.speakerEmployeeId === 'number' ? entry.speakerEmployeeId : null;
      segment.speakerName = typeof entry.speakerName === 'string' ? entry.speakerName : null;
    }
    return [segment];
  });
}

/** 구간의 화자 이름표를 처음 나온 순서로 모아 사원 연결·발언 수·첫 두 발언을 계산한다 */
export function summarizeSpeakers(segments: TranscriptSegment[]): MeetingSpeakerSummary[] {
  const byLabel = new Map<string, MeetingSpeakerSummary>();
  for (const s of segments) {
    if (!s.speaker) continue;
    let entry = byLabel.get(s.speaker);
    if (!entry) {
      entry = { label: s.speaker, employeeId: s.speakerEmployeeId ?? null, employeeName: s.speakerName ?? null, segmentCount: 0, firstTexts: [] };
      byLabel.set(s.speaker, entry);
    }
    entry.segmentCount += 1;
    if (entry.firstTexts.length < 2) entry.firstTexts.push(s.text);
  }
  return [...byLabel.values()];
}

function isCandidate(v: unknown): v is Omit<MeetingCandidate, 'context'> {
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

/** 현황 줄을 읽는다. 옛 분석 결과에는 칸이 없고, 모양이 다른 줄은 버린다 */
function readContext(value: unknown): MeetingCandidateContextLine[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((l: unknown) => (isObject(l) && typeof l.label === 'string' && typeof l.value === 'string' ? [{ label: l.label, value: l.value, tone: l.tone === 'warn' ? ('warn' as const) : ('info' as const) }] : []));
}

function readReview(value: unknown): MeetingReviewResult | undefined {
  if (!isObject(value)) return undefined;
  if (value.ok === true && typeof value.missedCount === 'number' && typeof value.concernCount === 'number') return { ok: true, missedCount: value.missedCount, concernCount: value.concernCount };
  if (value.ok === false) return { ok: false, error: typeof value.error === 'string' ? value.error : '' };
  return undefined;
}

const stringOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);

function readChange(v: unknown): MeetingTraceChange[] {
  if (!isObject(v) || (v.action !== 'DROPPED' && v.action !== 'CHANGED') || typeof v.reason !== 'string') return [];
  return [{ action: v.action, title: stringOrNull(v.title), reason: v.reason }];
}

function readStep(v: unknown): MeetingTraceStep[] {
  if (!isObject(v) || (v.stage !== 'ANALYSIS' && v.stage !== 'REVIEW') || typeof v.durationMs !== 'number' || typeof v.ok !== 'boolean') return [];
  return [
    {
      stage: v.stage,
      model: typeof v.model === 'string' ? v.model : '',
      durationMs: v.durationMs,
      ok: v.ok,
      error: stringOrNull(v.error),
      rawAnswer: stringOrNull(v.rawAnswer),
      thinking: stringOrNull(v.thinking),
      truncated: v.truncated === true,
      changes: Array.isArray(v.changes) ? v.changes.flatMap(readChange) : [],
    },
  ];
}

/** AI 실행 기록. 이 기능 전의 분석 결과에는 없다 */
function readTrace(value: unknown): MeetingAnalysisTrace | undefined {
  if (!isObject(value) || !Array.isArray(value.steps) || typeof value.totalMs !== 'number') return undefined;
  return { steps: value.steps.flatMap(readStep), totalMs: value.totalMs };
}

/** DB의 분석 결과 JSON을 읽는다. 서버가 쓴 값이지만 모양이 다르면 null (화면이 깨지지 않게) */
export function readAnalysis(value: Prisma.JsonValue | null): MeetingAnalysis | null {
  if (!isObject(value) || typeof value.summary !== 'string' || !Array.isArray(value.decisions) || !Array.isArray(value.candidates)) return null;
  const review = readReview(value.review);
  const trace = readTrace(value.trace);
  return {
    summary: value.summary,
    decisions: value.decisions.flatMap((d) => (isObject(d) && typeof d.text === 'string' && isNumbers(d.evidence) ? [{ text: d.text, evidence: d.evidence }] : [])),
    candidates: value.candidates.flatMap((c: unknown) => (isCandidate(c) ? [{ ...c, context: readContext((c as { context?: unknown }).context) }] : [])),
    ...(review ? { review } : {}),
    ...(trace ? { trace } : {}),
    model: typeof value.model === 'string' ? value.model : '',
    analyzedAt: typeof value.analyzedAt === 'string' ? value.analyzedAt : '',
  };
}
