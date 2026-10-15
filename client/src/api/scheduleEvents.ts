// 내 일정 api (Voice2ERP 6단계). 서버를 부른다 (api/server/scheduleEvents.ts, docs/backend/schedule-event.md).
import type { ScheduleEventView } from '@fantasteel/shared';
import { serverScheduleEventApi } from '@/api/server/scheduleEvents';

export type { ScheduleEventView } from '@fantasteel/shared';

export const scheduleEventKeys = {
  all: ['schedule-events'] as const,
  range: (employeeId: number, from: string, to: string) => ['schedule-events', employeeId, from, to] as const,
};

export const scheduleEventApi = {
  /** from·to = 'YYYY-MM-DD' (Asia/Seoul, 끝 날짜 포함) */
  list: (from: string, to: string): Promise<ScheduleEventView[]> => serverScheduleEventApi.list(from, to),
};
