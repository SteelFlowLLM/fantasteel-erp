// 업무 지정 알림 문구 (NOTIFICATION_TYPE 🟡 TASK_ASSIGNED 업무 지정). api/tasks.ts와 협업 시드가 함께 쓴다.

export interface TaskNotice {
  title: string;
  body: string;
  linkPath: string;
}

export function taskAssignedNotice(task: { id: number; title: string; dueDate: string | null }, creatorName: string): TaskNotice {
  return {
    title: `업무 지정 · ${task.title}`,
    body: `${creatorName}님이 업무를 맡겼어요${task.dueDate ? ` · 마감 ${task.dueDate}` : ''}`,
    linkPath: `/tasks?tab=tasks&task=${task.id}`,
  };
}
