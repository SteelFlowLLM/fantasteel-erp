// 회의록 AI 분석 화면 계산: 정리 가능 여부, 후보 묶기, 일정 시각 글. 서버가 이미 검증한 값을 보이기만 한다.
import { PERMISSION } from '@/codes';
import { canUse, permissionNeedText, type WithPermissions } from '@/lib/permissions';
import { MEETING_ANALYSIS_MAX_CHARS, MEETING_MINUTES_STATUS, missingFieldsOf, notionSyncOf, type MeetingAnalysis, type MeetingAnalysisProgress, type MeetingAnalysisTrace, type MeetingTraceStage, type MeetingTraceStep, type MeetingCandidate, type MeetingCandidateContextLine, type MeetingCandidateKind, type MeetingMinutesView, type MeetingTranscriptionProgress } from '@fantasteel/shared';

export const CANDIDATE_KIND_LABEL: Record<MeetingCandidateKind, string> = {
  TASK: '할 일',
  EVENT: '일정',
  PURCHASE: '구매요청 초안',
};

const KIND_ORDER: MeetingCandidateKind[] = ['TASK', 'EVENT', 'PURCHASE'];

const ANALYZABLE: string[] = [MEETING_MINUTES_STATUS.TRANSCRIBED, MEETING_MINUTES_STATUS.REVIEW, MEETING_MINUTES_STATUS.FAILED];

export type AnalyzeAvailability = { ok: true } | { ok: false; reason: string | null };

/** 서버 규칙(API-260)과 같다: 작성자만, 전사가 있고, 전사 완료·검토 대기·실패 상태에서만. 사유가 null이면 안내 없이 숨긴다 */
export function analyzeAvailability(minutes: MeetingMinutesView, employeeId: number): AnalyzeAvailability {
  if (minutes.creator.id !== employeeId) return { ok: false, reason: null };
  if (!ANALYZABLE.includes(minutes.meetingMinutesStatus) || !minutes.transcript?.trim()) return { ok: false, reason: null };
  if (minutes.transcript.length > MEETING_ANALYSIS_MAX_CHARS) return { ok: false, reason: '회의 기록이 너무 길어 분석할 수 없어요 (20만 자 이하)' };
  return { ok: true };
}

export interface CandidateGroup {
  kind: MeetingCandidateKind;
  label: string;
  items: MeetingCandidate[];
}

/** 할 일 → 일정 → 구매요청 초안 순, 빈 묶음은 뺀다 */
export function groupCandidates(candidates: MeetingCandidate[]): CandidateGroup[] {
  return KIND_ORDER.map((kind) => ({ kind, label: CANDIDATE_KIND_LABEL[kind], items: candidates.filter((c) => c.kind === kind) })).filter((g) => g.items.length > 0);
}

/** '+09:00' ISO를 그대로 잘라 읽는다(브라우저 시간대와 무관): 같은 날이면 "2026-10-20 14:00 ~ 15:00" */
export function formatSchedule(startAt: string | null, endAt: string | null): string {
  if (!startAt) return '-';
  const start = `${startAt.slice(0, 10)} ${startAt.slice(11, 16)}`;
  if (!endAt) return start;
  return endAt.slice(0, 10) === startAt.slice(0, 10) ? `${start} ~ ${endAt.slice(11, 16)}` : `${start} ~ ${endAt.slice(0, 10)} ${endAt.slice(11, 16)}`;
}

/** 발언 번호 칩 글자: 화면의 번호는 1부터 센다 */
export const evidenceLabel = (index: number): string => `#${index + 1}`;

export interface DecisionCounts {
  approved: number;
  excluded: number;
  pending: number;
}

export function decisionCounts(candidates: readonly MeetingCandidate[]): DecisionCounts {
  return {
    approved: candidates.filter((c) => c.decision === 'APPROVED').length,
    excluded: candidates.filter((c) => c.decision === 'EXCLUDED').length,
    pending: candidates.filter((c) => c.decision === 'PENDING').length,
  };
}

/** 허가 버튼을 막는 이유(서버 규칙과 같다). 허가할 수 있으면 null */
export function approvalBlocker(c: MeetingCandidate): string | null {
  const missing = missingFieldsOf(c);
  return missing.length > 0 ? `${missing.join(', ')}을(를) 채워야 허가할 수 있어요` : null;
}

/** 구매요청 후보를 허가할 작성자 (요청자를 따로 정하지 않으면 구매요청 초안의 요청자가 된다) */
export interface PurchaseApprover extends WithPermissions {
  departmentId: number;
  headDepartmentIds: readonly number[];
}

/**
 * 구매요청 후보를 이 작성자가 허가할 수 없는 이유 (서버 assertPurchaseRequester와 같은 규칙). 칸을 채워도 풀리지 않아 따로 보인다.
 * 누른 뒤에야 서버가 거절(COM-002·PUR-001)하지 않게 미리 막는다 (#519). 요청자를 따로 정했으면(#530) 서버가 정할 때 그 사원을 이미 확인했다
 */
export function purchaseApprovalBlocker(c: MeetingCandidate, approver: PurchaseApprover): string | null {
  if (c.kind !== 'PURCHASE' || c.purchaseRequesterId != null) return null;
  if (!canUse(approver, PERMISSION.PURCHASE_REQUISITION_CREATE)) return `${permissionNeedText([PERMISSION.PURCHASE_REQUISITION_CREATE])}. 수정에서 요청자를 구매요청 권한이 있는 사원(예: 구매 담당 참석자)으로 고르거나 후보를 제외해 주세요`;
  if (approver.headDepartmentIds.includes(approver.departmentId)) return '부서장 본인 요청은 승인할 사람이 없어 허가할 수 없어요. 수정에서 요청자를 부서원으로 고르거나 후보를 제외해 주세요';
  return null;
}

/** 확정 확인창에 보일 줄: 종류별 허가 건수와 제목, 제외 건수 */
export function registerPreview(candidates: readonly MeetingCandidate[]): { label: string; titles: string[] }[] {
  const lines = KIND_ORDER.map((kind) => {
    const approved = candidates.filter((c) => c.kind === kind && c.decision === 'APPROVED');
    const notion = kind === 'EVENT' ? approved.filter(notionSyncOf).length : 0;
    return { label: `${CANDIDATE_KIND_LABEL[kind]} ${approved.length}건${notion > 0 ? ` (Notion 캘린더에도 ${notion}건)` : ''}`, titles: approved.map((c) => c.title) };
  });
  return lines.filter((line) => line.titles.length > 0);
}

/** 후보 옆 ERP 현황 줄. 현황을 계산하기 전의 옛 분석 결과에는 칸이 없어 빈 배열로 읽는다 */
export function contextLinesOf(c: MeetingCandidate): MeetingCandidateContextLine[] {
  const raw: unknown = c.context;
  return Array.isArray(raw) ? raw.filter((l): l is MeetingCandidateContextLine => typeof l?.label === 'string' && typeof l?.value === 'string').map((l) => ({ ...l, tone: l.tone === 'warn' ? 'warn' : 'info' })) : [];
}

/** AI 요약 머리말 밑 한 줄. 2차 검토를 하지 않은 옛 분석 결과는 null(안 보인다) */
export function reviewSummaryText(review: MeetingAnalysis['review']): string | null {
  if (!review) return null;
  if (!review.ok) return '2차 검토 실패 — 1차 결과만 보여요';
  const failed = review.failedChunks ? ` (조각 ${review.failedChunks}개는 검토 실패)` : '';
  return `2차 검토: 빠진 후보 ${review.missedCount}건 · 지적 ${review.concernCount}건${failed}`;
}

export const TRACE_STAGE_LABEL: Record<MeetingTraceStage, string> = { ANALYSIS: '1차 분석', MERGE: '조각 합치기', REVIEW: '2차 검토' };

/** 실행 기록 단계 이름 옆 조각 표시: "조각 2/5 · 발언 #210~#432". 나누지 않은 분석은 null */
export function traceChunkText(chunk: MeetingTraceStep['chunk']): string | null {
  return chunk ? `조각 ${chunk.index}/${chunk.total} · 발언 #${chunk.firstSegment}~#${chunk.lastSegment}` : null;
}

/** AI 정리 중 진행 안내. 긴 전사는 몇 번째 조각인지 보인다. 진행 칸이 없으면(옛 서버) null */
export function analysisProgressText(progress: MeetingAnalysisProgress | null | undefined): string | null {
  if (!progress) return null;
  const chunk = progress.total > 1 ? ` (조각 ${progress.current}/${progress.total})` : '';
  if (progress.phase === 'MERGE') return '조각 결과를 합치는 중';
  return progress.phase === 'ANALYSIS' ? `1차 분석 중${chunk}` : `2차 검토 중${chunk}`;
}

/** 음성 전사 중 진행 안내 (이슈 #522): "화자를 나누는 중" → "받아쓰는 중 3/7". 음성 서버가 진행을 알려 주지 않으면(whisper.cpp·OpenAI) null */
export function transcriptionProgressText(progress: MeetingTranscriptionProgress | null | undefined): string | null {
  if (!progress) return null;
  if (progress.phase === 'DIARIZE') return '화자를 나누는 중';
  return progress.total > 1 ? `받아쓰는 중 ${progress.current}/${progress.total}` : '받아쓰는 중';
}

/** 걸린 시간: 1분이 넘으면 "1분 12초", 아니면 "8.4초" */
export function formatDuration(ms: number): string {
  const seconds = Math.max(0, ms) / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}초`;
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}분 ${whole % 60}초`;
}

/** 접힌 실행 기록 머리 줄: "AI 호출 2번 · 1분 30초 · 버림 3 · 고침 1" */
export function traceSummaryText(trace: MeetingAnalysisTrace): string {
  const changes = trace.steps.flatMap((step) => step.changes);
  const dropped = changes.filter((c) => c.action === 'DROPPED').length;
  const changed = changes.length - dropped;
  return [`AI 호출 ${trace.steps.length}번`, formatDuration(trace.totalMs), ...(dropped ? [`버림 ${dropped}`] : []), ...(changed ? [`고침 ${changed}`] : [])].join(' · ');
}
