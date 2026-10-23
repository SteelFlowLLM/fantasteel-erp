// 내 일정 api (Voice2ERP 6단계). 서버를 부른다 (api/server/scheduleEvents.ts, docs/backend/schedule-event.md).
import type { ScheduleEventInput, ScheduleEventView, ScheduleNotionStatus } from '@fantasteel/shared';
import { serverScheduleEventApi } from '@/api/server/scheduleEvents';

export type { ScheduleEventInput, ScheduleEventView, ScheduleNotionStatus } from '@fantasteel/shared';

export const scheduleEventKeys = {
  all: ['schedule-events'] as const,
  range: (employeeId: number, from: string, to: string) => ['schedule-events', employeeId, from, to] as const,
  notionStatus: ['schedule-events', 'notion-status'] as const,
};

export const scheduleEventApi = {
  /** from·to = 'YYYY-MM-DD' (Asia/Seoul, 끝 날짜 포함) */
  list: (from: string, to: string): Promise<ScheduleEventView[]> => serverScheduleEventApi.list(from, to),
  /** 내 일정 직접 등록 (등록자 본인만 참석자) */
  create: (input: ScheduleEventInput): Promise<ScheduleEventView> => serverScheduleEventApi.create(input),
  /** 내가 직접 등록한 일정만 고칠 수 있다 (회의록 일정은 안 됨) */
  update: ({ id, input }: { id: number; input: ScheduleEventInput }): Promise<ScheduleEventView> => serverScheduleEventApi.update(id, input),
  /** Notion에 넣을지만 바꾼다. 내가 등록한 일정이면 회의록 일정도 된다 (이슈 #434) */
  updateNotionSync: ({ id, notionSync }: { id: number; notionSync: boolean }): Promise<ScheduleEventView> => serverScheduleEventApi.updateNotionSync(id, notionSync),
  /** 일정을 Notion에 넣을 수 있는지 (이슈 #434) */
  notionStatus: (): Promise<ScheduleNotionStatus> => serverScheduleEventApi.notionStatus(),
};
