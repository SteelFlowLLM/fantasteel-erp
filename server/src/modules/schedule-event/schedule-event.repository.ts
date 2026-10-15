import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import type { Tx } from '../../prisma/prisma.service';

const include = {
  creator: { select: { id: true, employeeName: true } },
  meetingMinutes: { select: { id: true, meetingMinutesTitle: true } },
  attendees: { select: { employeeId: true, employee: { select: { employeeName: true } } }, orderBy: { id: 'asc' } },
} satisfies Prisma.ScheduleEventInclude;

export type ScheduleEventRow = Prisma.ScheduleEventGetPayload<{ include: typeof include }>;

/** DB 접근은 여기서만 한다. 함수의 첫 인자는 tx (컨벤션 8장) */
@Injectable()
export class ScheduleEventRepository {
  /** 시작 시각이 [from, to) 안인 일정 중 내가 참석자이거나 등록자인 것 */
  findMine(tx: Tx, employeeId: number, from: Date, to: Date): Promise<ScheduleEventRow[]> {
    return tx.scheduleEvent.findMany({
      where: { startAt: { gte: from, lt: to }, OR: [{ creatorId: employeeId }, { attendees: { some: { employeeId } } }] },
      include,
      orderBy: [{ startAt: 'asc' }, { id: 'asc' }],
    });
  }
}
