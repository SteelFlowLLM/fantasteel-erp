import type { MeetingCandidate, MeetingReviewResult, MeetingTraceChange } from '@fantasteel/shared';
import { dropReasonOf, isObject, LIST_MAX, silentChangesOf, squash, text, titleOf, toCandidate, type AnalysisContext } from './meeting-analysis.validator';

/** 2차 검토가 찾은 후보와 지적을 1차 후보에 합친다 (REQ-AST-005·009). 모델 값은 1차와 같은 검증을 거친다 */

export const REVIEW_ISSUE = {
  found: 'AI 2차 검토에서 찾은 후보예요',
  concernPrefix: '2차 검토: ',
} as const;

const CONCERN_MAX = 120;
// 작은 모델이 "(오류 아님)"이라고 적은 채 지적 칸에 넣는 경우가 있어, 스스로 문제가 아니라고 한 지적은 버린다
const NOT_A_PROBLEM = /(오류|문제)(가|는|도)?\s*(아님|아니|없)/;
export const REVIEW_BAD_SHAPE = 'AI 2차 검토 응답 형식이 올바르지 않아요';

/** 2차 검토에서 버린 이유 (실행 기록) */
export const REVIEW_DROP = {
  concernKey: (key: string | null) => `지적한 후보 ${key ?? '(키 없음)'}가 1차 결과에 없어요`,
  concernReason: '지적에 이유가 없어요',
  notAProblem: '모델이 스스로 문제가 아니라고 적은 지적이에요',
  duplicate: '1차 후보와 종류·제목이 같아요',
  noRoom: `후보가 ${LIST_MAX}개를 넘어 더 넣지 않았어요`,
} as const;

export interface ReviewMerge {
  candidates: MeetingCandidate[];
  review: MeetingReviewResult;
  /** 서버가 버리거나 고친 것 (AI 실행 기록) */
  changes: MeetingTraceChange[];
}

/** 모델 답이 객체이고 missed·concerns 중 하나라도 배열이면 읽을 수 있는 답이다 */
export function isReadableReview(raw: unknown): raw is Record<string, unknown> {
  return isObject(raw) && (Array.isArray(raw.missed) || Array.isArray(raw.concerns));
}

/** 2차 검토의 missed 항목에서 수주번호를 모으는 쪽(collectSalesOrderNos)이 읽는 모양으로 */
export function reviewItemsOf(raw: unknown): { items: unknown[] } {
  return { items: isObject(raw) && Array.isArray(raw.missed) ? raw.missed : [] };
}

const sameCandidate = (a: Pick<MeetingCandidate, 'kind' | 'title'>, b: Pick<MeetingCandidate, 'kind' | 'title'>) => a.kind === b.kind && squash(a.title) === squash(b.title);

/**
 * 1차 후보(키 c1…)에 2차 결과를 합친다.
 * - missed: 같은 검증을 통과한 것만, 키는 c{n+1}부터. 1차와 종류·제목이 같으면 중복이라 버린다.
 * - concerns: 없는 키·빈 이유는 버리고, 있는 후보에는 확인 사유로 덧붙인다.
 */
export function mergeReview(first: MeetingCandidate[], raw: unknown, ctx: AnalysisContext): ReviewMerge {
  if (!isReadableReview(raw)) return { candidates: first, review: { ok: false, error: REVIEW_BAD_SHAPE }, changes: [] };

  const changes: MeetingTraceChange[] = [];
  const concerns = new Map<string, string[]>();
  let concernCount = 0;
  for (const c of (Array.isArray(raw.concerns) ? raw.concerns : []).slice(0, LIST_MAX)) {
    if (!isObject(c)) continue;
    const key = text(c.key, 20);
    const reason = text(c.reason, CONCERN_MAX);
    const target = key === null ? undefined : first.find((f) => f.key === key);
    const drop = (why: string) => changes.push({ action: 'DROPPED', title: target?.title ?? reason, reason: why });
    if (key === null || target === undefined) {
      drop(REVIEW_DROP.concernKey(key));
      continue;
    }
    if (reason === null || NOT_A_PROBLEM.test(reason)) {
      drop(reason === null ? REVIEW_DROP.concernReason : REVIEW_DROP.notAProblem);
      continue;
    }
    concerns.set(key, [...(concerns.get(key) ?? []), `${REVIEW_ISSUE.concernPrefix}${reason}`]);
    concernCount += 1;
  }

  const merged = first.map((c) => ({ ...c, issues: [...c.issues, ...(concerns.get(c.key) ?? [])] }));
  const room = Math.max(0, LIST_MAX - merged.length);
  let missedCount = 0;
  for (const item of (Array.isArray(raw.missed) ? raw.missed : []).slice(0, LIST_MAX)) {
    if (!isObject(item)) continue;
    const candidate = toCandidate(item, ctx);
    const dropped = candidate === null ? dropReasonOf(item, ctx) : merged.some((m) => sameCandidate(m, candidate)) ? REVIEW_DROP.duplicate : missedCount >= room ? REVIEW_DROP.noRoom : null;
    if (candidate === null || dropped !== null) {
      changes.push({ action: 'DROPPED', title: titleOf(item), reason: dropped ?? dropReasonOf(item, ctx) });
      continue;
    }
    for (const reason of silentChangesOf(item, candidate)) changes.push({ action: 'CHANGED', title: candidate.title, reason });
    merged.push({ key: `c${merged.length + 1}`, ...candidate, issues: [REVIEW_ISSUE.found, ...candidate.issues], fromReview: true });
    missedCount += 1;
  }
  return { candidates: merged, review: { ok: true, missedCount, concernCount }, changes };
}
