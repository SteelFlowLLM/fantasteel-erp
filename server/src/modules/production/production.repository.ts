import { Injectable } from '@nestjs/common';
import type { ItemType, ProductionPlanStatus } from '@fantasteel/shared';
import { Prisma } from '../../generated/prisma/client';
import { lockProductionPlan } from '../../generated/prisma/sql';
import type { Tx } from '../../prisma/prisma.service';

/** 목록·상세가 함께 쓰는 계획 요약 */
export const planSummarySelect = {
  id: true,
  productionPlanNo: true,
  productionPlanStatus: true,
  isReproduction: true,
  itemId: true,
  shortageQty: true,
  heatCount: true,
  salesOrderItemId: true,
  createdAt: true,
  updatedAt: true,
  item: { select: { itemCode: true, itemName: true, itemType: true, steelGrade: { select: { steelGradeCode: true } } } },
  salesOrderItem: {
    select: {
      id: true,
      orderedQty: true,
      dueDate: true,
      salesOrderItemStatus: true,
      salesOrder: { select: { id: true, salesOrderNo: true, customer: { select: { customerName: true } } } },
    },
  },
} satisfies Prisma.ProductionPlanSelect;
export type PlanSummaryRow = Prisma.ProductionPlanGetPayload<{ select: typeof planSummarySelect }>;

const inspectionSelect = { select: { inspectionResult: true } } as const;

/** 계획이 만든 LOT과 판정 (상위 히트: 슬래브 → 히트, 코일 → 슬래브 → 히트) */
export const planLotSelect = {
  id: true,
  lotNo: true,
  lotType: true,
  lotStatus: true,
  itemId: true,
  initialTon: true,
  producedDate: true,
  productionResultId: true,
  item: { select: { itemCode: true } },
  productionResult: { select: { processType: true, productionPlanId: true } },
  qualityInspection: inspectionSelect,
  lotRelationsAsChildLot: {
    select: {
      parentLot: {
        select: {
          id: true,
          lotNo: true,
          lotType: true,
          qualityInspection: inspectionSelect,
          lotRelationsAsChildLot: { select: { parentLot: { select: { id: true, lotNo: true, lotType: true, qualityInspection: inspectionSelect } } } },
        },
      },
    },
  },
  _count: { select: { lotRelationsAsParentLot: true } },
} satisfies Prisma.LotSelect;
export type PlanLotRow = Prisma.LotGetPayload<{ select: typeof planLotSelect }>;

export interface PlanListFilter {
  productionPlanStatus?: ProductionPlanStatus;
  itemType?: ItemType;
  salesOrderId?: number;
  isReproduction?: boolean;
}

/**
 * DB 접근은 여기서만 한다. 함수의 첫 인자는 tx (컨벤션 8장).
 * 집계·3개 이상 JOIN·잠금(FOR UPDATE)은 prisma/sql/*.sql(TypedSQL)로 만들고 tx.$queryRawTyped(...)로 부른다.
 */
@Injectable()
export class ProductionRepository {
  /** 계획 규격과 히트 계산에 필요한 이론중량 (코일이면 대응 슬래브 규격까지) */
  findItemForPlan(tx: Tx, itemId: number) {
    return tx.item.findUnique({
      where: { id: itemId },
      select: {
        id: true,
        itemCode: true,
        itemType: true,
        steelGradeId: true,
        theoreticalWeightTon: true,
        specMappingAsCoilItem: { select: { slabItem: { select: { id: true, itemCode: true, theoreticalWeightTon: true } } } },
      },
    });
  }

  findRoutings(tx: Tx, itemType: ItemType) {
    return tx.routing.findMany({ where: { itemType }, orderBy: { sequenceNo: 'asc' } });
  }

  findProductionSetting(tx: Tx) {
    return tx.productionSetting.findFirst({ orderBy: { id: 'asc' } });
  }

  createPlan(tx: Tx, data: { productionPlanNo: string; salesOrderItemId: number; itemId: number; shortageQty: number; heatCount: number; productionPlanStatus: ProductionPlanStatus; isReproduction?: boolean }) {
    return tx.productionPlan.create({ data });
  }

  findPlansOfSalesOrderItem(tx: Tx, salesOrderItemId: number) {
    return tx.productionPlan.findMany({ where: { salesOrderItemId }, orderBy: { id: 'asc' } });
  }

  updatePlan(tx: Tx, id: number, data: { productionPlanStatus?: ProductionPlanStatus; salesOrderItemId?: null; heatCount?: number }) {
    return tx.productionPlan.update({ where: { id }, data });
  }

  // ── 생산계획 조회 ──────────────────────────────────────

  /** 계획 행 잠금. 없으면 null */
  async lockPlan(tx: Tx, id: number) {
    return (await tx.$queryRawTyped(lockProductionPlan(id)))[0] ?? null;
  }

  private planWhere(filter: PlanListFilter): Prisma.ProductionPlanWhereInput {
    return {
      productionPlanStatus: filter.productionPlanStatus,
      isReproduction: filter.isReproduction,
      item: filter.itemType ? { itemType: filter.itemType } : undefined,
      salesOrderItem: filter.salesOrderId === undefined ? undefined : { salesOrderId: filter.salesOrderId },
    };
  }

  findPlans(tx: Tx, filter: PlanListFilter, page: { skip: number; take: number }) {
    return tx.productionPlan.findMany({ where: this.planWhere(filter), select: planSummarySelect, orderBy: { id: 'desc' }, skip: page.skip, take: page.take });
  }

  countPlans(tx: Tx, filter: PlanListFilter) {
    return tx.productionPlan.count({ where: this.planWhere(filter) });
  }

  findPlan(tx: Tx, id: number) {
    return tx.productionPlan.findUnique({ where: { id }, select: planSummarySelect });
  }

  /** 계획들이 만든 LOT (계획 id → 실적 → LOT) */
  findLotsOfPlans(tx: Tx, productionPlanIds: number[]) {
    return tx.lot.findMany({ where: { productionResult: { productionPlanId: { in: productionPlanIds } } }, select: planLotSelect, orderBy: { id: 'asc' } });
  }

  /** 계획의 작업 실적 (작업 중 여부·공정별 수) */
  findResultsOfPlan(tx: Tx, productionPlanId: number) {
    return tx.productionResult.findMany({ where: { productionPlanId }, select: { id: true, processType: true, startedAt: true, completedAt: true }, orderBy: { id: 'asc' } });
  }

  /** 재생산 판단: 수주 품목의 주문·상태·예약과 연결 계획 */
  findSalesOrderItemForReproduction(tx: Tx, salesOrderItemId: number) {
    return tx.salesOrderItem.findUnique({
      where: { id: salesOrderItemId },
      select: {
        id: true,
        salesOrderId: true,
        itemId: true,
        orderedQty: true,
        salesOrderItemStatus: true,
        reservations: { select: { reservationStatus: true, reservedQty: true } },
        productionPlans: { select: { id: true, productionPlanStatus: true, shortageQty: true, itemId: true }, orderBy: { id: 'asc' } },
      },
    });
  }

  findInventory(tx: Tx, itemId: number) {
    return tx.inventory.findUnique({ where: { itemId }, select: { onHandQty: true, reservedQty: true, rollingAllocatedQty: true } });
  }
}
