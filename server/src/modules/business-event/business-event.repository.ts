import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import type { Tx } from '../../prisma/prisma.service';

const EVENT_SELECT = {
  id: true,
  businessEventNo: true,
  businessEventType: true,
  actorType: true,
  actorEmployeeId: true,
  targetType: true,
  targetId: true,
  salesOrderId: true,
  beforeData: true,
  afterData: true,
  reason: true,
  isAiAssisted: true,
  actionDraftId: true,
  messageId: true,
  createdAt: true,
} satisfies Prisma.BusinessEventSelect;

export type BusinessEventRow = Prisma.BusinessEventGetPayload<{ select: typeof EVENT_SELECT }>;

/**
 * DB 접근은 여기서만 한다. 함수의 첫 인자는 tx (컨벤션 8장).
 * 사원·수주·LOT은 이벤트 페이지를 읽은 뒤 id로 따로 읽는다 (Prisma 7 중첩 select를 여러 행에 걸쳐 읽으면 실패할 수 있다, lot.md 구현 메모).
 */
@Injectable()
export class BusinessEventRepository {
  findPage(tx: Tx, where: Prisma.BusinessEventWhereInput, direction: Prisma.SortOrder, skip: number, take: number): Promise<BusinessEventRow[]> {
    return tx.businessEvent.findMany({ where, select: EVENT_SELECT, orderBy: [{ createdAt: direction }, { id: direction }], skip, take });
  }

  count(tx: Tx, where: Prisma.BusinessEventWhereInput): Promise<number> {
    return tx.businessEvent.count({ where });
  }

  findEmployees(tx: Tx, ids: number[]) {
    return tx.employee.findMany({ where: { id: { in: ids } }, select: { id: true, employeeNo: true, employeeName: true } });
  }

  findSalesOrders(tx: Tx, ids: number[]) {
    return tx.salesOrder.findMany({ where: { id: { in: ids } }, select: { id: true, salesOrderNo: true } });
  }

  findEventLots(tx: Tx, businessEventIds: number[]) {
    return tx.businessEventLot.findMany({ where: { businessEventId: { in: businessEventIds } }, select: { businessEventId: true, lotId: true }, orderBy: { id: 'asc' } });
  }

  findLots(tx: Tx, ids: number[]) {
    return tx.lot.findMany({ where: { id: { in: ids } }, select: { id: true, lotNo: true, lotType: true } });
  }
}
