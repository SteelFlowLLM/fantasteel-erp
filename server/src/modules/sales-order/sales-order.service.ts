import { Injectable } from '@nestjs/common';
import {
  BUSINESS_EVENT_TYPE, ERROR_CODE, EVENT_REASON_CODE, EVENT_TARGET_TYPE, ITEM_QTY_UNIT, ITEM_TYPE, NOTIFICATION_TYPE, ROLE_CODE,
  SALES_ORDER_ITEM_STATUS, type AllocationPurpose, type AllocationStatus, type AuthUser, type ReservationStatus,
} from '@fantasteel/shared';
import { lockProductInventories, lockRow } from '../../common/concurrency/locks';
import { AppException, badInput, invalidState, notFound } from '../../common/errors/app.exception';
import { NumberingService } from '../../common/numbering/numbering.service';
import { RealtimeService } from '../../common/realtime/realtime.service';
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import { BusinessEventRecorder } from '../business-event/business-event.recorder';
import { StockService } from '../inventory/stock.service';
import { NotificationSender } from '../notification/notification.sender';
import { ProductionPlanWriter } from '../production/production-plan.writer';
import { ShipmentRequestService } from '../shipment/shipment-request.service';
import type { CancelSalesOrderDto } from './dto/cancel-sales-order.dto';
import type { CreateSalesOrderDto } from './dto/create-sales-order.dto';
import type { ListSalesOrdersDto } from './dto/list-sales-orders.dto';
import { IdempotencyService } from './idempotency.service';
import { SalesOrderRepository, type SalesOrderRow } from './sales-order.repository';
import { qtyTon, remainingTargetQty, toSalesOrderView, tonText, type SalesOrderItemView, type SalesOrderView } from './sales-order.view';

const QTY_MESSAGE = '수량은 1 이상의 정수로 입력해 주세요';
// 수주 업무방에 함께 넣는 부서의 부서장 (생산부·품질부·물류부·구매부). 부서 코드는 시드 기준.
const WORK_ROOM_DEPARTMENT_CODES = ['PRODUCTION', 'QUALITY', 'LOGISTICS', 'PURCHASE'];
const DEFAULT_PAGE_SIZE = 50;

export interface SalesOrderListView {
  rows: SalesOrderView[];
  total: number;
  page: number;
  size: number;
}

export interface FulfillmentPlanView {
  id: number;
  productionPlanNo: string;
  productionPlanStatus: string;
  isReproduction: boolean;
  /** 계획 목표 매수 */
  shortageQty: number;
  /** 남은 목표 매수 (목표 − 이미 적격이 된 생산분, 닫힌 계획은 0) */
  remainingTargetQty: number;
  heatCount: number;
  plannedSlabQty: number;
  surplusUseQty: number;
}

export interface FulfillmentLotView {
  id: number;
  lotNo: string;
  lotType: string;
  lotStatus: string;
  isPassed: boolean | null;
  heatNo: string | null;
  isHeatPassed: boolean | null;
  producedAt: string;
  productionPlanId: number | null;
  /** 이 품목에 대한 배정이 있으면 그 목적·상태 (없으면 null = 생산·귀속만 된 LOT) */
  allocationPurpose: AllocationPurpose | null;
  allocationStatus: AllocationStatus | null;
}

export interface FulfillmentItemView extends SalesOrderItemView {
  productionPlans: FulfillmentPlanView[];
  lots: FulfillmentLotView[];
}

export interface FulfillmentView extends Omit<SalesOrderView, 'items'> {
  items: FulfillmentItemView[];
}

export interface ReservationView {
  id: number;
  salesOrderItemId: number;
  lineNo: number;
  productSpecId: number;
  specCode: string;
  itemType: 'SLAB' | 'COIL';
  reservedQty: number;
  reservedTon: string;
  status: ReservationStatus;
  isAutoReserved: boolean;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class SalesOrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: SalesOrderRepository,
    private readonly idempotency: IdempotencyService,
    private readonly numbering: NumberingService,
    private readonly stock: StockService,
    private readonly planWriter: ProductionPlanWriter,
    private readonly shipmentRequests: ShipmentRequestService,
    private readonly events: BusinessEventRecorder,
    private readonly notifications: NotificationSender,
    private readonly realtime: RealtimeService,
  ) {}

  // ───────────────────────────── 등록 (BP-SO-01) ─────────────────────────────

  /**
   * 수주 등록: 저장 → 품목별 합격 재고 우선 예약(부분 허용) → 부족 매수만 생산계획 → 업무방 생성.
   * 전부 한 트랜잭션이다. 같은 Idempotency-Key로 다시 부르면 처음 결과를 돌려준다.
   */
  async create(dto: CreateSalesOrderDto, user: AuthUser, idempotencyKey?: string): Promise<SalesOrderView> {
    const lines = this.validateLines(dto);
    return this.idempotency.run('SALES_ORDER_CREATE', idempotencyKey, user, async (tx) => {
      const customer = await this.repo.findCustomer(tx, dto.customerId);
      if (!customer || !customer.isActive) throw badInput('등록된 고객사를 선택해 주세요');
      const specs = new Map((await this.repo.findProductSpecs(tx, lines.map((l) => l.productSpecId))).map((s) => [s.id, s]));
      for (const line of lines) {
        const spec = specs.get(line.productSpecId);
        const sellable = spec && spec.isActive && spec.item.isActive && (spec.item.itemType === ITEM_TYPE.SLAB || spec.item.itemType === ITEM_TYPE.COIL);
        if (!sellable) throw new AppException(ERROR_CODE.SO_001, '등록되지 않은 규격입니다');
      }

      const order = await this.repo.create(tx, {
        salesOrderNo: await this.numbering.documentNo(tx, 'SO'),
        customerId: customer.id,
        dueDate: new Date(`${dto.dueDate.slice(0, 10)}T00:00:00.000Z`),
        ownerEmployeeId: user.employeeId,
        note: dto.note?.trim() || null,
        items: lines.map((l, i) => ({ lineNo: i + 1, productSpecId: l.productSpecId, orderedQty: l.orderedQty })),
      });
      await this.events.record(tx, {
        actor: user,
        eventType: BUSINESS_EVENT_TYPE.SALES_ORDER_REGISTERED,
        targetType: EVENT_TARGET_TYPE.SALES_ORDER,
        targetId: order.id,
        targetNo: order.salesOrderNo,
        salesOrderId: order.id,
        summary: `${customer.customerName} 수주 ${order.salesOrderNo} 등록 (품목 ${order.items.length}건)`,
        after: {
          salesOrderNo: order.salesOrderNo, customerId: customer.id, dueDate: dto.dueDate.slice(0, 10),
          items: order.items.map((i) => ({ lineNo: i.lineNo, productSpecId: i.productSpecId, specCode: specs.get(i.productSpecId)!.specCode, orderedQty: i.orderedQty })),
        },
      });

      // 같은 규격을 동시에 주문해도 초과 예약하지 않도록 재고 풀을 규격 id 순서로 먼저 잠근다 (REQ-INV-009).
      await lockProductInventories(tx, order.items.map((i) => i.productSpecId));
      for (const item of order.items) {
        const reservedQty = await this.stock.reserveForItem(tx, { salesOrderItemId: item.id, maxQty: item.orderedQty, actor: user, reasonCode: EVENT_REASON_CODE.STOCK_FIRST });
        const shortageQty = item.orderedQty - reservedQty;
        if (shortageQty > 0) await this.planWriter.createForShortage(tx, { salesOrderItemId: item.id, shortageQty, actor: user });
      }

      await this.createWorkRoom(tx, order.id, order.salesOrderNo, user);
      this.realtime.changed('sales-orders', 'chat-rooms');
      return this.loadView(tx, order.id);
    });
  }

  /** 수량·규격 id 형식 검증. 소수(10.5)·0·음수·누락·문자열은 반올림하지 않고 거부한다 (REQ-SO-002). */
  private validateLines(dto: CreateSalesOrderDto): { productSpecId: number; orderedQty: number }[] {
    return dto.items.map((line) => {
      const { orderedQty, productSpecId } = line;
      if (typeof orderedQty !== 'number' || !Number.isInteger(orderedQty) || orderedQty < 1) throw new AppException(ERROR_CODE.SO_002, QTY_MESSAGE);
      if (typeof productSpecId !== 'number' || !Number.isInteger(productSpecId) || productSpecId < 1) throw new AppException(ERROR_CODE.SO_001, '등록되지 않은 규격입니다');
      return { productSpecId, orderedQty };
    });
  }

  /**
   * 수주 업무방. 메신저 모듈의 서비스에 기대지 않고 chat_room·chat_room_member 행만 같은 tx에서 만든다.
   * 멤버 = 수주 담당 + 생산부·품질부·물류부·구매부 부서장.
   */
  private async createWorkRoom(tx: Tx, salesOrderId: number, salesOrderNo: string, user: AuthUser): Promise<void> {
    const heads = await this.repo.findDepartmentHeads(tx, WORK_ROOM_DEPARTMENT_CODES);
    const memberEmployeeIds = [...new Set([user.employeeId, ...heads.map((d) => d.headEmployeeId!)])];
    await this.repo.createWorkRoom(tx, { salesOrderId, chatRoomName: `#${salesOrderNo}`, createdEmployeeId: user.employeeId, memberEmployeeIds });
  }

  // ───────────────────────────── 조회 ─────────────────────────────

  async list(q: ListSalesOrdersDto): Promise<SalesOrderListView> {
    const orders = await this.repo.findMany(this.prisma, {
      customerId: q.customerId,
      itemType: q.itemType,
      dueFrom: q.dueFrom ? new Date(`${q.dueFrom.slice(0, 10)}T00:00:00.000Z`) : undefined,
      dueTo: q.dueTo ? new Date(`${q.dueTo.slice(0, 10)}T00:00:00.000Z`) : undefined,
      keyword: q.keyword,
    });
    const views = await this.toViews(this.prisma, orders);
    // 헤더 상태와 납기 위험은 저장값이 아니라 계산값이어서 조회한 뒤에 거른다.
    const filtered = views.filter((v) => (!q.status || v.salesOrderStatus === q.status) && (!q.deliveryRiskOnly || v.isDeliveryRisk));
    const size = q.size ?? DEFAULT_PAGE_SIZE;
    const page = q.page ?? 1;
    return { rows: filtered.slice((page - 1) * size, page * size), total: filtered.length, page, size };
  }

  async detail(id: number): Promise<SalesOrderView> {
    return this.loadView(this.prisma, id);
  }

  /**
   * 수주 충족 현황 (REQ-SO-004, 업무 프로세스 정의서 4.5).
   * 예약·검사합격·출하는 서로 겹치지 않는 확보 매수이고, 생산중은 미확보 매수 안에서만 센다.
   * 그래서 reservedQty + passedQty + shippedQty + inProductionQty ≤ orderedQty 가 항상 성립한다.
   */
  async fulfillment(id: number): Promise<FulfillmentView> {
    const order = await this.repo.findById(this.prisma, id);
    if (!order) throw notFound('수주');
    const qualifiedByPlan = await this.qualifiedByPlan(this.prisma, [order]);
    const view = toSalesOrderView(order, qualifiedByPlan, await this.repo.findDeliveryRiskDays(this.prisma));
    const lots = await this.repo.findLinkedLots(this.prisma, order.items.map((i) => i.id));
    const items = view.items.map((itemView, idx): FulfillmentItemView => {
      const row = order.items[idx];
      return {
        ...itemView,
        productionPlans: row.productionPlans.map((p) => ({
          id: p.id,
          productionPlanNo: p.productionPlanNo,
          productionPlanStatus: p.productionPlanStatus,
          isReproduction: p.isReproduction,
          shortageQty: p.shortageQty,
          remainingTargetQty: remainingTargetQty(p, qualifiedByPlan),
          heatCount: p.heatCount,
          plannedSlabQty: p.plannedSlabQty,
          surplusUseQty: p.surplusUseQty,
        })),
        lots: lots
          .filter((l) => l.salesOrderItemId === row.id || l.allocations.some((a) => a.salesOrderItemId === row.id))
          .map((l) => {
            const allocation = l.allocations.find((a) => a.salesOrderItemId === row.id) ?? null;
            return {
              id: l.id,
              lotNo: l.lotNo,
              lotType: l.lotType,
              lotStatus: l.lotStatus,
              isPassed: l.isPassed,
              heatNo: l.heatLot?.lotNo ?? null,
              isHeatPassed: l.heatLot?.isPassed ?? null,
              producedAt: l.producedAt.toISOString(),
              productionPlanId: l.productionPlanId,
              allocationPurpose: (allocation?.purpose as AllocationPurpose | undefined) ?? null,
              allocationStatus: (allocation?.status as AllocationStatus | undefined) ?? null,
            };
          }),
      };
    });
    return { ...view, items };
  }

  /** 예약 이력 (ACTIVE·CONVERTED·RELEASED 모두). */
  async reservations(id: number): Promise<ReservationView[]> {
    const order = await this.repo.findById(this.prisma, id);
    if (!order) throw notFound('수주');
    const rows = await this.repo.findReservations(this.prisma, id);
    return rows.map((r) => ({
      id: r.id,
      salesOrderItemId: r.salesOrderItemId,
      lineNo: r.salesOrderItem.lineNo,
      productSpecId: r.productSpecId,
      specCode: r.productSpec.specCode,
      itemType: r.productSpec.item.itemType as 'SLAB' | 'COIL',
      reservedQty: r.reservedQty,
      reservedTon: tonText(qtyTon(r.reservedQty, r.productSpec.theoreticalWeightTon)),
      status: r.status as ReservationStatus,
      isAutoReserved: r.isAutoReserved,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  // ───────────────────────────── 취소 (BP-SO-02, REQ-SO-006) ─────────────────────────────

  /**
   * 수주 취소. 출고가 끝난 매수는 그대로 두고 남은 것만 취소한다.
   * - 전량 출하된 품목: SHIPPED 유지
   * - 일부 출하된 품목: CANCELLED로 바꾸되 ordered_qty·shipped_qty·CONVERTED 예약·출고·밀시트는 그대로 둔다
   *   (잔량 = ordered_qty − shipped_qty 가 취소된 매수). 스키마에 취소 매수 컬럼이 없어 주문 매수를 줄이지 않는다.
   * - 미출하 품목: CANCELLED
   */
  async cancel(id: number, dto: CancelSalesOrderDto, user: AuthUser): Promise<SalesOrderView> {
    const reason = dto.reason?.trim() || null;
    return this.prisma.tx(async (tx) => {
      // 잠금 순서: 수주 → 출하요청 → 수주 품목 → 재고 풀 (출고 확정·배정 확정과 같은 순서라 교착이 없다).
      await lockRow(tx, 'sales_order', id);
      const order = await this.repo.findById(tx, id);
      if (!order) throw notFound('수주');
      if (order.isCancelled) throw invalidState('이미 취소된 수주입니다');
      const targets = order.items.filter((i) => i.salesOrderItemStatus !== SALES_ORDER_ITEM_STATUS.SHIPPED && i.salesOrderItemStatus !== SALES_ORDER_ITEM_STATUS.CANCELLED);
      if (!targets.length) throw invalidState('전량 출하된 수주는 취소할 수 없습니다');
      const targetIds = targets.map((i) => i.id).sort((a, b) => a - b);

      // 출하요청 품목에는 취소 상태가 없고 출고 확정은 요청 단위라, 취소 품목이 든 미출고 출하요청은 요청 전체를 취소한다.
      const requests = await this.repo.findOpenShipmentRequestIds(tx, targetIds);
      let releasedAllocationCount = 0;
      for (const r of requests) {
        const result = await this.shipmentRequests.cancelWithinTx(tx, r.id, user, {
          reasonCode: EVENT_REASON_CODE.ORDER_CANCELLED, reason: `수주 ${order.salesOrderNo} 취소`, salesOrderId: order.id,
        });
        releasedAllocationCount += result.releasedAllocationCount;
      }

      for (const itemId of targetIds) await lockRow(tx, 'sales_order_item', itemId);
      const coilSpecIds = targets.filter((i) => i.productSpec.item.itemType === ITEM_TYPE.COIL).map((i) => i.productSpecId);
      const slabSpecIds = (await this.repo.findSlabSpecIdsOfCoilSpecs(tx, coilSpecIds)).map((m) => m.slabSpecId);
      await lockProductInventories(tx, [...targets.map((i) => i.productSpecId), ...slabSpecIds]);

      let releasedReservationQty = 0;
      for (const item of targets) {
        releasedReservationQty += await this.stock.releaseItemReservations(tx, item.id, user, EVENT_REASON_CODE.ORDER_CANCELLED);
        // 시작 전 계획은 취소, 생산 중 물량은 완료 후 여재. 열연 배정·귀속 슬래브도 여기서 풀린다.
        await this.planWriter.handleSalesOrderItemCancelled(tx, item.id, user);
      }
      await this.repo.markItemsCancelled(tx, targetIds);
      await this.repo.markCancelled(tx, id, reason);

      const unit = (i: SalesOrderRow['items'][number]) => ITEM_QTY_UNIT[i.productSpec.item.itemType as 'SLAB' | 'COIL'];
      const cancelledText = targets.map((i) => `#${i.lineNo} 잔량 ${i.orderedQty - i.shippedQty}${unit(i)}`).join(', ');
      await this.events.record(tx, {
        actor: user,
        eventType: BUSINESS_EVENT_TYPE.SALES_ORDER_CANCELLED,
        targetType: EVENT_TARGET_TYPE.SALES_ORDER,
        targetId: order.id,
        targetNo: order.salesOrderNo,
        salesOrderId: order.id,
        summary: `수주 ${order.salesOrderNo} 취소 (${cancelledText})`,
        before: { isCancelled: false, items: order.items.map((i) => ({ lineNo: i.lineNo, salesOrderItemStatus: i.salesOrderItemStatus, orderedQty: i.orderedQty, shippedQty: i.shippedQty })) },
        after: {
          isCancelled: true,
          releasedReservationQty,
          releasedAllocationCount,
          cancelledShipmentRequestIds: requests.map((r) => r.id),
          items: order.items.map((i) => ({
            lineNo: i.lineNo,
            salesOrderItemStatus: targetIds.includes(i.id) ? SALES_ORDER_ITEM_STATUS.CANCELLED : i.salesOrderItemStatus,
            orderedQty: i.orderedQty,
            shippedQty: i.shippedQty,
            cancelledQty: targetIds.includes(i.id) ? i.orderedQty - i.shippedQty : 0,
          })),
        },
        reasonCode: EVENT_REASON_CODE.ORDER_CANCELLED,
        reason,
      });

      for (const roleCode of [ROLE_CODE.PRODUCTION, ROLE_CODE.LOGISTICS]) {
        await this.notifications.toRole(tx, roleCode, {
          notificationType: NOTIFICATION_TYPE.SALES,
          title: `수주 ${order.salesOrderNo} 취소`,
          body: `${order.customer.customerName} · ${cancelledText}${reason ? ` · 사유: ${reason}` : ''}`,
          linkPath: `/sales-orders/${order.id}`,
          dedupeKey: `SO_CANCELLED:${order.id}`,
          excludeEmployeeId: user.employeeId,
        });
      }
      this.realtime.changed('sales-orders', 'inventories', 'production-plans', 'shipment-requests', 'allocations');
      return this.loadView(tx, id);
    });
  }

  // ───────────────────────────── 내부 ─────────────────────────────

  private async loadView(tx: Tx, id: number): Promise<SalesOrderView> {
    const order = await this.repo.findById(tx, id);
    if (!order) throw notFound('수주');
    return (await this.toViews(tx, [order]))[0];
  }

  private async toViews(tx: Tx, orders: SalesOrderRow[]): Promise<SalesOrderView[]> {
    const [qualifiedByPlan, deliveryRiskDays] = [await this.qualifiedByPlan(tx, orders), await this.repo.findDeliveryRiskDays(tx)];
    const now = new Date();
    return orders.map((o) => toSalesOrderView(o, qualifiedByPlan, deliveryRiskDays, now));
  }

  private qualifiedByPlan(tx: Tx, orders: SalesOrderRow[]): Promise<Map<number, number>> {
    const plans = orders.flatMap((o) => o.items.flatMap((i) => i.productionPlans.map((p) => ({ id: p.id, productSpecId: p.productSpecId }))));
    return this.repo.countQualifiedLotsByPlan(tx, plans);
  }
}
