// 내 일정 (Voice2ERP 6단계). 회의록 확정으로 등록된 일정을 참석자·등록자가 본다.
// 2026-10-16부터 사원이 자기 일정을 직접 등록·수정한다(문서에 없는 기능). 회의록에서 등록한 일정은 회의록 쪽 기록이라 고치지 않는다.

/** 직접 등록·수정하는 내 일정 (POST·PATCH /schedule-events) */
export interface ScheduleEventInput {
  scheduleEventTitle: string;
  scheduleEventDescription: string | null;
  /** ISO 8601. endAt은 startAt보다 뒤 */
  startAt: string;
  endAt: string;
}
export interface ScheduleEventAttendeeView {
  employeeId: number;
  employeeName: string;
}

export interface ScheduleEventView {
  id: number;
  scheduleEventTitle: string;
  scheduleEventDescription: string | null;
  /** ISO 8601 (UTC) */
  startAt: string;
  endAt: string;
  linkPath: string | null;
  meetingMinutes: { id: number; title: string } | null;
  attendees: ScheduleEventAttendeeView[];
  creator: { id: number; name: string };
}
