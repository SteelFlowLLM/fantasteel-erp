import { Injectable } from '@nestjs/common';
import type { ItemType, ProductionPlanStatus } from '@fantasteel/shared';
import { Prisma } from '../../generated/prisma/client';
import { lockProductionPlan, lockSalesOrderItemForReproduction } from '../../generated/prisma/sql';
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
      salesOrder: {
        select: {
          id: true,
          salesOrderNo: true,
          customer: { select: { customerName: true } },
          ownerEmployee: { select: { employeeName: true } },
          // 수주 안 품목 순번(ERD에 줄 번호가 없어 품목 id 순으로 센다)
          salesOrderItems: { select: { id: true }, orderBy: { id: 'asc' } },
        },
      },
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
  remainingTon: true,
  dispositionStatus: true,
  yard: { select: { yardName: true } },
  allocations: { where: { allocationStatus: 'CONFIRMED' }, select: { allocationPurpose: true } },
  item: { select: { itemCode: true } },
  productionResult: { select: { processType: true, productionPlanId: true, converterCode: true, completedAt: true } },
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
        itemName: true,
        specMappingAsCoilItem: { select: { slabItem: { select: { id: true, itemCode: true, itemName: true, theoreticalWeightTon: true } } } },
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

  async lockSalesOrderItem(tx: Tx, salesOrderItemId: number) {
    return (await tx.$queryRawTyped(lockSalesOrderItemForReproduction(salesOrderItemId)))[0] ?? null;
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
        productionPlans: { select: { id: true, productionPlanNo: true, productionPlanStatus: true, isReproduction: true, shortageQty: true, itemId: true, item: { select: { itemType: true } } }, orderBy: { id: 'asc' } },
        salesOrder: { select: { salesOrderNo: true, salesOrderItems: { select: { id: true }, orderBy: { id: 'asc' } } } },
      },
    });
  }

  /** LOT과 판정 (계획과 상관없이 id로) */
  findLotsByIds(tx: Tx, lotIds: number[]) {
    if (lotIds.length === 0) return Promise.resolve([]);
    return tx.lot.findMany({ where: { id: { in: lotIds } }, select: planLotSelect, orderBy: { id: 'asc' } });
  }

  /** 계획 번호 */
  async findPlanNos(tx: Tx, planIds: number[]): Promise<Map<number, string>> {
    if (planIds.length === 0) return new Map();
    const rows = await tx.productionPlan.findMany({ where: { id: { in: planIds } }, select: { id: true, productionPlanNo: true } });
    return new Map(rows.map((r) => [r.id, r.productionPlanNo]));
  }

  async findYardNames(tx: Tx): Promise<Map<number, string>> {
    return new Map((await tx.yard.findMany({ select: { id: true, yardName: true } })).map((y) => [y.id, y.yardName]));
  }

  /** 계획 생성·취소 작업 로그 (등록자·취소 시각) */
  findPlanEvents(tx: Tx, productionPlanId: number) {
    return tx.businessEvent.findMany({
      where: { targetType: 'production_plan', targetId: productionPlanId, businessEventType: { in: ['PRODUCTION_PLAN_CREATED', 'REPRODUCTION_PLAN_CREATED', 'PRODUCTION_PLAN_CANCELLED'] } },
      select: { businessEventType: true, createdAt: true, actorEmployee: { select: { employeeName: true } } },
      orderBy: { id: 'asc' },
    });
  }

  /** 계획들의 확정 열연 배정 수 */
  async countConfirmedRollingByPlans(tx: Tx, productionPlanIds: number[]): Promise<Map<number, number>> {
    if (productionPlanIds.length === 0) return new Map();
    const rows = await tx.allocation.groupBy({ by: ['productionPlanId'], where: { productionPlanId: { in: productionPlanIds }, allocationPurpose: 'HOT_ROLLING', allocationStatus: 'CONFIRMED' }, _count: { _all: true } });
    return new Map(rows.flatMap((r) => (r.productionPlanId === null ? [] : [[r.productionPlanId, r._count._all] as const])));
  }

  /** LOT을 만든 생산계획 (열연 후보가 이 계획 생산분인지 표시) */
  async findPlanIdsOfLots(tx: Tx, lotIds: number[]): Promise<Map<number, number | null>> {
    if (lotIds.length === 0) return new Map();
    const rows = await tx.lot.findMany({ where: { id: { in: lotIds } }, select: { id: true, productionResult: { select: { productionPlanId: true } } } });
    return new Map(rows.map((r) => [r.id, r.productionResult?.productionPlanId ?? null]));
  }

  findInventory(tx: Tx, itemId: number) {
    return tx.inventory.findUnique({ where: { itemId }, select: { onHandQty: true, reservedQty: true, rollingAllocatedQty: true } });
  }
}
