// 업무 화면 ↔ 서버 API (server/src/modules/notification, API-239~241·274). 서버 응답을 화면이 쓰는 모양(가짜 DB와 같은 타입)으로 바꾼다.
// 사원 id는 서버 id다. 고치기는 등록자·담당자, 완료는 담당자만이라(서버 규칙) 로그인 사원(/auth/me)과 비교해 버튼을 정한다.
// 서버에 없어 비우는 것: 완료 시각(ERD 칸 없음). 마감일은 서버에서 필수다.
import type { AuthUser, PageResult, TaskView as ServerTaskView } from '@fantasteel/shared';
import { TASK_STATUS } from '@/codes';
import { FieldErrors } from '@/api/errors';
import { serverRequest } from '@/api/http';
import { TASK_DESCRIPTION_MAX, TASK_TITLE_MAX, type TaskInput, type TaskScope, type TaskSummary, type TaskUpdateInput, type TaskView } from '@/api/tasks';
import { compareTasksByDue, isScreenPath, LINK_PATH_ERROR } from '@/features/tasks/lib/taskDue';

const PAGE_SIZE = 100;

const myId = async (): Promise<number> => (await serverRequest<AuthUser>('GET', '/auth/me')).employeeId;

async function listOf(scope: TaskScope): Promise<ServerTaskView[]> {
  const rows: ServerTaskView[] = [];
  for (let page = 1; ; page++) {
    const result = await serverRequest<PageResult<ServerTaskView>>('GET', '/tasks', { query: { page, size: PAGE_SIZE, scope } });
    rows.push(...result.items);
    if (rows.length >= result.total || result.items.length === 0) return rows;
  }
}

function toView(row: ServerTaskView, me: number): TaskView {
  // 부서·직급은 업무 카드에 보이지 않아 응답에 없는 값을 따로 읽지 않는다
  const person = (id: number, employeeName: string) => ({ id, employeeName, departmentName: '-', jobGradeName: '-' });
  const open = row.taskStatus === TASK_STATUS.OPEN;
  return {
    id: row.id,
    title: row.taskTitle,
    description: row.taskDescription,
    assignee: person(row.assigneeId, row.assigneeName),
    creator: person(row.creatorId, row.creatorName),
    dueDate: row.dueDate,
    taskStatus: row.taskStatus,
    linkPath: row.linkPath,
    completedAt: null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    canEdit: open && (row.creatorId === me || row.assigneeId === me),
    canComplete: open && row.assigneeId === me,
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
  const linkPath = (input.linkPath ?? '').trim();
  if (linkPath && !isScreenPath(linkPath)) errors.add('linkPath', LINK_PATH_ERROR);
  errors.throwIfAny();
  // 위에서 비었으면 이미 던졌다
  return { taskTitle, taskDescription: taskDescription || null, assigneeId: input.assigneeId ?? 0, dueDate: input.dueDate ?? '', linkPath: linkPath || null };
}

export const serverTaskApi = {
  list: async (scope: TaskScope): Promise<TaskView[]> => {
    const [rows, me] = await Promise.all([listOf(scope), myId()]);
    return rows.map((row) => toView(row, me)).sort(compareTasksByDue);
  },

  summary: async (today: string): Promise<TaskSummary> => {
    const open = (await listOf('mine')).filter((task) => task.taskStatus === TASK_STATUS.OPEN);
    return {
      openCount: open.length,
      overdueCount: open.filter((task) => task.dueDate < today).length,
      dueTodayCount: open.filter((task) => task.dueDate === today).length,
    };
  },

  /** 메시지에서 등록하면 연결 화면은 서버가 원본 메시지 경로로 준다 */
  create: async (input: TaskInput): Promise<TaskView> => {
    const { linkPath, ...body } = bodyOf(input);
    const saved = await serverRequest<ServerTaskView>('POST', '/tasks', { body: input.messageId ? { ...body, messageId: input.messageId } : { ...body, linkPath } });
    return toView(saved, await myId());
  },

  /** 서버는 상태(진행)로 완료된 업무 수정을 막아 expectedUpdatedAt은 보내지 않는다 */
  update: async ({ id, ...input }: TaskUpdateInput & { id: number }): Promise<TaskView> => {
    const saved = await serverRequest<ServerTaskView>('PATCH', `/tasks/${id}`, { body: bodyOf(input) });
    return toView(saved, await myId());
  },

  complete: async (id: number): Promise<TaskView> => toView(await serverRequest<ServerTaskView>('POST', `/tasks/${id}/complete`), await myId()),
};
