import { Injectable } from '@nestjs/common';
import type { TaskScope } from '@fantasteel/shared';
import type { Prisma } from '../../generated/prisma/client';
import type { Tx } from '../../prisma/prisma.service';

const taskInclude = { assignee: { select: { employeeName: true } }, creator: { select: { employeeName: true } }, message: { select: { chatRoomId: true } } } as const;

export type TaskRow = Prisma.TaskGetPayload<{ include: typeof taskInclude }>;

/** 범위: mine 담당, created 등록, all 담당 또는 등록 (API-239 scope) */
const whereOf = (employeeId: number, scope: TaskScope, taskStatus: string | undefined): Prisma.TaskWhereInput => ({
  ...(scope === 'mine' ? { assigneeId: employeeId } : scope === 'created' ? { creatorId: employeeId } : { OR: [{ assigneeId: employeeId }, { creatorId: employeeId }] }),
  taskStatus,
});

/** DB 접근은 여기서만 한다. 함수의 첫 인자는 tx (컨벤션 8장) */
@Injectable()
export class TaskRepository {
  findEmployeeStatus(tx: Tx, id: number) {
    return tx.employee.findUnique({ where: { id }, select: { id: true, isActive: true } });
  }

  /** 메시지에서 업무 등록: 원본 메시지와 등록하는 사원이 그 방 멤버인지 */
  findMessageForTask(tx: Tx, messageId: number, employeeId: number) {
    return tx.message.findUnique({
      where: { id: messageId },
      select: { id: true, messageType: true, deletedAt: true, chatRoom: { select: { chatRoomMembers: { where: { employeeId }, select: { employeeId: true } } } } },
    });
  }

  createTask(tx: Tx, data: Prisma.TaskUncheckedCreateInput) {
    return tx.task.create({ data, select: { id: true } });
  }

  /** 트랜잭션 안 판단용: 관계 없이 필요한 값만 */
  findTaskState(tx: Tx, id: number) {
    return tx.task.findUnique({ where: { id }, select: { id: true, taskTitle: true, assigneeId: true, creatorId: true, taskStatus: true } });
  }

  /** 진행(OPEN)일 때만 바꾼다. 동시에 완료하면 한쪽만 count 1 */
  updateStatusIfOpen(tx: Tx, id: number, from: string, to: string) {
    return tx.task.updateMany({ where: { id, taskStatus: from }, data: { taskStatus: to } });
  }

  /** 진행(OPEN)일 때만 고친다. 그사이 완료됐으면 count 0 */
  updateTaskIfOpen(tx: Tx, id: number, data: Prisma.TaskUncheckedUpdateManyInput) {
    return tx.task.updateMany({ where: { id, taskStatus: 'OPEN' }, data });
  }

  findTask(tx: Tx, id: number) {
    return tx.task.findUnique({ where: { id }, include: taskInclude });
  }

  countTasks(tx: Tx, employeeId: number, scope: TaskScope, taskStatus?: string) {
    return tx.task.count({ where: whereOf(employeeId, scope, taskStatus) });
  }

  /** 마감일 빠른 순 */
  findTasks(tx: Tx, employeeId: number, scope: TaskScope, taskStatus: string | undefined, page: { skip: number; take: number }) {
    return tx.task.findMany({ where: whereOf(employeeId, scope, taskStatus), include: taskInclude, orderBy: [{ dueDate: 'asc' }, { id: 'asc' }], ...page });
  }
}
