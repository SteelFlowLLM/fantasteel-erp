import { Injectable } from '@nestjs/common';
import {
  BUSINESS_EVENT_TYPE, EVENT_TARGET_TYPE, LOT_STATUS, LOT_TYPE, PRODUCTION_PLAN_STATUS, PURCHASE_ORDER_STATUS, PURCHASE_REQUISITION_STATUS,
} from '@fantasteel/shared';
import { Prisma } from '../../generated/prisma/client';
import type { Tx } from '../../prisma/prisma.service';

const OPEN_PLAN_STATUSES = [PRODUCTION_PLAN_STATUS.PLANNED, PRODUCTION_PLAN_STATUS.CONFIRMED, PRODUCTION_PLAN_STATUS.IN_PROGRESS];
const OPEN_PURCHASE_ORDER_STATUSES = [PURCHASE_ORDER_STATUS.CONFIRMED, PURCHASE_ORDER_STATUS.PARTIALLY_RECEIVED];
/** 아직 발주로 넘어가지 않은 구매요청 (반려·발주 완료 제외) */
const OPEN_REQUISITION_STATUSES = [PURCHASE_REQUISITION_STATUS.DRAFT, PURCHASE_REQUISITION_STATUS.WAITING_APPROVAL, PURCHASE_REQUISITION_STATUS.APPROVED];

const PLAN_INCLUDE = {
  steelGrade: { select: { steelGradeCode: true } },
  productSpec: { select: { specCode: true, item: { select: { itemType: true } } } },
  salesOrderItem: { select: { salesOrder: { select: { id: true, salesOrderNo: true, dueDate: true } } } },
} satisfies Prisma.ProductionPlanInclude;

const RUN_INCLUDE = {
  requirements: {
    orderBy: { rawMaterialId: 'asc' },
    include: { rawMaterial: { select: { id: true, materialCode: true, rawMaterialType: true, item: { select: { itemName: true } } } } },
  },
} satisfies Prisma.MrpRunInclude;

export type OpenPlanRow = Prisma.ProductionPlanGetPayload<{ include: typeof PLAN_INCLUDE }>;
export type MrpRunRow = Prisma.MrpRunGetPayload<{ include: typeof RUN_INCLUDE }>;

@Injectable()
export class MrpRepository {
  findOpenPlans(tx: Tx): Promise<OpenPlanRow[]> {
    return tx.productionPlan.findMany({ where: { productionPlanStatus: { in: OPEN_PLAN_STATUSES } }, include: PLAN_INCLUDE, orderBy: { id: 'asc' } });
  }

  /** 계획별로 이미 만든 히트 LOT 수 */
  async countHeatLots(tx: Tx, productionPlanIds: number[]): Promise<Map<number, number>> {
    if (!productionPlanIds.length) return new Map();
    const rows = await tx.lot.groupBy({ by: ['productionPlanId'], where: { lotType: LOT_TYPE.HEAT, productionPlanId: { in: productionPlanIds } }, _count: { _all: true } });
    return new Map(rows.filter((r) => r.productionPlanId !== null).map((r) => [r.productionPlanId as number, r._count._all]));
  }

  async sumHotMetalRemainingTon(tx: Tx): Promise<Prisma.Decimal> {
    const agg = await tx.lot.aggregate({ where: { lotType: LOT_TYPE.HOT_METAL, lotStatus: LOT_STATUS.IN_STOCK }, _sum: { remainingTon: true } });
    return agg._sum.remainingTon ?? new Prisma.Decimal(0);
  }

  /** 원료별 원료 LOT 잔량 합계 */
  async sumRawMaterialRemainingTon(tx: Tx): Promise<Map<number, Prisma.Decimal>> {
    const rows = await tx.lot.groupBy({ by: ['rawMaterialId'], where: { lotType: LOT_TYPE.RAW_MATERIAL, lotStatus: LOT_STATUS.IN_STOCK, rawMaterialId: { not: null } }, _sum: { remainingTon: true } });
    return new Map(rows.map((r) => [r.rawMaterialId as number, r._sum.remainingTon ?? new Prisma.Decimal(0)]));
  }

  /** 확정 발주 중 아직 다 입고되지 않은 품목 (입고예정) */
  findOpenPurchaseOrderItems(tx: Tx, rawMaterialIds?: number[]) {
    return tx.purchaseOrderItem.findMany({
      where: { purchaseOrder: { purchaseOrderStatus: { in: OPEN_PURCHASE_ORDER_STATUSES } }, ...(rawMaterialIds ? { rawMaterialId: { in: rawMaterialIds } } : {}) },
      select: { rawMaterialId: true, orderedTon: true, receivedTon: true, purchaseOrder: { select: { id: true, purchaseOrderNo: true, dueDate: true } } },
      orderBy: { id: 'asc' },
    });
  }

  findOpenRequisitionItems(tx: Tx, rawMaterialIds: number[]) {
    return tx.purchaseRequisitionItem.findMany({
      where: { rawMaterialId: { in: rawMaterialIds }, purchaseRequisition: { purchaseRequisitionStatus: { in: OPEN_REQUISITION_STATUSES } } },
      select: { rawMaterialId: true, requiredTon: true, orderedTon: true, purchaseRequisition: { select: { id: true, purchaseRequisitionNo: true, purchaseRequisitionStatus: true } } },
      orderBy: { id: 'asc' },
    });
  }

  /** MRP 실행 뒤에 확정된 발주 품목 */
  findPurchaseOrderItemsConfirmedAfter(tx: Tx, rawMaterialIds: number[], after: Date) {
    return tx.purchaseOrderItem.findMany({
      where: { rawMaterialId: { in: rawMaterialIds }, purchaseOrder: { confirmedAt: { gt: after } } },
      select: { rawMaterialId: true, orderedTon: true },
    });
  }

  createRun(
    tx: Tx,
    data: {
      mrpRunNo: string; runEmployeeId: number; hotMetalTon: Prisma.Decimal; heatTon: Prisma.Decimal; heatCount: number;
      requirements: { rawMaterialId: number; requiredTon: Prisma.Decimal; remainingTon: Prisma.Decimal; scheduledReceiptTon: Prisma.Decimal; netRequiredTon: Prisma.Decimal; requiredDate: Date | null }[];
    },
  ) {
    const { requirements, ...run } = data;
    return tx.mrpRun.create({ data: { ...run, requirements: { create: requirements } } });
  }

  findRuns(tx: Tx): Promise<MrpRunRow[]> {
    return tx.mrpRun.findMany({ include: RUN_INCLUDE, orderBy: { id: 'desc' }, take: 50 });
  }

  findRun(tx: Tx, id: number): Promise<MrpRunRow | null> {
    return tx.mrpRun.findUnique({ where: { id }, include: RUN_INCLUDE });
  }

  findLatestRun(tx: Tx): Promise<MrpRunRow | null> {
    return tx.mrpRun.findFirst({ include: RUN_INCLUDE, orderBy: { id: 'desc' } });
  }

  /** 실행 시점의 계획별 내역은 작업 로그(MRP_RUN)의 after에 남겨 둔 것을 읽는다 (mrp_run에 담을 컬럼이 없다). */
  async findRunSnapshot(tx: Tx, mrpRunId: number): Promise<unknown> {
    const event = await tx.businessEvent.findFirst({
      where: { eventType: BUSINESS_EVENT_TYPE.MRP_RUN, targetType: EVENT_TARGET_TYPE.MRP_RUN, targetId: mrpRunId },
      select: { afterData: true },
    });
    return event?.afterData ?? null;
  }

  findEmployees(tx: Tx, ids: number[]) {
    return tx.employee.findMany({ where: { id: { in: ids } }, select: { id: true, employeeNo: true, employeeName: true } });
  }
}
