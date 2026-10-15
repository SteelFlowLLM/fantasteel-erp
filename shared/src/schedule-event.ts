// 내 일정 (Voice2ERP 6단계). 회의록 확정으로 등록된 일정을 참석자·등록자가 본다.
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
