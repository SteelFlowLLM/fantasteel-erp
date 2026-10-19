import { Injectable } from '@nestjs/common';
import { missingFieldsOf, NOTIFICATION_TYPE, type AiWorkCard, type AiActionCardExecuteResult, type AuthUser, type MeetingCandidate } from '@fantasteel/shared';
import { AppException } from '../../common/errors/app.exception';
import { seoulToday } from '../../common/time/seoul-date';
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import { normalizeDateTime, matchEmployee, matchItem, quantityOf, validDate } from '../meeting-minutes/meeting-analysis.validator';
import { applyCandidateEdit, employeeIdsIn } from '../meeting-minutes/meeting-candidate.rules';
import { NotionWorkspaceService } from '../integration/notion/notion-workspace.service';
import { MessageActionService } from '../message-action/message-action.service';
import { NotificationService } from '../notification/notification.service';
import { TaskService } from '../notification/task.service';
import { scheduleWeekLink, shortSeoulTime } from '../schedule-event/schedule-notice';
import { AiAssistantRepository } from './ai-assistant.repository';
import type { ExecuteAiActionCardDto } from './dto/ai-assistant.dto';
import { optionalString, requiredString, ToolArgumentError } from './tools/assistant-tool';

export type ProposedCard = Omit<AiWorkCard, 'key'>;

/** 카드가 비워 둔 칸마다 붙는 확인 사유. 화면 카드에 그대로 보인다 */
const ISSUE = {
  assignee: '담당자를 정해 주세요',
  assigneeNotFound: (name: string) => `담당자 "${name}"을(를) 사원에서 찾지 못했어요`,
  dueDate: '마감일을 확인해 주세요 (오늘부터 1년 안)',
  attendeesNotFound: (names: string[]) => `참석자를 찾지 못했어요: ${names.join(', ')}`,
  eventStart: '일정 시각을 확인해 주세요 (오늘부터 1년 안)',
  eventEndAssumed: '끝 시각은 말이 없어 1시간으로 가정했어요',
  rawMaterial: '원료 품목을 확인해 주세요',
  quantityTon: '수량(톤)을 확인해 주세요',
  desiredReceiptDate: '희망 입고일을 확인해 주세요 (오늘부터 1년 안)',
} as const;

const KINDS = ['TASK', 'EVENT', 'PURCHASE'] as const;
const TITLE_MAX = 200;
const DESCRIPTION_MAX = 1000;
const NAME_MAX = 50;
const ATTENDEE_MAX = 20;
/** "나에게 …"처럼 사용자 본인을 가리키는 말 */
const SELF_WORDS = new Set(['나', '저', '내', '본인', '제', '자신']);

/**
 * AI 어시스턴트 실행 카드 (REQ-AST-005·010). 모델은 카드 내용을 제안만 하고 서버가 사원·품목·날짜·톤을 DB와 규칙으로 맞춘다.
 * 카드는 서버에 저장하지 않는다: 사용자가 칸을 확인·수정해 실행을 누르면 그 값을 다시 검증해 사용자 권한으로 등록한다(회의록 확정 등록과 같은 규칙).
 */
@Injectable()
export class AiActionCardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: AiAssistantRepository,
    private readonly tasks: TaskService,
    private readonly notifications: NotificationService,
    private readonly messageActions: MessageActionService,
    private readonly notionWorkspace: NotionWorkspaceService,
  ) {}

  /** 모델이 넘긴 인자를 카드로 만든다. 못 맞춘 칸은 비워 두고 확인 사유(issues)를 붙인다 */
  async propose(user: AuthUser, args: Record<string, unknown>): Promise<ProposedCard> {
    const kind = KINDS.find((k) => k === args.kind);
    if (!kind) throw new ToolArgumentError(`kind는 ${KINDS.join(', ')} 중 하나예요`);
    const title = requiredString(args, 'title', TITLE_MAX);
    const description = optionalString(args, 'description', DESCRIPTION_MAX) ?? null;
    const today = seoulToday();
    const card: ProposedCard = {
      kind,
      title,
      description,
      assigneeId: null,
      assigneeName: null,
      dueDate: null,
      startAt: null,
      endAt: null,
      endAssumed: false,
      attendeeIds: [],
      purchase: null,
      itemName: null,
      issues: [],
    };

    if (kind === 'TASK') {
      const pool = await this.employeePool();
      card.assigneeName = optionalString(args, 'assigneeName', NAME_MAX) ?? null;
      card.assigneeId = card.assigneeName === null ? null : this.employeeIdOf(user, card.assigneeName, pool);
      if (card.assigneeName === null) card.issues.push(ISSUE.assignee);
      else if (card.assigneeId === null) card.issues.push(ISSUE.assigneeNotFound(card.assigneeName));
      card.dueDate = validDate(optionalString(args, 'dueDate', 10), today);
      if (card.dueDate === null) card.issues.push(ISSUE.dueDate);
    } else if (kind === 'EVENT') {
      const names = (Array.isArray(args.attendeeNames) ? args.attendeeNames : []).slice(0, ATTENDEE_MAX).filter((n): n is string => typeof n === 'string' && n.trim() !== '');
      if (names.length === 0) {
        card.attendeeIds = [user.employeeId];
      } else {
        const pool = await this.employeePool();
        const matched = names.map((name) => ({ name, id: this.employeeIdOf(user, name.trim(), pool) }));
        card.attendeeIds = [...new Set(matched.flatMap((m) => (m.id === null ? [] : [m.id])))];
        const notFound = matched.filter((m) => m.id === null).map((m) => m.name.trim());
        if (notFound.length > 0) card.issues.push(ISSUE.attendeesNotFound(notFound));
      }
      card.startAt = normalizeDateTime(optionalString(args, 'startAt', 25), today);
      if (card.startAt === null) {
        card.issues.push(ISSUE.eventStart);
      } else {
        const given = normalizeDateTime(optionalString(args, 'endAt', 25), today);
        if (given !== null && given > card.startAt) {
          card.endAt = given;
        } else {
          card.endAt = oneHourAfter(card.startAt);
          card.endAssumed = true;
          card.issues.push(ISSUE.eventEndAssumed);
        }
      }
    } else {
      // 만들 수 없는 사람에게 카드를 보여 주면 실행에서야 막히므로 제안할 때 미리 알린다
      try {
        await this.messageActions.assertCanRequestFromMeeting(this.prisma, user);
      } catch (error) {
        if (error instanceof AppException) throw new ToolArgumentError(error.message);
        throw error;
      }
      card.itemName = optionalString(args, 'itemName', 100) ?? null;
      const rawMaterials = (await this.repository.findRawMaterials(this.prisma)).map((i) => ({ itemId: i.id, itemName: i.itemName, itemCode: i.itemCode }));
      const itemId = card.itemName === null ? null : matchItem(card.itemName, rawMaterials);
      const requestedTon = quantityOf(args.quantityTon);
      const desiredReceiptDate = validDate(optionalString(args, 'desiredReceiptDate', 10), today);
      if (itemId === null) card.issues.push(ISSUE.rawMaterial);
      if (requestedTon === null) card.issues.push(ISSUE.quantityTon);
      if (desiredReceiptDate === null) card.issues.push(ISSUE.desiredReceiptDate);
      card.purchase = { itemId, requestedTon, desiredReceiptDate, requestReason: title, sourceText: null };
    }
    return card;
  }

  /**
   * 사용자가 확인·수정한 카드를 등록한다. 모델이 아니라 사용자가 보낸 값이므로 회의록 후보 고치기와 같은 규칙으로 다시 검증하고,
   * 업무·일정은 바로 만들고 구매요청은 기존 초안 흐름(확인 대기 → 구매요청 → 부서장 승인)의 초안으로 만든다.
   * 업무·일정·초안 생성이 한 트랜잭션이라 중간에 실패하면 아무것도 남지 않는다.
   */
  async execute(user: AuthUser, dto: ExecuteAiActionCardDto): Promise<AiActionCardExecuteResult> {
    const kind = KINDS.find((k) => k === dto.kind);
    if (!kind) throw new AppException('COM-004', '카드 종류가 올바르지 않아요');
    const card = applyCandidateEdit(blankCandidate(kind), dto, seoulToday(), '오늘');
    const missing = missingFieldsOf(card);
    if (missing.length > 0) throw new AppException('ACT-001', `채워야 할 칸: ${missing.join(', ')}`);
    const registered = await this.prisma.$transaction(async (tx) => {
      await this.requireReferences(tx, card);
      return this.register(tx, user, card);
    });
    // 업무·일정이면 Notion 업무 공간(이슈 #391) 반영을 커밋 뒤에 깨운다
    if (registered.type !== 'action_draft') this.notionWorkspace.kick();
    return { kind, registered };
  }

  private async register(tx: Tx, user: AuthUser, card: MeetingCandidate): Promise<AiActionCardExecuteResult['registered']> {
    if (card.kind === 'TASK' && card.assigneeId !== null && card.dueDate !== null) {
      const id = await this.tasks.createInTx(tx, user.employeeId, {
        taskTitle: card.title,
        taskDescription: card.description,
        assigneeId: card.assigneeId,
        dueDate: new Date(`${card.dueDate}T00:00:00.000Z`),
        linkPath: '/tasks',
      });
      return { type: 'task', id };
    }
    if (card.kind === 'EVENT' && card.startAt !== null && card.endAt !== null) {
      const event = await this.repository.createScheduleEvent(
        tx,
        { scheduleEventTitle: card.title, scheduleEventDescription: card.description, startAt: new Date(card.startAt), endAt: new Date(card.endAt), creatorId: user.employeeId },
        card.attendeeIds,
      );
      await this.notifications.notifyEmployees(
        tx,
        card.attendeeIds.filter((employeeId) => employeeId !== user.employeeId),
        { notificationType: NOTIFICATION_TYPE.SCHEDULE_EVENT_ASSIGNED, notificationContent: `일정 등록 · ${card.title} · ${shortSeoulTime(card.startAt)}`, linkPath: scheduleWeekLink(card.startAt) },
      );
      return { type: 'schedule_event', id: event.id };
    }
    if (card.kind === 'PURCHASE' && card.purchase !== null) {
      const id = await this.messageActions.createFromAssistant(tx, user, { ...card.purchase, requestReason: card.purchase.requestReason?.trim() || card.title });
      return { type: 'action_draft', id };
    }
    throw new AppException('ACT-001', '채워야 할 칸을 확인해 주세요');
  }

  /** 담당자·참석자는 사용 중인 사원, 품목은 원료여야 한다. 카드를 보여 준 뒤 퇴사·삭제됐을 수 있어 실행할 때 다시 본다 */
  private async requireReferences(tx: Tx, card: MeetingCandidate): Promise<void> {
    const employeeIds = employeeIdsIn({ assigneeId: card.assigneeId ?? undefined, attendeeIds: card.attendeeIds });
    if (employeeIds.length > 0) {
      const found = new Set((await this.repository.findActiveEmployeeIds(tx, employeeIds)).map((e) => e.id));
      const missing = employeeIds.filter((id) => !found.has(id));
      if (missing.length > 0) throw new AppException('COM-003', `고른 사원을 찾을 수 없거나 퇴사했어요 (사원 id ${missing.join(', ')})`);
    }
    if (card.purchase?.itemId != null) {
      const found = await this.repository.findRawMaterialIds(tx, [card.purchase.itemId]);
      if (found.length === 0) throw new AppException('COM-004', `원료 품목을 찾을 수 없어요 (품목 id ${card.purchase.itemId})`);
    }
  }

  private async employeePool() {
    return (await this.repository.findActiveEmployees(this.prisma)).map((e) => ({ employeeId: e.id, employeeName: e.employeeName }));
  }

  private employeeIdOf(user: AuthUser, name: string, pool: { employeeId: number; employeeName: string }[]): number | null {
    if (SELF_WORDS.has(name) || name === user.employeeName) return user.employeeId;
    return matchEmployee(name, pool);
  }
}

/** 시작 시각(+09:00 ISO)의 1시간 뒤 */
function oneHourAfter(startAt: string): string {
  const end = new Date(Date.parse(startAt) + 3_600_000);
  const seoul = new Date(end.getTime() + 9 * 3_600_000).toISOString();
  return `${seoul.slice(0, 16)}:00+09:00`;
}

/** 실행 요청의 값을 후보 규칙(applyCandidateEdit)에 태우려고 빈 후보에서 시작한다 */
function blankCandidate(kind: MeetingCandidate['kind']): MeetingCandidate {
  return {
    key: 'a0',
    kind,
    title: '',
    description: null,
    evidence: [],
    sourceText: null,
    assigneeId: null,
    assigneeName: null,
    dueDate: null,
    startAt: null,
    endAt: null,
    endAssumed: false,
    attendeeIds: [],
    // 제목을 고칠 때 구매요청 사유가 따라가도록 사유를 제목('')과 같게 둔다
    purchase: kind === 'PURCHASE' ? { itemId: null, requestedTon: null, desiredReceiptDate: null, requestReason: '', sourceText: null } : null,
    itemName: null,
    relatedSalesOrderNo: null,
    salesOrderId: null,
    issues: [],
    context: [],
    decision: 'PENDING',
  };
}
