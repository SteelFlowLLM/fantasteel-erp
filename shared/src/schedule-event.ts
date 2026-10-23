// 내 일정 (Voice2ERP 6단계). 회의록 확정으로 등록된 일정을 참석자·등록자가 본다.
// 2026-10-16부터 사원이 자기 일정을 직접 등록·수정한다(문서에 없는 기능). 회의록에서 등록한 일정은 회의록 쪽 기록이라 고치지 않는다.

/** 직접 등록·수정하는 내 일정 (POST·PATCH /schedule-events) */
export interface ScheduleEventInput {
  scheduleEventTitle: string;
  scheduleEventDescription: string | null;
  /** ISO 8601. endAt은 startAt보다 뒤 */
  startAt: string;
  endAt: string;
  /** Notion 업무 공간에도 넣을지 (이슈 #434). 보내지 않으면 등록은 넣고, 수정은 그대로 둔다 */
  notionSync?: boolean;
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
  /** Notion 업무 공간에 넣는 일정인지 (이슈 #434) */
  notionSync: boolean;
  /** Notion 일정 데이터베이스에 만든 페이지. 아직 올라가지 않았으면 null */
  notionPageUrl: string | null;
}

/** GET /schedule-events/notion-status. 일정을 Notion에 넣을 수 있는지 (사원 누구나 본다, 이슈 #434) */
export interface ScheduleNotionStatus {
  /** Notion이 연결돼 있고 업무 공간(일정 데이터베이스)이 준비됨 */
  ready: boolean;
  /** 준비되지 않은 이유. ready면 null */
  reason: string | null;
  /** 관리자가 고른 Notion 캘린더 이름. 고르지 않았으면 null (일정 데이터베이스에만 올라간다) */
  calendarName: string | null;
}
