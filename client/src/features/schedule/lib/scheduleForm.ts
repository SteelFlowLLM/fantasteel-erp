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
  /** Notion 업무 공간에도 넣을지 (이슈 #434). 새 일정은 넣는다 */
  notionSync: boolean;
}

export const TITLE_MAX = 100;
export const DESCRIPTION_MAX = 1000;

/** 서울 날짜·시각 → ISO (UTC) */
export function seoulIso(date: string, time: string): string {
  return new Date(`${date}T${time}:00+09:00`).toISOString();
}

/** 새 일정: 고른 날 09:00~10:00 */
export function emptyForm(date: string): ScheduleForm {
  return { title: '', description: '', date, start: '09:00', end: '10:00', notionSync: true };
}

/** 고칠 일정 → 입력값. 직접 등록한 일정은 하루 안에 시작·끝이 있다 */
export function formOf(event: ScheduleEventView): ScheduleForm {
  return { title: event.scheduleEventTitle, description: event.scheduleEventDescription ?? '', date: seoulDayOf(event.startAt), start: fmtHM(event.startAt), end: fmtHM(event.endAt), notionSync: event.notionSync };
}

// ── 시각 고르기: 30분 단위 목록 (브라우저 기본 시계 입력은 칸이 좁으면 '오전 09:0'처럼 잘리고 고르기 불편하다) ──

export const TIME_STEP_MINUTES = 30;
/** 하루 끝. 23:30에 시작하는 일정도 끝을 고를 수 있게 끝 목록 맨 뒤에 둔다 */
export const DAY_END = '23:59';

const minutesOf = (time: string): number => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const timeOf = (minutes: number): string => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** 00:00부터 23:30까지 30분 단위. 고칠 일정의 시각이 30분 단위가 아니면 그 시각도 넣는다 */
export function startOptions(current?: string): string[] {
  const list = Array.from({ length: (24 * 60) / TIME_STEP_MINUTES }, (_, i) => timeOf(i * TIME_STEP_MINUTES));
  return current && !list.includes(current) ? [...list, current].sort() : list;
}

/** 끝 목록: 시작 뒤의 시각만, 맨 뒤에 하루 끝(23:59) */
export function endOptions(start: string, current?: string): string[] {
  const list = [...startOptions(current), DAY_END].filter((time, i, all) => time > start && all.indexOf(time) === i);
  return list.sort();
}

/** 시작을 바꾸면 끝도 원래 길이만큼 함께 옮긴다 (길이를 모르면 1시간). 하루를 넘으면 23:59 */
export function shiftEnd(prevStart: string, prevEnd: string, nextStart: string): string {
  const length = minutesOf(prevEnd) - minutesOf(prevStart);
  const end = minutesOf(nextStart) + (length > 0 ? length : 60);
  return end >= 24 * 60 ? DAY_END : timeOf(end);
}

/** 저장을 막는 이유. 없으면 null */
export function formProblem(form: ScheduleForm): string | null {
  if (!form.title.trim()) return '제목을 입력해 주세요';
  if (!form.date || !form.start || !form.end) return '날짜와 시각을 입력해 주세요';
  if (form.end <= form.start) return '끝나는 시각은 시작 시각보다 뒤여야 해요';
  return null;
}

export function inputOf(form: ScheduleForm): ScheduleEventInput {
  return { scheduleEventTitle: form.title.trim(), scheduleEventDescription: form.description.trim() || null, startAt: seoulIso(form.date, form.start), endAt: seoulIso(form.date, form.end), notionSync: form.notionSync };
}

/** 내가 직접 등록한 일정만 고친다 (회의록에서 등록한 일정은 회의록 쪽 기록) */
export function canEditEvent(event: ScheduleEventView, employeeId: number): boolean {
  return event.creator.id === employeeId && event.meetingMinutes === null;
}

/** 회의록에서 등록한 일정은 내용은 못 고치지만, 등록자는 Notion에 넣을지 바꿀 수 있다 (이슈 #434) */
export function canToggleNotion(event: ScheduleEventView, employeeId: number): boolean {
  return event.creator.id === employeeId && event.meetingMinutes !== null;
}

/** 넣지 않기로 바꿨는데 Notion 페이지가 아직 남아 있으면: 다음 반영 때 치운다 */
export function notionRemovalPending(event: Pick<ScheduleEventView, 'notionSync' | 'notionPageUrl'>): boolean {
  return !event.notionSync && event.notionPageUrl !== null;
}
