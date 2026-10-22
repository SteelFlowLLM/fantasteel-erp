// 회의록 API 응답·입력 타입 (docs/backend/meeting-minutes.md, API-258·259).
import type { PageResult } from './api';
import type { PurchaseRequisitionDraftPayload } from './action-draft';
import type { MeetingMinutesStatus, Role } from './codes';

/** 원본 전사 구간. 글로 넣은 회의록은 시간이 없어 start·end가 null이다. 배열 위치가 발언 번호다 */
export interface TranscriptSegment {
  /** 초 단위 시작·끝 */
  start: number | null;
  end: number | null;
  text: string;
  /** 화자 분리 엔진이 붙인 이름표('SPEAKER_1' …). 화자를 구분하지 못한 전사는 null */
  speaker?: string | null;
  /** 작성자가 화자를 연결한 사원. 연결하지 않았거나 '모름'이면 null */
  speakerEmployeeId?: number | null;
  speakerName?: string | null;
}

/** 화자 이름표 하나의 요약 (화자 연결 화면용). 상세 응답에 서버가 계산해 담는다 */
export interface MeetingSpeakerSummary {
  label: string;
  employeeId: number | null;
  employeeName: string | null;
  segmentCount: number;
  /** 그 화자의 처음 두 발언 */
  firstTexts: string[];
}

/** PATCH meeting-minutes/:id/speakers. 값이 null이면 '모름'. 보내지 않은 이름표는 그대로 둔다 */
export interface MeetingSpeakerMappingInput {
  mapping: Record<string, number | null>;
}

/** PUT meeting-minutes/:id/attendees (이슈 #449). 참석자 전체를 이 목록으로 바꾼다. 확정 전에만 */
export interface MeetingAttendeesUpdateInput {
  attendeeIds: number[];
}

/** AI가 추정한 화자 하나 (이슈 #406). employeeId가 null이면 근거가 없어 '모름'으로 둔 것 */
export interface MeetingSpeakerSuggestion {
  label: string;
  employeeId: number | null;
  /** 짐작한 근거 (자기소개·호칭·부서 이야기 등). 모름이면 빈 문자열일 수 있다 */
  reason: string;
}

/** POST meeting-minutes/:id/speakers/suggest. 저장하지 않는다. AI가 실패하면 suggestions가 비고 failureReason에 이유를 담는다 */
export interface MeetingSpeakerSuggestResult {
  suggestions: MeetingSpeakerSuggestion[];
  failureReason: string | null;
}

export const MEETING_TITLE_MAX = 200;
export const MEETING_TRANSCRIPT_MAX = 100000;
/** 음성 파일 한 개의 최대 크기 (녹음·파일 올리기 공통) */
export const MEETING_AUDIO_MAX_BYTES = 500 * 1024 * 1024;
/** MIME 형식이 비었거나 application/octet-stream일 때 확장자로 오디오를 알아본다 */
export const MEETING_AUDIO_EXTENSIONS = ['m4a', 'mp3', 'wav', 'webm', 'aac', 'ogg', 'mp4', 'flac'] as const;

/** 파일 이름 확장자가 허용 목록에 있는지 */
export function hasMeetingAudioExtension(fileName: string): boolean {
  const dot = fileName.lastIndexOf('.');
  if (dot < 0) return false;
  const ext = fileName.slice(dot + 1).toLowerCase();
  return (MEETING_AUDIO_EXTENSIONS as readonly string[]).includes(ext);
}

/** 화자 이름표 'SPEAKER_3' → '화자 3'. 다른 모양이면 그대로 */
export function speakerLabelText(label: string): string {
  const match = /^SPEAKER_(\d+)$/.exec(label);
  return match ? `화자 ${match[1]}` : label;
}

/** POST meeting-minutes (API-258). 글로 넣은 전사는 STT를 건너뛰고 TRANSCRIBED로 시작한다 */
export interface MeetingMinutesCreateInput {
  meetingMinutesTitle: string;
  /** YYYY-MM-DD */
  meetingDate: string;
  attendeeIds: number[];
  /** 한 줄에 한 발언 */
  transcript: string;
}

/**
 * POST meeting-minutes/audio/from-drive (이슈 #361). 회사 Google Drive 폴더의 녹음으로 만든다.
 * 음성 올리기(multipart)와 같은 칸이지만 JSON이라 attendeeIds는 숫자 배열이다.
 */
export interface MeetingMinutesFromDriveInput {
  meetingMinutesTitle: string;
  /** YYYY-MM-DD */
  meetingDate: string;
  attendeeIds: number[];
  /** 설정한 Drive 폴더 안의 녹음 파일 id (GET integrations/google-drive/files?kind=audio) */
  driveFileId: string;
}

/** 목록 한 줄 (API-259 목록) */
export interface MeetingMinutesListItem {
  id: number;
  meetingMinutesTitle: string;
  meetingDate: string;
  meetingMinutesStatus: MeetingMinutesStatus;
  attendeeCount: number;
  creatorId: number;
  creatorName: string;
  createdAt: string;
}

export interface MeetingAttendeeView {
  employeeId: number;
  employeeName: string;
  departmentName: string;
  roleCode: Role;
}

/** 상세 (API-259). 원본 전사(transcript)와 AI 요약(summary)은 따로 둔다 (BP-VOC-01) */
export interface MeetingMinutesView {
  id: number;
  meetingMinutesTitle: string;
  meetingDate: string;
  meetingMinutesStatus: MeetingMinutesStatus;
  transcript: string | null;
  transcriptSegments: TranscriptSegment[];
  /** 전사 구간에 화자 이름표가 있을 때만 값이 있다 (없으면 빈 배열). 이름표는 처음 나온 순서 */
  speakers: MeetingSpeakerSummary[];
  summary: string | null;
  /** AI 분석 결과(API-260). 서버가 검증한 후보만 담고, 읽을 수 없는 모양이면 null */
  analysisResult: MeetingAnalysis | null;
  /** AI 정리 중(ANALYZING)일 때만 값이 있다 */
  analysisProgress: MeetingAnalysisProgress | null;
  failureReason: string | null;
  creator: { id: number; name: string };
  attendees: MeetingAttendeeView[];
  confirmedAt: string | null;
  /** Notion으로 내보낸 페이지 주소 (이슈 #358). 내보내지 않았으면 null */
  notionPageUrl: string | null;
  /** Notion 내보내기 시각. notionPageUrl이 있을 때만 값이 있다 */
  notionExportedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** POST meeting-minutes/:id/notion-export (이슈 #358). 확정된 회의록만, 한 번만 내보낸다 */
export interface MeetingNotionExportResult {
  notionPageUrl: string;
  notionExportedAt: string;
  meetingMinutes: MeetingMinutesView;
}

export type MeetingMinutesPage = PageResult<MeetingMinutesListItem>;

/** AI 분석에 보낼 수 있는 전사의 최대 글자 수. 넘는 전사는 조각으로 나눠 분석한다 (🟡 가정값: 한국어 회의 약 10시간) */
export const MEETING_ANALYSIS_MAX_CHARS = 200000;

/** 분석 단계: 1차 분석(조각마다) → 조각 합치기 → 2차 검토(조각마다) */
export type MeetingAnalysisPhase = 'ANALYSIS' | 'MERGE' | 'REVIEW';

/** AI 정리 중인 회의록의 진행 상황. 긴 전사는 몇 번째 조각을 보는지 알 수 있다 */
export interface MeetingAnalysisProgress {
  phase: MeetingAnalysisPhase;
  /** 1부터 */
  current: number;
  total: number;
}

export type MeetingCandidateKind = 'TASK' | 'EVENT' | 'PURCHASE';

/** 후보 옆에 보이는 ERP 현황 한 줄. 값은 서버가 DB에서 읽어 글로 만든 것이다 (REQ-AST-009) */
export interface MeetingCandidateContextLine {
  label: string;
  value: string;
  /** warn은 사람이 눈여겨볼 점 (납기 초과·겹치는 일정·업무 쏠림 등) */
  tone: 'info' | 'warn';
}
export type MeetingCandidateDecision = 'PENDING' | 'APPROVED' | 'EXCLUDED';

/**
 * AI가 제안한 등록 후보. 모델은 제안만 하고, 사원·품목·수주 번호와 날짜는 서버가 DB·규칙으로 검증해 채운다.
 * evidence는 transcriptSegments의 0부터 시작하는 위치다.
 */
export interface MeetingCandidate {
  /** 'c1', 'c2' … 출력 순서 */
  key: string;
  kind: MeetingCandidateKind;
  title: string;
  description: string | null;
  evidence: number[];
  /** 시각·날짜를 말한 원문 (예: "다음 주 화요일 2시") */
  sourceText: string | null;
  assigneeId: number | null;
  /** 말한 담당자 이름 그대로 */
  assigneeName: string | null;
  /** TASK 마감일 YYYY-MM-DD */
  dueDate: string | null;
  /** EVENT 시작·끝: +09:00 ISO */
  startAt: string | null;
  endAt: string | null;
  endAssumed: boolean;
  attendeeIds: number[];
  /** EVENT를 Notion 업무 공간(일정 데이터베이스·캘린더)에도 넣을지 (이슈 #434). 이 칸이 없던 옛 후보는 넣는 것으로 읽는다 (notionSyncOf) */
  notionSync?: boolean;
  /** PURCHASE 구매요청 초안 값 */
  purchase: PurchaseRequisitionDraftPayload | null;
  /**
   * PURCHASE 초안의 요청자(확정 주체, 이슈 #530). 없으면 회의록 작성자. 작성자에게 구매요청 등록 권한이 없으면(예: 영업) 구매 담당 사원을 골라 넘긴다.
   * 확정하면 이 사원이 요청자인 구매요청 초안이 만들어지고, 이 사원이 초안을 확인해 구매요청으로 확정한다
   */
  purchaseRequesterId?: number | null;
  purchaseRequesterName?: string | null;
  /** 말한 품목 이름 그대로 */
  itemName: string | null;
  relatedSalesOrderNo: string | null;
  salesOrderId: number | null;
  /** 사람이 확인해야 하는 이유 */
  issues: string[];
  /** 수주·재고·업무·일정 현황. 분석할 때와 후보를 고칠 때 서버가 다시 계산한다. 옛 분석 결과에는 없어 빈 배열로 읽는다 */
  context: MeetingCandidateContextLine[];
  /** AI 2차 검토가 새로 찾은 후보 */
  fromReview?: boolean;
  decision: MeetingCandidateDecision;
  /** 확정 때 만들어진 결과. 확정 전에는 없다 */
  registered?: MeetingCandidateRegistered | null;
}

export type MeetingCandidateRegisteredType = 'task' | 'schedule_event' | 'action_draft';

/** 허가한 후보가 확정 때 만든 행 (task·schedule_event·action_draft의 id) */
export interface MeetingCandidateRegistered {
  type: MeetingCandidateRegisteredType;
  id: number;
}

export interface MeetingDecision {
  text: string;
  evidence: number[];
}

/** AI 2차 검토 결과. 실패해도 1차 결과는 그대로 남는다. 긴 전사를 나눠 검토했으면 실패한 조각 수(failedChunks)를 함께 둔다 */
export type MeetingReviewResult = { ok: true; missedCount: number; concernCount: number; failedChunks?: number } | { ok: false; error: string };

/** 서버가 모델 답에서 버리거나 고친 것 한 줄. 어느 항목인지 알 수 있게 모델이 쓴 제목을 함께 둔다 */
export interface MeetingTraceChange {
  action: 'DROPPED' | 'CHANGED';
  /** 모델이 쓴 제목. 제목이 없던 항목이면 null */
  title: string | null;
  reason: string;
}

/** MERGE는 긴 전사를 나눠 분석했을 때 조각 요약을 하나로 합치는 단계 */
export type MeetingTraceStage = MeetingAnalysisPhase;

/** AI 실행 기록의 한 단계 (1차 분석, 2차 검토). 모델이 무엇을 냈고 서버가 무엇을 걸렀는지 사람이 따라가 보게 한다 */
export interface MeetingTraceStep {
  stage: MeetingTraceStage;
  /** 긴 전사를 나눠 분석했을 때 몇 번째 조각인지 (1부터). 나누지 않았으면 없다 */
  chunk?: { index: number; total: number; firstSegment: number; lastSegment: number };
  model: string;
  durationMs: number;
  ok: boolean;
  /** 실패한 단계의 이유 */
  error: string | null;
  /** 모델이 처음 낸 답 원문. 길면 앞부분만 */
  rawAnswer: string | null;
  /** 추론 모델이 답 앞에 쓴 생각 글. 모델이 스스로 쓴 설명이라 실제 판단과 다를 수 있다 */
  thinking: string | null;
  /** 원문이나 생각 글을 잘라 저장했으면 true */
  truncated: boolean;
  changes: MeetingTraceChange[];
}

export interface MeetingAnalysisTrace {
  steps: MeetingTraceStep[];
  /** 분석 시작부터 결과 저장 직전까지 (ERP 현황 계산 포함) */
  totalMs: number;
}

export interface MeetingAnalysis {
  summary: string;
  decisions: MeetingDecision[];
  candidates: MeetingCandidate[];
  /** 2차 검토를 하지 않은 옛 분석 결과에는 없다 */
  review?: MeetingReviewResult;
  /** AI 실행 기록. 이 기능 전의 분석 결과에는 없다 */
  trace?: MeetingAnalysisTrace;
  model: string;
  analyzedAt: string;
}

/** PATCH meeting-minutes/:id/candidates/:key (API-261 확인 단계). 보낸 칸만 바꾼다. 작성자만, 검토(REVIEW) 중일 때만 */
export interface MeetingCandidateUpdateInput {
  title?: string;
  description?: string | null;
  assigneeId?: number;
  /** YYYY-MM-DD */
  dueDate?: string;
  /** +09:00 ISO 또는 `YYYY-MM-DDTHH:mm` (서울 시각) */
  startAt?: string;
  endAt?: string;
  attendeeIds?: number[];
  /** EVENT를 Notion에도 넣을지 */
  notionSync?: boolean;
  /** PURCHASE 초안의 요청자 (구매요청 등록 권한이 있는 사원). null이면 작성자로 되돌린다 */
  purchaseRequesterId?: number | null;
  purchase?: {
    itemId?: number;
    requestedTon?: string;
    desiredReceiptDate?: string;
  };
  decision?: MeetingCandidateDecision;
}

/** PATCH meeting-minutes/:id/summary */
export interface MeetingSummaryUpdateInput {
  summary: string;
}

export const MEETING_SUMMARY_MAX = 3000;

/** POST meeting-minutes/:id/register (API-261). 만들어진 행의 id를 돌려준다 */
export interface MeetingRegisterResult {
  meetingMinutes: MeetingMinutesView;
  taskIds: number[];
  scheduleEventIds: number[];
  actionDraftIds: number[];
  excludedKeys: string[];
  /** Notion에 넣기로 한 일정이 있는데 Notion 업무 공간을 지금 쓸 수 없으면 그 이유. 일정은 ERP에만 들어갔다 (이슈 #434) */
  notionNotice: string | null;
}

/** 허가하려면 채워져 있어야 하는 칸 중 비어 있는 것 (표시명). 비면 허가할 수 있다. 서버와 화면이 같은 규칙을 쓴다 */
export function missingFieldsOf(c: Pick<MeetingCandidate, 'kind' | 'title' | 'assigneeId' | 'dueDate' | 'startAt' | 'endAt' | 'attendeeIds' | 'purchase'>): string[] {
  const missing: string[] = [];
  if (c.title.trim() === '') missing.push('제목');
  if (c.kind === 'TASK') {
    if (c.assigneeId === null) missing.push('담당자');
    if (c.dueDate === null) missing.push('마감일');
  } else if (c.kind === 'EVENT') {
    if (c.startAt === null) missing.push('시작 시각');
    if (c.endAt === null || (c.startAt !== null && c.endAt <= c.startAt)) missing.push('끝 시각');
    if (c.attendeeIds.length === 0) missing.push('참석자');
  } else {
    if (c.purchase?.itemId == null) missing.push('원료 품목');
    if (c.purchase?.requestedTon == null) missing.push('수량(톤)');
    if (c.purchase?.desiredReceiptDate == null) missing.push('희망 입고일');
  }
  return missing;
}

/** 일정 후보·카드를 Notion에도 넣을지. 정하지 않았으면 넣는다 (Notion 업무 공간이 준비돼 있을 때의 기본값, 이슈 #434) */
export function notionSyncOf(c: Pick<MeetingCandidate, 'notionSync'>): boolean {
  return c.notionSync ?? true;
}

/** 회의록 목록 검색어의 최대 글자 수. 서버 DTO와 화면이 같은 값을 쓴다 (이슈 #476, 넘으면 서버가 400이라 목록이 통째로 비었다) */
export const MEETING_KEYWORD_MAX = 100;
