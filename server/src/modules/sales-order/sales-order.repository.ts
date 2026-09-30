import { Injectable } from '@nestjs/common';
import { ALLOCATION_STATUS, CHAT_ROOM_TYPE, EMPLOYEE_STATUS, PRODUCTION_PLAN_STATUS, SALES_ORDER_ITEM_STATUS, SHIPMENT_REQUEST_STATUS } from '@fantasteel/shared';
import type { Prisma } from '../../generated/prisma/client';
import type { Tx } from '../../prisma/prisma.service';

export const SALES_ORDER_INCLUDE = {
  customer: { select: { id: true, customerCode: true, customerName: true } },
  ownerEmployee: { select: { id: true, employeeNo: true, employeeName: true } },
  items: {
    orderBy: { lineNo: 'asc' },
    include: {
      productSpec: { include: { item: { select: { itemType: true } }, steelGrade: { select: { steelGradeCode: true } } } },
      reservations: { select: { reservedQty: true, status: true, isAutoReserved: true } },
      productionPlans: { orderBy: { id: 'asc' } },
    },
  },
  chatRooms: { where: { chatRoomType: CHAT_ROOM_TYPE.WORK }, select: { id: true }, orderBy: { id: 'asc' } },
} satisfies Prisma.SalesOrderInclude;
export type SalesOrderRow = Prisma.SalesOrderGetPayload<{ include: typeof SALES_ORDER_INCLUDE }>;
export type SalesOrderItemRow = SalesOrderRow['items'][number];

export interface SalesOrderFilter {
  customerId?: number;
  itemType?: 'SLAB' | 'COIL';
  dueFrom?: Date;
  dueTo?: Date;
  keyword?: string;
}

export const OPEN_PLAN_STATUSES: string[] = [PRODUCTION_PLAN_STATUS.PLANNED, PRODUCTION_PLAN_STATUS.CONFIRMED, PRODUCTION_PLAN_STATUS.IN_PROGRESS];

@Injectable()
export class SalesOrderRepository {
  findCustomer(tx: Tx, id: number) {
    return tx.customer.findUnique({ where: { id } });
  }

  findProductSpecs(tx: Tx, ids: number[]) {
    return tx.productSpec.findMany({ where: { id: { in: ids } }, include: { item: { select: { itemType: true, isActive: true } } } });
  }

  /** 코일 규격 → 대응 슬래브 규격 (취소 시 귀속 슬래브가 돌아갈 재고 풀을 미리 잠그기 위해). */
  findSlabSpecIdsOfCoilSpecs(tx: Tx, coilSpecIds: number[]) {
    return tx.specMapping.findMany({ where: { coilSpecId: { in: coilSpecIds } }, select: { slabSpecId: true } });
  }

  create(
    tx: Tx,
    data: { salesOrderNo: string; customerId: number; dueDate: Date; ownerEmployeeId: number; note: string | null; items: { lineNo: number; productSpecId: number; orderedQty: number }[] },
  ) {
    return tx.salesOrder.create({
      data: {
        salesOrderNo: data.salesOrderNo, customerId: data.customerId, dueDate: data.dueDate, ownerEmployeeId: data.ownerEmployeeId, note: data.note,
        items: { create: data.items },
      },
      include: { items: { orderBy: { lineNo: 'asc' } } },
    });
  }

  findById(tx: Tx, id: number) {
    return tx.salesOrder.findUnique({ where: { id }, include: SALES_ORDER_INCLUDE });
  }

  findMany(tx: Tx, filter: SalesOrderFilter) {
    const keyword = filter.keyword?.trim();
    const where: Prisma.SalesOrderWhereInput = {
      ...(filter.customerId ? { customerId: filter.customerId } : {}),
      ...(filter.itemType ? { items: { some: { productSpec: { item: { itemType: filter.itemType } } } } } : {}),
      ...(filter.dueFrom || filter.dueTo ? { dueDate: { ...(filter.dueFrom ? { gte: filter.dueFrom } : {}), ...(filter.dueTo ? { lte: filter.dueTo } : {}) } } : {}),
      ...(keyword
        ? {
            OR: [
              { salesOrderNo: { contains: keyword, mode: 'insensitive' } },
              { customer: { customerName: { contains: keyword, mode: 'insensitive' } } },
              { items: { some: { productSpec: { specCode: { contains: keyword, mode: 'insensitive' } } } } },
            ],
          }
        : {}),
    };
    return tx.salesOrder.findMany({ where, include: SALES_ORDER_INCLUDE, orderBy: { id: 'desc' } });
  }

  async findDeliveryRiskDays(tx: Tx): Promise<number | null> {
    return (await tx.productionSetting.findFirst({ select: { deliveryRiskDays: true } }))?.deliveryRiskDays ?? null;
  }

  /** 생산계획별 "목표 규격으로 나와 적격이 된 LOT 수" — 계획의 남은 목표 매수를 구할 때 뺀다. */
  async countQualifiedLotsByPlan(tx: Tx, plans: { id: number; productSpecId: number }[]): Promise<Map<number, number>> {
    const out = new Map<number, number>();
    if (!plans.length) return out;
    const specOf = new Map(plans.map((p) => [p.id, p.productSpecId]));
    const lots = await tx.lot.findMany({
      where: { productionPlanId: { in: plans.map((p) => p.id) }, isPassed: true, heatLot: { isPassed: true } },
      select: { productionPlanId: true, productSpecId: true },
    });
    for (const l of lots) {
      if (l.productionPlanId === null || specOf.get(l.productionPlanId) !== l.productSpecId) continue;
      out.set(l.productionPlanId, (out.get(l.productionPlanId) ?? 0) + 1);
    }
    return out;
  }

  /** 수주 품목에 연결된 LOT: 그 품목을 위해 생산·귀속된 LOT과 배정(확정·소진)된 LOT. */
  findLinkedLots(tx: Tx, salesOrderItemIds: number[]) {
    const allocationWhere = { salesOrderItemId: { in: salesOrderItemIds }, status: { in: [ALLOCATION_STATUS.CONFIRMED, ALLOCATION_STATUS.CONSUMED] } };
    return tx.lot.findMany({
      where: { OR: [{ salesOrderItemId: { in: salesOrderItemIds } }, { allocations: { some: allocationWhere } }] },
      orderBy: [{ producedAt: 'asc' }, { lotNo: 'asc' }],
      select: {
        id: true, lotNo: true, lotType: true, lotStatus: true, isPassed: true, producedAt: true, salesOrderItemId: true, productionPlanId: true,
        heatLot: { select: { lotNo: true, isPassed: true } },
        allocations: { where: allocationWhere, orderBy: { id: 'desc' }, select: { id: true, salesOrderItemId: true, purpose: true, status: true } },
      },
    });
  }

  findReservations(tx: Tx, salesOrderId: number) {
    return tx.reservation.findMany({
      where: { salesOrderItem: { salesOrderId } },
      orderBy: { id: 'asc' },
      include: { salesOrderItem: { select: { lineNo: true } }, productSpec: { select: { specCode: true, theoreticalWeightTon: true, item: { select: { itemType: true } } } } },
    });
  }

  /** 부서 코드로 부서장을 찾는다 (업무방 멤버). */
  findDepartmentHeads(tx: Tx, departmentCodes: string[]) {
    return tx.department.findMany({
      where: { departmentCode: { in: departmentCodes }, headEmployeeId: { not: null }, headEmployee: { employeeStatus: EMPLOYEE_STATUS.ACTIVE } },
      select: { headEmployeeId: true },
    });
  }

  createWorkRoom(tx: Tx, data: { salesOrderId: number; chatRoomName: string; createdEmployeeId: number; memberEmployeeIds: number[] }) {
    return tx.chatRoom.create({
      data: {
        chatRoomType: CHAT_ROOM_TYPE.WORK, chatRoomName: data.chatRoomName, salesOrderId: data.salesOrderId, createdEmployeeId: data.createdEmployeeId,
        members: { create: data.memberEmployeeIds.map((employeeId) => ({ employeeId })) },
      },
      select: { id: true },
    });
  }

  /** 취소 대상 품목이 들어 있는 미출고 출하요청. */
  findOpenShipmentRequestIds(tx: Tx, salesOrderItemIds: number[]) {
    return tx.shipmentRequest.findMany({
      where: {
        shipmentRequestStatus: { in: [SHIPMENT_REQUEST_STATUS.REQUESTED, SHIPMENT_REQUEST_STATUS.ALLOCATED] },
        items: { some: { salesOrderItemId: { in: salesOrderItemIds } } },
      },
      orderBy: { id: 'asc' },
      select: { id: true },
    });
  }

  markItemsCancelled(tx: Tx, itemIds: number[]) {
    return tx.salesOrderItem.updateMany({ where: { id: { in: itemIds } }, data: { salesOrderItemStatus: SALES_ORDER_ITEM_STATUS.CANCELLED } });
  }

  markCancelled(tx: Tx, id: number, cancelReason: string | null) {
    return tx.salesOrder.update({ where: { id }, data: { isCancelled: true, cancelledAt: new Date(), cancelReason } });
  }
}
