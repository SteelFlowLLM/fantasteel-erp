// 내 일정 직접 등록·수정 창의 입력 규칙 (2026-10-16, 문서에 없는 기능). 시각은 Asia/Seoul로 입력받아 ISO로 보낸다.
import type { ScheduleEventInput, ScheduleEventView } from '@fantasteel/shared';
import { seoulDayOf } from '@/features/schedule/lib/week';
import { fmtHM } from '@/lib/format';

export interface ScheduleForm {
  title: string;
  description: string;
  /** YYYY-MM-DD (서울) */
  date: string;
  /** HH:mm (서울) */
  start: string;
  end: string;
}

export const TITLE_MAX = 100;
export const DESCRIPTION_MAX = 1000;

/** 서울 날짜·시각 → ISO (UTC) */
export function seoulIso(date: string, time: string): string {
  return new Date(`${date}T${time}:00+09:00`).toISOString();
}

/** 새 일정: 고른 날 09:00~10:00 */
export function emptyForm(date: string): ScheduleForm {
  return { title: '', description: '', date, start: '09:00', end: '10:00' };
}

/** 고칠 일정 → 입력값. 직접 등록한 일정은 하루 안에 시작·끝이 있다 */
export function formOf(event: ScheduleEventView): ScheduleForm {
  return { title: event.scheduleEventTitle, description: event.scheduleEventDescription ?? '', date: seoulDayOf(event.startAt), start: fmtHM(event.startAt), end: fmtHM(event.endAt) };
}

/** 저장을 막는 이유. 없으면 null */
export function formProblem(form: ScheduleForm): string | null {
  if (!form.title.trim()) return '제목을 입력해 주세요';
  if (!form.date || !form.start || !form.end) return '날짜와 시각을 입력해 주세요';
  if (form.end <= form.start) return '끝나는 시각은 시작 시각보다 뒤여야 해요';
  return null;
}

export function inputOf(form: ScheduleForm): ScheduleEventInput {
  return { scheduleEventTitle: form.title.trim(), scheduleEventDescription: form.description.trim() || null, startAt: seoulIso(form.date, form.start), endAt: seoulIso(form.date, form.end) };
}

/** 내가 직접 등록한 일정만 고친다 (회의록에서 등록한 일정은 회의록 쪽 기록) */
export function canEditEvent(event: ScheduleEventView, employeeId: number): boolean {
  return event.creator.id === employeeId && event.meetingMinutes === null;
}
