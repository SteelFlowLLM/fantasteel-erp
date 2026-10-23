// 일정·업무 고치기 카드(이슈 #398) 단위 시험. 실제 반영 규칙(권한·완료 업무 등)은 ai-notion.spec.ts가 DB로 본다.
import { ROLE, TASK_STATUS, type AuthUser } from '@fantasteel/shared';
import { seoulToday } from '../../common/time/seoul-date';
import type { PrismaService } from '../../prisma/prisma.service';
import type { TaskService } from '../notification/task.service';
import type { ScheduleEventService } from '../schedule-event/schedule-event.service';
import type { AiAssistantRepository } from './ai-assistant.repository';
import { AiUpdateCardService } from './ai-update-card.service';
import type { ExecuteAiActionCardDto } from './dto/ai-assistant.dto';
import { ToolArgumentError } from './tools/assistant-tool';

const me: AuthUser = { employeeId: 7, employeeNo: '2207005', employeeName: '정다은', roleCode: ROLE.PURCHASE, departmentId: 1, jobGradeId: 1, headDepartmentIds: [], permissions: {} };
const plusDays = (days: number) => new Date(Date.parse(`${seoulToday()}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10);
const day = plusDays(3);

const event = (over: Record<string, unknown> = {}) => ({
  id: 11,
  scheduleEventTitle: '라인 점검',
  scheduleEventDescription: null,
  startAt: new Date(`${day}T14:00:00+09:00`),
  endAt: new Date(`${day}T15:30:00+09:00`),
  creatorId: me.employeeId,
  meetingMinutesId: null,
  attendees: [{ employeeId: me.employeeId }],
  ...over,
});
const task = (over: Record<string, unknown> = {}) => ({ id: 21, taskTitle: '견적서 보내기', taskDescription: null, dueDate: new Date(`${plusDays(5)}T00:00:00.000Z`), taskStatus: TASK_STATUS.OPEN, creatorId: 3, assigneeId: me.employeeId, ...over });

function service(rows: { event?: unknown; task?: unknown } = {}, calls: string[] = []) {
  const repository = { findScheduleEventForCard: async () => rows.event ?? null, findTaskForCard: async () => rows.task ?? null } as unknown as AiAssistantRepository;
  const scheduleEvents = {
    update: async (_u: AuthUser, id: number, input: unknown) => {
      calls.push(`event ${id} ${JSON.stringify(input)}`);
      return { id };
    },
  } as unknown as ScheduleEventService;
  const tasks = {
    update: async (_u: AuthUser, id: number, input: unknown) => {
      calls.push(`task ${id} ${JSON.stringify(input)}`);
      return { id };
    },
    complete: async (_u: AuthUser, id: number) => {
      calls.push(`complete ${id}`);
      return { id };
    },
  } as unknown as TaskService;
  return new AiUpdateCardService({} as PrismaService, repository, scheduleEvents, tasks);
}

describe('일정 고치기 카드', () => {
  it('시작만 옮기면 길이는 그대로 두고 끝도 따라간다. 바뀌기 전 값도 담는다', async () => {
    const card = await service({ event: event() }).proposeScheduleEvent(me, { scheduleEventId: 11, startAt: `${day}T16:00` });
    expect(card).toMatchObject({ kind: 'SCHEDULE_EVENT_UPDATE', scheduleEventId: 11, title: '일정 고치기 · 라인 점검', startAt: `${day}T16:00:00+09:00`, endAt: `${day}T17:30:00+09:00` });
    expect(card.before).toEqual({ scheduleEventTitle: '라인 점검', scheduleEventDescription: null, startAt: `${day}T14:00:00+09:00`, endAt: `${day}T15:30:00+09:00` });
  });

  it('일정 화면과 같은 규칙: 남의 일정·회의록 일정·볼 수 없는 일정은 카드를 만들지 않는다', async () => {
    await expect(service({ event: event({ creatorId: 3 }) }).proposeScheduleEvent(me, { scheduleEventId: 11, title: '새 제목' })).rejects.toThrow(/내가 등록한 일정만/);
    await expect(service({ event: event({ meetingMinutesId: 5 }) }).proposeScheduleEvent(me, { scheduleEventId: 11, title: '새 제목' })).rejects.toThrow(/회의록에서 등록한/);
    await expect(service({ event: event({ creatorId: 3, attendees: [] }) }).proposeScheduleEvent(me, { scheduleEventId: 11, title: '새 제목' })).rejects.toThrow(/찾을 수 없어요/);
    await expect(service({ event: event() }).proposeScheduleEvent(me, { scheduleEventId: 11 })).rejects.toThrow(/바꿀 내용이 없어요/);
    await expect(service({ event: event() }).proposeScheduleEvent(me, { scheduleEventId: 11, startAt: `${day}T16:00`, endAt: `${day}T15:00` })).rejects.toThrow(/끝 시각/);
    await expect(service({ event: event() }).proposeScheduleEvent(me, { title: 'x' })).rejects.toThrow(ToolArgumentError);
  });

  it('실행은 일정 service.update에 전체 값을 넘긴다', async () => {
    const calls: string[] = [];
    const result = await service({}, calls).execute(me, { kind: 'SCHEDULE_EVENT_UPDATE', scheduleEventId: 11, title: '라인 점검', description: '', startAt: `${day}T16:00`, endAt: `${day}T17:00:00+09:00` } as ExecuteAiActionCardDto);
    expect(result).toEqual({ kind: 'SCHEDULE_EVENT_UPDATE', registered: { type: 'schedule_event', id: 11, updated: true } });
    expect(calls).toEqual([`event 11 ${JSON.stringify({ scheduleEventTitle: '라인 점검', scheduleEventDescription: null, startAt: new Date(`${day}T16:00:00+09:00`).toISOString(), endAt: new Date(`${day}T17:00:00+09:00`).toISOString() })}`]);
    await expect(service().execute(me, { kind: 'SCHEDULE_EVENT_UPDATE', scheduleEventId: 11, title: '' } as ExecuteAiActionCardDto)).rejects.toMatchObject({ code: 'ACT-001' });
  });
});

describe('업무 고치기 카드', () => {
  it('마감일만 바꾸는 카드, 완료 카드', async () => {
    const edit = await service({ task: task() }).proposeTask(me, { taskId: 21, dueDate: plusDays(8) });
    expect(edit).toMatchObject({ kind: 'TASK_UPDATE', taskId: 21, dueDate: plusDays(8), complete: false, taskTitle: '견적서 보내기', before: { dueDate: plusDays(5) } });
    const done = await service({ task: task() }).proposeTask(me, { taskId: 21, complete: true });
    expect(done).toMatchObject({ title: '업무 완료 · 견적서 보내기', complete: true, dueDate: plusDays(5) });
  });

  it('업무 화면과 같은 규칙: 등록자·담당자만, 진행 중만, 완료는 담당자만, 완료와 고치기는 따로', async () => {
    await expect(service({ task: task({ creatorId: 3, assigneeId: 4 }) }).proposeTask(me, { taskId: 21, title: 'x' })).rejects.toThrow(/등록한 사람과 담당자만/);
    await expect(service({ task: task({ taskStatus: TASK_STATUS.DONE }) }).proposeTask(me, { taskId: 21, title: 'x' })).rejects.toThrow(/되돌릴 수 없어요/);
    await expect(service({ task: task({ creatorId: me.employeeId, assigneeId: 4 }) }).proposeTask(me, { taskId: 21, complete: true })).rejects.toThrow(/담당자만 완료/);
    await expect(service({ task: task() }).proposeTask(me, { taskId: 21, complete: true, title: 'x' })).rejects.toThrow(/나눠야/);
    await expect(service({ task: task() }).proposeTask(me, { taskId: 21, dueDate: '2020-01-01' })).rejects.toThrow(/dueDate/);
  });

  it('실행: 고치기는 update에 바꾼 칸만, 완료는 complete', async () => {
    const calls: string[] = [];
    await service({}, calls).execute(me, { kind: 'TASK_UPDATE', taskId: 21, dueDate: plusDays(8) } as ExecuteAiActionCardDto);
    await service({}, calls).execute(me, { kind: 'TASK_UPDATE', taskId: 21, complete: true } as ExecuteAiActionCardDto);
    expect(calls).toEqual([`task 21 ${JSON.stringify({ dueDate: plusDays(8) })}`, 'complete 21']);
    await expect(service().execute(me, { kind: 'TASK_UPDATE', taskId: 21, complete: true, title: 'x' } as ExecuteAiActionCardDto)).rejects.toMatchObject({ code: 'COM-004' });
    await expect(service().execute(me, { kind: 'TASK_UPDATE', taskId: 21 } as ExecuteAiActionCardDto)).rejects.toMatchObject({ code: 'ACT-001' });
  });
});
