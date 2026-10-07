import { Injectable } from '@nestjs/common';
import {
  ITEM_TYPE,
  PERMISSION,
  PRODUCTION_PLAN_STATUS,
  SALES_ORDER_ITEM_STATUS,
  SHIPMENT_REQUEST_STATUS,
  sumTon,
  type AuthUser,
  type ItemType,
  type OrderFulfillmentWidget,
  type ProcessFlowWidget,
  type ProductStockWidget,
} from '@fantasteel/shared';
import { hasPermission } from '../../common/auth/auth.guard';
import { AppException } from '../../common/errors/app.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { daysBetween } from '../sales-order/fulfillment.calculator';
import { SalesOrderService } from '../sales-order/sales-order.service';
import { DashboardRepository } from './dashboard.repository';

const OPEN_STATUSES: readonly string[] = [SALES_ORDER_ITEM_STATUS.OPEN, SALES_ORDER_ITEM_STATUS.PARTIALLY_SHIPPED];
const DAY_MS = 86_400_000;

/**
 * 대시보드 위젯 (REQ-DSH-001, BP-DSH-01 "권한 내 집계"). 숫자는 각 모듈의 계산을 그대로 쓰고 다시 만들지 않는다.
 * 공정 흐름 현황은 로그인한 모든 사원에게 6단계 건수를 모두 준다. 그 화면을 열 권한은 화면이 따로 본다(바로가기만 막음, 2026-10-07 사용자 결정).
 * Agent 위험 감지·대응 후보 확정은 P2라 여기 없다.
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: DashboardRepository,
    private readonly salesOrders: SalesOrderService,
    private readonly inventory: InventoryService,
  ) {}

  async processFlow(): Promise<ProcessFlowWidget> {
    const tx = this.prisma;
    const [open, stock, planRows, pending, requestRows] = await Promise.all([
      this.salesOrders.openSalesOrderFulfillments(tx),
      this.inventory.productStock(tx),
      this.repository.countPlansByStatus(tx),
      this.repository.countPendingInspectionLots(tx),
      this.repository.countShipmentRequestsByStatus(tx),
    ]);
    const availableOf = (itemType: ItemType) => stock.filter((r) => r.itemType === itemType).reduce((sum, r) => sum + r.availableQty, 0);
    const openOrders = open.salesOrders.filter((so) => OPEN_STATUSES.includes(so.salesOrderStatus));

    const planCount = (status: string) => planRows.find((r) => r.productionPlanStatus === status)?._count._all ?? 0;
    const requestCount = (status: string) => requestRows.find((r) => r.shipmentRequestStatus === status)?._count._all ?? 0;
    // 오늘 출고 확정: 서울 오늘 00:00 ~ 내일 00:00
    const from = new Date(`${open.today}T00:00:00.000+09:00`);
    const issued = await this.repository.countIssuedBetween(tx, from, new Date(from.getTime() + DAY_MS));
    return {
      today: open.today,
      salesOrders: { openCount: openOrders.length, dueRiskCount: openOrders.filter((so) => so.isDueRisk).length },
      productionPlans: { plannedCount: planCount(PRODUCTION_PLAN_STATUS.PLANNED), inProgressCount: planCount(PRODUCTION_PLAN_STATUS.IN_PROGRESS) },
      inspections: { pendingCount: pending.heat + pending.slab + pending.coil, heatCount: pending.heat, slabCount: pending.slab, coilCount: pending.coil },
      inventories: { slabAvailableQty: availableOf(ITEM_TYPE.SLAB), coilAvailableQty: availableOf(ITEM_TYPE.COIL) },
      shipmentRequests: { requestedCount: requestCount(SHIPMENT_REQUEST_STATUS.REQUESTED), allocatedCount: requestCount(SHIPMENT_REQUEST_STATUS.ALLOCATED) },
      goodsIssues: { issuedRequestCount: issued.requests, issuedLotCount: issued.lots },
    };
  }

  /** 수주 충족 현황: 진행 중 수주를 가장 이른 납기 순으로. 납기 위험 = 납기까지 기준일 이하 + 미출하 있음 (기준일은 생산 설정값) */
  async orderFulfillment(user: AuthUser): Promise<OrderFulfillmentWidget> {
    if (!hasPermission(user, { permission: PERMISSION.SALES_ORDER_CREATE, level: 'VIEW' })) throw new AppException('COM-002');
    const open = await this.salesOrders.openSalesOrderFulfillments(this.prisma);
    const salesOrders = open.salesOrders
      .filter((so) => OPEN_STATUSES.includes(so.salesOrderStatus))
      .sort((a, b) => (a.earliestDueDate ?? '9999-12-31').localeCompare(b.earliestDueDate ?? '9999-12-31') || a.id - b.id)
      .map((so) => ({
        salesOrderId: so.id,
        salesOrderNo: so.salesOrderNo,
        customerName: so.customerName,
        earliestDueDate: so.earliestDueDate,
        isDueRisk: so.isDueRisk,
        progress: so.progress,
        items: so.fulfillments.map((i) => ({ ...i, daysToDue: daysBetween(open.today, i.dueDate) })),
      }));
    return { today: open.today, deliveryRiskDays: open.deliveryRiskDays, salesOrders };
  }

  /** 제품 재고: 슬래브·코일 합계와 재고가 있는 규격 (재고 화면은 모든 사원이 연다) */
  async productStock(): Promise<ProductStockWidget> {
    const rows = await this.inventory.productStock(this.prisma);
    const totals = [ITEM_TYPE.SLAB, ITEM_TYPE.COIL].map((itemType) => {
      const ofType = rows.filter((r) => r.itemType === itemType);
      const sum = (pick: (r: (typeof rows)[number]) => number) => ofType.reduce((acc, r) => acc + pick(r), 0);
      return {
        itemType,
        onHandQty: sum((r) => r.onHandQty),
        reservedQty: sum((r) => r.reservedQty),
        rollingAllocatedQty: sum((r) => r.rollingAllocatedQty),
        availableQty: sum((r) => r.availableQty),
        onHandTon: sumTon(ofType.map((r) => r.onHandTon)),
        availableTon: sumTon(ofType.map((r) => r.availableTon)),
      };
    });
    return { totals, items: rows.filter((r) => r.onHandQty > 0) };
  }
}
