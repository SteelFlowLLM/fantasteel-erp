// 내 일정 화면 ↔ 서버 API (server/src/modules/schedule-event).
import type { ScheduleEventInput, ScheduleEventView, ScheduleNotionStatus } from '@fantasteel/shared';
import { serverRequest } from '@/api/http';

export const serverScheduleEventApi = {
  list: (from: string, to: string): Promise<ScheduleEventView[]> => serverRequest<ScheduleEventView[]>('GET', '/schedule-events', { query: { from, to } }),
  create: (input: ScheduleEventInput): Promise<ScheduleEventView> => serverRequest<ScheduleEventView>('POST', '/schedule-events', { body: input }),
  update: (id: number, input: ScheduleEventInput): Promise<ScheduleEventView> => serverRequest<ScheduleEventView>('PATCH', `/schedule-events/${id}`, { body: input }),
  updateNotionSync: (id: number, notionSync: boolean): Promise<ScheduleEventView> => serverRequest<ScheduleEventView>('PATCH', `/schedule-events/${id}/notion-sync`, { body: { notionSync } }),
  notionStatus: (): Promise<ScheduleNotionStatus> => serverRequest<ScheduleNotionStatus>('GET', '/schedule-events/notion-status'),
};
