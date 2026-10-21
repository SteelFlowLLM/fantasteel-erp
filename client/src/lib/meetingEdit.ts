// 회의록 지우기·참석자 고치기 (이슈 #449). 서버(meeting-minutes.service loadForEdit)와 같은 조건으로 버튼을 보인다.
import { MEETING_MINUTES_STATUS, PERMISSION, type MeetingMinutesView } from '@fantasteel/shared';
import { canUse, type PermissionMap } from '@/lib/permissions';

/** 확정 전이고 전사·AI 정리 중이 아닌 회의록을 작성자나 관리자(ORG_MANAGE 사용)가 */
export function canEditMeeting(minutes: Pick<MeetingMinutesView, 'meetingMinutesStatus' | 'creator'>, user: { employeeId: number; permissions: PermissionMap }): boolean {
  const status = minutes.meetingMinutesStatus;
  const open = status === MEETING_MINUTES_STATUS.TRANSCRIBED || status === MEETING_MINUTES_STATUS.REVIEW || status === MEETING_MINUTES_STATUS.FAILED;
  return open && (minutes.creator.id === user.employeeId || canUse(user, PERMISSION.ORG_MANAGE));
}

/** 참석자를 빼면 풀리는 화자 연결 수 (확인 문구용) */
export function unlinkedSpeakerCount(minutes: Pick<MeetingMinutesView, 'speakers'>, attendeeIds: readonly number[]): number {
  return minutes.speakers.filter((s) => s.employeeId !== null && !attendeeIds.includes(s.employeeId)).length;
}
