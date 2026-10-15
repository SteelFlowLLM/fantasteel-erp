// 회의록 화면 ↔ 서버 API (server/src/modules/meeting-minutes, API-258·259, docs/backend/meeting-minutes.md).
// 서버가 막는 입력(빈 제목·기록, 참석자 없음, 길이)은 미리 입력칸 오류로 보인다. 없는 참석자·날짜 형식은 서버 문구를 그대로 보인다.
import type { MeetingMinutesCreateInput, MeetingMinutesPage, MeetingMinutesView } from '@fantasteel/shared';
import { FieldErrors } from '@/api/errors';
import { serverRequest, serverUpload } from '@/api/http';
import { MEETING_AUDIO_MAX_BYTES, MEETING_LIST_PAGE_SIZE, MEETING_TITLE_MAX, MEETING_TRANSCRIPT_MAX, type MeetingMinutesAudioInput, type MeetingMinutesListQuery } from '@/api/meetingMinutes';

/** 글·음성 만들기가 같이 쓰는 칸 확인. 오류는 errors에 모은다 */
function commonFields(input: { meetingMinutesTitle: string; meetingDate: string; attendeeIds: number[] }, errors: FieldErrors) {
  const meetingMinutesTitle = input.meetingMinutesTitle.trim();
  if (!meetingMinutesTitle) errors.add('meetingMinutesTitle', '제목을 입력해 주세요');
  else if (meetingMinutesTitle.length > MEETING_TITLE_MAX) errors.add('meetingMinutesTitle', `제목은 ${MEETING_TITLE_MAX}자까지 쓸 수 있어요`);
  if (!input.meetingDate) errors.add('meetingDate', '회의일을 골라 주세요');
  const attendeeIds = [...new Set(input.attendeeIds)];
  if (attendeeIds.length === 0) errors.add('attendeeIds', '참석자를 1명 이상 골라 주세요');
  return { meetingMinutesTitle, meetingDate: input.meetingDate, attendeeIds };
}

function bodyOf(input: MeetingMinutesCreateInput): MeetingMinutesCreateInput {
  const errors = new FieldErrors();
  const common = commonFields(input, errors);
  if (!input.transcript.trim()) errors.add('transcript', '회의 기록을 입력해 주세요');
  else if (input.transcript.length > MEETING_TRANSCRIPT_MAX) errors.add('transcript', `회의 기록은 ${MEETING_TRANSCRIPT_MAX.toLocaleString('ko-KR')}자까지 넣을 수 있어요`);
  errors.throwIfAny();
  return { ...common, transcript: input.transcript };
}

function audioFormOf(input: MeetingMinutesAudioInput): FormData {
  const errors = new FieldErrors();
  const common = commonFields(input, errors);
  if (input.file.size === 0) errors.add('file', '음성이 비어 있어요');
  else if (input.file.size > MEETING_AUDIO_MAX_BYTES) errors.add('file', '음성 파일은 100MB까지 올릴 수 있어요');
  errors.throwIfAny();
  const form = new FormData();
  form.append('meetingMinutesTitle', common.meetingMinutesTitle);
  form.append('meetingDate', common.meetingDate);
  form.append('attendeeIds', JSON.stringify(common.attendeeIds));
  // 파일은 맨 뒤: multer가 글 칸을 먼저 읽게 한다
  form.append('file', input.file, input.file.name);
  return form;
}

export const serverMeetingMinutesApi = {
  list: (query: MeetingMinutesListQuery): Promise<MeetingMinutesPage> =>
    serverRequest<MeetingMinutesPage>('GET', '/meeting-minutes', {
      query: { page: query.page ?? 1, size: MEETING_LIST_PAGE_SIZE, meetingMinutesStatus: query.meetingMinutesStatus, keyword: query.keyword?.trim() || undefined },
    }),

  get: (id: number): Promise<MeetingMinutesView> => serverRequest<MeetingMinutesView>('GET', `/meeting-minutes/${id}`),

  // async: 입력 오류도 다른 서버 오류처럼 거절된 약속으로 돌려준다
  create: async (input: MeetingMinutesCreateInput): Promise<MeetingMinutesView> => serverRequest<MeetingMinutesView>('POST', '/meeting-minutes', { body: bodyOf(input) }),

  createFromAudio: async (input: MeetingMinutesAudioInput): Promise<MeetingMinutesView> => serverUpload<MeetingMinutesView>('/meeting-minutes/audio', audioFormOf(input)),
};
