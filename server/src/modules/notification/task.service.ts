import { Injectable } from '@nestjs/common';
import { NOTIFICATION_TYPE, TASK_STATUS, type AuthUser } from '@fantasteel/shared';
import { badInput, forbidden, notFound } from '../../common/errors/app.exception';
import { RealtimeService } from '../../common/realtime/realtime.service';
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import type { CreateTaskDto } from './dto/create-task.dto';
import { TASK_SCOPE, type ListTasksDto } from './dto/list-tasks.dto';
import type { UpdateTaskDto } from './dto/update-task.dto';
import { NotificationSender } from './notification.sender';
import { TaskRepository, type TaskRow } from './task.repository';

export interface TaskView {
  id: number;
  title: string;
  description: string | null;
  assigneeId: number;
  assigneeName: string;
  creatorId: number;
  creatorName: string;
  /** YYYY-MM-DD */
  dueDate: string | null;
  taskStatus: string;
  linkPath: string | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const toDate = (ymd: string) => new Date(`${ymd}T00:00:00Z`);

function toView(t: TaskRow): TaskView {
  return {
    id: t.id,
    title: t.title,
    description: t.description,
    assigneeId: t.assigneeId,
    assigneeName: t.assignee.employeeName,
    creatorId: t.creatorId,
    creatorName: t.creator.employeeName,
    dueDate: t.dueDate ? t.dueDate.toISOString().slice(0, 10) : null,
    taskStatus: t.taskStatus,
    linkPath: t.linkPath,
    completedAt: t.completedAt,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

@Injectable()
export class TaskService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tasks: TaskRepository,
    private readonly sender: NotificationSender,
    private readonly realtime: RealtimeService,
  ) {}

  async list(q: ListTasksDto, user: AuthUser): Promise<TaskView[]> {
    const me = user.employeeId;
    const scope = q.scope ?? TASK_SCOPE.MINE;
    const owner = scope === TASK_SCOPE.MINE ? { assigneeId: me } : scope === TASK_SCOPE.CREATED ? { creatorId: me } : { OR: [{ assigneeId: me }, { creatorId: me }] };
    const rows = await this.tasks.list(this.prisma, { ...owner, taskStatus: q.status });
    return rows.map(toView);
  }

  async create(dto: CreateTaskDto, user: AuthUser): Promise<TaskView> {
    return this.prisma.tx(async (tx) => {
      await this.assertAssignable(tx, dto.assigneeId);
      const row = await this.tasks.create(tx, {
        title: dto.title.trim(),
        description: dto.description ?? null,
        assigneeId: dto.assigneeId,
        creatorId: user.employeeId,
        dueDate: dto.dueDate ? toDate(dto.dueDate) : null,
        linkPath: dto.linkPath ?? null,
      });
      await this.notifyAssignee(tx, row, user, `TASK_ASSIGNED:${row.id}:${row.assigneeId}`);
      this.realtime.changed('tasks');
      return toView(row);
    });
  }

  /** 만든 사람이나 담당자만 고칠 수 있다. 담당자를 바꾸면 새 담당자에게 알린다. */
  async update(id: number, dto: UpdateTaskDto, user: AuthUser): Promise<TaskView> {
    return this.prisma.tx(async (tx) => {
      const current = await this.loadEditable(tx, id, user);
      const reassigned = dto.assigneeId !== undefined && dto.assigneeId !== current.assigneeId;
      if (reassigned) await this.assertAssignable(tx, dto.assigneeId!);
      const row = await this.tasks.update(tx, id, {
        title: dto.title?.trim(),
        description: dto.description,
        assigneeId: dto.assigneeId,
        dueDate: dto.dueDate === undefined ? undefined : dto.dueDate === null ? null : toDate(dto.dueDate),
        linkPath: dto.linkPath,
      });
      // 담당자가 A→B→A로 바뀌어도 매번 알리도록 시각을 키에 넣는다
      if (reassigned) await this.notifyAssignee(tx, row, user, `TASK_ASSIGNED:${row.id}:${row.assigneeId}:${row.updatedAt.getTime()}`);
      this.realtime.changed('tasks');
      return toView(row);
    });
  }

  /** 상태를 바꾼다. 완료(DONE)가 되면 completedAt을 기록하고, 다시 열면 지운다. */
  async setStatus(id: number, taskStatus: string, user: AuthUser): Promise<TaskView> {
    return this.prisma.tx(async (tx) => {
      const current = await this.loadEditable(tx, id, user);
      if (current.taskStatus === taskStatus) return toView(current);
      const row = await this.tasks.update(tx, id, {
        taskStatus,
        completedAt: taskStatus === TASK_STATUS.DONE ? new Date() : null,
      });
      this.realtime.changed('tasks');
      return toView(row);
    });
  }

  private async loadEditable(tx: Tx, id: number, user: AuthUser): Promise<TaskRow> {
    const task = await this.tasks.findById(tx, id);
    if (!task) throw notFound('업무');
    if (task.creatorId !== user.employeeId && task.assigneeId !== user.employeeId) throw forbidden('만든 사람이나 담당자만 고칠 수 있는 업무입니다');
    return task;
  }

  private async assertAssignable(tx: Tx, assigneeId: number): Promise<void> {
    if (!(await this.tasks.isActiveEmployee(tx, assigneeId))) throw badInput('담당자는 사용 중인 사원이어야 합니다');
  }

  private async notifyAssignee(tx: Tx, task: TaskRow, actor: AuthUser, dedupeKey: string): Promise<void> {
    const due = task.dueDate ? ` (마감 ${task.dueDate.toISOString().slice(0, 10)})` : '';
    await this.sender.toEmployees(tx, [task.assigneeId], {
      notificationType: NOTIFICATION_TYPE.TASK,
      title: `업무 배정: ${task.title}`,
      body: `${actor.employeeName}님이 업무를 맡겼습니다${due}`,
      linkPath: task.linkPath ?? '/tasks',
      dedupeKey,
      excludeEmployeeId: actor.employeeId, // 자기 자신에게 맡긴 업무는 알리지 않는다
    });
  }
}
