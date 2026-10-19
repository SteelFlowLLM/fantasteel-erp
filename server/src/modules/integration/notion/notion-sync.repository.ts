import { Injectable } from '@nestjs/common';
import { MEETING_MINUTES_STATUS, TASK_STATUS } from '@fantasteel/shared';
import type { Prisma } from '../../../generated/prisma/client';
import {
  finishMeetingMinutesNotionPage,
  markMeetingMinutesNotionSynced,
  markScheduleEventNotionSynced,
  markTaskNotionSynced,
  resetScheduleEventCalendarSync,
  setScheduleEventCalendarEvent,
  setScheduleEventNotionPage,
} from '../../../generated/prisma/sql';
import type { Tx } from '../../../prisma/prisma.service';
import { meetingMinutesDetailSelect } from '../../meeting-minutes/meeting-minutes.repository';

const meetingLink = { select: { id: true, notionPageUrl: true } } as const;

const scheduleEventSelect = {
  id: true,
  scheduleEventTitle: true,
  scheduleEventDescription: true,
  startAt: true,
  endAt: true,
  linkPath: true,
  notionPageId: true,
  notionCalendarEventId: true,
  updatedAt: true,
  creator: { select: { employeeName: true } },
  meetingMinutes: meetingLink,
  attendees: { orderBy: { id: 'asc' }, select: { employee: { select: { employeeName: true, email: true } } } },
} satisfies Prisma.ScheduleEventSelect;

const taskSelect = {
  id: true,
  taskTitle: true,
  taskDescription: true,
  taskStatus: true,
  dueDate: true,
  linkPath: true,
  messageId: true,
  notionPageId: true,
  updatedAt: true,
  assignee: { select: { employeeName: true } },
  creator: { select: { employeeName: true } },
  meetingMinutes: meetingLink,
} satisfies Prisma.TaskSelect;

const meetingSelect = { ...meetingMinutesDetailSelect, notionPageId: true } satisfies Prisma.MeetingMinutesSelect;

export type NotionScheduleEventRow = Prisma.ScheduleEventGetPayload<{ select: typeof scheduleEventSelect }>;
export type NotionTaskRow = Prisma.TaskGetPayload<{ select: typeof taskSelect }>;
export type NotionMeetingRow = Prisma.MeetingMinutesGetPayload<{ select: typeof meetingSelect }>;

// 반영한 뒤 바뀌었거나 아직 반영하지 않은 행 (updated_at이 notion_synced_at보다 뒤)
const dirtyScheduleEvent = (tx: Tx): Prisma.ScheduleEventWhereInput => ({ OR: [{ notionSyncedAt: null }, { updatedAt: { gt: tx.scheduleEvent.fields.notionSyncedAt } }] });
const dirtyTask = (tx: Tx): Prisma.TaskWhereInput => ({ OR: [{ notionSyncedAt: null }, { updatedAt: { gt: tx.task.fields.notionSyncedAt } }] });
const dirtyMeeting = (tx: Tx): Prisma.MeetingMinutesWhereInput => ({ OR: [{ notionSyncedAt: null }, { updatedAt: { gt: tx.meetingMinutes.fields.notionSyncedAt } }] });

/**
 * Notion 업무 공간 반영 (이슈 #391)이 읽고 쓰는 일정·업무·회의록. DB 접근만 둔다. 첫 인자는 항상 tx (컨벤션 6장)
 * 반영했다고 적는 쓰기는 TypedSQL로 한다: Prisma로 쓰면 @updatedAt이 바뀌어 방금 반영한 행이 다시 바뀐 것으로 보인다.
 */
@Injectable()
export class NotionSyncRepository {
  /** 할 일 데이터베이스의 담당자 선택 항목 */
  findActiveEmployeeNames(tx: Tx) {
    return tx.employee.findMany({ where: { isActive: true }, select: { employeeName: true }, orderBy: { id: 'asc' } });
  }

  // ── 일정 ──

  private scheduleEventWhere(tx: Tx, since: Date): Prisma.ScheduleEventWhereInput {
    return { AND: [dirtyScheduleEvent(tx), { OR: [{ notionPageId: { not: null } }, { endAt: { gte: since } }] }] };
  }

  /** 반영할 일정. 아직 페이지가 없는 일정은 since 뒤에 끝나는 것만 (지난 일정을 모두 옮기지 않는다) */
  findDirtyScheduleEvents(tx: Tx, since: Date, skipIds: number[], take: number) {
    return tx.scheduleEvent.findMany({ where: { AND: [this.scheduleEventWhere(tx, since), { id: { notIn: skipIds } }] }, select: scheduleEventSelect, orderBy: { id: 'asc' }, take });
  }

  countDirtyScheduleEvents(tx: Tx, since: Date) {
    return tx.scheduleEvent.count({ where: this.scheduleEventWhere(tx, since) });
  }

  /** 일정 데이터베이스 페이지 id만 적는다. 캘린더까지 반영해야 markScheduleEventSynced로 끝낸다 */
  setScheduleEventPage(tx: Tx, id: number, notionPageId: string) {
    return tx.$queryRawTyped(setScheduleEventNotionPage(id, notionPageId));
  }

  setScheduleEventCalendarEvent(tx: Tx, id: number, eventId: string) {
    return tx.$queryRawTyped(setScheduleEventCalendarEvent(id, eventId));
  }

  markScheduleEventSynced(tx: Tx, id: number, syncedAt: Date) {
    return tx.$queryRawTyped(markScheduleEventNotionSynced(id, syncedAt));
  }

  /** 캘린더 설정이 바뀌면 since 뒤에 끝나는 일정을 다시 반영하게 하고, 캘린더를 바꿨으면 옛 일정 id를 지운다 */
  resetScheduleEventCalendarSync(tx: Tx, since: Date, clearEvents: boolean) {
    return tx.$queryRawTyped(resetScheduleEventCalendarSync(since, clearEvents));
  }

  // ── 업무 ──

  private taskWhere(tx: Tx, since: Date): Prisma.TaskWhereInput {
    return { AND: [dirtyTask(tx), { OR: [{ notionPageId: { not: null } }, { taskStatus: { not: TASK_STATUS.DONE } }, { updatedAt: { gte: since } }] }] };
  }

  /** 반영할 업무. 아직 페이지가 없는 업무는 진행 중이거나 since 뒤에 바뀐 것만 */
  findDirtyTasks(tx: Tx, since: Date, skipIds: number[], take: number) {
    return tx.task.findMany({ where: { AND: [this.taskWhere(tx, since), { id: { notIn: skipIds } }] }, select: taskSelect, orderBy: { id: 'asc' }, take });
  }

  countDirtyTasks(tx: Tx, since: Date) {
    return tx.task.count({ where: this.taskWhere(tx, since) });
  }

  markTaskSynced(tx: Tx, id: number, notionPageId: string, syncedAt: Date) {
    return tx.$queryRawTyped(markTaskNotionSynced(id, notionPageId, syncedAt));
  }

  // ── 회의록 ──

  /**
   * 회의록 데이터베이스에 새로 만들 회의록: 확정했고, 직접 내보낸 적이 없고(notion_page_url 없음), 아무도 내보내는 중이 아님.
   * 직접 내보낸 회의록은 이미 Notion에 페이지가 있어 데이터베이스에 또 만들지 않는다.
   */
  private meetingCreateWhere(staleBefore: Date): Prisma.MeetingMinutesWhereInput {
    return {
      meetingMinutesStatus: MEETING_MINUTES_STATUS.CONFIRMED,
      notionPageId: null,
      notionPageUrl: null,
      OR: [{ notionExportedAt: null }, { notionExportedAt: { lt: staleBefore } }],
    };
  }

  private meetingUpdateWhere(tx: Tx): Prisma.MeetingMinutesWhereInput {
    return { AND: [{ notionPageId: { not: null } }, dirtyMeeting(tx)] };
  }

  findMeetingIdsToCreate(tx: Tx, staleBefore: Date, skipIds: number[], take: number) {
    return tx.meetingMinutes.findMany({ where: { AND: [this.meetingCreateWhere(staleBefore), { id: { notIn: skipIds } }] }, select: { id: true }, orderBy: { id: 'asc' }, take });
  }

  /** id만 읽는다: 회의록 상세(참석자 → 사원 → 부서·역할)를 여러 행에 걸쳐 깊게 읽으면 Prisma 7이 실패할 수 있어(lot.md) 한 건씩 findMeeting으로 읽는다 */
  findMeetingIdsToUpdate(tx: Tx, skipIds: number[], take: number) {
    return tx.meetingMinutes.findMany({ where: { AND: [this.meetingUpdateWhere(tx), { id: { notIn: skipIds } }] }, select: { id: true }, orderBy: { id: 'asc' }, take });
  }

  async countDirtyMeetings(tx: Tx, staleBefore: Date): Promise<number> {
    const [create, update] = await Promise.all([tx.meetingMinutes.count({ where: this.meetingCreateWhere(staleBefore) }), tx.meetingMinutes.count({ where: this.meetingUpdateWhere(tx) })]);
    return create + update;
  }

  findMeeting(tx: Tx, id: number) {
    return tx.meetingMinutes.findUnique({ where: { id }, select: meetingSelect });
  }

  /** 회의록 직접 내보내기(meeting-minutes.repository.ts claimNotionExport)와 같은 잡기. 두 쪽이 동시에 페이지를 만들지 않게 한다 */
  claimMeeting(tx: Tx, id: number, claimedAt: Date, staleBefore: Date) {
    return tx.meetingMinutes.updateMany({ where: { id, ...this.meetingCreateWhere(staleBefore) }, data: { notionExportedAt: claimedAt } });
  }

  releaseMeeting(tx: Tx, id: number, claimedAt: Date) {
    return tx.meetingMinutes.updateMany({ where: { id, notionPageUrl: null, notionExportedAt: claimedAt }, data: { notionExportedAt: null } });
  }

  finishMeetingPage(tx: Tx, id: number, page: { url: string; id: string }, exportedAt: Date, syncedAt: Date, claimedAt: Date) {
    return tx.$queryRawTyped(finishMeetingMinutesNotionPage(id, page.url, page.id, exportedAt, syncedAt, claimedAt));
  }

  markMeetingSynced(tx: Tx, id: number, syncedAt: Date) {
    return tx.$queryRawTyped(markMeetingMinutesNotionSynced(id, syncedAt));
  }
}
