import { forwardRef, Inject, Injectable } from '@nestjs/common';
import {
  BUSINESS_EVENT_TYPE,
  ITEM_TYPE,
  MAX_ORDERED_QTY,
  ORDERED_QTY_OVER_MESSAGE,
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
  type PurchaseOrderStatus,
  type PurchaseRequisitionStatus,
  type SalesOrderCancelBlock,
  type SalesOrderCancelPurchaseImpactLine,
  type SalesOrderCancellation,
  type SalesOrderDetail,
  type SalesOrderFulfillment,
  type SalesOrderItemFulfillment,
  type SalesOrderItemStatus,
  type SalesOrderReservationView,
  type SalesOrderSummary,
  type ShipmentRequestStatus,
} from '@fantasteel/shared';
import { BusinessEventRecorder, type BusinessEventInput } from '../../common/business-event/business-event.recorder';
import { AppException } from '../../common/errors/app.exception';
import { NumberingService } from '../../common/numbering/numbering.service';
import { Prisma } from '../../generated/prisma/client';
import { seoulToday } from '../../common/time/seoul-date';
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { ProductionService, salesOrderCancelEffectOf } from '../production/production.service';
import type { CancelSalesOrderDto, CreateSalesOrderDto, ListSalesOrdersQuery } from './dto/sales-order.dto';
import { calcItemFulfillment, planRemainingTargetQty, progressOf, salesOrderStatusOf } from './fulfillment.calculator';
import { IdempotencyStore } from './idempotency.store';
import { SalesOrderRepository } from './sales-order.repository';

type SalesOrderRow = NonNullable<Awaited<ReturnType<SalesOrderRepository['findSalesOrder']>>>;
type SalesOrderItemRow = SalesOrderRow['salesOrderItems'][number];

/**
 * 수주를 취소하면 처리할 품목: 진행중·부분출하. 이미 취소된 품목과 전량 출고된 품목은 그대로 둔다 (BP-SO-02 예외, 2026-10-14 잔량 취소).
 * 수주 취소와 취소 창의 구매 진행 영향이 같이 쓴다.
 */
const cancellableItemsOf = (row: SalesOrderRow): SalesOrderItemRow[] =>
  row.salesOrderItems.filter((i) => i.salesOrderItemStatus === SALES_ORDER_ITEM_STATUS.OPEN || i.salesOrderItemStatus === SALES_ORDER_ITEM_STATUS.PARTIALLY_SHIPPED);

/** 생산 설정값이 없을 때 쓰는 납기 위험 기준일 (REQ-MST-009 초기값) */
const DEFAULT_DELIVERY_RISK_DAYS = 3;
const DEFAULT_PAGE_SIZE = 20;
const OPEN_SHIPMENT_STATUSES: readonly string[] = [SHIPMENT_REQUEST_STATUS.REQUESTED, SHIPMENT_REQUEST_STATUS.ALLOCATED];

const dateOnly = (d: Date) => d.toISOString().slice(0, 10);
const isValidDate = (s: string) => !Number.isNaN(Date.parse(`${s}T00:00:00.000Z`)) && dateOnly(new Date(`${s}T00:00:00.000Z`)) === s;

/** 수주 품목 줄 검증: 매수는 1 이상 상한 이하 정수(SO-002), 납기는 실제 있는 날짜 */
function assertSalesOrderLines(items: CreateSalesOrderDto['items']): void {
  for (const line of items) {
    if (typeof line.orderedQty !== 'number' || !Number.isInteger(line.orderedQty) || line.orderedQty < 1) throw new AppException('SO-002');
    if (line.orderedQty > MAX_ORDERED_QTY) throw new AppException('SO-002', ORDERED_QTY_OVER_MESSAGE);
    if (!isValidDate(line.dueDate)) throw new AppException('COM-004', `납기 ${line.dueDate}는 없는 날짜예요`);
  }
}

/** 읽기 계산에 필요한 값: 계획별 합격 제품 매수, 납기 위험 기준일, 오늘(서울) */
interface ReadContext {
  passedQtyByPlan: Map<number, number>;
  /** 규격별 예약 가용 (on_hand − reserved − rolling). 재생산 필요 매수 계산에 쓴다 */
  availableQtyByItem: Map<number, number>;
  deliveryRiskDays: number;
  today: string;
}

/** 동시에 같은 행을 만들어 unique 위반(P2002)이 나면 트랜잭션 전체를 다시 한다. 번호(수주·계획·작업 로그)는 NumberingService가 앞부분을 잠가 겹치지 않는다 */
const NUMBER_CONFLICT_ATTEMPTS = 3;
/**
 * 등록·취소는 품목마다 예약·계획·작업 로그(번호 채번 포함) 쿼리가 수십 번 돈다. Prisma 기본 제한(5초)은
 * 원격 DB(Supabase 풀러)에서 품목이 많으면 넘을 수 있어 늘려 둔다.
 */
const LONG_TX = { maxWait: 5_000, timeout: 30_000 };
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
    // 수주번호 일부로 찾는다 (상단 통합 검색)
    const where: Prisma.SalesOrderWhereInput = query.salesOrderNo ? { salesOrderNo: { contains: query.salesOrderNo.trim(), mode: 'insensitive' } } : {};
    const [total, rows] = await Promise.all([this.repository.countSalesOrders(this.prisma, where), this.repository.findSalesOrders(this.prisma, { skip: (page - 1) * size, take: size }, where)]);
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
        items: r.shipmentRequestItems.map((l) => ({ salesOrderItemId: l.salesOrderItemId, requestQty: l.requestQty, allocatedQty: l._count.allocations })),
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

  /**
   * 수주 취소 창의 구매 진행 영향 (BP-PRD-01 "수주 취소·계획 변경 시 구매 진행 영향도 표시한다"): 지금 취소하면 취소·연결 해제될
   * 생산계획에 연결된 구매요청과 발주. 수주 취소는 구매요청·발주를 바꾸지 않아 보여 주기만 한다. 구매요청 번호 순.
   */
  async cancelPurchaseImpact(id: number): Promise<SalesOrderCancelPurchaseImpactLine[]> {
    const row = await this.mustFind(this.prisma, id);
    const requisitions = await this.repository.findRequisitionsOfPlans(this.prisma, cancellableItemsOf(row).map((i) => i.id));
    return requisitions.flatMap((pr) => {
      const plan = pr.productionPlan;
      const planEffect = plan ? salesOrderCancelEffectOf(plan.productionPlanStatus) : null;
      if (!plan || !planEffect) return [];
      const purchaseOrder = pr.purchaseOrderItem?.purchaseOrder ?? null;
      return [
        {
          purchaseRequisitionId: pr.id,
          purchaseRequisitionNo: pr.purchaseRequisitionNo,
          purchaseRequisitionStatus: pr.purchaseRequisitionStatus as PurchaseRequisitionStatus,
          itemName: pr.item.itemName,
          requestedTon: pr.requestedTon.toFixed(3),
          productionPlanId: plan.id,
          productionPlanNo: plan.productionPlanNo,
          planEffect,
          purchaseOrderId: purchaseOrder?.id ?? null,
          purchaseOrderNo: purchaseOrder?.purchaseOrderNo ?? null,
          purchaseOrderStatus: (purchaseOrder?.purchaseOrderStatus ?? null) as PurchaseOrderStatus | null,
        },
      ];
    });
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
    assertSalesOrderLines(dto.items);
    return this.idempotency.run(`${user.employeeId}:sales-order`, idempotencyKey, () => retryOnNumberConflict(() => this.prisma.$transaction((tx) => this.createInTx(tx, user, dto), LONG_TX)));
  }

  /**
   * 수주 등록 본문. Message → ERP 수주 등록 초안이 자기 실행 트랜잭션 안에서 부른다.
   * 초안 실행도 화면 등록과 같은 매수·납기 검증을 지나도록 여기서 한 번 더 본다. origin이 있으면 수주 등록 작업 로그에 원본 초안·메시지를 남긴다
   */
  async createInTx(tx: Tx, user: AuthUser, dto: CreateSalesOrderDto, origin: Pick<BusinessEventInput, 'actionDraftId' | 'messageId' | 'isAiAssisted'> = {}): Promise<CreateSalesOrderResult> {
    assertSalesOrderLines(dto.items);
    if (!(await this.repository.findCustomer(tx, dto.customerId))) throw new AppException('COM-003', '고객사를 찾을 수 없어요');
    const items = await this.repository.findItems(tx, [...new Set(dto.items.map((i) => i.itemId))]);
    const itemOf = (itemId: number) => {
      const item = items.find((i) => i.id === itemId);
      if (!item || (item.itemType !== ITEM_TYPE.SLAB && item.itemType !== ITEM_TYPE.COIL) || !item.theoreticalWeightTon) throw new AppException('SO-001');
      return item;
    };
    dto.items.forEach((line) => itemOf(line.itemId));
    // 재고 행을 첫 채번·작업 로그보다 먼저 잠근다 (출고·수주 취소와 같은 잠금 순서, 교착 방지 #478)
    await this.inventory.lockInventoriesFirst(tx, dto.items.map((line) => line.itemId));

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
      ...origin,
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
   * 수주 취소: 전량 출고된 수주는 SO-003, 진행 중 출하요청이 있으면 SO-004.
   * 통과하면 진행중·부분출하 품목마다 ACTIVE 예약 해제 → 시작 전 계획 취소·진행중 계획 연결 해제(여재) → 품목 CANCELLED.
   * 출고 완료분은 되돌리지 않는다: 부분출하 품목은 출고 매수를 남긴 채 잔량만 취소하고, 전량 출고된 품목은 그대로 둔다 (BP-SO-02 예외).
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
      const live = cancellableItemsOf(row);
      // 잠금 순서: 수주 품목 → 생산계획 → 재고 행 → 작업 로그 (열연 완료·출고와 같은 순서, #478).
      // 계획을 잠가 진행 중인 열연 완료가 끝난 뒤의 상태를 보고, 재고 행은 첫 작업 로그 전에 모두 잠근다
      const planIds = await this.production.lockPlansOfSalesOrderItems(tx, live.map((i) => i.id));
      await this.inventory.lockInventoriesFirst(tx, [...live.map((i) => i.itemId), ...(await this.inventory.hotRollingItemIdsOfPlans(tx, planIds))]);
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
    }, LONG_TX);
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
    const itemIds = [...new Set(rows.flatMap((r) => r.salesOrderItems.map((i) => i.itemId)))];
    const [passed, setting, inventories] = await Promise.all([
      planIds.length ? this.repository.countPassedProductsByPlan(tx, planIds) : Promise.resolve([]),
      this.repository.findProductionSetting(tx),
      this.repository.findInventories(tx, itemIds),
    ]);
    return {
      passedQtyByPlan: new Map(passed.flatMap((p) => (p.production_plan_id === null ? [] : [[p.production_plan_id, p.passed_qty ?? 0] as const]))),
      availableQtyByItem: new Map(inventories.map((v) => [v.itemId, Math.max(0, v.onHandQty - v.reservedQty - v.rollingAllocatedQty)])),
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
      openPlanRemainingQty: numbers.inProductionQty + numbers.plannedQty,
      reservationAvailableQty: ctx.availableQtyByItem.get(i.itemId) ?? 0,
      reproductionNeedQty: Math.max(0, numbers.additionalPlanQty - (ctx.availableQtyByItem.get(i.itemId) ?? 0)),
    };
  }

  private toSummary(row: SalesOrderRow, ctx: ReadContext): SalesOrderSummary {
    const items = row.salesOrderItems.map((i) => this.toFulfillment(i, ctx));
    const live = items.filter((i) => i.salesOrderItemStatus !== SALES_ORDER_ITEM_STATUS.CANCELLED);
    const salesOrderStatus = salesOrderStatusOf(items.map((i) => i.salesOrderItemStatus));
    // 진행률은 진행 중이면 취소 품목을 빼고 센다. 취소로 끝난 수주는 모든 품목으로 세서(부분 출고 뒤 잔량 취소면 출고 ÷ 전체 주문)
    // 헤더가 취소인데 남은 출하완료 품목만으로 100%가 되지 않게 한다
    const measured = salesOrderStatus === SALES_ORDER_ITEM_STATUS.CANCELLED || live.length === 0 ? items : live;
    return {
      id: row.id,
      salesOrderNo: row.salesOrderNo,
      customerId: row.customerId,
      customerName: row.customer.customerName,
      ownerEmployeeId: row.ownerEmployeeId,
      ownerEmployeeName: row.ownerEmployee.employeeName,
      salesOrderStatus,
      itemCount: items.length,
      totalOrderedQty: items.reduce((sum, i) => sum + i.orderedQty, 0),
      totalOrderedTon: sumTon(items.map((i) => i.orderedTon)),
      totalShippedQty: items.reduce((sum, i) => sum + i.shippedQty, 0),
      totalActiveReservedQty: items.reduce((sum, i) => sum + i.activeReservedQty, 0),
      hasReproductionNeed: items.some((i) => i.reproductionNeedQty > 0),
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

  /** 취소할 품목이 없을 때: 하나라도 취소됐으면 이미 취소한 수주(부분 출고 뒤 잔량 취소 포함), 모두 출고됐으면 SO-003 */
  private cancelBlockOf(row: SalesOrderRow, requests: readonly { shipmentRequestStatus: string }[]): SalesOrderCancelBlock {
    if (cancellableItemsOf(row).length === 0) {
      return row.salesOrderItems.some((i) => i.salesOrderItemStatus === SALES_ORDER_ITEM_STATUS.CANCELLED) ? 'CANCELLED' : 'SO-003';
    }
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
