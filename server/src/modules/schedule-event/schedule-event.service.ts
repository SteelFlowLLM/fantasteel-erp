import { Injectable } from '@nestjs/common';
import type { AuthUser, ScheduleEventInput, ScheduleEventView } from '@fantasteel/shared';
import { AppException } from '../../common/errors/app.exception';
import { seoulToday } from '../../common/time/seoul-date';
import { PrismaService } from '../../prisma/prisma.service';
import { NotionWorkspaceService } from '../integration/notion/notion-workspace.service';
import type { ListScheduleEventsQuery } from './dto/schedule-event.dto';
import { ScheduleEventRepository, type ScheduleEventFields, type ScheduleEventRow } from './schedule-event.repository';

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

/** 입력 시각을 확인한다. schedule_event에 end_at > start_at CHECK가 있어 DB 오류가 되기 전에 업무 오류로 알린다 */
function fieldsOf(input: ScheduleEventInput): ScheduleEventFields {
  const startAt = new Date(input.startAt);
  const endAt = new Date(input.endAt);
  if (endAt.getTime() <= startAt.getTime()) throw new AppException('COM-004', '끝나는 시각은 시작 시각보다 뒤여야 해요');
  return { scheduleEventTitle: input.scheduleEventTitle, scheduleEventDescription: input.scheduleEventDescription ?? null, startAt, endAt };
}

/**
 * 내 일정 (Voice2ERP 6단계). 내가 참석자이거나 등록자인 일정만.
 * 직접 등록·수정은 문서에 없는 기능(2026-10-16): 등록자 본인만 고치고, 회의록에서 등록한 일정은 회의록 쪽 기록이라 고치지 않는다.
 * 일정은 REQ-LOG-002 작업 로그 대상이 아니어서 로그를 남기지 않는다(회의록 일정 등록도 알림만 보낸다).
 */
@Injectable()
export class ScheduleEventService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: ScheduleEventRepository,
    private readonly notionWorkspace: NotionWorkspaceService,
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

  /** 내 일정 직접 등록. 나 혼자 보는 일정이라 다른 사원에게 알림을 보내지 않는다 */
  async create(user: AuthUser, input: ScheduleEventInput): Promise<ScheduleEventView> {
    const fields = fieldsOf(input);
    const view = toView(await this.repository.createMine(this.prisma, user.employeeId, fields));
    // Notion 업무 공간(이슈 #391) 반영은 저장 뒤에 깨우고 기다리지 않는다
    this.notionWorkspace.kick();
    return view;
  }

  /** 내가 직접 등록한 일정만 고친다. 볼 수 없는 일정은 없는 것처럼 COM-003 */
  async update(user: AuthUser, id: number, input: ScheduleEventInput): Promise<ScheduleEventView> {
    const fields = fieldsOf(input);
    const view = await this.prisma.$transaction(async (tx) => {
      const event = await this.repository.findById(tx, id);
      const visible = event && (event.creatorId === user.employeeId || event.attendees.some((a) => a.employeeId === user.employeeId));
      if (!event || !visible) throw new AppException('COM-003', '일정을 찾을 수 없어요');
      if (event.creatorId !== user.employeeId) throw new AppException('COM-002', '내가 등록한 일정만 고칠 수 있어요');
      if (event.meetingMinutesId !== null) throw new AppException('COM-004', '회의록에서 등록한 일정은 여기서 고칠 수 없어요', 409);
      return toView(await this.repository.update(tx, id, fields));
    });
    this.notionWorkspace.kick();
    return view;
  }
}
