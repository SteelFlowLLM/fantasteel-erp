import { ROLE, type AuthUser } from '@fantasteel/shared';
import { AppException } from '../../common/errors/app.exception';
import { seoulToday } from '../../common/time/seoul-date';
import type { PrismaService, Tx } from '../../prisma/prisma.service';
import type { MessageActionService } from '../message-action/message-action.service';
import type { NotificationService } from '../notification/notification.service';
import type { TaskService } from '../notification/task.service';
import { AiActionCardService } from './ai-action-card.service';
import type { AiAssistantRepository } from './ai-assistant.repository';
import type { ExecuteAiActionCardDto } from './dto/ai-assistant.dto';
import { ToolArgumentError } from './tools/assistant-tool';

const user: AuthUser = { employeeId: 1, employeeNo: '2205013', employeeName: '서민지', roleCode: ROLE.SALES, departmentId: 1, jobGradeId: 1, headDepartmentIds: [], permissions: {} };

const plusDays = (days: number): string => new Date(Date.parse(`${seoulToday()}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10);

function setup(options: { canRequestPurchase?: boolean; inactiveIds?: number[] } = {}) {
  const calls: { name: string; args: unknown[] }[] = [];
  const record = <T>(name: string, result: T) => async (...args: unknown[]): Promise<T> => {
    calls.push({ name, args });
    return result;
  };
  const prisma = { $transaction: async (run: (tx: Tx) => Promise<unknown>) => run({} as Tx) } as unknown as PrismaService;
  const repository = {
    findActiveEmployees: async () => [
      { id: 1, employeeName: '서민지' },
      { id: 7, employeeName: '박서영' },
      { id: 8, employeeName: '이도윤' },
    ],
    findActiveEmployeeIds: async (_tx: unknown, ids: number[]) => ids.filter((id) => !(options.inactiveIds ?? []).includes(id)).map((id) => ({ id })),
    findRawMaterials: async () => [
      { id: 3, itemCode: 'ORE01', itemName: '철광석' },
      { id: 4, itemCode: 'SCR01', itemName: '고철' },
    ],
    findRawMaterialIds: async (_tx: unknown, ids: number[]) => ids.map((id) => ({ id })),
    createScheduleEvent: record('createScheduleEvent', { id: 21 }),
  } as unknown as AiAssistantRepository;
  const tasks = { createInTx: record('createInTx', 11) } as unknown as TaskService;
  const notifications = { notifyEmployees: record('notifyEmployees', undefined) } as unknown as NotificationService;
  const messageActions = {
    assertCanRequestFromMeeting: async () => {
      if (options.canRequestPurchase === false) throw new AppException('COM-002', '구매요청 등록 권한이 없어요');
    },
    createFromAssistant: record('createFromAssistant', 31),
  } as unknown as MessageActionService;
  return { service: new AiActionCardService(prisma, repository, tasks, notifications, messageActions), calls };
}

const dto = (over: Partial<ExecuteAiActionCardDto>): ExecuteAiActionCardDto => ({ kind: 'TASK', title: '견적서 보내기', ...over }) as ExecuteAiActionCardDto;

describe('실행 카드 제안 (모델이 낸 값을 서버 규칙으로 맞춘다)', () => {
  it('업무: 담당자 이름은 사원 id로, 마감일은 오늘부터 1년 안의 날짜만 받는다', async () => {
    const { service } = setup();
    const due = plusDays(3);
    const card = await service.propose(user, { kind: 'TASK', title: '견적서 보내기', assigneeName: '박서영', dueDate: due });
    expect(card).toMatchObject({ kind: 'TASK', assigneeId: 7, assigneeName: '박서영', dueDate: due, issues: [] });
  });

  it('업무: "나"는 사용자 본인이고, 못 찾은 이름·지난 날짜는 비워 두고 사유를 붙인다', async () => {
    const { service } = setup();
    expect((await service.propose(user, { kind: 'TASK', title: 'a', assigneeName: '나', dueDate: plusDays(1) })).assigneeId).toBe(1);
    const card = await service.propose(user, { kind: 'TASK', title: 'a', assigneeName: '없는사람', dueDate: plusDays(-1) });
    expect(card.assigneeId).toBeNull();
    expect(card.dueDate).toBeNull();
    expect(card.issues).toEqual(['담당자 "없는사람"을(를) 사원에서 찾지 못했어요', '마감일을 확인해 주세요 (오늘부터 1년 안)']);
  });

  it('업무: 말하지 않은 담당자·마감일은 지어내지 않는다', async () => {
    const { service } = setup();
    const card = await service.propose(user, { kind: 'TASK', title: 'a' });
    expect(card).toMatchObject({ assigneeId: null, dueDate: null });
    expect(card.issues).toEqual(['담당자를 정해 주세요', '마감일을 확인해 주세요 (오늘부터 1년 안)']);
  });

  it('일정: 참석자를 말하지 않으면 본인 일정이고, 끝 시각이 없으면 1시간 뒤로 가정한다', async () => {
    const { service } = setup();
    const day = plusDays(2);
    const card = await service.propose(user, { kind: 'EVENT', title: '라인 점검', startAt: `${day}T14:00` });
    expect(card).toMatchObject({ attendeeIds: [1], startAt: `${day}T14:00:00+09:00`, endAt: `${day}T15:00:00+09:00`, endAssumed: true });
    expect(card.issues).toEqual(['끝 시각은 말이 없어 1시간으로 가정했어요']);
  });

  it('일정: 참석자 이름을 맞추고 못 찾은 이름은 사유로 알린다', async () => {
    const { service } = setup();
    const day = plusDays(2);
    const card = await service.propose(user, { kind: 'EVENT', title: '회의', startAt: `${day}T09:00`, endAt: `${day}T10:30`, attendeeNames: ['박서영', '이도윤', '유령'] });
    expect(card).toMatchObject({ attendeeIds: [7, 8], endAt: `${day}T10:30:00+09:00`, endAssumed: false });
    expect(card.issues).toEqual(['참석자를 찾지 못했어요: 유령']);
  });

  it('구매요청: 원료 이름은 품목 id로, 수량은 소수 3자리 톤으로 맞춘다', async () => {
    const { service } = setup();
    const card = await service.propose(user, { kind: 'PURCHASE', title: '철광석 구매요청', itemName: '철광석', quantityTon: 12.5, desiredReceiptDate: plusDays(10) });
    expect(card.purchase).toMatchObject({ itemId: 3, requestedTon: '12.500', desiredReceiptDate: plusDays(10), requestReason: '철광석 구매요청' });
    expect(card.issues).toEqual([]);
  });

  it('구매요청: 구매요청을 만들 수 없는 사용자에게는 카드를 만들지 않고 이유를 모델에 돌려준다', async () => {
    const { service } = setup({ canRequestPurchase: false });
    await expect(service.propose(user, { kind: 'PURCHASE', title: 'x', itemName: '철광석' })).rejects.toThrow(ToolArgumentError);
  });

  it('종류와 제목이 틀리면 모델에 이유를 돌려준다', async () => {
    const { service } = setup();
    await expect(service.propose(user, { kind: 'ORDER', title: 'x' })).rejects.toThrow(ToolArgumentError);
    await expect(service.propose(user, { kind: 'TASK' })).rejects.toThrow('title가 필요해요');
  });
});

describe('실행 카드 실행 (사용자가 확인한 값을 다시 검증해 등록)', () => {
  it('업무: 필수 칸이 비면 만들지 않고 ACT-001로 거절한다', async () => {
    const { service, calls } = setup();
    await expect(service.execute(user, dto({}))).rejects.toMatchObject({ code: 'ACT-001' });
    expect(calls).toEqual([]);
  });

  it('업무: 담당자·마감일을 채우면 사용자를 등록자로 업무를 만든다', async () => {
    const { service, calls } = setup();
    const due = plusDays(5);
    const result = await service.execute(user, dto({ assigneeId: 7, dueDate: due, description: '메모' }));
    expect(result).toEqual({ kind: 'TASK', registered: { type: 'task', id: 11 } });
    expect(calls).toHaveLength(1);
    expect(calls[0].args[1]).toBe(1);
    expect(calls[0].args[2]).toMatchObject({ taskTitle: '견적서 보내기', taskDescription: '메모', assigneeId: 7, dueDate: new Date(`${due}T00:00:00.000Z`), linkPath: '/tasks' });
  });

  it('업무: 지난 마감일은 거절하고 메시지는 "오늘" 기준이다', async () => {
    const { service } = setup();
    await expect(service.execute(user, dto({ assigneeId: 7, dueDate: plusDays(-1) }))).rejects.toThrow(/오늘/);
  });

  it('업무: 그 사이 퇴사한 담당자면 거절한다', async () => {
    const { service, calls } = setup({ inactiveIds: [7] });
    await expect(service.execute(user, dto({ assigneeId: 7, dueDate: plusDays(5) }))).rejects.toMatchObject({ code: 'COM-003' });
    expect(calls).toEqual([]);
  });

  it('일정: 일정을 만들고 본인을 뺀 참석자에게만 알린다', async () => {
    const { service, calls } = setup();
    const day = plusDays(4);
    const result = await service.execute(user, dto({ kind: 'EVENT', title: '라인 점검', startAt: `${day}T14:00`, attendeeIds: [1, 7] }));
    expect(result.registered).toEqual({ type: 'schedule_event', id: 21 });
    expect(calls.map((c) => c.name)).toEqual(['createScheduleEvent', 'notifyEmployees']);
    expect(calls[0].args[1]).toMatchObject({ scheduleEventTitle: '라인 점검', creatorId: 1, startAt: new Date(`${day}T14:00:00+09:00`), endAt: new Date(`${day}T15:00:00+09:00`) });
    expect(calls[0].args[2]).toEqual([1, 7]);
    expect(calls[1].args[1]).toEqual([7]);
  });

  it('구매요청: 일정·업무가 아니라 구매요청 초안(확인 대기)을 만든다', async () => {
    const { service, calls } = setup();
    const result = await service.execute(user, dto({ kind: 'PURCHASE', title: '철광석 구매요청', purchase: { itemId: 3, requestedTon: '12.5', desiredReceiptDate: plusDays(10) } }));
    expect(result.registered).toEqual({ type: 'action_draft', id: 31 });
    expect(calls[0].name).toBe('createFromAssistant');
    expect(calls[0].args[2]).toMatchObject({ itemId: 3, requestedTon: '12.500', requestReason: '철광석 구매요청' });
  });

  it('다른 종류의 칸을 보내면 거절한다', async () => {
    const { service } = setup();
    await expect(service.execute(user, dto({ kind: 'TASK', attendeeIds: [1] }))).rejects.toMatchObject({ code: 'COM-004' });
  });
});
