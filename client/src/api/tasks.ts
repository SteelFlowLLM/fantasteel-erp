// 업무(할 일) API — docs/api/notification.md 의 모양 그대로.
import type { TaskStatus } from '@fantasteel/shared';
import { api } from './client';

export interface TaskView {
  id: number;
  title: string;
  description: string | null;
  assigneeId: number;
  assigneeName: string;
  creatorId: number;
  creatorName: string;
  /** 'YYYY-MM-DD' */
  dueDate: string | null;
  taskStatus: TaskStatus;
  linkPath: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** mine = 내가 담당 · created = 내가 만든 것 · all = 둘 다 */
export type TaskScope = 'mine' | 'created' | 'all';

export interface CreateTaskBody {
  title: string;
  description?: string;
  assigneeId: number;
  dueDate?: string;
  linkPath?: string;
}

/** 생략 = 변경 없음, null = 비움 */
export interface UpdateTaskBody {
  title?: string;
  description?: string | null;
  assigneeId?: number;
  dueDate?: string | null;
  linkPath?: string | null;
}

export const taskApi = {
  list: (q: { scope?: TaskScope; status?: TaskStatus } = {}) => api.get<TaskView[]>('/tasks', { ...q }),
  create: (dto: CreateTaskBody) => api.post<TaskView>('/tasks', dto),
  update: ({ id, ...dto }: UpdateTaskBody & { id: number }) => api.patch<TaskView>(`/tasks/${id}`, dto),
  setStatus: ({ id, taskStatus }: { id: number; taskStatus: TaskStatus }) => api.post<TaskView>(`/tasks/${id}/status`, { taskStatus }),
};
