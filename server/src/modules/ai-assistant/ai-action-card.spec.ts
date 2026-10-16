// AI 어시스턴트 실행 카드(REQ-AST-005)를 실제 DB(fs_collab)로 확인한다: 카드 제안 → 사용자 실행 → 업무·일정·구매요청 초안.
import { Test, type TestingModule } from '@nestjs/testing';
import { BUSINESS_EVENT_TYPE, DRAFT_STATUS, NOTIFICATION_TYPE, type AuthUser } from '@fantasteel/shared';
import { AppModule } from '../../app.module';
import { AuthUserService } from '../../common/auth/auth-user.service';
import { AppException } from '../../common/errors/app.exception';
import { seoulToday } from '../../common/time/seoul-date';
import { PrismaService } from '../../prisma/prisma.service';
import { AiActionCardService } from './ai-action-card.service';
import type { ExecuteAiActionCardDto } from './dto/ai-assistant.dto';
import { ToolArgumentError } from './tools/assistant-tool';

let moduleRef: TestingModule;
let prisma: PrismaService;
let service: AiActionCardService;
/** 정다은 (구매 사원: 구매요청 등록 권한 있음) */
let author: AuthUser;
/** 박서영 (영업: 구매요청 등록 권한 없음) */
let sales: AuthUser;
let oreId: number;
let startTaskId = 0;
let startEventId = 0;
let startNotificationId = 0;

const plusDays = (days: number): string => new Date(Date.parse(`${seoulToday()}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10);
const dto = (over: Partial<ExecuteAiActionCardDto>): ExecuteAiActionCardDto => ({ kind: 'TASK', title: '견적서 보내기', ...over }) as ExecuteAiActionCardDto;

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (e) {
    if (e instanceof AppException) return e.code;
    throw e;
  }
  throw new Error('오류가 나지 않았습니다');
}

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  await moduleRef.init();
  prisma = moduleRef.get(PrismaService);
  service = moduleRef.get(AiActionCardService);
  const authUsers = moduleRef.get(AuthUserService);
  const load = async (employeeNo: string) => {
    const employee = await prisma.employee.findUniqueOrThrow({ where: { employeeNo } });
    const user = await authUsers.load(employee.id);
    if (!user) throw new Error(employeeNo);
    return user;
  };
  author = await load('2207005');
  sales = await load('2103003');
  oreId = (await prisma.item.findUniqueOrThrow({ where: { itemCode: 'ORE01' } })).id;
  startTaskId = (await prisma.task.aggregate({ _max: { id: true } }))._max.id ?? 0;
  startEventId = (await prisma.scheduleEvent.aggregate({ _max: { id: true } }))._max.id ?? 0;
  startNotificationId = (await prisma.notification.aggregate({ _max: { id: true } }))._max.id ?? 0;
}, 60_000);

afterAll(async () => {
  // 구매요청 초안·작업 로그는 지울 수 없는 연결이 있어(작업 로그 불변) 업무·일정·알림만 치운다. 시험 DB는 실행마다 새로 만든다
  await prisma?.notification.deleteMany({ where: { id: { gt: startNotificationId } } });
  await prisma?.task.deleteMany({ where: { id: { gt: startTaskId } } });
  await prisma?.scheduleEventAttendee.deleteMany({ where: { scheduleEventId: { gt: startEventId } } });
  await prisma?.scheduleEvent.deleteMany({ where: { id: { gt: startEventId } } });
  await moduleRef?.close();
});

describe('실행 카드 제안', () => {
  it('업무: 이름을 실제 사원 id로 맞춘다', async () => {
    const card = await service.propose(author, { kind: 'TASK', title: '견적서 보내기', assigneeName: sales.employeeName, dueDate: plusDays(3) });
    expect(card).toMatchObject({ assigneeId: sales.employeeId, dueDate: plusDays(3), issues: [] });
  });

  it('구매요청: 원료 이름을 실제 원료 품목 id로 맞추고, 권한 없는 역할에는 카드를 만들지 않는다', async () => {
    const card = await service.propose(author, { kind: 'PURCHASE', title: '철광석 구매요청', itemName: '철광석', quantityTon: 20, desiredReceiptDate: plusDays(10) });
    expect(card.purchase).toMatchObject({ itemId: oreId, requestedTon: '20.000' });
    await expect(service.propose(sales, { kind: 'PURCHASE', title: '철광석 구매요청', itemName: '철광석' })).rejects.toThrow(ToolArgumentError);
  });
});

describe('실행 카드 실행', () => {
  it('업무: 사용자를 등록자로 업무를 만들고 담당자에게 알린다', async () => {
    const result = await service.execute(author, dto({ assigneeId: sales.employeeId, dueDate: plusDays(5), description: '고객사 요청' }));
    expect(result.registered.type).toBe('task');
    const task = await prisma.task.findUniqueOrThrow({ where: { id: result.registered.id } });
    expect(task).toMatchObject({ taskTitle: '견적서 보내기', taskDescription: '고객사 요청', creatorId: author.employeeId, assigneeId: sales.employeeId, taskStatus: 'OPEN' });
    const notices = await prisma.notification.findMany({ where: { id: { gt: startNotificationId }, recipientId: sales.employeeId, notificationType: NOTIFICATION_TYPE.TASK_ASSIGNED } });
    expect(notices.some((n) => n.notificationContent === '업무 지정 · 견적서 보내기')).toBe(true);
  });

  it('업무: 필수 칸이 비면 아무것도 만들지 않는다', async () => {
    const before = await prisma.task.count();
    expect(await codeOf(service.execute(author, dto({ assigneeId: sales.employeeId })))).toBe('ACT-001');
    expect(await codeOf(service.execute(author, dto({ assigneeId: 2_000_000_000, dueDate: plusDays(5) })))).toBe('COM-003');
    expect(await prisma.task.count()).toBe(before);
  });

  it('일정: 일정과 참석자를 만들고 본인을 뺀 참석자에게만 알린다', async () => {
    const day = plusDays(4);
    const result = await service.execute(author, dto({ kind: 'EVENT', title: '라인 점검', startAt: `${day}T14:00`, attendeeIds: [author.employeeId, sales.employeeId] }));
    expect(result.registered.type).toBe('schedule_event');
    const event = await prisma.scheduleEvent.findUniqueOrThrow({ where: { id: result.registered.id }, include: { attendees: true } });
    expect(event).toMatchObject({ scheduleEventTitle: '라인 점검', creatorId: author.employeeId, meetingMinutesId: null });
    expect(event.startAt.toISOString()).toBe(new Date(`${day}T14:00:00+09:00`).toISOString());
    expect(event.endAt.toISOString()).toBe(new Date(`${day}T15:00:00+09:00`).toISOString());
    expect(event.attendees.map((a) => a.employeeId).sort()).toEqual([author.employeeId, sales.employeeId].sort());
    const notices = await prisma.notification.findMany({ where: { id: { gt: startNotificationId }, notificationType: NOTIFICATION_TYPE.SCHEDULE_EVENT_ASSIGNED } });
    expect(notices.map((n) => n.recipientId)).toEqual([sales.employeeId]);
  });

  it('구매요청: 메시지·회의록 없이 확인 대기 초안을 만들고 AI 경유로 남긴다', async () => {
    const result = await service.execute(author, dto({ kind: 'PURCHASE', title: '철광석 구매요청', purchase: { itemId: oreId, requestedTon: '20', desiredReceiptDate: plusDays(10) } }));
    expect(result.registered.type).toBe('action_draft');
    const draft = await prisma.actionDraft.findUniqueOrThrow({ where: { id: result.registered.id } });
    expect(draft).toMatchObject({ draftStatus: DRAFT_STATUS.WAITING_APPROVAL, requesterId: author.employeeId, messageId: null, meetingMinutesId: null });
    expect(draft.payload).toMatchObject({ itemId: oreId, requestedTon: '20.000', requestReason: '철광석 구매요청', aiFilledFields: ['itemId', 'requestedTon', 'desiredReceiptDate'] });
    const event = await prisma.businessEvent.findFirstOrThrow({ where: { actionDraftId: draft.id, businessEventType: BUSINESS_EVENT_TYPE.DRAFT_CREATED } });
    expect(event.isAiAssisted).toBe(true);
  });

  it('구매요청: 구매요청 등록 권한이 없는 사용자는 실행할 수 없다', async () => {
    const before = await prisma.actionDraft.count();
    expect(await codeOf(service.execute(sales, dto({ kind: 'PURCHASE', title: '철광석 구매요청', purchase: { itemId: oreId, requestedTon: '20', desiredReceiptDate: plusDays(10) } })))).toBe('COM-002');
    expect(await prisma.actionDraft.count()).toBe(before);
  });
});
