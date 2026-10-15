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
  failureReason: string | null;
  creator: { id: number; name: string };
  attendees: MeetingAttendeeView[];
  confirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type MeetingMinutesPage = PageResult<MeetingMinutesListItem>;

/** AI 분석에 보낼 수 있는 전사의 최대 글자 수 (긴 회의는 나눠 분석하는 방식이 생길 때까지 거절한다) */
export const MEETING_ANALYSIS_MAX_CHARS = 40000;

export type MeetingCandidateKind = 'TASK' | 'EVENT' | 'PURCHASE';
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
  /** PURCHASE 구매요청 초안 값 */
  purchase: PurchaseRequisitionDraftPayload | null;
  /** 말한 품목 이름 그대로 */
  itemName: string | null;
  relatedSalesOrderNo: string | null;
  salesOrderId: number | null;
  /** 사람이 확인해야 하는 이유 */
  issues: string[];
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

export interface MeetingAnalysis {
  summary: string;
  decisions: MeetingDecision[];
  candidates: MeetingCandidate[];
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
}

/** 허가하려면 채워져 있어야 하는 칸 중 비어 있는 것 (표시명). 비면 허가할 수 있다. 서버와 화면이 같은 규칙을 쓴다 */
export function missingFieldsOf(c: MeetingCandidate): string[] {
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
