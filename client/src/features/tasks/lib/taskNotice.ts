// 업무 지정 알림 문구 (NOTIFICATION_TYPE 🟡 TASK_ASSIGNED 업무 지정). api/tasks.ts와 협업 시드가 함께 쓴다.

/** ERD notification.title varchar(200) */
export const NOTIFICATION_TITLE_MAX = 200;

const TASK_ASSIGNED_TITLE_PREFIX = '업무 지정 · ';

export interface TaskNotice {
  title: string;
  body: string;
  linkPath: string;
}

/** 앞말 + 내용을 max자 안에 맞춘다. 넘치면 내용 끝을 잘라 '…'로 줄인다. */
export function fitTitle(prefix: string, text: string, max: number = NOTIFICATION_TITLE_MAX): string {
  const full = `${prefix}${text}`;
  if (full.length <= max) return full;
  return `${prefix}${text.slice(0, Math.max(0, max - prefix.length - 1))}…`;
}

export function taskAssignedNotice(task: { id: number; title: string; dueDate: string | null }, creatorName: string): TaskNotice {
  return {
    title: fitTitle(TASK_ASSIGNED_TITLE_PREFIX, task.title),
    body: `${creatorName}님이 업무를 맡겼어요${task.dueDate ? ` · 마감 ${task.dueDate}` : ''}`,
    linkPath: `/tasks?tab=tasks&task=${task.id}`,
  };
}
