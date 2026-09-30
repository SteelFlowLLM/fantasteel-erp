import { Injectable } from '@nestjs/common';
import {
  ALLOCATION_STATUS, BUSINESS_EVENT_TYPE, ERROR_CODE, EVENT_REASON_CODE, EVENT_TARGET_TYPE, ITEM_QTY_UNIT, LOT_STATUS, NOTIFICATION_TYPE, RESERVATION_STATUS,
  SALES_ORDER_ITEM_STATUS, SHIPMENT_REQUEST_ITEM_STATUS, SHIPMENT_REQUEST_STATUS, type AuthUser,
} from '@fantasteel/shared';
import { lockLots, lockProductInventories, lockRow } from '../../common/concurrency/locks';
import { AppException, invalidState, notFound } from '../../common/errors/app.exception';
import { NumberingService } from '../../common/numbering/numbering.service';
import { RealtimeService } from '../../common/realtime/realtime.service';
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import { BusinessEventRecorder } from '../business-event/business-event.recorder';
import { StockService } from '../inventory/stock.service';
import { NotificationSender } from '../notification/notification.sender';
import { IdempotencyService } from '../sales-order/idempotency.service';
import { SalesOrderStatusService } from '../sales-order/sales-order-status.service';
import type { ListGoodsIssuesDto } from './dto/list-goods-issues.dto';
import { MillSheetService } from './mill-sheet.service';
import { ShipmentRepository, type GoodsIssueRow } from './shipment.repository';
import { kstDayRange, toGoodsIssueView, type EmployeeRef, type GoodsIssueView } from './shipment.view';

@Injectable()
export class GoodsIssueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: ShipmentRepository,
    private readonly idempotency: IdempotencyService,
    private readonly numbering: NumberingService,
    private readonly stock: StockService,
    private readonly salesOrderStatus: SalesOrderStatusService,
    private readonly millSheets: MillSheetService,
    private readonly events: BusinessEventRecorder,
    private readonly notifications: NotificationSender,
    private readonly realtime: RealtimeService,
  ) {}

  async list(q: ListGoodsIssuesDto): Promise<GoodsIssueView[]> {
    const rows = await this.repo.findGoodsIssues(this.prisma, { shipmentRequestId: q.shipmentRequestId, customerId: q.customerId, salesOrderId: q.salesOrderId, ...kstDayRange(q.from, q.to) });
    return this.toViews(this.prisma, rows);
  }

  /**
   * 출고 확정 (REQ-SHP-002, 업무 프로세스 정의서 13.3). 출하요청 단위로 전부 한 트랜잭션에서 처리한다.
   * 잠금 순서: 출하요청 → 수주 품목 → 재고 풀(규격 id 순) → LOT(id 순).
   * 다시 불러도 두 번 출고되지 않는다: 같은 Idempotency-Key면 처음 응답을 돌려주고,
   * 키가 없거나 다르면 출하요청 상태(ISSUED)에서 막힌다.
   */
  async confirm(shipmentRequestId: number, user: AuthUser, idempotencyKey?: string): Promise<GoodsIssueView> {
    return this.idempotency.run(`GOODS_ISSUE:${shipmentRequestId}`, idempotencyKey, user, async (tx) => {
      await lockRow(tx, 'shipment_request', shipmentRequestId);
      const request = await this.repo.findRequestById(tx, shipmentRequestId);
      if (!request) throw notFound('출하요청');
      if (request.shipmentRequestStatus === SHIPMENT_REQUEST_STATUS.ISSUED || request.shipmentRequestStatus === SHIPMENT_REQUEST_STATUS.PARTIALLY_ISSUED) {
        throw invalidState('이미 출고 확정된 출하요청입니다');
      }
      if (request.shipmentRequestStatus === SHIPMENT_REQUEST_STATUS.CANCELLED) throw invalidState('취소된 출하요청입니다');
      if (request.shipmentRequestStatus !== SHIPMENT_REQUEST_STATUS.ALLOCATED) throw invalidState('LOT 배정이 끝나지 않은 출하요청입니다. 배정을 먼저 확정해 주세요');

      const salesOrderItemIds = [...new Set(request.items.map((i) => i.salesOrderItemId))].sort((a, b) => a - b);
      for (const id of salesOrderItemIds) await lockRow(tx, 'sales_order_item', id);
      await lockProductInventories(tx, request.items.map((i) => i.salesOrderItem.productSpecId));
      const lines = request.items.map((item) => ({ item, allocations: item.allocations.filter((a) => a.status === ALLOCATION_STATUS.CONFIRMED) }));
      const lotIds = lines.flatMap((l) => l.allocations.map((a) => a.lotId));
      await lockLots(tx, lotIds);

      // 잠근 뒤에 다시 확인한다: 배정 수, LOT 적격(자기 검사 + 상위 히트)·미소진, 예약·주문 잔량.
      const lots = new Map((await this.repo.findLotsForIssue(tx, lotIds)).map((l) => [l.id, l]));
      const reserved = await this.repo.sumActiveReservedQty(tx, salesOrderItemIds);
      for (const { item, allocations } of lines) {
        const soItem = item.salesOrderItem;
        const label = `${soItem.salesOrder.salesOrderNo} #${soItem.lineNo}`;
        if (allocations.length !== item.requestQty) throw invalidState(`${label}: 배정된 LOT 수(${allocations.length})가 출하 매수(${item.requestQty})와 다릅니다`);
        if (soItem.salesOrder.isCancelled || soItem.salesOrderItemStatus === SALES_ORDER_ITEM_STATUS.CANCELLED) throw invalidState(`${label}: 취소된 수주 품목입니다`);
        for (const a of allocations) {
          const lot = lots.get(a.lotId);
          if (!lot) throw notFound('LOT');
          if (lot.lotStatus !== LOT_STATUS.IN_STOCK) throw new AppException(ERROR_CODE.INV_004, `${lot.lotNo}: 이미 투입·출고된 LOT입니다`);
          if (lot.isPassed !== true || lot.heatLot?.isPassed !== true) throw new AppException(ERROR_CODE.INV_002, `${lot.lotNo}: 제품 또는 상위 히트가 미합격이어서 출고할 수 없습니다`);
          if (lot.productSpecId !== soItem.productSpecId) throw invalidState(`${lot.lotNo}: 수주 품목과 규격이 다른 LOT입니다`);
        }
        if (item.requestQty > soItem.orderedQty - soItem.shippedQty) throw new AppException(ERROR_CODE.INV_001, `${label}: 출하 매수가 주문 잔량(${soItem.orderedQty - soItem.shippedQty})을 넘습니다`);
        if (item.requestQty > (reserved.get(soItem.id) ?? 0)) throw new AppException(ERROR_CODE.INV_001, `${label}: 출하 매수만큼의 예약이 없습니다 (ACTIVE 예약 ${reserved.get(soItem.id) ?? 0})`);
      }

      const confirmedAt = new Date();
      const goodsIssue = await this.repo.createGoodsIssue(tx, {
        goodsIssueNo: await this.numbering.documentNo(tx, 'GI'), shipmentRequestId: request.id, confirmedEmployeeId: user.employeeId, confirmedAt,
      });

      for (const { item, allocations } of lines) {
        const soItem = item.salesOrderItem;
        const qty = allocations.length;
        const unit = ITEM_QTY_UNIT[soItem.productSpec.item.itemType as 'SLAB' | 'COIL'];
        const activeBefore = reserved.get(soItem.id) ?? 0;
        for (const a of allocations) await this.stock.consumeForShipment(tx, a.id);
        await this.repo.createGoodsIssueItems(tx, allocations.map((a) => ({ goodsIssueId: goodsIssue.id, shipmentRequestItemId: item.id, lotId: a.lotId })));
        // 부분 출고는 예약을 나눈다: ACTIVE 10 → 4 출고 → ACTIVE 6 + CONVERTED 4 (REQ-INV-005).
        await this.stock.convertItemReservations(tx, soItem.id, qty);
        await this.repo.addShippedQty(tx, soItem.id, qty);
        const itemStatus = await this.salesOrderStatus.recalcItem(tx, soItem.id);
        await this.events.record(tx, {
          actor: user,
          eventType: BUSINESS_EVENT_TYPE.RESERVATION_CONVERTED,
          targetType: EVENT_TARGET_TYPE.SALES_ORDER_ITEM,
          targetId: soItem.id,
          targetNo: `${soItem.salesOrder.salesOrderNo} #${soItem.lineNo}`,
          salesOrderId: soItem.salesOrderId,
          summary: `예약 ${qty}${unit} 출고 전환 (남은 ACTIVE 예약 ${activeBefore - qty}${unit})`,
          before: { [RESERVATION_STATUS.ACTIVE]: activeBefore, shippedQty: soItem.shippedQty, salesOrderItemStatus: soItem.salesOrderItemStatus },
          after: { [RESERVATION_STATUS.ACTIVE]: activeBefore - qty, [RESERVATION_STATUS.CONVERTED]: qty, shippedQty: soItem.shippedQty + qty, salesOrderItemStatus: itemStatus },
          reasonCode: EVENT_REASON_CODE.GOODS_ISSUE,
        });
        await this.millSheets.issue(tx, {
          goodsIssue: { id: goodsIssue.id, goodsIssueNo: goodsIssue.goodsIssueNo, confirmedAt },
          shipmentRequestNo: request.shipmentRequestNo,
          customer: request.customer,
          salesOrderItem: soItem,
          lotIds: allocations.map((a) => a.lotId),
          actor: user,
        });
      }
      await this.repo.updateItemsStatus(tx, request.items.map((i) => i.id), SHIPMENT_REQUEST_ITEM_STATUS.ISSUED);
      await this.repo.updateRequestStatus(tx, request.id, SHIPMENT_REQUEST_STATUS.ISSUED);

      // 수주 타임라인마다 보이도록 수주별로 한 건씩 남기고, 그 수주 담당에게 알린다.
      const orders = new Map(lines.map((l) => [l.item.salesOrderItem.salesOrderId, l.item.salesOrderItem.salesOrder]));
      for (const [salesOrderId, order] of orders) {
        const own = lines.filter((l) => l.item.salesOrderItem.salesOrderId === salesOrderId);
        const text = own.map((l) => `#${l.item.salesOrderItem.lineNo} ${l.allocations.length}${ITEM_QTY_UNIT[l.item.salesOrderItem.productSpec.item.itemType as 'SLAB' | 'COIL']}`).join(', ');
        await this.events.record(tx, {
          actor: user,
          eventType: BUSINESS_EVENT_TYPE.GOODS_ISSUE_CONFIRMED,
          targetType: EVENT_TARGET_TYPE.GOODS_ISSUE,
          targetId: goodsIssue.id,
          targetNo: goodsIssue.goodsIssueNo,
          salesOrderId,
          lotIds: own.flatMap((l) => l.allocations.map((a) => a.lotId)),
          summary: `출고 ${goodsIssue.goodsIssueNo} 확정: ${order.salesOrderNo} ${text} (출하요청 ${request.shipmentRequestNo})`,
          before: { shipmentRequestStatus: request.shipmentRequestStatus },
          after: {
            shipmentRequestStatus: SHIPMENT_REQUEST_STATUS.ISSUED,
            goodsIssueNo: goodsIssue.goodsIssueNo,
            items: own.map((l) => ({ salesOrderItemId: l.item.salesOrderItemId, issuedQty: l.allocations.length, lotNos: l.allocations.map((a) => a.lot.lotNo) })),
          },
          reasonCode: EVENT_REASON_CODE.GOODS_ISSUE,
        });
        await this.notifications.toEmployees(tx, [order.ownerEmployeeId], {
          notificationType: NOTIFICATION_TYPE.SHIPMENT,
          title: `출고 완료 ${goodsIssue.goodsIssueNo}`,
          body: `${order.salesOrderNo} ${text} 출고 확정 · 밀시트 발행`,
          linkPath: `/sales-orders/${salesOrderId}`,
          dedupeKey: `GOODS_ISSUE:${goodsIssue.id}:${salesOrderId}`,
          excludeEmployeeId: user.employeeId,
        });
      }
      this.realtime.changed('goods-issues', 'shipment-requests', 'sales-orders', 'inventories', 'mill-sheets');
      return this.loadView(tx, goodsIssue.id);
    });
  }

  private async loadView(tx: Tx, id: number): Promise<GoodsIssueView> {
    const row = await this.repo.findGoodsIssueById(tx, id);
    if (!row) throw notFound('출고');
    return (await this.toViews(tx, [row]))[0];
  }

  private async toViews(tx: Tx, rows: GoodsIssueRow[]): Promise<GoodsIssueView[]> {
    const ids = [...new Set(rows.map((r) => r.confirmedEmployeeId).filter((id): id is number => id !== null))];
    const employees = new Map<number, EmployeeRef>((await this.repo.findEmployees(tx, ids)).map((e) => [e.id, e]));
    return rows.map((r) => toGoodsIssueView(r, employees));
  }
}
