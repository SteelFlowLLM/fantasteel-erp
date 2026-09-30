import { Injectable } from '@nestjs/common';
import {
  ALLOCATION_STATUS, GOODS_ISSUE_STATUS, RESERVATION_STATUS, SALES_ORDER_ITEM_STATUS, SHIPMENT_REQUEST_ITEM_STATUS, SHIPMENT_REQUEST_STATUS,
  type ShipmentRequestItemStatus, type ShipmentRequestStatus,
} from '@fantasteel/shared';
import type { Prisma } from '../../generated/prisma/client';
import type { Tx } from '../../prisma/prisma.service';

const SALES_ORDER_ITEM_INCLUDE = {
  salesOrder: { select: { id: true, salesOrderNo: true, customerId: true, ownerEmployeeId: true, isCancelled: true } },
  productSpec: { include: { item: { select: { itemType: true } }, steelGrade: { select: { steelGradeCode: true, steelGradeName: true, standardNo: true } } } },
} satisfies Prisma.SalesOrderItemInclude;

export const SHIPMENT_REQUEST_INCLUDE = {
  customer: { select: { id: true, customerCode: true, customerName: true } },
  items: {
    orderBy: { lineNo: 'asc' },
    include: {
      salesOrderItem: { include: SALES_ORDER_ITEM_INCLUDE },
      allocations: {
        where: { status: { in: [ALLOCATION_STATUS.CONFIRMED, ALLOCATION_STATUS.CONSUMED] } },
        orderBy: { id: 'asc' },
        include: { lot: { select: { id: true, lotNo: true, lotType: true, lotStatus: true, isPassed: true, producedAt: true, heatLot: { select: { lotNo: true, isPassed: true } } } } },
      },
    },
  },
  goodsIssues: { orderBy: { id: 'asc' }, select: { id: true, goodsIssueNo: true, confirmedAt: true, confirmedEmployeeId: true, millSheets: { orderBy: { id: 'asc' }, select: { id: true, millSheetNo: true, salesOrderId: true, pdfStatus: true } } } },
} satisfies Prisma.ShipmentRequestInclude;
export type ShipmentRequestRow = Prisma.ShipmentRequestGetPayload<{ include: typeof SHIPMENT_REQUEST_INCLUDE }>;

export const GOODS_ISSUE_INCLUDE = {
  shipmentRequest: { select: { id: true, shipmentRequestNo: true, customer: { select: { id: true, customerCode: true, customerName: true } } } },
  items: {
    orderBy: { id: 'asc' },
    include: {
      lot: { select: { id: true, lotNo: true, heatLot: { select: { lotNo: true } } } },
      shipmentRequestItem: { select: { id: true, lineNo: true, salesOrderItem: { include: SALES_ORDER_ITEM_INCLUDE } } },
    },
  },
  millSheets: { orderBy: { id: 'asc' }, select: { id: true, millSheetNo: true, salesOrderId: true, pdfStatus: true } },
} satisfies Prisma.GoodsIssueInclude;
export type GoodsIssueRow = Prisma.GoodsIssueGetPayload<{ include: typeof GOODS_ISSUE_INCLUDE }>;

/** 아직 출고도 취소도 되지 않은 출하요청 상태. */
export const OPEN_REQUEST_STATUSES: ShipmentRequestStatus[] = [SHIPMENT_REQUEST_STATUS.REQUESTED, SHIPMENT_REQUEST_STATUS.ALLOCATED];

export interface ShipmentRequestFilter {
  status?: ShipmentRequestStatus;
  customerId?: number;
  salesOrderId?: number;
  shipFrom?: Date;
  shipTo?: Date;
  keyword?: string;
}

@Injectable()
export class ShipmentRepository {
  // ───────────── 출하요청 ─────────────

  findCustomer(tx: Tx, id: number) {
    return tx.customer.findUnique({ where: { id } });
  }

  findSalesOrderItems(tx: Tx, ids: number[]) {
    return tx.salesOrderItem.findMany({ where: { id: { in: ids } }, include: SALES_ORDER_ITEM_INCLUDE });
  }

  /** 출하요청할 수 있는 후보: 취소·출하완료가 아닌 수주 품목 중 ACTIVE 예약이 있는 것. */
  findShippableCandidates(tx: Tx, filter: { customerId?: number; salesOrderId?: number }) {
    return tx.salesOrderItem.findMany({
      where: {
        salesOrderItemStatus: { notIn: [SALES_ORDER_ITEM_STATUS.CANCELLED, SALES_ORDER_ITEM_STATUS.SHIPPED] },
        reservations: { some: { status: RESERVATION_STATUS.ACTIVE } },
        salesOrder: { isCancelled: false, ...(filter.customerId ? { customerId: filter.customerId } : {}), ...(filter.salesOrderId ? { id: filter.salesOrderId } : {}) },
      },
      orderBy: [{ salesOrderId: 'asc' }, { lineNo: 'asc' }],
      include: {
        salesOrder: { select: { id: true, salesOrderNo: true, dueDate: true, customer: { select: { id: true, customerCode: true, customerName: true } } } },
        productSpec: { include: { item: { select: { itemType: true } }, steelGrade: { select: { steelGradeCode: true } } } },
      },
    });
  }

  /** 수주 품목별 ACTIVE 예약 매수. */
  async sumActiveReservedQty(tx: Tx, salesOrderItemIds: number[]): Promise<Map<number, number>> {
    const rows = await tx.reservation.groupBy({
      by: ['salesOrderItemId'],
      where: { salesOrderItemId: { in: salesOrderItemIds }, status: RESERVATION_STATUS.ACTIVE },
      _sum: { reservedQty: true },
    });
    return new Map(rows.map((r) => [r.salesOrderItemId, r._sum.reservedQty ?? 0]));
  }

  /** 수주 품목별 "다른 미출고 출하요청"에 들어 있는 매수. */
  async sumOpenRequestQty(tx: Tx, salesOrderItemIds: number[], excludeShipmentRequestId?: number): Promise<Map<number, number>> {
    const rows = await tx.shipmentRequestItem.findMany({
      where: {
        salesOrderItemId: { in: salesOrderItemIds },
        shipmentRequest: { shipmentRequestStatus: { in: OPEN_REQUEST_STATUSES }, ...(excludeShipmentRequestId ? { id: { not: excludeShipmentRequestId } } : {}) },
      },
      select: { salesOrderItemId: true, requestQty: true },
    });
    const out = new Map<number, number>();
    for (const r of rows) out.set(r.salesOrderItemId, (out.get(r.salesOrderItemId) ?? 0) + r.requestQty);
    return out;
  }

  createRequest(
    tx: Tx,
    data: { shipmentRequestNo: string; customerId: number; requestedShipDate: Date; requesterId: number; memo: string | null; items: { lineNo: number; salesOrderItemId: number; requestQty: number }[] },
  ) {
    return tx.shipmentRequest.create({
      data: {
        shipmentRequestNo: data.shipmentRequestNo, customerId: data.customerId, requestedShipDate: data.requestedShipDate, requesterId: data.requesterId, memo: data.memo,
        shipmentRequestStatus: SHIPMENT_REQUEST_STATUS.REQUESTED,
        items: { create: data.items.map((i) => ({ ...i, shipmentRequestItemStatus: SHIPMENT_REQUEST_ITEM_STATUS.WAITING_ALLOCATION })) },
      },
      select: { id: true, shipmentRequestNo: true },
    });
  }

  findRequestById(tx: Tx, id: number) {
    return tx.shipmentRequest.findUnique({ where: { id }, include: SHIPMENT_REQUEST_INCLUDE });
  }

  findRequests(tx: Tx, filter: ShipmentRequestFilter) {
    const keyword = filter.keyword?.trim();
    const where: Prisma.ShipmentRequestWhereInput = {
      ...(filter.status ? { shipmentRequestStatus: filter.status } : {}),
      ...(filter.customerId ? { customerId: filter.customerId } : {}),
      ...(filter.salesOrderId ? { items: { some: { salesOrderItem: { salesOrderId: filter.salesOrderId } } } } : {}),
      ...(filter.shipFrom || filter.shipTo ? { requestedShipDate: { ...(filter.shipFrom ? { gte: filter.shipFrom } : {}), ...(filter.shipTo ? { lte: filter.shipTo } : {}) } } : {}),
      ...(keyword
        ? {
            OR: [
              { shipmentRequestNo: { contains: keyword, mode: 'insensitive' } },
              { customer: { customerName: { contains: keyword, mode: 'insensitive' } } },
              { items: { some: { salesOrderItem: { salesOrder: { salesOrderNo: { contains: keyword, mode: 'insensitive' } } } } } },
            ],
          }
        : {}),
    };
    return tx.shipmentRequest.findMany({ where, include: SHIPMENT_REQUEST_INCLUDE, orderBy: { id: 'desc' } });
  }

  findEmployees(tx: Tx, ids: number[]) {
    return tx.employee.findMany({ where: { id: { in: ids } }, select: { id: true, employeeNo: true, employeeName: true } });
  }

  updateRequestStatus(tx: Tx, id: number, status: ShipmentRequestStatus, cancelledAt?: Date) {
    return tx.shipmentRequest.update({ where: { id }, data: { shipmentRequestStatus: status, ...(cancelledAt ? { cancelledAt } : {}) } });
  }

  updateItemsStatus(tx: Tx, itemIds: number[], status: ShipmentRequestItemStatus) {
    return tx.shipmentRequestItem.updateMany({ where: { id: { in: itemIds } }, data: { shipmentRequestItemStatus: status } });
  }

  // ───────────── 출고 ─────────────

  createGoodsIssue(tx: Tx, data: { goodsIssueNo: string; shipmentRequestId: number; confirmedEmployeeId: number; confirmedAt: Date }) {
    return tx.goodsIssue.create({ data: { ...data, goodsIssueStatus: GOODS_ISSUE_STATUS.CONFIRMED } });
  }

  createGoodsIssueItems(tx: Tx, rows: { goodsIssueId: number; shipmentRequestItemId: number; lotId: number }[]) {
    return tx.goodsIssueItem.createMany({ data: rows });
  }

  addShippedQty(tx: Tx, salesOrderItemId: number, qty: number) {
    return tx.salesOrderItem.update({ where: { id: salesOrderItemId }, data: { shippedQty: { increment: qty } } });
  }

  /** 출고 직전 재검증용: 잠근 뒤의 LOT 상태. */
  findLotsForIssue(tx: Tx, lotIds: number[]) {
    return tx.lot.findMany({
      where: { id: { in: lotIds } },
      select: { id: true, lotNo: true, lotStatus: true, isPassed: true, productSpecId: true, heatLot: { select: { lotNo: true, isPassed: true } } },
    });
  }

  countReservationsByStatus(tx: Tx, salesOrderItemId: number) {
    return tx.reservation.groupBy({ by: ['status'], where: { salesOrderItemId }, _sum: { reservedQty: true } });
  }

  findGoodsIssueById(tx: Tx, id: number) {
    return tx.goodsIssue.findUnique({ where: { id }, include: GOODS_ISSUE_INCLUDE });
  }

  findGoodsIssues(tx: Tx, filter: { shipmentRequestId?: number; customerId?: number; salesOrderId?: number; from?: Date; to?: Date }) {
    const where: Prisma.GoodsIssueWhereInput = {
      ...(filter.shipmentRequestId ? { shipmentRequestId: filter.shipmentRequestId } : {}),
      ...(filter.customerId ? { shipmentRequest: { customerId: filter.customerId } } : {}),
      ...(filter.salesOrderId ? { items: { some: { shipmentRequestItem: { salesOrderItem: { salesOrderId: filter.salesOrderId } } } } } : {}),
      ...(filter.from || filter.to ? { confirmedAt: { ...(filter.from ? { gte: filter.from } : {}), ...(filter.to ? { lt: filter.to } : {}) } } : {}),
    };
    return tx.goodsIssue.findMany({ where, include: GOODS_ISSUE_INCLUDE, orderBy: { id: 'desc' } });
  }
}
