import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import type { Tx } from '../../prisma/prisma.service';

export const EVENT_INCLUDE = {
  actorEmployee: { include: { department: true } },
  salesOrder: { select: { salesOrderNo: true } },
} satisfies Prisma.BusinessEventInclude;
export type BusinessEventRow = Prisma.BusinessEventGetPayload<{ include: typeof EVENT_INCLUDE }>;

@Injectable()
export class BusinessEventRepository {
  /** 정렬은 (occurred_at, id). 커서는 Prisma가 DB 정밀도 그대로 비교한다. */
  list(db: Tx, where: Prisma.BusinessEventWhereInput, dir: 'asc' | 'desc', take: number, cursorId?: number): Promise<BusinessEventRow[]> {
    return db.businessEvent.findMany({
      where,
      include: EVENT_INCLUDE,
      orderBy: [{ occurredAt: dir }, { id: dir }],
      take,
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    });
  }

  findById(db: Tx, id: number): Promise<BusinessEventRow | null> {
    return db.businessEvent.findUnique({ where: { id }, include: EVENT_INCLUDE });
  }

  lotsByIds(db: Tx, ids: number[]) {
    return db.lot.findMany({ where: { id: { in: ids } }, select: { id: true, lotNo: true, lotType: true } });
  }
}
