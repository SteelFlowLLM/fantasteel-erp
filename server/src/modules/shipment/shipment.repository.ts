import { Injectable } from '@nestjs/common';
import { ALLOCATION_STATUS, SALES_ORDER_ITEM_STATUS, type ShipmentRequestStatus } from '@fantasteel/shared';
import type { Prisma } from '../../generated/prisma/client';
import { getShippableQtyBySalesOrderItem, lockSalesOrderItemsForShipment, lockShipmentRequest } from '../../generated/prisma/sql';
import type { Tx } from '../../prisma/prisma.service';

const summarySelect = {
  id: true,
  shipmentRequestNo: true,
  customerId: true,
  shipDate: true,
  shipmentRequestStatus: true,
  issuedAt: true,
  createdAt: true,
  customer: { select: { customerName: true } },
  shipmentRequestItems: { select: { requestQty: true } },
} satisfies Prisma.ShipmentRequestSelect;

const detailSelect = {
  ...summarySelect,
  issuedEmployeeId: true,
  issuedEmployee: { select: { employeeName: true } },
  shipmentRequestItems: {
    orderBy: { id: 'asc' },
    select: {
      id: true,
      salesOrderItemId: true,
      requestQty: true,
      salesOrderItem: {
        select: {
          salesOrderId: true,
          itemId: true,
          salesOrder: { select: { salesOrderNo: true } },
          item: { select: { itemCode: true, itemName: true } },
        },
      },
      allocations: {
        where: { allocationStatus: { not: ALLOCATION_STATUS.RELEASED } },
        orderBy: { id: 'asc' },
        select: { id: true, lotId: true, allocationStatus: true, lot: { select: { lotNo: true } } },
      },
    },
  },
} satisfies Prisma.ShipmentRequestSelect;

export type ShipmentRequestSummaryRow = Prisma.ShipmentRequestGetPayload<{ select: typeof summarySelect }>;
export type ShipmentRequestDetailRow = Prisma.ShipmentRequestGetPayload<{ select: typeof detailSelect }>;

@Injectable()
export class ShipmentRepository {
  lockSalesOrderItems(tx: Tx, salesOrderItemIds: number[]) {
    return tx.$queryRawTyped(lockSalesOrderItemsForShipment(salesOrderItemIds));
  }

  findShippableQty(tx: Tx, salesOrderItemIds: number[], activeReservationStatus: string, pendingStatuses: ShipmentRequestStatus[]) {
    return tx.$queryRawTyped(getShippableQtyBySalesOrderItem(salesOrderItemIds, activeReservationStatus, pendingStatuses));
  }

  create(
    tx: Tx,
    data: { shipmentRequestNo: string; customerId: number; shipDate: Date | null; items: { salesOrderItemId: number; requestQty: number }[] },
  ) {
    return tx.shipmentRequest.create({
      data: {
        shipmentRequestNo: data.shipmentRequestNo,
        customerId: data.customerId,
        shipDate: data.shipDate,
        shipmentRequestItems: { create: data.items },
      },
      select: { id: true },
    });
  }

  findMany(tx: Tx, where: Prisma.ShipmentRequestWhereInput, skip: number, take: number) {
    return tx.shipmentRequest.findMany({ where, orderBy: { id: 'desc' }, skip, take, select: summarySelect });
  }

  count(tx: Tx, where: Prisma.ShipmentRequestWhereInput) {
    return tx.shipmentRequest.count({ where });
  }

  findDetail(tx: Tx, id: number) {
    return tx.shipmentRequest.findUnique({ where: { id }, select: detailSelect });
  }

  /** 상태 갱신용: 품목별 요청 매수와 CONFIRMED 배정 수 */
  findAllocationProgress(tx: Tx, id: number) {
    return tx.shipmentRequest.findUnique({
      where: { id },
      select: {
        shipmentRequestStatus: true,
        shipmentRequestItems: {
          select: {
            requestQty: true,
            _count: { select: { allocations: { where: { allocationStatus: ALLOCATION_STATUS.CONFIRMED } } } },
          },
        },
      },
    });
  }

  /** 출하할 수 있는 상태(진행중·부분출하)의 수주 품목. 납기 순 */
  findOpenSalesOrderItems(tx: Tx, customerId?: number) {
    return tx.salesOrderItem.findMany({
      where: {
        salesOrderItemStatus: { in: [SALES_ORDER_ITEM_STATUS.OPEN, SALES_ORDER_ITEM_STATUS.PARTIALLY_SHIPPED] },
        ...(customerId ? { salesOrder: { customerId } } : {}),
      },
      select: {
        id: true,
        salesOrderId: true,
        itemId: true,
        orderedQty: true,
        dueDate: true,
        salesOrder: { select: { salesOrderNo: true, customerId: true, customer: { select: { customerName: true } } } },
        item: { select: { itemCode: true, itemName: true, itemType: true } },
      },
      orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
    });
  }

  /** 출하요청을 잠근다. 취소·배정 확정·해제가 같은 요청의 상태를 동시에 바꾸지 않게 한다 */
  async lockShipmentRequest(tx: Tx, id: number) {
    return (await tx.$queryRawTyped(lockShipmentRequest(id)))[0] ?? null;
  }

  updateStatus(tx: Tx, id: number, shipmentRequestStatus: ShipmentRequestStatus) {
    return tx.shipmentRequest.update({ where: { id }, data: { shipmentRequestStatus }, select: { id: true } });
  }
}
