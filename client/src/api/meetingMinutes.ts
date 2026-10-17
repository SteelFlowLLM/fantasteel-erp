// 회의록 api (REQ-VOC-002, BP-VOC-01). 서버를 부른다 (api/server/meetingMinutes.ts).
// 글로 붙여 넣은 전사는 바로 저장하고, 음성(녹음·파일)은 올리면 서버가 백그라운드로 글로 바꾼다.
// 작성자가 AI 정리를 시키면 서버가 요약·결정사항·등록 후보를 만든다 (API-260). 후보는 서버가 검증한 값이고, 작성자가 후보마다 허가·제외한 뒤 확정하면 등록된다 (API-261).
import type { MeetingMinutesFromDriveInput, MeetingNotionExportResult, MeetingCandidateUpdateInput, MeetingSpeakerMappingInput, MeetingMinutesCreateInput, MeetingMinutesPage, MeetingMinutesStatus, MeetingMinutesView, MeetingRegisterResult } from '@fantasteel/shared';
import { serverMeetingMinutesApi } from '@/api/server/meetingMinutes';

export type { MeetingAnalysis, MeetingCandidate, MeetingCandidateDecision, MeetingCandidateKind, MeetingCandidateUpdateInput, MeetingRegisterResult, MeetingDecision, MeetingMinutesCreateInput, MeetingMinutesListItem, MeetingMinutesPage, MeetingMinutesView, MeetingSpeakerMappingInput, MeetingSpeakerSummary, TranscriptSegment } from '@fantasteel/shared';
export { MEETING_ANALYSIS_MAX_CHARS, MEETING_AUDIO_MAX_BYTES, MEETING_SUMMARY_MAX, MEETING_TITLE_MAX, MEETING_TRANSCRIPT_MAX } from '@fantasteel/shared';

/** 음성으로 만들기. file은 녹음(Blob을 File로 감싼 것)이거나 고른 파일 */
export interface MeetingMinutesAudioInput {
  meetingMinutesTitle: string;
  meetingDate: string;
  attendeeIds: number[];
  file: File;
}

export interface MeetingMinutesListQuery {
  meetingMinutesStatus?: MeetingMinutesStatus;
  keyword?: string;
  page?: number;
}

export const MEETING_LIST_PAGE_SIZE = 20;

export const meetingMinutesKeys = {
  all: ['meeting-minutes'] as const,
  list: (employeeId: number, query: MeetingMinutesListQuery) => ['meeting-minutes', 'list', employeeId, query] as const,
  detail: (employeeId: number, id: number) => ['meeting-minutes', 'detail', employeeId, id] as const,
};

export const meetingMinutesApi = {
  list: (query: MeetingMinutesListQuery): Promise<MeetingMinutesPage> => serverMeetingMinutesApi.list(query),

  get: (id: number): Promise<MeetingMinutesView> => serverMeetingMinutesApi.get(id),

  /** 글로 붙여 넣은 전사로 만든다. 서버가 전사 완료 상태로 시작한다 */
  create: (input: MeetingMinutesCreateInput): Promise<MeetingMinutesView> => serverMeetingMinutesApi.create(input),

  /** AI로 정리하기(다시 정리 포함). 작성자만 할 수 있고, 돌아온 회의록은 분석 중(ANALYZING)이다 */
  analyze: (id: number): Promise<MeetingMinutesView> => serverMeetingMinutesApi.analyze(id),

  /** 작성자가 후보를 고치고 허가·제외한다 (검토 대기 중에만) */
  updateCandidate: (id: number, key: string, input: MeetingCandidateUpdateInput): Promise<MeetingMinutesView> => serverMeetingMinutesApi.updateCandidate(id, key, input),

  updateSummary: (id: number, summary: string): Promise<MeetingMinutesView> => serverMeetingMinutesApi.updateSummary(id, summary),

  /** 화자 이름표를 참석자에게 연결한다 (AI 정리 전에). 값이 null이면 '모름' */
  updateSpeakers: (id: number, input: MeetingSpeakerMappingInput): Promise<MeetingMinutesView> => serverMeetingMinutesApi.updateSpeakers(id, input),

  /** 허가한 후보를 등록하고 회의록을 확정한다. 남은 후보가 있으면 서버가 거절한다 */
  register: (id: number): Promise<MeetingRegisterResult> => serverMeetingMinutesApi.register(id),

  /** 확정된 회의록을 Notion 페이지로 내보낸다 (이슈 #358). 작성자 또는 ORG_MANAGE 사용, 한 번만 */
  exportToNotion: (id: number): Promise<MeetingNotionExportResult> => serverMeetingMinutesApi.exportToNotion(id),
};

export const meetingMinutesAudioApi = {
  /** 올리면 바로 전사 중(TRANSCRIBING) 회의록이 돌아오고, 전사는 서버가 이어서 한다 */
  create: (input: MeetingMinutesAudioInput): Promise<MeetingMinutesView> => serverMeetingMinutesApi.createFromAudio(input),
};

export const meetingMinutesDriveApi = {
  /** 이슈 #361. 회사 Google Drive 폴더의 녹음으로 만든다. 음성 올리기처럼 전사 중(TRANSCRIBING) 회의록이 바로 돌아온다 */
  create: (input: MeetingMinutesFromDriveInput): Promise<MeetingMinutesView> => serverMeetingMinutesApi.createFromDrive(input),
};
