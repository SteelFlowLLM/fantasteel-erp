import { forwardRef, Inject, Injectable } from '@nestjs/common';
import {
  BUSINESS_EVENT_TYPE,
  ITEM_TYPE,
  RESERVATION_STATUS,
  SALES_ORDER_ITEM_STATUS,
  SHIPMENT_REQUEST_STATUS,
  calcWeightTon,
  sumTon,
  type AuthUser,
  type CancelSalesOrderResult,
  type CreateSalesOrderResult,
  type ItemType,
  type PageResult,
  type ProductionPlanStatus,
  type SalesOrderCancelBlock,
  type SalesOrderCancellation,
  type SalesOrderDetail,
  type SalesOrderFulfillment,
  type SalesOrderItemFulfillment,
  type SalesOrderItemStatus,
  type SalesOrderReservationView,
  type SalesOrderSummary,
  type ShipmentRequestStatus,
} from '@fantasteel/shared';
import { BusinessEventRecorder } from '../../common/business-event/business-event.recorder';
import { AppException } from '../../common/errors/app.exception';
import { NumberingService } from '../../common/numbering/numbering.service';
import { Prisma } from '../../generated/prisma/client';
import { seoulToday } from '../../common/time/seoul-date';
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { ProductionService } from '../production/production.service';
import type { CancelSalesOrderDto, CreateSalesOrderDto, ListSalesOrdersQuery } from './dto/sales-order.dto';
import { calcItemFulfillment, planRemainingTargetQty, progressOf, salesOrderStatusOf } from './fulfillment.calculator';
import { IdempotencyStore } from './idempotency.store';
import { SalesOrderRepository } from './sales-order.repository';

type SalesOrderRow = NonNullable<Awaited<ReturnType<SalesOrderRepository['findSalesOrder']>>>;
type SalesOrderItemRow = SalesOrderRow['salesOrderItems'][number];

/** 생산 설정값이 없을 때 쓰는 납기 위험 기준일 (REQ-MST-009 초기값) */
const DEFAULT_DELIVERY_RISK_DAYS = 3;
const DEFAULT_PAGE_SIZE = 20;
const OPEN_SHIPMENT_STATUSES: readonly string[] = [SHIPMENT_REQUEST_STATUS.REQUESTED, SHIPMENT_REQUEST_STATUS.ALLOCATED];

const dateOnly = (d: Date) => d.toISOString().slice(0, 10);
const isValidDate = (s: string) => !Number.isNaN(Date.parse(`${s}T00:00:00.000Z`)) && dateOnly(new Date(`${s}T00:00:00.000Z`)) === s;

/** 읽기 계산에 필요한 값: 계획별 합격 제품 매수, 납기 위험 기준일, 오늘(서울) */
interface ReadContext {
  passedQtyByPlan: Map<number, number>;
  deliveryRiskDays: number;
  today: string;
}

/** 채번은 "최댓값 + 1"이라 동시에 저장하면 번호(수주·계획·작업 로그)가 겹쳐 unique 위반이 난다. 트랜잭션 전체를 다시 하면 새 번호를 받는다 */
const NUMBER_CONFLICT_ATTEMPTS = 3;
async function retryOnNumberConflict<T>(work: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await work();
    } catch (e) {
      const conflict = e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
      if (!conflict || attempt >= NUMBER_CONFLICT_ATTEMPTS) throw e;
    }
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/**
 * 수주 등록·충족 현황·취소 (REQ-SO-001~006, BP-SO-01·02, docs/backend/sales-order.md).
 * 등록·취소는 한 트랜잭션에서 inventory(예약)·production(생산계획) 함수를 tx와 함께 부른다.
 */
@Injectable()
export class SalesOrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: SalesOrderRepository,
    private readonly numbering: NumberingService,
    private readonly businessEventRecorder: BusinessEventRecorder,
    // shipment가 출고 확정에서 recalcItemStatus를 부른다 → sales-order → inventory → shipment → sales-order 순환이라 forwardRef
    @Inject(forwardRef(() => InventoryService)) private readonly inventory: InventoryService,
    @Inject(forwardRef(() => ProductionService)) private readonly production: ProductionService,
    private readonly idempotency: IdempotencyStore,
  ) {}

  // ── 조회 ──────────────────────────────────────────────

  async list(query: ListSalesOrdersQuery): Promise<PageResult<SalesOrderSummary>> {
    const page = query.page ?? 1;
    const size = query.size ?? DEFAULT_PAGE_SIZE;
    const [total, rows] = await Promise.all([this.repository.countSalesOrders(this.prisma), this.repository.findSalesOrders(this.prisma, { skip: (page - 1) * size, take: size })]);
    const ctx = await this.readContext(this.prisma, rows);
    return { items: rows.map((row) => this.toSummary(row, ctx)), page, size, total };
  }

  async detail(id: number): Promise<SalesOrderDetail> {
    const row = await this.mustFind(this.prisma, id);
    const ctx = await this.readContext(this.prisma, [row]);
    const itemIds = row.salesOrderItems.map((i) => i.id);
    const [requests, cancelEvent] = await Promise.all([this.repository.findShipmentRequestsOfItems(this.prisma, itemIds), this.repository.findLastCancelEvent(this.prisma, id)]);
    const { items: _lines, ...summary } = this.toSummary(row, ctx);
    return {
      ...summary,
      items: row.salesOrderItems.map((i) => this.toFulfillment(i, ctx)),
      productionPlans: row.salesOrderItems.flatMap((i) =>
        i.productionPlans.map((p) => ({
          id: p.id,
          productionPlanNo: p.productionPlanNo,
          salesOrderItemId: i.id,
          itemId: p.itemId,
          shortageQty: p.shortageQty,
          heatCount: p.heatCount,
          isReproduction: p.isReproduction,
          productionPlanStatus: p.productionPlanStatus as ProductionPlanStatus,
          remainingTargetQty: planRemainingTargetQty({ productionPlanStatus: p.productionPlanStatus as ProductionPlanStatus, shortageQty: p.shortageQty, passedQty: ctx.passedQtyByPlan.get(p.id) ?? 0 }),
        })),
      ),
      shipmentRequests: requests.map((r) => ({
        id: r.id,
        shipmentRequestNo: r.shipmentRequestNo,
        shipmentRequestStatus: r.shipmentRequestStatus as ShipmentRequestStatus,
        shipDate: r.shipDate ? dateOnly(r.shipDate) : null,
        issuedAt: r.issuedAt?.toISOString() ?? null,
        items: r.shipmentRequestItems.map((l) => ({ salesOrderItemId: l.salesOrderItemId, requestQty: l.requestQty })),
      })),
      cancelBlock: this.cancelBlockOf(row, requests),
      cancellation: cancelEvent ? this.cancellationOf(cancelEvent) : null,
    };
  }

  /** 충족 현황: 품목별 예약·생산중·검사합격·출하와 진행률 (분모 포함, 단계를 더하지 않는다) */
  async fulfillment(id: number): Promise<SalesOrderFulfillment> {
    const row = await this.mustFind(this.prisma, id);
    const ctx = await this.readContext(this.prisma, [row]);
    const summary = this.toSummary(row, ctx);
    return { salesOrderId: row.id, salesOrderNo: row.salesOrderNo, salesOrderStatus: summary.salesOrderStatus, progress: summary.progress, items: row.salesOrderItems.map((i) => this.toFulfillment(i, ctx)) };
  }

  async reservations(id: number): Promise<SalesOrderReservationView[]> {
    const row = await this.mustFind(this.prisma, id);
    return this.inventory.listReservations(this.prisma, row.salesOrderItems.map((i) => i.id));
  }

  /** 진행 중 수주의 충족 현황 (대시보드 수주 충족 현황·공정 흐름 현황이 쓴다). 취소 품목은 뺀다 */
  async openSalesOrderFulfillments(tx: Tx): Promise<{ today: string; deliveryRiskDays: number; salesOrders: (SalesOrderSummary & { fulfillments: SalesOrderItemFulfillment[] })[] }> {
    const rows = await this.repository.findOpenSalesOrders(tx);
    const ctx = await this.readContext(tx, rows);
    return {
      today: ctx.today,
      deliveryRiskDays: ctx.deliveryRiskDays,
      salesOrders: rows.map((row) => ({
        ...this.toSummary(row, ctx),
        fulfillments: row.salesOrderItems.filter((i) => i.salesOrderItemStatus !== SALES_ORDER_ITEM_STATUS.CANCELLED).map((i) => this.toFulfillment(i, ctx)),
      })),
    };
  }

  // ── 등록 (BP-SO-01, 13.1·13.2) ─────────────────────────

  /**
   * 수주 등록: 번호 채번 → 수주·품목 저장 → 품목마다 합격 가용 재고 우선 예약 → 부족 매수만 생산계획 → 작업 로그. 모두 한 트랜잭션.
   * 예약은 저장하는 순간 서버가 가용을 다시 읽어 정한다 (화면 미리보기 값은 쓰지 않는다).
   */
  async create(user: AuthUser, dto: CreateSalesOrderDto, idempotencyKey?: string): Promise<CreateSalesOrderResult> {
    for (const line of dto.items) {
      if (typeof line.orderedQty !== 'number' || !Number.isInteger(line.orderedQty) || line.orderedQty < 1) throw new AppException('SO-002');
      if (!isValidDate(line.dueDate)) throw new AppException('COM-004', `납기 ${line.dueDate}는 없는 날짜예요`);
    }
    return this.idempotency.run(`${user.employeeId}:sales-order`, idempotencyKey, () => retryOnNumberConflict(() => this.prisma.$transaction((tx) => this.createInTx(tx, user, dto))));
  }

  private async createInTx(tx: Tx, user: AuthUser, dto: CreateSalesOrderDto): Promise<CreateSalesOrderResult> {
    if (!(await this.repository.findCustomer(tx, dto.customerId))) throw new AppException('COM-003', '고객사를 찾을 수 없어요');
    const items = await this.repository.findItems(tx, [...new Set(dto.items.map((i) => i.itemId))]);
    const itemOf = (itemId: number) => {
      const item = items.find((i) => i.id === itemId);
      if (!item || (item.itemType !== ITEM_TYPE.SLAB && item.itemType !== ITEM_TYPE.COIL) || !item.theoreticalWeightTon) throw new AppException('SO-001');
      return item;
    };
    dto.items.forEach((line) => itemOf(line.itemId));

    const salesOrder = await this.repository.createSalesOrder(tx, {
      salesOrderNo: await this.numbering.nextDocumentNumber(tx, 'SALES_ORDER'),
      customerId: dto.customerId,
      ownerEmployeeId: user.employeeId,
      items: dto.items.map((line) => ({ itemId: line.itemId, orderedQty: line.orderedQty as number, dueDate: new Date(`${line.dueDate}T00:00:00.000Z`) })),
    });
    await this.businessEventRecorder.record(tx, {
      type: BUSINESS_EVENT_TYPE.SALES_ORDER_CREATED,
      actor: user,
      target: { table: 'sales_order', id: salesOrder.id },
      salesOrderId: salesOrder.id,
      after: {
        salesOrderNo: salesOrder.salesOrderNo,
        customerId: salesOrder.customerId,
        ownerEmployeeId: salesOrder.ownerEmployeeId,
        items: salesOrder.salesOrderItems.map((i) => ({ salesOrderItemId: i.id, itemId: i.itemId, orderedQty: i.orderedQty, dueDate: dateOnly(i.dueDate) })),
      },
    });

    // 재고 행 잠금 순서를 고정하려고 규격 id 오름차순으로 예약한다 (교착 방지, 13.2 "고정 순서")
    const results = new Map<number, CreateSalesOrderResult['items'][number]>();
    for (const soItem of [...salesOrder.salesOrderItems].sort((a, b) => a.itemId - b.itemId || a.id - b.id)) {
      const reservedQty = await this.inventory.reserveForSalesOrderItem(tx, { salesOrderId: salesOrder.id, salesOrderItemId: soItem.id, itemId: soItem.itemId, qty: soItem.orderedQty, actor: user });
      const shortageQty = soItem.orderedQty - reservedQty;
      const plan = shortageQty > 0 ? await this.production.createPlanForShortage(tx, { salesOrderId: salesOrder.id, salesOrderItemId: soItem.id, itemId: soItem.itemId, shortageQty, actor: user }) : null;
            results.set(soItem.id, {
        salesOrderItemId: soItem.id,
        itemId: soItem.itemId,
        orderedQty: soItem.orderedQty,
        orderedTon: calcWeightTon(soItem.orderedQty, itemOf(soItem.itemId).theoreticalWeightTon?.toFixed(3) ?? '0'),
        reservedQty,
        shortageQty,
        productionPlanNo: plan?.productionPlanNo ?? null,
      });
    }
    const lines = salesOrder.salesOrderItems.map((i) => results.get(i.id)).filter((l): l is CreateSalesOrderResult['items'][number] => l !== undefined);
    return {
      salesOrderId: salesOrder.id,
      salesOrderNo: salesOrder.salesOrderNo,
      items: lines,
      totalReservedQty: lines.reduce((sum, l) => sum + l.reservedQty, 0),
      totalShortageQty: lines.reduce((sum, l) => sum + l.shortageQty, 0),
    };
  }

  // ── 취소 (BP-SO-02, REQ-SO-006) ────────────────────────

  /**
   * 수주 취소: 출고된 매수가 있으면 SO-003, 진행 중 출하요청이 있으면 SO-004.
   * 통과하면 품목마다 ACTIVE 예약 해제 → 시작 전 계획 취소·진행중 계획 연결 해제(여재) → 품목 CANCELLED. 출고 완료분은 되돌리지 않는다.
   */
  cancel(user: AuthUser, id: number, dto: CancelSalesOrderDto): Promise<CancelSalesOrderResult> {
    return this.prisma.$transaction(async (tx) => {
      const found = await this.mustFind(tx, id);
      // 출하요청 등록과 같은 수주 품목을 잠근다: 검사(SO-004)와 취소 사이에 출하요청이 끼어들지 않게
      await this.repository.lockSalesOrderItems(tx, found.salesOrderItems.map((i) => i.id));
      const row = await this.mustFind(tx, id);
      const requests = await this.repository.findShipmentRequestsOfItems(tx, row.salesOrderItems.map((i) => i.id));
      const block = this.cancelBlockOf(row, requests);
      if (block === 'CANCELLED') throw new AppException('COM-001', '이미 취소된 수주예요');
      if (block) throw new AppException(block);

      const reason = `ORDER_CANCELLED: 수주 ${row.salesOrderNo} 취소`;
      const releasedReservations: SalesOrderCancellation['releasedReservations'] = [];
      const cancelledPlanNos: string[] = [];
      const unlinkedPlanNos: string[] = [];
      const live = row.salesOrderItems.filter((i) => i.salesOrderItemStatus !== SALES_ORDER_ITEM_STATUS.CANCELLED);
      for (const soItem of [...live].sort((a, b) => a.itemId - b.itemId || a.id - b.id)) {
        const releasedQty = await this.inventory.releaseForSalesOrderItem(tx, { salesOrderId: row.id, salesOrderItemId: soItem.id, itemId: soItem.itemId, actor: user, reason });
        releasedReservations.push({ salesOrderItemId: soItem.id, releasedQty });
        const plans = await this.production.detachOrCancelPlansForSalesOrderItem(tx, { salesOrderId: row.id, salesOrderNo: row.salesOrderNo, salesOrderItemId: soItem.id, actor: user });
        cancelledPlanNos.push(...plans.cancelledPlanNos);
        unlinkedPlanNos.push(...plans.unlinkedPlanNos);
        await this.repository.updateItemStatus(tx, soItem.id, SALES_ORDER_ITEM_STATUS.CANCELLED);
      }
      const touched = await this.repository.touchSalesOrder(tx, row.id);
      releasedReservations.sort((a, b) => a.salesOrderItemId - b.salesOrderItemId);
      await this.businessEventRecorder.record(tx, {
        type: BUSINESS_EVENT_TYPE.SALES_ORDER_CANCELLED,
        actor: user,
        target: { table: 'sales_order', id: row.id },
        salesOrderId: row.id,
        before: { items: row.salesOrderItems.map((i) => ({ salesOrderItemId: i.id, salesOrderItemStatus: i.salesOrderItemStatus })) },
        after: { releasedReservations, cancelledPlanNos, unlinkedPlanNos },
        reason: dto.reason,
      });
      return {
        salesOrderId: row.id,
        salesOrderNo: row.salesOrderNo,
        cancellation: { cancelledAt: touched.updatedAt.toISOString(), reason: dto.reason, releasedReservations, cancelledPlanNos, unlinkedPlanNos },
      };
    });
  }

  // ── 출고 확정이 부른다 (REQ-SO-005) ─────────────────────

  /**
   * 출고(CONVERTED 예약) 매수로 품목 상태를 다시 정한다: 수주 매수 이상이면 SHIPPED, 하나라도 있으면 PARTIALLY_SHIPPED.
   * 취소된 품목은 건드리지 않는다. 헤더 상태는 저장하지 않고 품목 상태에서 계산한다.
   */
  async recalcItemStatus(tx: Tx, salesOrderItemId: number): Promise<SalesOrderItemStatus> {
    const item = await this.repository.findItemForStatus(tx, salesOrderItemId);
    if (!item) throw new AppException('COM-003', '수주 품목을 찾을 수 없어요');
    const current = item.salesOrderItemStatus as SalesOrderItemStatus;
    if (current === SALES_ORDER_ITEM_STATUS.CANCELLED) return current;
    const reservations = await this.inventory.listReservations(tx, [salesOrderItemId]);
    const shippedQty = reservations.filter((r) => r.reservationStatus === RESERVATION_STATUS.CONVERTED).reduce((sum, r) => sum + r.reservedQty, 0);
    const next = shippedQty >= item.orderedQty ? SALES_ORDER_ITEM_STATUS.SHIPPED : shippedQty > 0 ? SALES_ORDER_ITEM_STATUS.PARTIALLY_SHIPPED : SALES_ORDER_ITEM_STATUS.OPEN;
    if (next !== current) await this.repository.updateItemStatus(tx, salesOrderItemId, next);
    return next;
  }

  // ── 계산·모양 ─────────────────────────────────────────

  private async mustFind(tx: Tx, id: number): Promise<SalesOrderRow> {
    const row = await this.repository.findSalesOrder(tx, id);
    if (!row) throw new AppException('COM-003', '수주를 찾을 수 없어요');
    return row;
  }

  private async readContext(tx: Tx, rows: readonly SalesOrderRow[]): Promise<ReadContext> {
    const planIds = rows.flatMap((r) => r.salesOrderItems.flatMap((i) => i.productionPlans.map((p) => p.id)));
    const [passed, setting] = await Promise.all([planIds.length ? this.repository.countPassedProductsByPlan(tx, planIds) : Promise.resolve([]), this.repository.findProductionSetting(tx)]);
    return {
      passedQtyByPlan: new Map(passed.flatMap((p) => (p.production_plan_id === null ? [] : [[p.production_plan_id, p.passed_qty ?? 0] as const]))),
      deliveryRiskDays: setting?.deliveryRiskDays ?? DEFAULT_DELIVERY_RISK_DAYS,
      today: seoulToday(),
    };
  }

  private toFulfillment(i: SalesOrderItemRow, ctx: ReadContext): SalesOrderItemFulfillment {
    const theoreticalWeightTon = i.item.theoreticalWeightTon?.toFixed(3) ?? '0.000';
    const status = i.salesOrderItemStatus as SalesOrderItemStatus;
    const numbers = calcItemFulfillment({
      orderedQty: i.orderedQty,
      salesOrderItemStatus: status,
      dueDate: dateOnly(i.dueDate),
      reservations: i.reservations,
      plans: i.productionPlans.map((p) => ({ productionPlanStatus: p.productionPlanStatus as ProductionPlanStatus, shortageQty: p.shortageQty, passedQty: ctx.passedQtyByPlan.get(p.id) ?? 0 })),
      today: ctx.today,
      deliveryRiskDays: ctx.deliveryRiskDays,
    });
    return {
      salesOrderItemId: i.id,
      itemId: i.itemId,
      itemCode: i.item.itemCode,
      itemName: i.item.itemName,
      itemType: i.item.itemType as ItemType,
      theoreticalWeightTon,
      orderedQty: i.orderedQty,
      orderedTon: calcWeightTon(i.orderedQty, theoreticalWeightTon),
      dueDate: dateOnly(i.dueDate),
      salesOrderItemStatus: status,
      ...numbers,
    };
  }

  private toSummary(row: SalesOrderRow, ctx: ReadContext): SalesOrderSummary {
    const items = row.salesOrderItems.map((i) => this.toFulfillment(i, ctx));
    const live = items.filter((i) => i.salesOrderItemStatus !== SALES_ORDER_ITEM_STATUS.CANCELLED);
    const measured = live.length > 0 ? live : items;
    return {
      id: row.id,
      salesOrderNo: row.salesOrderNo,
      customerId: row.customerId,
      customerName: row.customer.customerName,
      ownerEmployeeId: row.ownerEmployeeId,
      ownerEmployeeName: row.ownerEmployee.employeeName,
      salesOrderStatus: salesOrderStatusOf(items.map((i) => i.salesOrderItemStatus)),
      itemCount: items.length,
      totalOrderedQty: items.reduce((sum, i) => sum + i.orderedQty, 0),
      totalOrderedTon: sumTon(items.map((i) => i.orderedTon)),
      totalShippedQty: items.reduce((sum, i) => sum + i.shippedQty, 0),
      earliestDueDate: live.map((i) => i.dueDate).sort()[0] ?? null,
      isDueRisk: items.some((i) => i.isDueRisk),
      progress: progressOf(
        measured.reduce((sum, i) => sum + i.shippedQty, 0),
        measured.reduce((sum, i) => sum + i.orderedQty, 0),
      ),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      items: items.map((i) => ({
        salesOrderItemId: i.salesOrderItemId,
        itemId: i.itemId,
        itemName: i.itemName,
        itemType: i.itemType,
        orderedQty: i.orderedQty,
        dueDate: i.dueDate,
        salesOrderItemStatus: i.salesOrderItemStatus,
      })),
    };
  }

  private cancelBlockOf(row: SalesOrderRow, requests: readonly { shipmentRequestStatus: string }[]): SalesOrderCancelBlock {
    if (row.salesOrderItems.every((i) => i.salesOrderItemStatus === SALES_ORDER_ITEM_STATUS.CANCELLED)) return 'CANCELLED';
    if (row.salesOrderItems.some((i) => i.reservations.some((r) => r.reservationStatus === RESERVATION_STATUS.CONVERTED))) return 'SO-003';
    if (requests.some((r) => OPEN_SHIPMENT_STATUSES.includes(r.shipmentRequestStatus))) return 'SO-004';
    return null;
  }

  private cancellationOf(event: { createdAt: Date; reason: string | null; afterData: unknown }): SalesOrderCancellation {
    const after = isRecord(event.afterData) ? event.afterData : {};
    const released = Array.isArray(after.releasedReservations) ? after.releasedReservations : [];
    return {
      cancelledAt: event.createdAt.toISOString(),
      reason: event.reason,
      releasedReservations: released.flatMap((r) =>
        isRecord(r) && typeof r.salesOrderItemId === 'number' && typeof r.releasedQty === 'number' ? [{ salesOrderItemId: r.salesOrderItemId, releasedQty: r.releasedQty }] : [],
      ),
      cancelledPlanNos: strings(after.cancelledPlanNos),
      unlinkedPlanNos: strings(after.unlinkedPlanNos),
    };
  }
}
