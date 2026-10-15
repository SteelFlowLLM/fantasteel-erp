import { Injectable } from '@nestjs/common';
import type { AuthUser, ScheduleEventView } from '@fantasteel/shared';
import { AppException } from '../../common/errors/app.exception';
import { seoulToday } from '../../common/time/seoul-date';
import { PrismaService } from '../../prisma/prisma.service';
import type { ListScheduleEventsQuery } from './dto/schedule-event.dto';
import { ScheduleEventRepository, type ScheduleEventRow } from './schedule-event.repository';

const MAX_RANGE_DAYS = 62;
const DAY_MS = 86_400_000;
const SEOUL_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 'YYYY-MM-DD'의 서울 자정을 UTC Date로 */
const seoulMidnight = (date: string): Date => new Date(Date.parse(`${date}T00:00:00.000Z`) - SEOUL_OFFSET_MS);

const isRealDate = (value: string): boolean => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

const addDays = (date: string, days: number): string => new Date(Date.parse(`${date}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);

/** 이번 주 월~일 (서울 기준) */
function thisWeek(): { from: string; to: string } {
  const today = seoulToday();
  const weekday = new Date(`${today}T00:00:00.000Z`).getUTCDay();
  const from = addDays(today, -((weekday + 6) % 7));
  return { from, to: addDays(from, 6) };
}

function toView(row: ScheduleEventRow): ScheduleEventView {
  return {
    id: row.id,
    scheduleEventTitle: row.scheduleEventTitle,
    scheduleEventDescription: row.scheduleEventDescription,
    startAt: row.startAt.toISOString(),
    endAt: row.endAt.toISOString(),
    linkPath: row.linkPath,
    meetingMinutes: row.meetingMinutes ? { id: row.meetingMinutes.id, title: row.meetingMinutes.meetingMinutesTitle } : null,
    attendees: row.attendees.map((a) => ({ employeeId: a.employeeId, employeeName: a.employee.employeeName })),
    creator: { id: row.creator.id, name: row.creator.employeeName },
  };
}

/** 내 일정 (Voice2ERP 6단계). 내가 참석자이거나 등록자인 일정만 */
@Injectable()
export class ScheduleEventService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: ScheduleEventRepository,
  ) {}

  async listMine(user: AuthUser, query: ListScheduleEventsQuery): Promise<ScheduleEventView[]> {
    const week = thisWeek();
    const from = query.from ?? week.from;
    const to = query.to ?? (query.from ? addDays(from, 6) : week.to);
    for (const value of [from, to]) if (!isRealDate(value)) throw new AppException('COM-004', `${value}는 없는 날짜예요`);
    const days = (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / DAY_MS;
    if (days < 0) throw new AppException('COM-004', '끝 날짜가 시작 날짜보다 앞이에요');
    if (days + 1 > MAX_RANGE_DAYS) throw new AppException('COM-004', `조회 기간은 ${MAX_RANGE_DAYS}일까지예요`);
    const rows = await this.repository.findMine(this.prisma, user.employeeId, seoulMidnight(from), seoulMidnight(addDays(to, 1)));
    return rows.map(toView);
  }
}
