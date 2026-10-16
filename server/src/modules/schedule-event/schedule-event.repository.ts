import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import type { Tx } from '../../prisma/prisma.service';

const include = {
  creator: { select: { id: true, employeeName: true } },
  meetingMinutes: { select: { id: true, meetingMinutesTitle: true } },
  attendees: { select: { employeeId: true, employee: { select: { employeeName: true } } }, orderBy: { id: 'asc' } },
} satisfies Prisma.ScheduleEventInclude;

export type ScheduleEventRow = Prisma.ScheduleEventGetPayload<{ include: typeof include }>;

export interface ScheduleEventFields {
  scheduleEventTitle: string;
  scheduleEventDescription: string | null;
  startAt: Date;
  endAt: Date;
}

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

  findById(tx: Tx, id: number): Promise<ScheduleEventRow | null> {
    return tx.scheduleEvent.findUnique({ where: { id }, include });
  }

  /** 내 일정: 등록자 본인을 참석자로 둔다 (참석자 행이 있어야 캘린더에 보인다는 회의록 일정과 같은 규칙) */
  createMine(tx: Tx, creatorId: number, fields: ScheduleEventFields): Promise<ScheduleEventRow> {
    return tx.scheduleEvent.create({ data: { ...fields, creatorId, attendees: { create: [{ employeeId: creatorId }] } }, include });
  }

  update(tx: Tx, id: number, fields: ScheduleEventFields): Promise<ScheduleEventRow> {
    return tx.scheduleEvent.update({ where: { id }, data: fields, include });
  }
}
