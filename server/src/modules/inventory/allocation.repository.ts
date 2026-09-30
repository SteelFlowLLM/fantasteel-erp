import { Injectable } from '@nestjs/common';
import { ALLOCATION_STATUS, LOT_STATUS, LOT_TYPE, type ShipmentRequestItemStatus, type ShipmentRequestStatus } from '@fantasteel/shared';
import type { Prisma } from '../../generated/prisma/client';
import type { Tx } from '../../prisma/prisma.service';

const CONFIRMED_ALLOCATIONS = {
  where: { status: ALLOCATION_STATUS.CONFIRMED },
  orderBy: { id: 'asc' },
  include: { lot: { select: { id: true, lotNo: true, lotType: true, producedAt: true, productionPlanId: true, heatLot: { select: { lotNo: true } } } } },
} satisfies Prisma.ShipmentRequestItem$allocationsArgs;

const SALES_ORDER_ITEM = {
  include: {
    salesOrder: { select: { id: true, salesOrderNo: true, isCancelled: true } },
    productSpec: { select: { id: true, specCode: true, item: { select: { itemType: true } }, coilMapping: { select: { slabSpecId: true, slabSpec: { select: { specCode: true } } } } } },
  },
} satisfies Prisma.SalesOrderItemDefaultArgs;

const SHIPMENT_TARGET_INCLUDE = {
  shipmentRequest: { select: { id: true, shipmentRequestNo: true, shipmentRequestStatus: true, customer: { select: { customerName: true } } } },
  salesOrderItem: SALES_ORDER_ITEM,
  allocations: CONFIRMED_ALLOCATIONS,
} satisfies Prisma.ShipmentRequestItemInclude;
export type ShipmentTargetRow = Prisma.ShipmentRequestItemGetPayload<{ include: typeof SHIPMENT_TARGET_INCLUDE }>;

const ROLLING_TARGET_INCLUDE = {
  salesOrderItem: SALES_ORDER_ITEM,
  allocations: CONFIRMED_ALLOCATIONS,
} satisfies Prisma.ProductionPlanInclude;
export type RollingTargetRow = Prisma.ProductionPlanGetPayload<{ include: typeof ROLLING_TARGET_INCLUDE }>;

export type ConfirmedAllocationRow = ShipmentTargetRow['allocations'][number];

@Injectable()
export class AllocationRepository {
  findShipmentTarget(tx: Tx, shipmentRequestItemId: number) {
    return tx.shipmentRequestItem.findUnique({ where: { id: shipmentRequestItemId }, include: SHIPMENT_TARGET_INCLUDE });
  }

  findRollingTarget(tx: Tx, productionPlanId: number) {
    return tx.productionPlan.findUnique({ where: { id: productionPlanId }, include: ROLLING_TARGET_INCLUDE });
  }

  /** 코일 수주 품목에 귀속됐지만 아직 열연 배정이 확정되지 않은 적격 슬래브 수. */
  countEarmarkedWithoutAllocation(tx: Tx, coilSalesOrderItemId: number) {
    return tx.lot.count({
      where: {
        salesOrderItemId: coilSalesOrderItemId, lotType: LOT_TYPE.SLAB, lotStatus: LOT_STATUS.IN_STOCK, isPassed: true, heatLot: { isPassed: true },
        allocations: { none: { status: ALLOCATION_STATUS.CONFIRMED } },
      },
    });
  }

  findLots(tx: Tx, lotIds: number[]) {
    return tx.lot.findMany({ where: { id: { in: lotIds } }, select: { id: true, lotNo: true, lotType: true, productSpecId: true } });
  }

  findAllocation(tx: Tx, id: number) {
    return tx.allocation.findUnique({
      where: { id },
      include: {
        lot: { select: { id: true, lotNo: true, productSpecId: true } },
        salesOrderItem: { select: { id: true, lineNo: true, salesOrderId: true, salesOrder: { select: { salesOrderNo: true } } } },
        shipmentRequestItem: { select: { id: true, shipmentRequestId: true, shipmentRequest: { select: { shipmentRequestNo: true, shipmentRequestStatus: true } } } },
        productionPlan: { select: { id: true, productionPlanNo: true } },
      },
    });
  }

  findShipmentRequestItemStatuses(tx: Tx, shipmentRequestId: number) {
    return tx.shipmentRequestItem.findMany({ where: { shipmentRequestId }, select: { id: true, requestQty: true, shipmentRequestItemStatus: true } });
  }

  updateShipmentRequestItemStatus(tx: Tx, id: number, status: ShipmentRequestItemStatus) {
    return tx.shipmentRequestItem.update({ where: { id }, data: { shipmentRequestItemStatus: status } });
  }

  updateShipmentRequestStatus(tx: Tx, id: number, status: ShipmentRequestStatus) {
    return tx.shipmentRequest.update({ where: { id }, data: { shipmentRequestStatus: status } });
  }
}
