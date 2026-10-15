// 회의록 API 응답·입력 타입 (docs/backend/meeting-minutes.md, API-258·259).
import type { PageResult } from './api';
import type { MeetingMinutesStatus, Role } from './codes';

/** 원본 전사 구간. 글로 넣은 회의록은 시간이 없어 start·end가 null이다. 배열 위치가 발언 번호다 */
export interface TranscriptSegment {
  /** 초 단위 시작·끝 */
  start: number | null;
  end: number | null;
  text: string;
}

export const MEETING_TITLE_MAX = 200;
export const MEETING_TRANSCRIPT_MAX = 100000;

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
  summary: string | null;
  /** AI 분석 결과·검토 중 수정본. 모양은 AI 분석 단계에서 정한다 */
  analysisResult: unknown;
  failureReason: string | null;
  creator: { id: number; name: string };
  attendees: MeetingAttendeeView[];
  confirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type MeetingMinutesPage = PageResult<MeetingMinutesListItem>;
