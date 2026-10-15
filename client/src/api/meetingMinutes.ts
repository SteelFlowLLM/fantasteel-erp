// 회의록 api (REQ-VOC-002, BP-VOC-01). 서버를 부른다 (api/server/meetingMinutes.ts).
// 이 단계는 글로 붙여 넣은 전사만 저장한다: 음성 입력(STT)과 AI 분석은 아직 없다.
import type { MeetingMinutesCreateInput, MeetingMinutesPage, MeetingMinutesStatus, MeetingMinutesView } from '@fantasteel/shared';
import { serverMeetingMinutesApi } from '@/api/server/meetingMinutes';

export type { MeetingMinutesCreateInput, MeetingMinutesListItem, MeetingMinutesPage, MeetingMinutesView, TranscriptSegment } from '@fantasteel/shared';
export { MEETING_TITLE_MAX, MEETING_TRANSCRIPT_MAX } from '@fantasteel/shared';

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
