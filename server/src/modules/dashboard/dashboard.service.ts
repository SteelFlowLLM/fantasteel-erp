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
  type Permission,
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
 * 공정 흐름 현황은 단계마다 그 화면의 조회 권한을 보고, 없으면 그 단계만 null로 준다.
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

  async processFlow(user: AuthUser): Promise<ProcessFlowWidget> {
    const can = (permission: Permission) => hasPermission(user, { permission, level: 'VIEW' });
    const tx = this.prisma;
    const [open, stock] = await Promise.all([this.salesOrders.openSalesOrderFulfillments(tx), this.inventory.productStock(tx)]);
    const availableOf = (itemType: ItemType) => stock.filter((r) => r.itemType === itemType).reduce((sum, r) => sum + r.availableQty, 0);
    const openOrders = open.salesOrders.filter((so) => OPEN_STATUSES.includes(so.salesOrderStatus));

    let productionPlans: ProcessFlowWidget['productionPlans'] = null;
    if (can(PERMISSION.PRODUCTION_PLAN_CONFIRM)) {
      const rows = await this.repository.countPlansByStatus(tx);
      const countOf = (status: string) => rows.find((r) => r.productionPlanStatus === status)?._count._all ?? 0;
      productionPlans = { plannedCount: countOf(PRODUCTION_PLAN_STATUS.PLANNED), inProgressCount: countOf(PRODUCTION_PLAN_STATUS.IN_PROGRESS) };
    }
    let inspections: ProcessFlowWidget['inspections'] = null;
    if (can(PERMISSION.INSPECTION_REGISTER)) {
      const pending = await this.repository.countPendingInspectionLots(tx);
      inspections = { pendingCount: pending.heat + pending.slab + pending.coil, heatCount: pending.heat, slabCount: pending.slab, coilCount: pending.coil };
    }
    let shipmentRequests: ProcessFlowWidget['shipmentRequests'] = null;
    if (can(PERMISSION.SHIPMENT_REQUEST_MANAGE)) {
      const rows = await this.repository.countShipmentRequestsByStatus(tx);
      const countOf = (status: string) => rows.find((r) => r.shipmentRequestStatus === status)?._count._all ?? 0;
      shipmentRequests = { requestedCount: countOf(SHIPMENT_REQUEST_STATUS.REQUESTED), allocatedCount: countOf(SHIPMENT_REQUEST_STATUS.ALLOCATED) };
    }
    let goodsIssues: ProcessFlowWidget['goodsIssues'] = null;
    if (can(PERMISSION.GOODS_ISSUE_CONFIRM)) {
      // 서울 오늘 00:00 ~ 내일 00:00
      const from = new Date(`${open.today}T00:00:00.000+09:00`);
      const issued = await this.repository.countIssuedBetween(tx, from, new Date(from.getTime() + DAY_MS));
      goodsIssues = { issuedRequestCount: issued.requests, issuedLotCount: issued.lots };
    }
    return {
      today: open.today,
      salesOrders: can(PERMISSION.SALES_ORDER_CREATE) ? { openCount: openOrders.length, dueRiskCount: openOrders.filter((so) => so.isDueRisk).length } : null,
      productionPlans,
      inspections,
      inventories: { slabAvailableQty: availableOf(ITEM_TYPE.SLAB), coilAvailableQty: availableOf(ITEM_TYPE.COIL) },
      shipmentRequests,
      goodsIssues,
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
