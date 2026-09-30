import { Injectable } from '@nestjs/common';
import {
  ALLOCATION_STATUS, BUSINESS_EVENT_TYPE, ERROR_CODE, EVENT_REASON_CODE, EVENT_TARGET_TYPE, ITEM_QTY_UNIT, NOTIFICATION_TYPE, ROLE_CODE, SALES_ORDER_ITEM_STATUS,
  SHIPMENT_REQUEST_ITEM_STATUS, SHIPMENT_REQUEST_STATUS, type AuthUser, type EventReasonCode,
} from '@fantasteel/shared';
import { lockRow } from '../../common/concurrency/locks';
import { AppException, badInput, invalidState, notFound } from '../../common/errors/app.exception';
import { NumberingService } from '../../common/numbering/numbering.service';
import { RealtimeService } from '../../common/realtime/realtime.service';
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import { BusinessEventRecorder } from '../business-event/business-event.recorder';
import { StockService } from '../inventory/stock.service';
import { NotificationSender } from '../notification/notification.sender';
import { qtyTon, toDateOnly, tonText } from '../sales-order/sales-order.view';
import type { CancelShipmentRequestDto } from './dto/cancel-shipment-request.dto';
import type { CreateShipmentRequestDto } from './dto/create-shipment-request.dto';
import type { ListShipmentRequestsDto, ListShippableDto } from './dto/list-shipment-requests.dto';
import { ShipmentRepository, type ShipmentRequestRow } from './shipment.repository';
import { dateOnly, toShipmentRequestView, type CustomerRef, type EmployeeRef, type ShipmentRequestView } from './shipment.view';

export interface ShippableItemView {
  salesOrderItemId: number;
  salesOrderId: number;
  salesOrderNo: string;
  lineNo: number;
  customer: CustomerRef;
  /** YYYY-MM-DD */
  dueDate: string;
  productSpecId: number;
  specCode: string;
  itemType: 'SLAB' | 'COIL';
  qtyUnit: string;
  steelGradeCode: string;
  theoreticalWeightTon: string;
  orderedQty: number;
  shippedQty: number;
  /** ACTIVE 예약 매수 */
  reservedQty: number;
  /** 다른 미출고 출하요청에 이미 들어 있는 매수 */
  requestedQty: number;
  /** 지금 출하요청할 수 있는 매수 = reservedQty − requestedQty */
  shippableQty: number;
  shippableTon: string;
}

@Injectable()
export class ShipmentRequestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: ShipmentRepository,
    private readonly numbering: NumberingService,
    private readonly stock: StockService,
    private readonly events: BusinessEventRecorder,
    private readonly notifications: NotificationSender,
    private readonly realtime: RealtimeService,
  ) {}

  // ───────────────────────────── 조회 ─────────────────────────────

  async list(q: ListShipmentRequestsDto): Promise<ShipmentRequestView[]> {
    const rows = await this.repo.findRequests(this.prisma, {
      status: q.status, customerId: q.customerId, salesOrderId: q.salesOrderId, keyword: q.keyword,
      shipFrom: q.shipFrom ? dateOnly(q.shipFrom) : undefined,
      shipTo: q.shipTo ? dateOnly(q.shipTo) : undefined,
    });
    return this.toViews(this.prisma, rows);
  }

  async detail(id: number): Promise<ShipmentRequestView> {
    return this.loadView(this.prisma, id);
  }

  /** 지금 출하요청할 수 있는 수주 품목과 매수 (ACTIVE 예약 − 다른 미출고 출하요청). */
  async shippable(q: ListShippableDto): Promise<ShippableItemView[]> {
    const items = await this.repo.findShippableCandidates(this.prisma, q);
    const ids = items.map((i) => i.id);
    const reserved = await this.repo.sumActiveReservedQty(this.prisma, ids);
    const requested = await this.repo.sumOpenRequestQty(this.prisma, ids);
    return items
      .map((i): ShippableItemView => {
        const itemType = i.productSpec.item.itemType as 'SLAB' | 'COIL';
        const reservedQty = reserved.get(i.id) ?? 0;
        const requestedQty = requested.get(i.id) ?? 0;
        const shippableQty = Math.max(0, reservedQty - requestedQty);
        return {
          salesOrderItemId: i.id,
          salesOrderId: i.salesOrderId,
          salesOrderNo: i.salesOrder.salesOrderNo,
          lineNo: i.lineNo,
          customer: i.salesOrder.customer,
          dueDate: toDateOnly(i.salesOrder.dueDate),
          productSpecId: i.productSpecId,
          specCode: i.productSpec.specCode,
          itemType,
          qtyUnit: ITEM_QTY_UNIT[itemType],
          steelGradeCode: i.productSpec.steelGrade.steelGradeCode,
          theoreticalWeightTon: tonText(i.productSpec.theoreticalWeightTon),
          orderedQty: i.orderedQty,
          shippedQty: i.shippedQty,
          reservedQty,
          requestedQty,
          shippableQty,
          shippableTon: tonText(qtyTon(shippableQty, i.productSpec.theoreticalWeightTon)),
        };
      })
      .filter((v) => v.shippableQty > 0);
  }

  // ───────────────────────────── 출하요청 (REQ-SHP-001) ─────────────────────────────

  /** 같은 고객사의 수주 품목을 묶어 출하요청한다. 실제 LOT은 배정(POST /allocations)에서 정한다. */
  async create(dto: CreateShipmentRequestDto, user: AuthUser): Promise<ShipmentRequestView> {
    return this.prisma.tx(async (tx) => {
      const customer = await this.repo.findCustomer(tx, dto.customerId);
      if (!customer) throw badInput('등록된 고객사를 선택해 주세요');
      // 같은 수주 품목에 동시에 출하요청이 들어와도 예약 매수를 넘지 않도록 수주 품목을 id 순서로 잠근다.
      const itemIds = dto.items.map((i) => i.salesOrderItemId).sort((a, b) => a - b);
      for (const id of itemIds) await lockRow(tx, 'sales_order_item', id);
      const soItems = new Map((await this.repo.findSalesOrderItems(tx, itemIds)).map((i) => [i.id, i]));
      const reserved = await this.repo.sumActiveReservedQty(tx, itemIds);
      const requested = await this.repo.sumOpenRequestQty(tx, itemIds);

      for (const line of dto.items) {
        const soItem = soItems.get(line.salesOrderItemId);
        if (!soItem) throw notFound('수주 품목');
        const label = `${soItem.salesOrder.salesOrderNo} #${soItem.lineNo}`;
        if (soItem.salesOrder.customerId !== customer.id) throw badInput(`${label}: 같은 고객사의 수주 품목만 한 출하요청에 묶을 수 있습니다`);
        if (soItem.salesOrder.isCancelled || soItem.salesOrderItemStatus === SALES_ORDER_ITEM_STATUS.CANCELLED) throw invalidState(`${label}: 취소된 수주 품목은 출하요청할 수 없습니다`);
        const shippableQty = Math.max(0, (reserved.get(soItem.id) ?? 0) - (requested.get(soItem.id) ?? 0));
        if (line.requestQty > shippableQty) {
          throw new AppException(ERROR_CODE.INV_001, `${label}: 출하요청할 수 있는 매수는 ${shippableQty}${ITEM_QTY_UNIT[soItem.productSpec.item.itemType as 'SLAB' | 'COIL']}입니다 (예약 ${reserved.get(soItem.id) ?? 0}, 다른 출하요청 ${requested.get(soItem.id) ?? 0})`);
        }
      }

      const created = await this.repo.createRequest(tx, {
        shipmentRequestNo: await this.numbering.documentNo(tx, 'SHP'),
        customerId: customer.id,
        requestedShipDate: dateOnly(dto.requestedShipDate),
        requesterId: user.employeeId,
        memo: dto.memo?.trim() || null,
        items: dto.items.map((l, idx) => ({ lineNo: idx + 1, salesOrderItemId: l.salesOrderItemId, requestQty: l.requestQty })),
      });
      // 수주 타임라인마다 보이도록 수주별로 한 건씩 남긴다.
      for (const salesOrderId of new Set([...soItems.values()].map((i) => i.salesOrderId))) {
        const lines = dto.items.filter((l) => soItems.get(l.salesOrderItemId)!.salesOrderId === salesOrderId);
        await this.events.record(tx, {
          actor: user,
          eventType: BUSINESS_EVENT_TYPE.SHIPMENT_REQUESTED,
          targetType: EVENT_TARGET_TYPE.SHIPMENT_REQUEST,
          targetId: created.id,
          targetNo: created.shipmentRequestNo,
          salesOrderId,
          summary: `출하요청 ${created.shipmentRequestNo}: ${lines.map((l) => this.lineLabel(soItems.get(l.salesOrderItemId)!, l.requestQty)).join(', ')}`,
          after: { shipmentRequestNo: created.shipmentRequestNo, requestedShipDate: dto.requestedShipDate.slice(0, 10), items: lines },
        });
      }
      this.realtime.changed('shipment-requests', 'sales-orders');
      return this.loadView(tx, created.id);
    });
  }

  /** 출고 전 출하요청 취소. 확정된 배정을 해제한다. */
  async cancel(id: number, dto: CancelShipmentRequestDto, user: AuthUser): Promise<ShipmentRequestView> {
    return this.prisma.tx(async (tx) => {
      await this.cancelWithinTx(tx, id, user, { reasonCode: EVENT_REASON_CODE.ALLOCATION_CHANGE, reason: dto.reason?.trim() || '출하요청 취소', failIfCancelled: true });
      return this.loadView(tx, id);
    });
  }

  /**
   * 출하요청 취소 본체. 수주 취소에서도 같은 tx로 부른다.
   * 출하요청 품목에는 취소 상태 값이 없어 요청 헤더만 CANCELLED로 바꾸고 품목은 배정 대기로 되돌린다.
   */
  async cancelWithinTx(
    tx: Tx,
    id: number,
    actor: AuthUser,
    options: { reasonCode: EventReasonCode; reason: string; salesOrderId?: number; failIfCancelled?: boolean },
  ): Promise<{ releasedAllocationCount: number }> {
    await lockRow(tx, 'shipment_request', id);
    const request = await this.repo.findRequestById(tx, id);
    if (!request) throw notFound('출하요청');
    if (request.shipmentRequestStatus === SHIPMENT_REQUEST_STATUS.CANCELLED) {
      if (options.failIfCancelled) throw invalidState('이미 취소된 출하요청입니다');
      return { releasedAllocationCount: 0 };
    }
    if (request.shipmentRequestStatus !== SHIPMENT_REQUEST_STATUS.REQUESTED && request.shipmentRequestStatus !== SHIPMENT_REQUEST_STATUS.ALLOCATED) {
      throw invalidState('출고 확정된 출하요청은 취소할 수 없습니다');
    }

    let releasedAllocationCount = 0;
    for (const item of request.items) {
      const confirmed = item.allocations.filter((a) => a.status === ALLOCATION_STATUS.CONFIRMED);
      for (const a of confirmed) await this.stock.releaseAllocation(tx, a.id);
      if (confirmed.length) {
        releasedAllocationCount += confirmed.length;
        await this.events.record(tx, {
          actor,
          eventType: BUSINESS_EVENT_TYPE.ALLOCATION_RELEASED,
          targetType: EVENT_TARGET_TYPE.SHIPMENT_REQUEST,
          targetId: request.id,
          targetNo: request.shipmentRequestNo,
          salesOrderId: item.salesOrderItem.salesOrderId,
          lotIds: confirmed.map((a) => a.lotId),
          summary: `출하요청 ${request.shipmentRequestNo} 취소로 배정 ${confirmed.length}건 해제 (${confirmed.map((a) => a.lot.lotNo).join(', ')})`,
          before: { allocationIds: confirmed.map((a) => a.id), status: ALLOCATION_STATUS.CONFIRMED },
          after: { status: ALLOCATION_STATUS.RELEASED, shipmentRequestStatus: SHIPMENT_REQUEST_STATUS.CANCELLED },
          reasonCode: options.reasonCode,
          reason: options.reason,
        });
      }
    }
    await this.repo.updateItemsStatus(tx, request.items.map((i) => i.id), SHIPMENT_REQUEST_ITEM_STATUS.WAITING_ALLOCATION);
    await this.repo.updateRequestStatus(tx, request.id, SHIPMENT_REQUEST_STATUS.CANCELLED, new Date());

    const notice = {
      notificationType: NOTIFICATION_TYPE.SHIPMENT,
      title: `출하요청 ${request.shipmentRequestNo} 취소`,
      body: `${request.customer.customerName} · ${options.reason}`,
      linkPath: `/shipment-requests/${request.id}`,
      dedupeKey: `SHIPMENT_REQUEST_CANCELLED:${request.id}`,
      excludeEmployeeId: actor.employeeId,
    };
    await this.notifications.toEmployees(tx, [request.requesterId], notice);
    // 배정이 끝나 출고 대기 중이던 요청이면 물류에도 알린다.
    if (request.shipmentRequestStatus === SHIPMENT_REQUEST_STATUS.ALLOCATED) await this.notifications.toRole(tx, ROLE_CODE.LOGISTICS, notice);
    this.realtime.changed('shipment-requests', 'allocations');
    return { releasedAllocationCount };
  }

  // ───────────────────────────── 내부 ─────────────────────────────

  async loadView(tx: Tx, id: number): Promise<ShipmentRequestView> {
    const row = await this.repo.findRequestById(tx, id);
    if (!row) throw notFound('출하요청');
    return (await this.toViews(tx, [row]))[0];
  }

  private async toViews(tx: Tx, rows: ShipmentRequestRow[]): Promise<ShipmentRequestView[]> {
    const employeeIds = rows.flatMap((r) => [r.requesterId, ...r.goodsIssues.map((g) => g.confirmedEmployeeId)]).filter((id): id is number => id !== null);
    const employees = new Map<number, EmployeeRef>((await this.repo.findEmployees(tx, [...new Set(employeeIds)])).map((e) => [e.id, e]));
    return rows.map((r) => toShipmentRequestView(r, employees));
  }

  private lineLabel(soItem: { lineNo: number; salesOrder: { salesOrderNo: string }; productSpec: { item: { itemType: string } } }, qty: number): string {
    return `${soItem.salesOrder.salesOrderNo} #${soItem.lineNo} ${qty}${ITEM_QTY_UNIT[soItem.productSpec.item.itemType as 'SLAB' | 'COIL']}`;
  }
}
