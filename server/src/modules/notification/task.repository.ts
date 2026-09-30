import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import type { Tx } from '../../prisma/prisma.service';

const taskSelect = {
  id: true,
  title: true,
  description: true,
  assigneeId: true,
  creatorId: true,
  dueDate: true,
  taskStatus: true,
  linkPath: true,
  completedAt: true,
  createdAt: true,
  updatedAt: true,
  assignee: { select: { employeeName: true } },
  creator: { select: { employeeName: true } },
} satisfies Prisma.TaskSelect;

export type TaskRow = Prisma.TaskGetPayload<{ select: typeof taskSelect }>;

@Injectable()
export class TaskRepository {
  list(tx: Tx, where: Prisma.TaskWhereInput): Promise<TaskRow[]> {
    return tx.task.findMany({ where, select: taskSelect, orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { id: 'desc' }] });
  }

  findById(tx: Tx, id: number): Promise<TaskRow | null> {
    return tx.task.findUnique({ where: { id }, select: taskSelect });
  }

  create(tx: Tx, data: Prisma.TaskUncheckedCreateInput): Promise<TaskRow> {
    return tx.task.create({ data, select: taskSelect });
  }

  update(tx: Tx, id: number, data: Prisma.TaskUncheckedUpdateInput): Promise<TaskRow> {
    return tx.task.update({ where: { id }, data, select: taskSelect });
  }

  /** 담당자로 지정할 수 있는 사원(ACTIVE)인지 */
  async isActiveEmployee(tx: Tx, employeeId: number): Promise<boolean> {
    const e = await tx.employee.findUnique({ where: { id: employeeId }, select: { employeeStatus: true } });
    return e?.employeeStatus === 'ACTIVE';
  }
}
