// 업무 마감 표시와 정렬, 연결 화면 경로 확인 (REQ-NTF-001). 화면과 api가 함께 쓰는 순수 함수.
import type { TaskStatus } from '@/codes';
import { fmtMD, fmtMDHM } from '@/lib/format';

export type TaskDueState = 'done' | 'overdue' | 'today' | 'upcoming' | 'none';

export interface TaskDueInput {
  taskStatus: TaskStatus;
  dueDate: string | null;
  completedAt?: string | null;
}

/** 두 날짜(YYYY-MM-DD) 사이의 일수. to가 뒤면 양수. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** 완료 · 마감 지남 · 오늘 마감 · 마감 전 · 마감 없음 */
export function taskDueStateOf(task: TaskDueInput, today: string): TaskDueState {
  if (task.taskStatus === 'DONE') return 'done';
  if (!task.dueDate) return 'none';
  const days = daysBetween(today, task.dueDate);
  if (days < 0) return 'overdue';
  return days === 0 ? 'today' : 'upcoming';
}

/** 카드 오른쪽 날짜 문구: 완료 10-01 14:05 · 09-29 마감 지남 (D+2) · 오늘 마감 · 마감 10-03 (D-2) · 마감 없음 */
export function taskDueText(task: TaskDueInput, today: string): string {
  const state = taskDueStateOf(task, today);
  switch (state) {
    case 'done':
      return task.completedAt ? `완료 ${fmtMDHM(task.completedAt)}` : '완료';
    case 'none':
      return '마감 없음';
    case 'today':
      return '오늘 마감';
    case 'overdue':
      return `${fmtMD(task.dueDate)} 마감 지남 (D+${daysBetween(task.dueDate ?? today, today)})`;
    case 'upcoming':
      return `마감 ${fmtMD(task.dueDate)} (D-${daysBetween(today, task.dueDate ?? today)})`;
  }
}

/** 마감일 빠른 순 → 마감 없음은 뒤 → 먼저 만든 순 */
export function compareTasksByDue(a: { dueDate: string | null; id: number }, b: { dueDate: string | null; id: number }): number {
  if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
  if (a.dueDate && !b.dueDate) return -1;
  if (!a.dueDate && b.dueDate) return 1;
  return a.id - b.id;
}

/** 연결 화면 경로 최대 길이 (ERD task.link_path · notification.link_path varchar(300)) */
export const LINK_PATH_MAX_LENGTH = 300;

/** 이 앱 안의 화면 경로인지: '/'로 시작하고('//' 외부 주소 제외) 공백이 없다 */
export function isScreenPath(path: string): boolean {
  return path.startsWith('/') && !path.startsWith('//') && !/\s/.test(path) && path.length <= LINK_PATH_MAX_LENGTH;
}

export const LINK_PATH_ERROR = '"/"로 시작하는 화면 경로만 넣을 수 있어요 (예: /goods-receipts)';
