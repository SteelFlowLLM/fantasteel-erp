// 업무 화면 ↔ 서버 API (server/src/modules/notification, API-239~241). 서버 응답을 화면이 쓰는 모양(가짜 DB와 같은 타입)으로 바꾼다.
// 사원 id는 서버 id다. 서버에 없어 비우는 것 (화면은 서버 모드에서 해당 기능을 숨긴다):
// - 범위: 서버 목록은 내 담당 업무만이다 (notification.md 8장, 2026-10-07 결정)
// - 요청자: task에 등록자 칸이 없어 담당자로 채운다 (화면은 둘이 같으면 요청자를 보이지 않는다)
// - 연결 화면·완료 시각·수정: ERD 칸·API가 없다. 마감일은 서버에서 필수다
import type { PageResult, TaskView as ServerTaskView } from '@fantasteel/shared';
import { TASK_STATUS } from '@/codes';
import { FieldErrors } from '@/api/errors';
import { serverRequest } from '@/api/http';
import { TASK_DESCRIPTION_MAX, TASK_TITLE_MAX, type TaskInput, type TaskSummary, type TaskView } from '@/api/tasks';
import { compareTasksByDue } from '@/features/tasks/lib/taskDue';

const PAGE_SIZE = 100;

async function listMine(): Promise<ServerTaskView[]> {
  const rows: ServerTaskView[] = [];
  for (let page = 1; ; page++) {
    const result = await serverRequest<PageResult<ServerTaskView>>('GET', '/tasks', { query: { page, size: PAGE_SIZE } });
    rows.push(...result.items);
    if (rows.length >= result.total || result.items.length === 0) return rows;
  }
}

function toView(row: ServerTaskView): TaskView {
  // 부서·직급은 업무 카드에 보이지 않아 응답에 없는 값을 따로 읽지 않는다
  const assignee = { id: row.assigneeId, employeeName: row.assigneeName, departmentName: '-', jobGradeName: '-' };
  return {
    id: row.id,
    title: row.taskTitle,
    description: row.taskDescription,
    assignee,
    creator: assignee,
    dueDate: row.dueDate,
    taskStatus: row.taskStatus,
    linkPath: null,
    completedAt: null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    // 서버 목록은 내 담당 업무라 진행 중이면 완료할 수 있다 (수정은 API가 없다)
    canEdit: row.taskStatus === TASK_STATUS.OPEN,
  };
}

/** 서버가 막을 값을 미리 입력칸 오류로 보인다 (마감일은 서버에서 필수) */
function bodyOf(input: TaskInput) {
  const errors = new FieldErrors();
  const taskTitle = input.title.trim();
  if (!taskTitle) errors.add('title', '제목을 입력해 주세요');
  else if (taskTitle.length > TASK_TITLE_MAX) errors.add('title', `제목은 ${TASK_TITLE_MAX}자까지 쓸 수 있어요`);
  const taskDescription = (input.description ?? '').trim();
  if (taskDescription.length > TASK_DESCRIPTION_MAX) errors.add('description', `설명은 ${TASK_DESCRIPTION_MAX}자까지 쓸 수 있어요`);
  if (input.assigneeId === null || input.assigneeId === undefined) errors.add('assigneeId', '담당자를 골라 주세요');
  if (!input.dueDate) errors.add('dueDate', '마감일을 골라 주세요');
  errors.throwIfAny();
  // 위에서 비었으면 이미 던졌다
  return { taskTitle, taskDescription: taskDescription || null, assigneeId: input.assigneeId ?? 0, dueDate: input.dueDate ?? '' };
}

export const serverTaskApi = {
  list: async (): Promise<TaskView[]> => (await listMine()).map(toView).sort(compareTasksByDue),

  summary: async (today: string): Promise<TaskSummary> => {
    const open = (await listMine()).filter((task) => task.taskStatus === TASK_STATUS.OPEN);
    return {
      openCount: open.length,
      overdueCount: open.filter((task) => task.dueDate < today).length,
      dueTodayCount: open.filter((task) => task.dueDate === today).length,
    };
  },

  create: async (input: TaskInput): Promise<TaskView> => toView(await serverRequest<ServerTaskView>('POST', '/tasks', { body: bodyOf(input) })),

  /** 서버는 상태(진행)로 중복 완료를 막아 expectedUpdatedAt은 보내지 않는다 */
  complete: async (id: number): Promise<TaskView> => toView(await serverRequest<ServerTaskView>('POST', `/tasks/${id}/complete`)),
};
