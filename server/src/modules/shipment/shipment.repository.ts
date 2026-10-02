import { Injectable } from '@nestjs/common';
import { ALLOCATION_STATUS, type ShipmentRequestStatus } from '@fantasteel/shared';
import type { Prisma } from '../../generated/prisma/client';
import { getShippableQtyBySalesOrderItem, lockSalesOrderItemsForShipment } from '../../generated/prisma/sql';
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

  updateStatus(tx: Tx, id: number, shipmentRequestStatus: ShipmentRequestStatus) {
    return tx.shipmentRequest.update({ where: { id }, data: { shipmentRequestStatus }, select: { id: true } });
  }
}
