import { TASK_SCOPES, TASK_STATUS, TASK_STATUS_LABEL, type TaskStatus } from '@fantasteel/shared';
import type { TaskService } from '../../notification/task.service';
import type { ScheduleEventService } from '../../schedule-event/schedule-event.service';
import { limitRows, OPEN_ACCESS, optionalDate, optionalEnum, seoulDateTimeText, type AssistantTool } from './assistant-tool';

const TASK_SCOPE_LABEL = { mine: '내 담당', created: '내가 등록', all: '담당·등록 모두' } as const;

/**
 * 내 일정·업무 조회 (문서에 없는 기능, 2026-10-19 이슈 #398). 일정·업무 고치기 카드를 만들기 전에 id와 지금 값을 찾는다.
 * 내 일정·내 업무 화면과 같은 범위(참석·등록한 일정, 담당·등록한 업무)만 보인다. 사원 본인의 것이라 철강맨AI 패널에서만 알린다(사내 채팅 @AI 답은 방 멤버 모두가 본다).
 */
export function myScheduleTool(scheduleEvents: ScheduleEventService): AssistantTool {
  return {
    access: OPEN_ACCESS,
    panelOnly: true,
    definition: {
      name: 'get_my_schedule',
      description: '내 일정(내가 참석하거나 등록한 일정)을 기간으로 조회한다. 기본은 이번 주(월~일). 일정 id·제목·시각·참석자, 내가 고칠 수 있는지를 준다. 일정을 고치는 카드를 만들기 전에 id를 찾을 때 쓴다.',
      parameters: {
        type: 'object',
        properties: { from: { type: 'string', description: '시작 날짜 YYYY-MM-DD (생략하면 이번 주 월요일)' }, to: { type: 'string', description: '끝 날짜 YYYY-MM-DD (62일 안)' } },
      },
    },
    async run(args, user) {
      const from = optionalDate(args, 'from');
      const to = optionalDate(args, 'to');
      const events = await scheduleEvents.listMine(user, { from, to });
      const { rows, omitted } = limitRows(events);
      return {
        label: `내 일정${from ? ` · ${from}~` : ''}`,
        data: {
          일정: rows.map((e) => ({
            일정id: e.id,
            제목: e.scheduleEventTitle,
            시작: seoulDateTimeText(e.startAt),
            끝: seoulDateTimeText(e.endAt),
            참석자: e.attendees.map((a) => a.employeeName),
            등록자: e.creator.name,
            설명: e.scheduleEventDescription,
            // 일정 화면 규칙: 내가 직접 등록한 일정만 고칠 수 있다 (회의록에서 만든 일정 제외)
            고칠수있음: e.creator.id === user.employeeId && e.meetingMinutes === null,
          })),
          ...(omitted ? { '더 있는 일정 수': omitted } : {}),
        },
      };
    },
  };
}

export function myTasksTool(tasks: TaskService): AssistantTool {
  return {
    access: OPEN_ACCESS,
    panelOnly: true,
    definition: {
      name: 'get_my_tasks',
      description: '내 업무(할 일)를 조회한다. 업무 id·제목·담당자·마감일·상태를 준다. 업무를 고치거나 완료하는 카드를 만들기 전에 id를 찾을 때 쓴다.',
      parameters: {
        type: 'object',
        properties: {
          scope: { type: 'string', enum: [...TASK_SCOPES], description: 'mine(내 담당, 기본)·created(내가 등록)·all(둘 다)' },
          status: { type: 'string', enum: Object.values(TASK_STATUS), description: `${TASK_STATUS.OPEN}(${TASK_STATUS_LABEL.OPEN})·${TASK_STATUS.DONE}(${TASK_STATUS_LABEL.DONE}). 생략하면 모두` },
        },
      },
    },
    async run(args, user) {
      const scope = optionalEnum(args, 'scope', TASK_SCOPES) ?? 'mine';
      const status = optionalEnum(args, 'status', Object.values(TASK_STATUS) as TaskStatus[]);
      const page = await tasks.list(user, { scope, taskStatus: status, page: 1, size: 15 });
      return {
        label: `내 업무 · ${TASK_SCOPE_LABEL[scope]}`,
        data: {
          업무: page.items.map((t) => ({ 업무id: t.id, 제목: t.taskTitle, 담당자: t.assigneeName, 등록자: t.creatorName, 마감일: t.dueDate, 상태: TASK_STATUS_LABEL[t.taskStatus] ?? t.taskStatus, 설명: t.taskDescription })),
          ...(page.total > page.items.length ? { '더 있는 업무 수': page.total - page.items.length } : {}),
        },
      };
    },
  };
}
