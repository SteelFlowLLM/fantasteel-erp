import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import type { Tx } from '../../prisma/prisma.service';

const listSelect = {
  id: true,
  meetingMinutesTitle: true,
  meetingDate: true,
  meetingMinutesStatus: true,
  creatorId: true,
  createdAt: true,
  creator: { select: { employeeName: true } },
  _count: { select: { attendees: true } },
} satisfies Prisma.MeetingMinutesSelect;

const detailSelect = {
  id: true,
  meetingMinutesTitle: true,
  meetingDate: true,
  meetingMinutesStatus: true,
  transcript: true,
  transcriptSegments: true,
  summary: true,
  analysisResult: true,
  failureReason: true,
  confirmedAt: true,
  createdAt: true,
  updatedAt: true,
  creator: { select: { id: true, employeeName: true } },
  attendees: {
    orderBy: { id: 'asc' },
    select: { employeeId: true, employee: { select: { employeeName: true, department: { select: { departmentName: true } }, role: { select: { roleCode: true } } } } },
  },
} satisfies Prisma.MeetingMinutesSelect;

export type MeetingMinutesListRow = Prisma.MeetingMinutesGetPayload<{ select: typeof listSelect }>;
export type MeetingMinutesDetailRow = Prisma.MeetingMinutesGetPayload<{ select: typeof detailSelect }>;

/** DB 접근만 둔다. 첫 인자는 항상 tx (컨벤션 6장) */
@Injectable()
export class MeetingMinutesRepository {
  /** 퇴사하지 않은 사원만. 없는 id는 결과에서 빠진다 */
  findActiveEmployeeIds(tx: Tx, ids: number[]) {
    return tx.employee.findMany({ where: { id: { in: ids }, isActive: true }, select: { id: true } });
  }

  createMeetingMinutes(tx: Tx, data: Prisma.MeetingMinutesUncheckedCreateInput) {
    return tx.meetingMinutes.create({ data, select: { id: true } });
  }

  createAttendees(tx: Tx, meetingMinutesId: number, employeeIds: number[]) {
    return tx.meetingAttendee.createMany({ data: employeeIds.map((employeeId) => ({ meetingMinutesId, employeeId })) });
  }

  findDetail(tx: Tx, id: number) {
    return tx.meetingMinutes.findUnique({ where: { id }, select: detailSelect });
  }

  count(tx: Tx, where: Prisma.MeetingMinutesWhereInput) {
    return tx.meetingMinutes.count({ where });
  }

  /** 회의일 최신순, 같은 날은 나중에 만든 것이 위 */
  findList(tx: Tx, where: Prisma.MeetingMinutesWhereInput, page: { skip: number; take: number }) {
    return tx.meetingMinutes.findMany({ where, select: listSelect, orderBy: [{ meetingDate: 'desc' }, { id: 'desc' }], ...page });
  }
}
