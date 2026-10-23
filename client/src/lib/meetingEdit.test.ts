// 회의록 지우기·참석자 고치기 버튼 조건과 풀리는 화자 연결 수 (이슈 #449)
import { MEETING_MINUTES_STATUS, type MeetingMinutesStatus, type MeetingSpeakerSummary } from '@fantasteel/shared';
import { describe, expect, it } from 'vitest';
import { canEditMeeting, unlinkedSpeakerCount } from '@/lib/meetingEdit';

const creator = { employeeId: 5, permissions: {} };
const admin = { employeeId: 1, permissions: { ORG_MANAGE: 'USE' as const } };
const other = { employeeId: 9, permissions: { ORG_MANAGE: 'VIEW' as const } };
const minutesOf = (meetingMinutesStatus: MeetingMinutesStatus) => ({ meetingMinutesStatus, creator: { id: 5, name: '정다은' } });

describe('canEditMeeting', () => {
  it('확정 전이고 전사·정리 중이 아니면 작성자와 관리자에게만', () => {
    for (const status of [MEETING_MINUTES_STATUS.TRANSCRIBED, MEETING_MINUTES_STATUS.REVIEW, MEETING_MINUTES_STATUS.FAILED]) {
      expect(canEditMeeting(minutesOf(status), creator)).toBe(true);
      expect(canEditMeeting(minutesOf(status), admin)).toBe(true);
      expect(canEditMeeting(minutesOf(status), other)).toBe(false);
    }
  });

  it('확정·전사 중·정리 중이면 누구도 못 한다', () => {
    for (const status of [MEETING_MINUTES_STATUS.CONFIRMED, MEETING_MINUTES_STATUS.TRANSCRIBING, MEETING_MINUTES_STATUS.ANALYZING]) {
      expect(canEditMeeting(minutesOf(status), creator)).toBe(false);
      expect(canEditMeeting(minutesOf(status), admin)).toBe(false);
    }
  });
});

describe('unlinkedSpeakerCount', () => {
  const speaker = (label: string, employeeId: number | null): MeetingSpeakerSummary => ({ label, employeeId, employeeName: null, segmentCount: 1, firstTexts: [] });
  it('빠지는 참석자에게 연결한 화자만 센다 (모름은 세지 않는다)', () => {
    const speakers = [speaker('SPEAKER_1', 5), speaker('SPEAKER_2', 6), speaker('SPEAKER_3', null)];
    expect(unlinkedSpeakerCount({ speakers }, [5])).toBe(1);
    expect(unlinkedSpeakerCount({ speakers }, [5, 6])).toBe(0);
  });
});
