// 회의록 AI 분석 화면 계산: 정리 가능 여부, 후보 묶기, 일정 시각 글. 서버가 이미 검증한 값을 보이기만 한다.
import { MEETING_ANALYSIS_MAX_CHARS, MEETING_MINUTES_STATUS, type MeetingCandidate, type MeetingCandidateKind, type MeetingMinutesView } from '@fantasteel/shared';

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
  if (minutes.transcript.length > MEETING_ANALYSIS_MAX_CHARS) return { ok: false, reason: '회의 기록이 너무 길어 지금은 분석할 수 없어요 (4만 자 이하)' };
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
