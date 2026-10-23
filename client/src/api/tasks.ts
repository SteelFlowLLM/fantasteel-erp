// 업무 (REQ-NTF-001: 업무에 담당자와 마감일을 지정한다). 상태는 OPEN 진행 → DONE 완료 (업무 프로세스 10장).
// 두 데이터 모드 모두 실제 서버를 부른다 (api/server/tasks.ts, API-239~241·274).
// - 고치기는 등록자·담당자, 완료는 담당자만 (서버 규칙). 담당자가 내가 아니면 서버가 담당자에게 '업무 지정' 알림을 보낸다.
// - 업무에 맞는 작업 로그 유형(BUSINESS_EVENT_TYPE)이 없어 작업 로그는 남기지 않는다.
import type { TaskStatus } from '@/codes';
import { serverTaskApi } from '@/api/server/tasks';

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
  /** 완료할 수 있는지. 없으면 canEdit을 따른다 (서버는 담당자만 완료, API-241) */
  canComplete?: boolean;
}

export interface TaskInput {
  title: string;
  description?: string | null;
  assigneeId: number | null;
  dueDate?: string | null;
  linkPath?: string | null;
  /** 메신저 메시지에서 등록할 때 원본 메시지 (16번). 연결 화면은 그 메시지로 정해진다 */
  messageId?: number | null;
}

export interface TaskUpdateInput extends TaskInput {
  /** 수정 창을 연 시점의 수정 시각 (COM-001 확인) */
  expectedUpdatedAt?: string | null;
}

export interface TaskSummary {
  /** 내가 담당한 진행 업무 수 */
  openCount: number;
  overdueCount: number;
  dueTodayCount: number;
}

export const taskApi = {
  list: (scope: TaskScope): Promise<TaskView[]> => serverTaskApi.list(scope),

  /** 내 업무 요약 (탭 숫자·부제). today = 'YYYY-MM-DD' (Asia/Seoul) */
  summary: (today: string): Promise<TaskSummary> => serverTaskApi.summary(today),

  create: (input: TaskInput): Promise<TaskView> => serverTaskApi.create(input),

  update: (input: TaskUpdateInput & { id: number }): Promise<TaskView> => serverTaskApi.update(input),

  /** 완료 (OPEN → DONE, 담당자만). 되돌리기는 없다 (업무 프로세스 10장 OPEN → DONE). */
  complete: ({ id }: { id: number; expectedUpdatedAt?: string | null }): Promise<TaskView> => serverTaskApi.complete(id),
};
