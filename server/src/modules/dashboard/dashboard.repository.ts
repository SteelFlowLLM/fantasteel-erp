import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import type { Tx } from '../../prisma/prisma.service';
import { escapeLike } from '../lot/like-pattern';

const OPEN_PLAN_STATUSES = ['PLANNED', 'CONFIRMED', 'IN_PROGRESS'];
const OPEN_SHIPMENT_STATUSES = ['REQUESTED', 'ALLOCATED', 'PARTIALLY_ISSUED'];
const OPEN_PO_STATUSES = ['CONFIRMED', 'PARTIALLY_RECEIVED'];

/** 여재 슬래브 = 적격(자기 검사 + 상위 히트 합격 + 재고) · 수주 미귀속 · CONFIRMED 배정 없음 (SERVER-GUIDE 6장). */
export const SURPLUS_SLAB_WHERE = {
  lotType: 'SLAB',
  lotStatus: 'IN_STOCK',
  isPassed: true,
  heatLot: { isPassed: true },
  salesOrderItemId: null,
  allocations: { none: { status: 'CONFIRMED' } },
} satisfies Prisma.LotWhereInput;

const ITEM_INCLUDE = {
  productSpec: true,
  salesOrder: { include: { customer: true } },
} satisfies Prisma.SalesOrderItemInclude;
export type OpenOrderItemRow = Prisma.SalesOrderItemGetPayload<{ include: typeof ITEM_INCLUDE }>;

@Injectable()
export class DashboardRepository {
  // ───────────── 레이아웃 ─────────────

  findLayout(db: Tx, employeeId: number) {
    return db.dashboardWidgetLayout.findUnique({ where: { employeeId } });
  }

  saveLayout(db: Tx, employeeId: number, layout: Prisma.InputJsonValue) {
    return db.dashboardWidgetLayout.upsert({ where: { employeeId }, create: { employeeId, layout }, update: { layout } });
  }

  // ───────────── 공정 흐름 ─────────────

  countOpenPlans(db: Tx) {
    return db.productionPlan.count({ where: { productionPlanStatus: { in: OPEN_PLAN_STATUSES } } });
  }

  countAwaitingInspection(db: Tx, lotType: string) {
    return db.lot.count({ where: { lotType, isPassed: null } });
  }

  countQualified(db: Tx, lotType: string) {
    return db.lot.count({ where: { lotType, lotStatus: 'IN_STOCK', isPassed: true, heatLot: { isPassed: true } } });
  }

  countOpenShipmentRequests(db: Tx) {
    return db.shipmentRequest.count({ where: { shipmentRequestStatus: { in: OPEN_SHIPMENT_STATUSES } } });
  }

  async issuedBetween(db: Tx, from: Date, to: Date) {
    const where = { confirmedAt: { gte: from, lt: to } } satisfies Prisma.GoodsIssueWhereInput;
    const [goodsIssueCount, lotCount] = await Promise.all([db.goodsIssue.count({ where }), db.goodsIssueItem.count({ where: { goodsIssue: where } })]);
    return { goodsIssueCount, lotCount };
  }

  // ───────────── 수주 충족·납기 위험 ─────────────

  /** 취소되지 않은 수주의 품목. 출하 완료 품목은 includeShipped가 아니면 제외. */
  openOrderItems(db: Tx, opts: { includeShipped?: boolean; dueOnOrBefore?: Date } = {}): Promise<OpenOrderItemRow[]> {
    return db.salesOrderItem.findMany({
      where: {
        salesOrderItemStatus: opts.includeShipped ? { not: 'CANCELLED' } : { notIn: ['CANCELLED', 'SHIPPED'] },
        salesOrder: { isCancelled: false, ...(opts.dueOnOrBefore ? { dueDate: { lte: opts.dueOnOrBefore } } : {}) },
      },
      include: ITEM_INCLUDE,
      orderBy: [{ salesOrder: { dueDate: 'asc' } }, { salesOrderId: 'asc' }, { lineNo: 'asc' }],
    });
  }

  async activeReservedByItem(db: Tx, itemIds: number[]): Promise<Map<number, number>> {
    if (!itemIds.length) return new Map();
    const rows = await db.reservation.groupBy({ by: ['salesOrderItemId'], where: { salesOrderItemId: { in: itemIds }, status: 'ACTIVE' }, _sum: { reservedQty: true } });
    return new Map(rows.map((r) => [r.salesOrderItemId, r._sum.reservedQty ?? 0]));
  }

  openPlansOfItems(db: Tx, itemIds: number[]) {
    if (!itemIds.length) return Promise.resolve([]);
    return db.productionPlan.findMany({
      where: { salesOrderItemId: { in: itemIds }, productionPlanStatus: { in: OPEN_PLAN_STATUSES } },
      select: { id: true, salesOrderItemId: true, productSpecId: true, shortageQty: true },
    });
  }

  /** 계획별·규격별 생산 LOT 수 (불합격 제외). */
  async producedByPlan(db: Tx, planIds: number[]): Promise<Map<string, number>> {
    if (!planIds.length) return new Map();
    const rows = await db.lot.groupBy({ by: ['productionPlanId', 'productSpecId'], where: { productionPlanId: { in: planIds }, OR: [{ isPassed: null }, { isPassed: true }] }, _count: { _all: true } });
    return new Map(rows.map((r) => [`${r.productionPlanId}:${r.productSpecId}`, r._count._all]));
  }

  deliveryRiskDays(db: Tx) {
    return db.productionSetting.findUnique({ where: { id: 1 } });
  }

  // ───────────── 최근 작업 로그 ─────────────

  recentEvents(db: Tx, take: number) {
    return db.businessEvent.findMany({ orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }], take, include: { actorEmployee: { select: { employeeName: true } } } });
  }

  // ───────────── 제품 재고 ─────────────

  productInventories(db: Tx) {
    return db.inventory.findMany({
      where: { productSpecId: { not: null }, OR: [{ onHandQty: { gt: 0 } }, { reservedQty: { gt: 0 } }] },
      include: { productSpec: { include: { steelGrade: true, item: true } } },
    });
  }

  // ───────────── 수율 ─────────────

  completedResultsByProcess(db: Tx) {
    return db.productionResult.groupBy({
      by: ['processCode'],
      where: { productionResultStatus: 'COMPLETED' },
      _count: { _all: true },
      _sum: { inputTon: true, outputTon: true, plannedQty: true, outputQty: true, lossQty: true },
    });
  }

  routings(db: Tx) {
    return db.routing.findMany({ orderBy: [{ itemType: 'asc' }, { processSeq: 'asc' }] });
  }

  // ───────────── 원료 잔량 ─────────────

  rawMaterialsWithInventory(db: Tx) {
    return db.rawMaterial.findMany({ include: { item: true, inventories: true }, orderBy: { id: 'asc' } });
  }

  openPurchaseOrderItems(db: Tx) {
    return db.purchaseOrderItem.findMany({
      where: { purchaseOrder: { purchaseOrderStatus: { in: OPEN_PO_STATUSES } } },
      include: { purchaseOrder: { include: { supplier: true } } },
    });
  }

  latestMrpRun(db: Tx) {
    return db.mrpRun.findFirst({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], include: { requirements: true } });
  }

  // ───────────── 불합격률 ─────────────

  steelGrades(db: Tx) {
    return db.steelGrade.findMany({ where: { isActive: true }, orderBy: { steelGradeCode: 'asc' } });
  }

  judgedInspectionsSince(db: Tx, since: Date) {
    return db.qualityInspection.findMany({
      where: { inspectionResult: { in: ['PASS', 'FAIL'] }, inspectedAt: { gte: since } },
      select: { processCode: true, inspectionResult: true, lot: { select: { steelGradeId: true } } },
    });
  }

  // ───────────── 구매 ─────────────

  requisitionCountsByStatus(db: Tx) {
    return db.purchaseRequisition.groupBy({ by: ['purchaseRequisitionStatus'], _count: { _all: true } });
  }

  // ───────────── 출하 실적·생산량·여재 ─────────────

  issuedItemsSince(db: Tx, since: Date) {
    return db.goodsIssueItem.findMany({
      where: { goodsIssue: { confirmedAt: { gte: since } } },
      select: { goodsIssue: { select: { confirmedAt: true } }, lot: { select: { lotType: true, productSpec: { select: { theoreticalWeightTon: true } } } } },
    });
  }

  producedLotsSince(db: Tx, since: Date) {
    return db.lot.findMany({ where: { lotType: { in: ['SLAB', 'COIL'] }, producedAt: { gte: since } }, select: { lotType: true, producedAt: true } });
  }

  surplusSlabs(db: Tx) {
    return db.lot.findMany({ where: SURPLUS_SLAB_WHERE, include: { productSpec: true, steelGrade: true }, orderBy: [{ producedAt: 'asc' }, { id: 'asc' }] });
  }

  // ───────────── 통합 검색 ─────────────

  async searchNo(db: Tx, q: string, take: number) {
    const both = <T>(run: (where: { equals: string; mode: 'insensitive' } | { contains: string; mode: 'insensitive' }) => Promise<T[]>) =>
      Promise.all([run({ equals: escapeLike(q), mode: 'insensitive' }), run({ contains: escapeLike(q), mode: 'insensitive' })]);
    const orderById = { orderBy: { id: 'desc' as const }, take };
    const [so, lot, plan, pr, shp, ms] = await Promise.all([
      both((w) => db.salesOrder.findMany({ where: { salesOrderNo: w }, select: { id: true, salesOrderNo: true }, ...orderById })),
      both((w) => db.lot.findMany({ where: { lotNo: w }, select: { id: true, lotNo: true, lotType: true }, ...orderById })),
      both((w) => db.productionPlan.findMany({ where: { productionPlanNo: w }, select: { id: true, productionPlanNo: true }, ...orderById })),
      both((w) => db.purchaseRequisition.findMany({ where: { purchaseRequisitionNo: w }, select: { id: true, purchaseRequisitionNo: true }, ...orderById })),
      both((w) => db.shipmentRequest.findMany({ where: { shipmentRequestNo: w }, select: { id: true, shipmentRequestNo: true }, ...orderById })),
      both((w) => db.millSheet.findMany({ where: { millSheetNo: w }, select: { id: true, millSheetNo: true }, ...orderById })),
    ]);
    return { so, lot, plan, pr, shp, ms };
  }
}
