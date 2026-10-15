// 확인·등록(API-261)을 실제 DB(fs_collab)로 확인한다. 회의록은 REVIEW 상태로 직접 넣어 LLM 없이 시험한다.
import { Test, type TestingModule } from '@nestjs/testing';
import { BUSINESS_EVENT_TYPE, DRAFT_STATUS, NOTIFICATION_TYPE, type AuthUser, type MeetingCandidate } from '@fantasteel/shared';
import { AppModule } from '../../app.module';
import { AuthUserService } from '../../common/auth/auth-user.service';
import { AppException } from '../../common/errors/app.exception';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MessageActionService } from '../message-action/message-action.service';
import { ISSUE } from './meeting-analysis.validator';
import { MeetingMinutesService } from './meeting-minutes.service';

let moduleRef: TestingModule;
let prisma: PrismaService;
let service: MeetingMinutesService;
let messageActions: MessageActionService;
/** 정다은 (구매 사원, 작성자) */
let author: AuthUser;
/** 최준혁 (구매부장, 참석자) */
let head: AuthUser;
/** 박서영 (영업, 참석자) */
let sales: AuthUser;
/** 권예진 (물류) — 회의 참석자가 아닌 담당자 */
let outsider: AuthUser;
let oreId: number;
let startMinutesId = 0;
let startNotificationId = 0;
const createdMinutes: number[] = [];

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (e) {
    if (e instanceof AppException) return e.code;
    throw e;
  }
  throw new Error('오류가 나지 않았습니다');
}

const base = (key: string, kind: MeetingCandidate['kind'], overrides: Partial<MeetingCandidate>): MeetingCandidate => ({
  key,
  kind,
  title: `${key} 후보`,
  description: null,
  evidence: [0],
  sourceText: null,
  assigneeId: null,
  assigneeName: null,
  dueDate: null,
  startAt: null,
  endAt: null,
  endAssumed: false,
  attendeeIds: [],
  purchase: null,
  itemName: null,
  relatedSalesOrderNo: null,
  salesOrderId: null,
  issues: [],
  context: [],
  decision: 'PENDING',
  ...overrides,
});

const taskCandidate = (key: string, overrides: Partial<MeetingCandidate> = {}) => base(key, 'TASK', { assigneeId: null, dueDate: '2026-10-22', issues: [ISSUE.assignee, ISSUE.sameDay], ...overrides });
const eventCandidate = (key: string, overrides: Partial<MeetingCandidate> = {}) =>
  base(key, 'EVENT', {
    startAt: '2026-10-20T14:00:00+09:00',
    endAt: '2026-10-20T15:00:00+09:00',
    endAssumed: true,
    attendeeIds: [author.employeeId, head.employeeId, sales.employeeId],
    issues: [ISSUE.eventEndAssumed],
    ...overrides,
  });
const purchaseCandidate = (key: string, overrides: Partial<MeetingCandidate> = {}) =>
  base(key, 'PURCHASE', {
    purchase: { itemId: null, requestedTon: '20.000', desiredReceiptDate: '2026-10-31', requestReason: '규소 부족', sourceText: '규소가 부족하니 20톤 구매요청' },
    issues: [ISSUE.rawMaterial],
    ...overrides,
  });

/** REVIEW 상태 회의록을 직접 만든다 */
async function reviewMinutes(candidates: MeetingCandidate[], creator: AuthUser = author) {
  const analysis = { summary: 'AI 요약', decisions: [], candidates, model: 'test', analyzedAt: '2026-10-15T00:00:00.000Z' };
  const row = await prisma.meetingMinutes.create({
    data: {
      meetingMinutesTitle: '확인 시험 회의',
      meetingDate: new Date('2026-10-15T00:00:00.000Z'),
      meetingMinutesStatus: 'REVIEW',
      transcript: '정다은: 첫 발언\n최준혁: 둘째 발언',
      transcriptSegments: [
        { start: null, end: null, text: '정다은: 첫 발언' },
        { start: null, end: null, text: '최준혁: 둘째 발언' },
      ],
      summary: analysis.summary,
      analysisResult: analysis as unknown as Prisma.InputJsonObject,
      creatorId: creator.employeeId,
      attendees: { create: [author, head, sales].map((u) => ({ employeeId: u.employeeId })) },
    },
  });
  createdMinutes.push(row.id);
  return row.id;
}

const decide = (id: number, key: string, decision: 'PENDING' | 'APPROVED' | 'EXCLUDED') => service.updateCandidate(author, id, key, { decision });

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  await moduleRef.init();
  prisma = moduleRef.get(PrismaService);
  service = moduleRef.get(MeetingMinutesService);
  messageActions = moduleRef.get(MessageActionService);
  const authUsers = moduleRef.get(AuthUserService);
  const load = async (employeeNo: string) => {
    const employee = await prisma.employee.findUniqueOrThrow({ where: { employeeNo } });
    const user = await authUsers.load(employee.id);
    if (!user) throw new Error(employeeNo);
    return user;
  };
  author = await load('2207005');
  head = await load('1702004');
  sales = await load('2103003');
  outsider = await load('2304015');
  oreId = (await prisma.item.findUniqueOrThrow({ where: { itemCode: 'ORE01' } })).id;
  startMinutesId = (await prisma.meetingMinutes.aggregate({ _max: { id: true } }))._max.id ?? 0;
  startNotificationId = (await prisma.notification.aggregate({ _max: { id: true } }))._max.id ?? 0;
}, 60_000);

afterAll(async () => {
  // 구매요청 초안·작업 로그는 지울 수 없는 연결이 있어(작업 로그 불변) 업무·일정·알림만 치운다. 시험 DB는 실행마다 새로 만든다
  await prisma?.notification.deleteMany({ where: { id: { gt: startNotificationId } } });
  await prisma?.task.deleteMany({ where: { meetingMinutesId: { in: createdMinutes } } });
  await prisma?.scheduleEventAttendee.deleteMany({ where: { scheduleEvent: { meetingMinutesId: { in: createdMinutes } } } });
  await prisma?.scheduleEvent.deleteMany({ where: { meetingMinutesId: { in: createdMinutes } } });
  await moduleRef?.close();
});

describe('후보 고치기 (PATCH candidates/:key)', () => {
  it('작성자만, 검토 중일 때만, 있는 후보만 고친다', async () => {
    const id = await reviewMinutes([taskCandidate('c1')]);
    expect(await codeOf(service.updateCandidate(head, id, 'c1', { title: '다른 사람' }))).toBe('VOC-003');
    expect(await codeOf(service.updateCandidate(author, id, 'c9', { title: 'x' }))).toBe('COM-003');
    expect(await codeOf(service.updateCandidate(author, 2_000_000_000, 'c1', { title: 'x' }))).toBe('VOC-001');
    await prisma.meetingMinutes.update({ where: { id }, data: { meetingMinutesStatus: 'TRANSCRIBED' } });
    expect(await codeOf(service.updateCandidate(author, id, 'c1', { title: 'x' }))).toBe('VOC-004');
  });

  it('분석과 같은 규칙으로 값을 검증한다 (범위·사원·원료·톤·시각 순서·종류)', async () => {
    const id = await reviewMinutes([taskCandidate('c1'), eventCandidate('c2'), purchaseCandidate('c3')]);
    const slabId = (await prisma.item.findFirstOrThrow({ where: { itemType: 'SLAB' }, orderBy: { id: 'asc' } })).id;
    expect(await codeOf(service.updateCandidate(author, id, 'c1', { dueDate: '2026-10-14' }))).toBe('COM-004');
    expect(await codeOf(service.updateCandidate(author, id, 'c1', { dueDate: '2028-01-01' }))).toBe('COM-004');
    expect(await codeOf(service.updateCandidate(author, id, 'c1', { dueDate: '2026-02-30' }))).toBe('COM-004');
    expect(await codeOf(service.updateCandidate(author, id, 'c1', { assigneeId: 2_000_000_000 }))).toBe('VOC-002');
    expect(await codeOf(service.updateCandidate(author, id, 'c1', { title: '   ' }))).toBe('COM-004');
    expect(await codeOf(service.updateCandidate(author, id, 'c2', { endAt: '2026-10-20T13:00' }))).toBe('COM-004');
    expect(await codeOf(service.updateCandidate(author, id, 'c2', { startAt: '2026-10-20T25:00' }))).toBe('COM-004');
    expect(await codeOf(service.updateCandidate(author, id, 'c2', { attendeeIds: [] }))).toBe('COM-004');
    expect(await codeOf(service.updateCandidate(author, id, 'c2', { attendeeIds: [2_000_000_000] }))).toBe('VOC-002');
    expect(await codeOf(service.updateCandidate(author, id, 'c3', { purchase: { itemId: slabId } }))).toBe('COM-004');
    expect(await codeOf(service.updateCandidate(author, id, 'c3', { purchase: { requestedTon: '1.2345' } }))).toBe('COM-004');
    expect(await codeOf(service.updateCandidate(author, id, 'c3', { purchase: { requestedTon: '0' } }))).toBe('COM-004');
    expect(await codeOf(service.updateCandidate(author, id, 'c3', { purchase: { desiredReceiptDate: '2026-10-01' } }))).toBe('COM-004');
    // 종류에 없는 칸
    expect(await codeOf(service.updateCandidate(author, id, 'c2', { assigneeId: author.employeeId }))).toBe('COM-004');
    expect(await codeOf(service.updateCandidate(author, id, 'c1', { purchase: { itemId: oreId } }))).toBe('COM-004');
  });

  it('직접 정한 칸은 그 칸의 확인 사유를 지운다. 담당자·참석자는 회의 참석자가 아니어도 된다', async () => {
    const id = await reviewMinutes([
      taskCandidate('c1'),
      eventCandidate('c2', { issues: [ISSUE.eventEndAssumed, ISSUE.eventAttendees] }),
      purchaseCandidate('c3', { issues: [ISSUE.rawMaterial, ISSUE.quantityTon, ISSUE.desiredReceiptDate] }),
    ]);

    let view = await service.updateCandidate(author, id, 'c1', { assigneeId: outsider.employeeId });
    expect(view.analysisResult?.candidates[0]).toMatchObject({ assigneeId: outsider.employeeId, issues: [ISSUE.sameDay] });
    view = await service.updateCandidate(author, id, 'c1', { dueDate: '2026-10-23', title: '  새 제목  ' });
    expect(view.analysisResult?.candidates[0]).toMatchObject({ dueDate: '2026-10-23', title: '새 제목', issues: [] });

    view = await service.updateCandidate(author, id, 'c2', { endAt: '2026-10-20T16:30' });
    expect(view.analysisResult?.candidates[1]).toMatchObject({ endAt: '2026-10-20T16:30:00+09:00', endAssumed: false, issues: [ISSUE.eventAttendees] });
    view = await service.updateCandidate(author, id, 'c2', { attendeeIds: [author.employeeId, outsider.employeeId] });
    expect(view.analysisResult?.candidates[1]).toMatchObject({ attendeeIds: [author.employeeId, outsider.employeeId], issues: [] });

    view = await service.updateCandidate(author, id, 'c3', { purchase: { itemId: oreId, requestedTon: '25.5', desiredReceiptDate: '2026-11-05' } });
    expect(view.analysisResult?.candidates[2]).toMatchObject({ purchase: { itemId: oreId, requestedTon: '25.500', desiredReceiptDate: '2026-11-05' }, issues: [] });
  });

  it('끝 시각을 가정한 일정은 시작을 옮기면 끝도 1시간 뒤로 옮긴다', async () => {
    const id = await reviewMinutes([eventCandidate('c1')]);
    const view = await service.updateCandidate(author, id, 'c1', { startAt: '2026-10-21T09:30' });
    expect(view.analysisResult?.candidates[0]).toMatchObject({ startAt: '2026-10-21T09:30:00+09:00', endAt: '2026-10-21T10:30:00+09:00', endAssumed: true });
  });

  it('허가는 필수 칸이 다 찬 후보만 된다. 남은 경고는 막지 않고, 제외한 것은 되살릴 수 있다', async () => {
    const id = await reviewMinutes([taskCandidate('c1'), eventCandidate('c2'), purchaseCandidate('c3')]);
    await expect(service.updateCandidate(author, id, 'c1', { decision: 'APPROVED' })).rejects.toMatchObject({ response: { code: 'VOC-006', message: expect.stringContaining('담당자') } });
    expect(await codeOf(decide(id, 'c3', 'APPROVED'))).toBe('VOC-006');
    // 필수 칸을 같은 요청에서 채우며 허가해도 된다
    const approved = await service.updateCandidate(author, id, 'c1', { assigneeId: outsider.employeeId, decision: 'APPROVED' });
    expect(approved.analysisResult?.candidates[0].decision).toBe('APPROVED');
    // 끝 시각 가정 경고가 남아 있어도 허가된다
    expect((await decide(id, 'c2', 'APPROVED')).analysisResult?.candidates[1]).toMatchObject({ decision: 'APPROVED', issues: [ISSUE.eventEndAssumed] });
    expect((await decide(id, 'c2', 'EXCLUDED')).analysisResult?.candidates[1].decision).toBe('EXCLUDED');
    expect((await decide(id, 'c2', 'PENDING')).analysisResult?.candidates[1].decision).toBe('PENDING');
  });

  it('요약은 작성자가 검토 중에만 고치고, 분석 결과 안의 요약도 같이 바뀐다', async () => {
    const id = await reviewMinutes([taskCandidate('c1')]);
    expect(await codeOf(service.updateSummary(head, id, { summary: 'x' }))).toBe('VOC-003');
    const view = await service.updateSummary(author, id, { summary: '  고친 요약  ' });
    expect(view.summary).toBe('고친 요약');
    expect(view.analysisResult?.summary).toBe('고친 요약');
  });
});

describe('확정하고 등록 (POST register, API-261)', () => {
  it('남은 후보가 있으면 하지 않고, 작성자가 아니면 거절한다', async () => {
    const id = await reviewMinutes([taskCandidate('c1', { assigneeId: outsider.employeeId })]);
    expect(await codeOf(service.register(head, id))).toBe('VOC-003');
    expect(await codeOf(service.register(author, id))).toBe('VOC-007');
    expect((await prisma.meetingMinutes.findUniqueOrThrow({ where: { id } })).meetingMinutesStatus).toBe('REVIEW');
  });

  it('허가한 후보를 업무·일정·구매요청 초안으로 한 번에 만들고 로그·알림을 남긴다', async () => {
    const id = await reviewMinutes([
      taskCandidate('c1', { title: '견적 정리', description: '동해철강 견적', assigneeId: outsider.employeeId, evidence: [0, 1] }),
      eventCandidate('c2', { title: '동해철강 방문' }),
      purchaseCandidate('c3', { purchase: { itemId: oreId, requestedTon: '20.000', desiredReceiptDate: '2026-10-31', requestReason: '규소 부족', sourceText: '근거 글' } }),
      taskCandidate('c4', { title: '제외할 일', assigneeId: head.employeeId }),
    ]);
    for (const key of ['c1', 'c2', 'c3']) await decide(id, key, 'APPROVED');
    await decide(id, 'c4', 'EXCLUDED');

    const result = await service.register(author, id);
    expect(result.meetingMinutes).toMatchObject({ meetingMinutesStatus: 'CONFIRMED' });
    expect(result.meetingMinutes.confirmedAt).not.toBeNull();
    expect(result).toMatchObject({ excludedKeys: ['c4'] });
    expect(result.taskIds).toHaveLength(1);
    expect(result.scheduleEventIds).toHaveLength(1);
    expect(result.actionDraftIds).toHaveLength(1);

    const task = await prisma.task.findUniqueOrThrow({ where: { id: result.taskIds[0] } });
    expect(task).toMatchObject({ taskTitle: '견적 정리', assigneeId: outsider.employeeId, creatorId: author.employeeId, taskStatus: 'OPEN', meetingMinutesId: id, linkPath: `/meetings?id=${id}` });
    expect(task.dueDate.toISOString().slice(0, 10)).toBe('2026-10-22');
    expect(task.taskDescription).toBe('동해철강 견적\n\n근거 발언: "정다은: 첫 발언" / "최준혁: 둘째 발언"');

    const event = await prisma.scheduleEvent.findUniqueOrThrow({ where: { id: result.scheduleEventIds[0] }, include: { attendees: true } });
    expect(event).toMatchObject({ scheduleEventTitle: '동해철강 방문', creatorId: author.employeeId, meetingMinutesId: id });
    expect(event.startAt.toISOString()).toBe('2026-10-20T05:00:00.000Z');
    expect(event.endAt.toISOString()).toBe('2026-10-20T06:00:00.000Z');
    expect(event.attendees.map((a) => a.employeeId).sort()).toEqual([author.employeeId, head.employeeId, sales.employeeId].sort());

    const draft = await messageActions.get(author, result.actionDraftIds[0]);
    expect(draft).toMatchObject({
      draftStatus: DRAFT_STATUS.WAITING_APPROVAL,
      requesterId: author.employeeId,
      message: null,
      meetingMinutes: { id, title: '확인 시험 회의' },
      payload: { itemId: oreId, requestedTon: '20.000', desiredReceiptDate: '2026-10-31', requestReason: '규소 부족', sourceText: '근거 글', aiFilledFields: ['itemId', 'requestedTon', 'desiredReceiptDate'] },
      unresolvedFields: [],
    });
    expect((await messageActions.list(author, {})).map((d) => d.id)).toContain(draft.id);

    // 작업 로그: 초안 생성(AI 보조)과 회의록 확정
    const draftEvent = await prisma.businessEvent.findFirstOrThrow({ where: { businessEventType: BUSINESS_EVENT_TYPE.DRAFT_CREATED, actionDraftId: draft.id } });
    expect(draftEvent).toMatchObject({ actorEmployeeId: author.employeeId, isAiAssisted: true, messageId: null });
    const confirmed = await prisma.businessEvent.findFirstOrThrow({ where: { businessEventType: BUSINESS_EVENT_TYPE.MEETING_MINUTES_CONFIRMED, targetId: id } });
    expect(confirmed).toMatchObject({ actorEmployeeId: author.employeeId, targetType: 'meeting_minutes', isAiAssisted: true });
    expect(confirmed.afterData).toMatchObject({ taskIds: result.taskIds, scheduleEventIds: result.scheduleEventIds, actionDraftIds: result.actionDraftIds, excludedKeys: ['c4'] });

    // 알림: 받는 사람마다 종류별로 하나씩, 작업 로그 id는 달지 않는다. 작성자 본인은 받지 않는다
    const notices = await prisma.notification.findMany({ where: { id: { gt: startNotificationId } }, orderBy: { id: 'asc' } });
    const mine = (type: string) => notices.filter((n) => n.notificationType === type);
    expect(
      mine(NOTIFICATION_TYPE.TASK_ASSIGNED)
        .filter((n) => n.notificationContent === '업무 지정 · 견적 정리')
        .map((n) => n.recipientId),
    ).toEqual([outsider.employeeId]);
    expect(
      mine(NOTIFICATION_TYPE.SCHEDULE_EVENT_ASSIGNED)
        .filter((n) => n.notificationContent === '일정 등록 · 동해철강 방문 · 10/20 14:00')
        .map((n) => n.recipientId)
        .sort(),
    ).toEqual([head.employeeId, sales.employeeId].sort());
    expect(mine(NOTIFICATION_TYPE.SCHEDULE_EVENT_ASSIGNED).filter((n) => n.notificationContent.startsWith('일정 등록 · 동해철강 방문')).every((n) => n.linkPath === '/schedule?week=2026-10-19')).toBe(true);
    const shared = mine(NOTIFICATION_TYPE.MEETING_MINUTES_SHARED).filter((n) => n.linkPath === `/meetings?id=${id}`);
    expect(shared.map((n) => n.recipientId).sort()).toEqual([head.employeeId, sales.employeeId].sort());
    expect(shared.every((n) => n.notificationContent === '회의록 공유 · 확인 시험 회의')).toBe(true);
    expect(notices.every((n) => n.businessEventId === null)).toBe(true);

    // 각 후보가 만든 결과가 분석 결과에 적힌다
    const candidates = result.meetingMinutes.analysisResult?.candidates ?? [];
    expect(candidates.map((c) => c.registered ?? null)).toEqual([
      { type: 'task', id: result.taskIds[0] },
      { type: 'schedule_event', id: result.scheduleEventIds[0] },
      { type: 'action_draft', id: result.actionDraftIds[0] },
      null,
    ]);
  });

  it('확정한 뒤에는 다시 등록·고치기·재정리가 모두 VOC-004이고 행이 더 생기지 않는다', async () => {
    const id = await reviewMinutes([taskCandidate('c1', { assigneeId: outsider.employeeId }), taskCandidate('c2', { assigneeId: head.employeeId })]);
    await decide(id, 'c1', 'APPROVED');
    await decide(id, 'c2', 'EXCLUDED');
    const first = await service.register(author, id);
    expect(first.taskIds).toHaveLength(1);
    expect(await codeOf(service.register(author, id))).toBe('VOC-004');
    expect(await codeOf(decide(id, 'c2', 'APPROVED'))).toBe('VOC-004');
    expect(await codeOf(service.updateCandidate(author, id, 'c1', { title: '바꿈' }))).toBe('VOC-004');
    expect(await codeOf(service.updateSummary(author, id, { summary: '바꿈' }))).toBe('VOC-004');
    expect(await codeOf(service.analyze(author, id))).toBe('VOC-004');
    expect(await prisma.task.count({ where: { meetingMinutesId: id } })).toBe(1);
  });

  it('허가한 후보가 하나도 없어도 회의록은 확정된다 (알림만 공유)', async () => {
    const id = await reviewMinutes([taskCandidate('c1', { assigneeId: outsider.employeeId })]);
    await decide(id, 'c1', 'EXCLUDED');
    const result = await service.register(author, id);
    expect(result).toMatchObject({ taskIds: [], scheduleEventIds: [], actionDraftIds: [], excludedKeys: ['c1'] });
    expect(result.meetingMinutes.meetingMinutesStatus).toBe('CONFIRMED');
  });

  it('구매요청 초안을 만들 수 없는 작성자는 구매 후보를 허가할 수 없다', async () => {
    const id = await reviewMinutes(
      [purchaseCandidate('c1', { purchase: { itemId: oreId, requestedTon: '5.000', desiredReceiptDate: '2026-10-31', requestReason: 'x', sourceText: null } })],
      sales,
    );
    expect(await codeOf(service.updateCandidate(sales, id, 'c1', { decision: 'APPROVED' }))).toBe('COM-002');
    expect((await service.get(id)).analysisResult?.candidates[0].decision).toBe('PENDING');
  });

  it('허가 뒤 권한이 바뀌어 초안을 못 만들면 전부 취소되고 REVIEW로 남는다', async () => {
    const id = await reviewMinutes(
      [
        taskCandidate('c1', { assigneeId: outsider.employeeId, decision: 'APPROVED' }),
        purchaseCandidate('c2', { decision: 'APPROVED', purchase: { itemId: oreId, requestedTon: '5.000', desiredReceiptDate: '2026-10-31', requestReason: 'x', sourceText: null } }),
      ],
      sales,
    );
    expect(await codeOf(service.register(sales, id))).toBe('COM-002');
    expect((await prisma.meetingMinutes.findUniqueOrThrow({ where: { id } })).meetingMinutesStatus).toBe('REVIEW');
    expect(await prisma.task.count({ where: { meetingMinutesId: id } })).toBe(0);
    expect(await prisma.businessEvent.count({ where: { businessEventType: BUSINESS_EVENT_TYPE.MEETING_MINUTES_CONFIRMED, targetId: id } })).toBe(0);
  });

  it('회의록에서 만든 구매요청 초안도 기존 확정·실행으로 구매요청이 된다', async () => {
    const id = await reviewMinutes([purchaseCandidate('c1', { purchase: { itemId: oreId, requestedTon: '12.5', desiredReceiptDate: '2026-11-10', requestReason: '규소 부족', sourceText: '근거 글' } })]);
    await decide(id, 'c1', 'APPROVED');
    const { actionDraftIds } = await service.register(author, id);
    const [draftId] = actionDraftIds;
    expect(await codeOf(messageActions.confirm(head, draftId, {}))).toBe('COM-002');
    const result = await messageActions.confirm(author, draftId, {});
    expect(result).toMatchObject({ executed: true, errorCode: null, draft: { draftStatus: DRAFT_STATUS.EXECUTED, meetingMinutes: { id }, result: { table: 'purchase_requisition', status: 'WAITING_APPROVAL' } } });
    const requisition = await prisma.purchaseRequisition.findUniqueOrThrow({ where: { actionDraftId: draftId } });
    expect(requisition).toMatchObject({ itemId: oreId, requesterId: author.employeeId });
    expect(requisition.requestedTon.toFixed(3)).toBe('12.500');
    expect(requisition.desiredReceiptDate.toISOString().slice(0, 10)).toBe('2026-11-10');
    // AI가 회의에서 뽑은 초안이라 생성부터 실행까지 모두 AI 경유다 (REQ-AST-010)
    const events = await prisma.businessEvent.findMany({ where: { actionDraftId: draftId }, orderBy: { id: 'asc' } });
    expect(events.map((e) => [e.businessEventType, e.isAiAssisted])).toEqual([
      [BUSINESS_EVENT_TYPE.DRAFT_CREATED, true],
      [BUSINESS_EVENT_TYPE.DRAFT_CONFIRMED, true],
      [BUSINESS_EVENT_TYPE.PURCHASE_REQUISITION_CREATED, true],
      [BUSINESS_EVENT_TYPE.DRAFT_EXECUTED, true],
    ]);
  });
});
