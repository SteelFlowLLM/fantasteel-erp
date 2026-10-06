import { Injectable } from '@nestjs/common';
import { ALLOCATION_STATUS, BUSINESS_EVENT_TYPE, SALES_ORDER_ITEM_STATUS, type SalesOrderItemStatus } from '@fantasteel/shared';
import { countPassedProductsByPlan, lockSalesOrderItemsForShipment } from '../../generated/prisma/sql';
import type { Tx } from '../../prisma/prisma.service';

/** 목록·상세·충족 현황이 함께 쓰는 읽기 모양: 품목 + 예약(상태·매수) + 연결 계획 */
const salesOrderInclude = {
  customer: { select: { customerName: true } },
  ownerEmployee: { select: { employeeName: true } },
  salesOrderItems: {
    orderBy: { id: 'asc' },
    include: {
      item: { select: { itemCode: true, itemName: true, itemType: true, theoreticalWeightTon: true } },
      reservations: { select: { reservationStatus: true, reservedQty: true } },
      productionPlans: {
        orderBy: { id: 'asc' },
        select: { id: true, productionPlanNo: true, salesOrderItemId: true, itemId: true, shortageQty: true, heatCount: true, isReproduction: true, productionPlanStatus: true },
      },
    },
  },
} as const;

/**
 * DB 접근은 여기서만 한다. 함수의 첫 인자는 tx (컨벤션 8장).
 * 집계·3개 이상 JOIN·잠금(FOR UPDATE)은 prisma/sql/*.sql(TypedSQL)로 만들고 tx.$queryRawTyped(...)로 부른다.
 */
@Injectable()
export class SalesOrderRepository {
  findCustomer(tx: Tx, id: number) {
    return tx.customer.findUnique({ where: { id }, select: { id: true } });
  }

  findItems(tx: Tx, ids: number[]) {
    return tx.item.findMany({ where: { id: { in: ids } }, select: { id: true, itemType: true, theoreticalWeightTon: true } });
  }

  createSalesOrder(tx: Tx, data: { salesOrderNo: string; customerId: number; ownerEmployeeId: number; items: { itemId: number; orderedQty: number; dueDate: Date }[] }) {
    return tx.salesOrder.create({
      data: {
        salesOrderNo: data.salesOrderNo,
        customerId: data.customerId,
        ownerEmployeeId: data.ownerEmployeeId,
        salesOrderItems: { create: data.items },
      },
      include: { salesOrderItems: { orderBy: { id: 'asc' } } },
    });
  }

  countSalesOrders(tx: Tx) {
    return tx.salesOrder.count();
  }

  findSalesOrders(tx: Tx, page: { skip: number; take: number }) {
    return tx.salesOrder.findMany({ include: salesOrderInclude, orderBy: { id: 'desc' }, skip: page.skip, take: page.take });
  }

  /** 진행 중(진행중·부분출하 품목이 있는) 수주 */
  findOpenSalesOrders(tx: Tx) {
    return tx.salesOrder.findMany({
      where: { salesOrderItems: { some: { salesOrderItemStatus: { in: [SALES_ORDER_ITEM_STATUS.OPEN, SALES_ORDER_ITEM_STATUS.PARTIALLY_SHIPPED] } } } },
      include: salesOrderInclude,
      orderBy: { id: 'asc' },
    });
  }

  findSalesOrder(tx: Tx, id: number) {
    return tx.salesOrder.findUnique({ where: { id }, include: salesOrderInclude });
  }

  /** 이 수주 품목들이 담긴 출하요청 (상세 화면·취소 검사 SO-004) */
  findShipmentRequestsOfItems(tx: Tx, salesOrderItemIds: number[]) {
    return tx.shipmentRequest.findMany({
      where: { shipmentRequestItems: { some: { salesOrderItemId: { in: salesOrderItemIds } } } },
      include: {
        shipmentRequestItems: {
          where: { salesOrderItemId: { in: salesOrderItemIds } },
          select: {
            salesOrderItemId: true,
            requestQty: true,
            _count: { select: { allocations: { where: { allocationStatus: { in: [ALLOCATION_STATUS.CONFIRMED, ALLOCATION_STATUS.CONSUMED] } } } } },
          },
        },
      },
      orderBy: { id: 'asc' },
    });
  }

  countPassedProductsByPlan(tx: Tx, productionPlanIds: number[]) {
    return tx.$queryRawTyped(countPassedProductsByPlan(productionPlanIds));
  }

  findInventories(tx: Tx, itemIds: number[]) {
    return tx.inventory.findMany({ where: { itemId: { in: itemIds } }, select: { itemId: true, onHandQty: true, reservedQty: true, rollingAllocatedQty: true } });
  }

  findProductionSetting(tx: Tx) {
    return tx.productionSetting.findFirst({ orderBy: { id: 'asc' }, select: { deliveryRiskDays: true } });
  }

  /** 출하요청 등록과 같은 잠금(shipment의 TypedSQL)을 써서 수주 취소와 출하요청 등록이 서로 끼어들지 않게 한다 */
  lockSalesOrderItems(tx: Tx, salesOrderItemIds: number[]) {
    return tx.$queryRawTyped(lockSalesOrderItemsForShipment([...salesOrderItemIds].sort((a, b) => a - b)));
  }

  updateItemStatus(tx: Tx, id: number, salesOrderItemStatus: SalesOrderItemStatus) {
    return tx.salesOrderItem.update({ where: { id }, data: { salesOrderItemStatus } });
  }

  /** 헤더에는 updated_at만 있어 취소 시각을 올리려고 고친다 (취소 시각·사유는 작업 로그에 남는다) */
  touchSalesOrder(tx: Tx, id: number) {
    return tx.salesOrder.update({ where: { id }, data: { updatedAt: new Date() } });
  }

  /** 수주 취소 작업 로그: 취소 시각·사유·취소로 일어난 일 (sales_order에 취소 컬럼이 없다) */
  findLastCancelEvent(tx: Tx, salesOrderId: number) {
    return tx.businessEvent.findFirst({
      where: { salesOrderId, businessEventType: BUSINESS_EVENT_TYPE.SALES_ORDER_CANCELLED },
      orderBy: { id: 'desc' },
      select: { createdAt: true, reason: true, afterData: true },
    });
  }
}
