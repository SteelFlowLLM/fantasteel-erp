// 내 일정 화면 ↔ 서버 API (server/src/modules/schedule-event).
import type { ScheduleEventView } from '@fantasteel/shared';
import { serverRequest } from '@/api/http';

export const serverScheduleEventApi = {
  list: (from: string, to: string): Promise<ScheduleEventView[]> => serverRequest<ScheduleEventView[]>('GET', '/schedule-events', { query: { from, to } }),
};
