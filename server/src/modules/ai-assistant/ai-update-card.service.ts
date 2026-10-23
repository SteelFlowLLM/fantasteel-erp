import { Injectable } from '@nestjs/common';
import { TASK_STATUS, type AiActionCardExecuteResult, type AiScheduleEventUpdateCard, type AiTaskUpdateCard, type AuthUser } from '@fantasteel/shared';
import { AppException } from '../../common/errors/app.exception';
import { seoulToday } from '../../common/time/seoul-date';
import { PrismaService } from '../../prisma/prisma.service';
import { seoulIso } from '../integration/notion/notion-workspace.tools';
import { normalizeDateTime, validDate } from '../meeting-minutes/meeting-analysis.validator';
import { TaskService } from '../notification/task.service';
import { ScheduleEventService } from '../schedule-event/schedule-event.service';
import { AiAssistantRepository } from './ai-assistant.repository';
import type { ExecuteAiActionCardDto } from './dto/ai-assistant.dto';
import { optionalBoolean, optionalPositiveInt, optionalString, ToolArgumentError } from './tools/assistant-tool';

/** 일정 제목은 일정 화면 DTO와 같은 100자, 설명은 1000자 */
const EVENT_TITLE_MAX = 100;
const EVENT_DESCRIPTION_MAX = 1000;
/** 업무 제목·설명은 업무 DTO와 같다 (설명은 카드 칸이 1000자라 그만큼) */
const TASK_TITLE_MAX = 200;
const TASK_DESCRIPTION_MAX = 1000;

type ProposedScheduleCard = Omit<AiScheduleEventUpdateCard, 'key'>;
type ProposedTaskCard = Omit<AiTaskUpdateCard, 'key'>;

/** 설명을 비우라는 뜻(빈 글)과 말이 없음(undefined)을 가른다 */
function descriptionArg(args: Record<string, unknown>, max: number): string | null | undefined {
  if (args.description === undefined || args.description === null) return undefined;
  if (typeof args.description !== 'string') throw new ToolArgumentError('description은 문자열이어야 해요');
  const trimmed = args.description.trim();
  if (trimmed.length > max) throw new ToolArgumentError(`description은 ${max}자까지예요`);
  return trimmed || null;
}

/** 'YYYY-MM-DDTHH:mm'(서울) 또는 ISO → Date. 틀리면 null */
function instantOf(value: string): Date | null {
  const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) ? `${value}:00+09:00` : value;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * 철강맨AI의 일정·업무 고치기 카드 (문서에 없는 기능, 2026-10-19 이슈 #398). "일정이 바뀌었어"를 ERP에서 고치게 한다:
 * Notion의 일정·할 일 데이터베이스는 ERP를 비추는 보기라(이슈 #391), 바꾼 ERP 행이 다음 반영 때 Notion에 간다.
 * 규칙은 일정·업무 화면과 같다: 일정은 등록자가 직접 등록한 것만(회의록 일정 제외), 업무는 등록자·담당자가 진행 중일 때만, 완료는 담당자만.
 * 참석자 바꾸기·완료 되돌리기는 화면에도 없는 기능이라 카드도 하지 않는다. 일정·업무는 작업 로그 대상이 아니다(REQ-LOG-002).
 */
@Injectable()
export class AiUpdateCardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: AiAssistantRepository,
    private readonly scheduleEvents: ScheduleEventService,
    private readonly tasks: TaskService,
  ) {}

  async proposeScheduleEvent(user: AuthUser, args: Record<string, unknown>): Promise<ProposedScheduleCard> {
    const id = optionalPositiveInt(args, 'scheduleEventId');
    if (id === undefined) throw new ToolArgumentError('scheduleEventId가 필요해요. get_my_schedule로 일정 id를 먼저 찾아요');
    const event = await this.repository.findScheduleEventForCard(this.prisma, id);
    const visible = event && (event.creatorId === user.employeeId || event.attendees.some((a) => a.employeeId === user.employeeId));
    if (!event || !visible) throw new ToolArgumentError('일정을 찾을 수 없어요. get_my_schedule로 일정 id를 확인해요');
    if (event.creatorId !== user.employeeId) throw new ToolArgumentError('내가 등록한 일정만 고칠 수 있어요. 등록한 사람에게 부탁해 달라고 안내해요');
    if (event.meetingMinutesId !== null) throw new ToolArgumentError('회의록에서 등록한 일정은 고칠 수 없어요. 회의록 화면에서 다뤄야 한다고 안내해요');

    const before = { scheduleEventTitle: event.scheduleEventTitle, scheduleEventDescription: event.scheduleEventDescription, startAt: seoulIso(event.startAt), endAt: seoulIso(event.endAt) };
    const today = seoulToday();
    const title = optionalString(args, 'title', EVENT_TITLE_MAX) ?? before.scheduleEventTitle;
    const description = descriptionArg(args, EVENT_DESCRIPTION_MAX);
    const startArg = optionalString(args, 'startAt', 25);
    const endArg = optionalString(args, 'endAt', 25);
    const startAt = startArg === undefined ? before.startAt : normalizeDateTime(startArg, today);
    if (startAt === null) throw new ToolArgumentError('startAt은 YYYY-MM-DDTHH:mm(서울), 오늘부터 1년 안이어야 해요');
    let endAt: string | null;
    if (endArg !== undefined) {
      endAt = normalizeDateTime(endArg, today);
      if (endAt === null) throw new ToolArgumentError('endAt은 YYYY-MM-DDTHH:mm(서울), 오늘부터 1년 안이어야 해요');
    } else {
      // 시작만 옮기면 길이는 그대로 두고 끝도 같이 옮긴다
      endAt = seoulIso(new Date(Date.parse(startAt) + (event.endAt.getTime() - event.startAt.getTime())));
    }
    if (Date.parse(endAt) <= Date.parse(startAt)) throw new ToolArgumentError('끝 시각은 시작 시각보다 뒤여야 해요');
    const after = { scheduleEventTitle: title, scheduleEventDescription: description === undefined ? before.scheduleEventDescription : description, startAt, endAt };
    const changed = (Object.keys(after) as (keyof typeof after)[]).some((key) => (key === 'startAt' || key === 'endAt' ? Date.parse(after[key]) !== Date.parse(before[key]) : after[key] !== before[key]));
    if (!changed) throw new ToolArgumentError('바꿀 내용이 없어요. 무엇을 바꿀지 사용자에게 물어요');
    return { kind: 'SCHEDULE_EVENT_UPDATE', title: `일정 고치기 · ${title}`, scheduleEventId: event.id, before, ...after, issues: [] };
  }

  async proposeTask(user: AuthUser, args: Record<string, unknown>): Promise<ProposedTaskCard> {
    const id = optionalPositiveInt(args, 'taskId');
    if (id === undefined) throw new ToolArgumentError('taskId가 필요해요. get_my_tasks로 업무 id를 먼저 찾아요');
    const task = await this.repository.findTaskForCard(this.prisma, id);
    if (!task || (task.creatorId !== user.employeeId && task.assigneeId !== user.employeeId)) throw new ToolArgumentError('업무를 찾을 수 없어요. 업무를 등록한 사람과 담당자만 고칠 수 있어요');
    if (task.taskStatus !== TASK_STATUS.OPEN) throw new ToolArgumentError('완료된 업무는 고치거나 되돌릴 수 없어요');
    const complete = optionalBoolean(args, 'complete') === true;
    const before = { taskTitle: task.taskTitle, taskDescription: task.taskDescription, dueDate: task.dueDate.toISOString().slice(0, 10) };
    const title = optionalString(args, 'title', TASK_TITLE_MAX);
    const description = descriptionArg(args, TASK_DESCRIPTION_MAX);
    const dueArg = optionalString(args, 'dueDate', 10);
    const dueDate = dueArg === undefined ? before.dueDate : validDate(dueArg, seoulToday());
    if (dueDate === null) throw new ToolArgumentError('dueDate는 YYYY-MM-DD, 오늘부터 1년 안이어야 해요');
    const after = { taskTitle: title ?? before.taskTitle, taskDescription: description === undefined ? before.taskDescription : description, dueDate };
    const changed = (Object.keys(after) as (keyof typeof after)[]).some((key) => after[key] !== before[key]);
    if (complete) {
      if (changed) throw new ToolArgumentError('완료와 내용 고치기는 카드를 나눠야 해요. 하나씩 부탁해 달라고 안내해요');
      if (task.assigneeId !== user.employeeId) throw new ToolArgumentError('담당자만 완료할 수 있어요');
      return { kind: 'TASK_UPDATE', title: `업무 완료 · ${before.taskTitle}`, taskId: task.id, before, ...before, complete: true, issues: [] };
    }
    if (!changed) throw new ToolArgumentError('바꿀 내용이 없어요. 무엇을 바꿀지 사용자에게 물어요');
    return { kind: 'TASK_UPDATE', title: `업무 고치기 · ${after.taskTitle}`, taskId: task.id, before, ...after, complete: false, issues: [] };
  }

  /** 사용자가 확인·수정한 카드를 일정·업무 화면과 같은 service로 반영한다. 저장한 뒤 service가 Notion 반영을 깨운다 */
  async execute(user: AuthUser, dto: ExecuteAiActionCardDto): Promise<AiActionCardExecuteResult> {
    if (dto.kind === 'SCHEDULE_EVENT_UPDATE') {
      const title = dto.title?.trim();
      const missing = [...(dto.scheduleEventId === undefined ? ['일정'] : []), ...(!title ? ['제목'] : []), ...(!dto.startAt ? ['시작 시각'] : []), ...(!dto.endAt ? ['끝 시각'] : [])];
      if (missing.length > 0 || dto.scheduleEventId === undefined || !title || !dto.startAt || !dto.endAt) throw new AppException('ACT-001', `채워야 할 칸: ${missing.join(', ')}`);
      if (title.length > EVENT_TITLE_MAX) throw new AppException('COM-004', `일정 제목은 ${EVENT_TITLE_MAX}자까지예요`);
      const startAt = instantOf(dto.startAt);
      const endAt = instantOf(dto.endAt);
      if (!startAt || !endAt) throw new AppException('COM-004', '시각은 YYYY-MM-DDTHH:mm 또는 ISO 8601로 보내 주세요');
      const view = await this.scheduleEvents.update(user, dto.scheduleEventId, {
        scheduleEventTitle: title,
        scheduleEventDescription: dto.description?.trim() || null,
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
      });
      return { kind: 'SCHEDULE_EVENT_UPDATE', registered: { type: 'schedule_event', id: view.id, updated: true } };
    }
    if (dto.kind === 'TASK_UPDATE') {
      if (dto.taskId === undefined) throw new AppException('ACT-001', '채워야 할 칸: 업무');
      const edits = dto.title !== undefined || dto.description !== undefined || dto.dueDate !== undefined;
      if (dto.complete === true) {
        if (edits) throw new AppException('COM-004', '완료와 내용 고치기는 따로 실행해 주세요');
        const view = await this.tasks.complete(user, dto.taskId);
        return { kind: 'TASK_UPDATE', registered: { type: 'task', id: view.id, updated: true } };
      }
      if (!edits) throw new AppException('ACT-001', '바꿀 내용이 없어요');
      const view = await this.tasks.update(user, dto.taskId, {
        ...(dto.title !== undefined ? { taskTitle: dto.title } : {}),
        ...(dto.description !== undefined ? { taskDescription: dto.description } : {}),
        ...(dto.dueDate !== undefined ? { dueDate: dto.dueDate } : {}),
      });
      return { kind: 'TASK_UPDATE', registered: { type: 'task', id: view.id, updated: true } };
    }
    throw new AppException('COM-004', '카드 종류가 올바르지 않아요');
  }
}
