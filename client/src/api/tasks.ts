// 업무 (REQ-NTF-001: 업무에 담당자와 마감일을 지정한다). 상태는 OPEN 진행 → DONE 완료 (업무 프로세스 10장).
// - 만든 사람과 담당자만 고치거나 완료할 수 있다 (가정값, docs/rework/areas/collab.md).
// - 담당자가 내가 아니면 담당자에게 '업무 지정' 알림을 보낸다 (NOTIFICATION_TYPE 🟡 TASK_ASSIGNED).
// - 업무에 맞는 작업 로그 유형(BUSINESS_EVENT_TYPE)이 없어 작업 로그는 남기지 않는다.
// - 서버 모드는 api/server/tasks.ts (내 담당 업무만, 수정 없음).
import { NOTIFICATION_TYPE, TASK_STATUS, type TaskStatus } from '@/codes';
import { requireActor, type Actor } from '@/api/actor';
import { ApiError, FieldErrors, InputError, mockMutation, mockQuery } from '@/api/client';
import { isServerDataSource } from '@/api/http';
import { serverTaskApi } from '@/api/server/tasks';
import { assertUnchanged, optionalDate, optionalText, requiredText, requireRow } from '@/api/validation';
import { compareTasksByDue, isScreenPath, LINK_PATH_ERROR } from '@/features/tasks/lib/taskDue';
import { taskAssignedNotice } from '@/features/tasks/lib/taskNotice';
import type { MockTables, TaskRow } from '@/mock/schema';
import { createNotifications } from '@/mock/services/notifications';
import { insertRow, updateRow, type MockTx } from '@/mock/store';

/** 내 업무 = 내가 담당 · 내가 만든 업무 · 전체 = 둘을 합친 것 */
export type TaskScope = 'mine' | 'created' | 'all';

export const taskKeys = {
  all: ['tasks'] as const,
  list: (employeeId: number, scope: TaskScope) => ['tasks', 'list', employeeId, scope] as const,
  summary: (employeeId: number) => ['tasks', 'summary', employeeId] as const,
};

export const TASK_TITLE_MAX = 200;
/** 설명은 ERD text라 길이 제한이 없지만 화면 입력은 2000자로 둔다 (가정값) */
export const TASK_DESCRIPTION_MAX = 2000;

export interface TaskPersonView {
  id: number;
  employeeName: string;
  departmentName: string;
  jobGradeName: string;
}

export interface TaskView {
  id: number;
  title: string;
  description: string | null;
  assignee: TaskPersonView;
  creator: TaskPersonView;
  dueDate: string | null;
  taskStatus: TaskStatus;
  linkPath: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** 요청한 사원이 고치거나 완료할 수 있는지 (만든 사람·담당자) */
  canEdit: boolean;
}

export interface TaskInput {
  title: string;
  description?: string | null;
  assigneeId: number | null;
  dueDate?: string | null;
  linkPath?: string | null;
}

export interface TaskUpdateInput extends TaskInput {
  /** 수정 창을 연 시점의 수정 시각 (COM-001 확인) */
  expectedUpdatedAt?: string | null;
}

function personOf(tables: Readonly<MockTables>, employeeId: number): TaskPersonView {
  const employee = tables.employee.find((e) => e.id === employeeId);
  return {
    id: employeeId,
    employeeName: employee?.employeeName ?? '알 수 없는 사원',
    departmentName: tables.department.find((d) => d.id === employee?.departmentId)?.departmentName ?? '-',
    jobGradeName: tables.jobGrade.find((g) => g.id === employee?.jobGradeId)?.jobGradeName ?? '-',
  };
}

const canEditTask = (task: TaskRow, employeeId: number) => task.creatorId === employeeId || task.assigneeId === employeeId;

function toView(tables: Readonly<MockTables>, task: TaskRow, viewerId: number): TaskView {
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    assignee: personOf(tables, task.assigneeId),
    creator: personOf(tables, task.creatorId),
    dueDate: task.dueDate,
    taskStatus: task.taskStatus,
    linkPath: task.linkPath,
    completedAt: task.completedAt,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    canEdit: canEditTask(task, viewerId),
  };
}

function inScope(task: TaskRow, employeeId: number, scope: TaskScope): boolean {
  if (scope === 'mine') return task.assigneeId === employeeId;
  if (scope === 'created') return task.creatorId === employeeId;
  return task.assigneeId === employeeId || task.creatorId === employeeId;
}

/** 입력 확인. 담당자가 없으면 COM-003, 사용 안 함 사원이면 입력칸 오류. */
function validateInput(tables: Readonly<MockTables>, input: TaskInput) {
  const errors = new FieldErrors();
  const title = requiredText(errors, 'title', input.title, '제목', TASK_TITLE_MAX);
  const description = optionalText(errors, 'description', input.description, '설명', TASK_DESCRIPTION_MAX);
  const dueDate = optionalDate(errors, 'dueDate', input.dueDate, '마감일');
  const linkText = (input.linkPath ?? '').trim();
  if (linkText && !isScreenPath(linkText)) errors.add('linkPath', LINK_PATH_ERROR);
  if (input.assigneeId === null || input.assigneeId === undefined) errors.add('assigneeId', '담당자를 골라 주세요');
  errors.throwIfAny();
  const assignee = requireRow(tables, 'employee', input.assigneeId, '담당자');
  if (!assignee.isActive) throw new InputError('입력한 내용을 확인해 주세요', { assigneeId: '사용 중인 사원만 담당자로 지정할 수 있어요' });
  return { title: title ?? '', description, dueDate: dueDate ?? null, linkPath: linkText || null, assigneeId: assignee.id };
}

function notifyAssignee(tx: MockTx, actor: Actor, task: TaskRow): void {
  if (task.assigneeId === actor.employee.id) return;
  createNotifications(tx, {
    notificationType: NOTIFICATION_TYPE.TASK_ASSIGNED,
    ...taskAssignedNotice(task, actor.employee.employeeName),
    recipientEmployeeIds: [task.assigneeId],
  });
}

function requireEditable(tables: Readonly<MockTables>, actor: Actor, taskId: number): TaskRow {
  const task = requireRow(tables, 'task', taskId, '업무');
  if (!canEditTask(task, actor.employee.id)) throw new ApiError('COM-002', '업무를 만든 사람과 담당자만 바꿀 수 있어요');
  return task;
}

export interface TaskSummary {
  /** 내가 담당한 진행 업무 수 */
  openCount: number;
  overdueCount: number;
  dueTodayCount: number;
}

export const taskApi = {
  list: (scope: TaskScope): Promise<TaskView[]> =>
    isServerDataSource() ? serverTaskApi.list() : mockQuery((tables) => {
      const actor = requireActor(tables);
      const me = actor.employee.id;
      return tables.task
        .filter((task) => inScope(task, me, scope))
        .sort(compareTasksByDue)
        .map((task) => toView(tables, task, me));
    }),

  /** 내 업무 요약 (탭 숫자·부제). today = 'YYYY-MM-DD' (Asia/Seoul) */
  summary: (today: string): Promise<TaskSummary> =>
    isServerDataSource() ? serverTaskApi.summary(today) : mockQuery((tables) => {
      const me = requireActor(tables).employee.id;
      const open = tables.task.filter((task) => task.assigneeId === me && task.taskStatus === TASK_STATUS.OPEN);
      return {
        openCount: open.length,
        overdueCount: open.filter((task) => task.dueDate !== null && task.dueDate < today).length,
        dueTodayCount: open.filter((task) => task.dueDate === today).length,
      };
    }),

  create: (input: TaskInput): Promise<TaskView> =>
    isServerDataSource() ? serverTaskApi.create(input) : mockMutation((tx) => {
      const actor = requireActor(tx.tables);
      const values = validateInput(tx.tables, input);
      const task = insertRow(tx, 'task', { ...values, creatorId: actor.employee.id, taskStatus: TASK_STATUS.OPEN, completedAt: null });
      notifyAssignee(tx, actor, task);
      return toView(tx.tables, task, actor.employee.id);
    }),

  update: ({ id, ...input }: TaskUpdateInput & { id: number }): Promise<TaskView> =>
    mockMutation((tx) => {
      const actor = requireActor(tx.tables);
      const task = requireEditable(tx.tables, actor, id);
      assertUnchanged(task.updatedAt, input.expectedUpdatedAt, '업무');
      if (task.taskStatus === TASK_STATUS.DONE) throw new InputError('완료한 업무는 고칠 수 없어요');
      const values = validateInput(tx.tables, input);
      const next = updateRow(tx, 'task', id, values) ?? task;
      if (values.assigneeId !== task.assigneeId) notifyAssignee(tx, actor, next);
      return toView(tx.tables, next, actor.employee.id);
    }),

  /** 완료 (OPEN → DONE). 되돌리기는 없다 (업무 프로세스 10장 OPEN → DONE). */
  complete: ({ id, expectedUpdatedAt }: { id: number; expectedUpdatedAt?: string | null }): Promise<TaskView> =>
    isServerDataSource() ? serverTaskApi.complete(id) : mockMutation((tx) => {
      const actor = requireActor(tx.tables);
      const task = requireEditable(tx.tables, actor, id);
      if (task.taskStatus === TASK_STATUS.DONE) throw new ApiError('COM-001', '이미 완료한 업무예요');
      assertUnchanged(task.updatedAt, expectedUpdatedAt, '업무');
      const next = updateRow(tx, 'task', id, { taskStatus: TASK_STATUS.DONE, completedAt: tx.nowIso }) ?? task;
      return toView(tx.tables, next, actor.employee.id);
    }),
};
