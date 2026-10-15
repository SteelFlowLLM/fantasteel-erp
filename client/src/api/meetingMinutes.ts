// 회의록 api (REQ-VOC-002, BP-VOC-01). 서버를 부른다 (api/server/meetingMinutes.ts).
// 글로 붙여 넣은 전사는 바로 저장하고, 음성(녹음·파일)은 올리면 서버가 백그라운드로 글로 바꾼다 (AI 분석은 아직 없다).
import type { MeetingMinutesCreateInput, MeetingMinutesPage, MeetingMinutesStatus, MeetingMinutesView } from '@fantasteel/shared';
import { serverMeetingMinutesApi } from '@/api/server/meetingMinutes';

export type { MeetingMinutesCreateInput, MeetingMinutesListItem, MeetingMinutesPage, MeetingMinutesView, TranscriptSegment } from '@fantasteel/shared';
export { MEETING_AUDIO_MAX_BYTES, MEETING_TITLE_MAX, MEETING_TRANSCRIPT_MAX } from '@fantasteel/shared';

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
};

export const meetingMinutesAudioApi = {
  /** 올리면 바로 전사 중(TRANSCRIBING) 회의록이 돌아오고, 전사는 서버가 이어서 한다 */
  create: (input: MeetingMinutesAudioInput): Promise<MeetingMinutesView> => serverMeetingMinutesApi.createFromAudio(input),
};
