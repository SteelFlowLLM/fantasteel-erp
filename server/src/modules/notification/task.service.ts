import { Injectable } from '@nestjs/common';
import { MESSAGE_TYPE, NOTIFICATION_TYPE, TASK_STATUS, type AuthUser, type PageResult, type TaskStatus, type TaskView } from '@fantasteel/shared';
import { AppException } from '../../common/errors/app.exception';
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import type { CreateTaskDto, ListTasksQuery } from './dto/task.dto';
import { NotificationService } from './notification.service';
import { TaskRepository, type TaskRow } from './task.repository';

const DEFAULT_PAGE_SIZE = 20;

const dateOnly = (d: Date) => d.toISOString().slice(0, 10);

function parseDueDate(value: string): Date {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || dateOnly(date) !== value) throw new AppException('COM-004', `마감일 ${value}는 없는 날짜예요`);
  return date;
}

function toView(row: TaskRow): TaskView {
  return {
    id: row.id,
    taskTitle: row.taskTitle,
    taskDescription: row.taskDescription,
    assigneeId: row.assigneeId,
    assigneeName: row.assignee.employeeName,
    dueDate: dateOnly(row.dueDate),
    taskStatus: row.taskStatus as TaskStatus,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    messageId: row.messageId,
    linkPath: row.message && row.messageId !== null ? `/messenger?room=${row.message.chatRoomId}&message=${row.messageId}` : null,
  };
}

/**
 * 업무 (REQ-NTF-001): 담당자·마감일, 상태 OPEN → DONE. 작업 로그는 남기지 않는다 (BUSINESS_EVENT_TYPE에 업무 이벤트가 없다).
 * 목록은 내 담당 업무만 본다: task에 등록자 칸이 없다 (2026-10-07 사용자 결정, notification.md 8장).
 */
@Injectable()
export class TaskService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: TaskRepository,
    private readonly notifications: NotificationService,
  ) {}

  /** API-239 */
  async list(user: AuthUser, query: ListTasksQuery): Promise<PageResult<TaskView>> {
    const page = query.page ?? 1;
    const size = query.size ?? DEFAULT_PAGE_SIZE;
    const [total, rows] = await Promise.all([
      this.repository.countTasks(this.prisma, user.employeeId, query.taskStatus),
      this.repository.findTasks(this.prisma, user.employeeId, query.taskStatus, { skip: (page - 1) * size, take: size }),
    ]);
    return { items: rows.map(toView), page, size, total };
  }

  /**
   * API-240. 담당자가 내가 아니면 같은 tx에서 담당자에게 업무 지정 알림.
   * messageId(16번, 명세에 없는 값)를 주면 메신저 메시지에서 등록한 업무로 남긴다: 메시지 없음 COM-003, 그 방 멤버가 아님 COM-002, 삭제·시스템 메시지 COM-004.
   */
  async create(user: AuthUser, dto: CreateTaskDto): Promise<TaskView> {
    const taskTitle = dto.taskTitle.trim();
    if (!taskTitle) throw new AppException('COM-004', '제목을 입력해 주세요');
    const dueDate = parseDueDate(dto.dueDate);
    const id = await this.prisma.$transaction(async (tx) => {
      const assignee = await this.repository.findEmployeeStatus(tx, dto.assigneeId);
      if (!assignee?.isActive) throw new AppException('COM-003', '담당자를 찾을 수 없어요');
      if (dto.messageId !== undefined) await this.requireSourceMessage(tx, user, dto.messageId);
      const task = await this.repository.createTask(tx, {
        taskTitle,
        taskDescription: dto.taskDescription?.trim() || null,
        assigneeId: dto.assigneeId,
        dueDate,
        taskStatus: TASK_STATUS.OPEN,
        messageId: dto.messageId ?? null,
      });
      if (dto.assigneeId !== user.employeeId) {
        await this.notifications.notifyEmployees(tx, [dto.assigneeId], { notificationType: NOTIFICATION_TYPE.TASK_ASSIGNED, notificationContent: `업무 지정 · ${taskTitle}`, linkPath: '/tasks' });
      }
      return task.id;
    });
    return this.view(id);
  }

  /** API-241. 담당자 본인만, 진행(OPEN)일 때만 완료(DONE) */
  async complete(user: AuthUser, id: number): Promise<TaskView> {
    await this.prisma.$transaction(async (tx) => {
      const task = await this.repository.findTaskState(tx, id);
      if (!task) throw new AppException('COM-003', '업무를 찾을 수 없어요');
      if (task.assigneeId !== user.employeeId) throw new AppException('COM-002', '담당자만 완료할 수 있어요');
      const { count } = await this.repository.updateStatusIfOpen(tx, id, TASK_STATUS.OPEN, TASK_STATUS.DONE);
      if (count === 0) throw new AppException('COM-001', '이미 완료된 업무예요');
    });
    return this.view(id);
  }

  private async requireSourceMessage(tx: Tx, user: AuthUser, messageId: number): Promise<void> {
    const message = await this.repository.findMessageForTask(tx, messageId, user.employeeId);
    if (!message) throw new AppException('COM-003', '메시지를 찾을 수 없어요');
    if (message.chatRoom.chatRoomMembers.length === 0) throw new AppException('COM-002', '채팅방 멤버만 이 메시지로 업무를 등록할 수 있어요');
    if (message.deletedAt || message.messageType !== MESSAGE_TYPE.USER) throw new AppException('COM-004', '삭제된 메시지나 시스템 메시지로는 업무를 등록할 수 없어요');
  }

  /** 응답용 조회는 커밋 뒤에 한다 (트랜잭션 안 관계 조회는 pg 경고) */
  private async view(id: number): Promise<TaskView> {
    const row = await this.repository.findTask(this.prisma, id);
    if (!row) throw new AppException('COM-003', '업무를 찾을 수 없어요');
    return toView(row);
  }
}
