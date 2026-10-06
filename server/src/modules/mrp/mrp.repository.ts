import { Injectable } from '@nestjs/common';
import { ITEM_TYPE, PROCESS_TYPE, PRODUCTION_PLAN_STATUS } from '@fantasteel/shared';
import { countHeatLotsByPlan, findOpenPurchaseOrderItemsForMrp, sumRawMaterialRemainingByItem } from '../../generated/prisma/sql';
import type { Tx } from '../../prisma/prisma.service';

/**
 * DB 접근은 여기서만 한다. 함수의 첫 인자는 tx (컨벤션 8장).
 * 집계(잔량 합계·입고예정·만든 히트 수)는 prisma/sql/*.sql(TypedSQL)로 부른다.
 */
@Injectable()
export class MrpRepository {
  /** 아직 끝나지 않은 생산계획 (계획·진행 중). 필요일은 연결 수주 품목 납기로 정한다 */
  findOpenPlans(tx: Tx) {
    return tx.productionPlan.findMany({
      where: { productionPlanStatus: { in: [PRODUCTION_PLAN_STATUS.PLANNED, PRODUCTION_PLAN_STATUS.IN_PROGRESS] } },
      select: {
        id: true,
        productionPlanNo: true,
        productionPlanStatus: true,
        heatCount: true,
        createdAt: true,
        item: { select: { itemCode: true, itemName: true, itemType: true, steelGradeId: true, steelGrade: { select: { steelGradeCode: true } } } },
        salesOrderItem: { select: { dueDate: true, salesOrder: { select: { salesOrderNo: true } } } },
      },
      orderBy: { id: 'asc' },
    });
  }

  countHeatLots(tx: Tx, productionPlanIds: number[]) {
    return tx.$queryRawTyped(countHeatLotsByPlan(productionPlanIds));
  }

  findRawMaterials(tx: Tx) {
    return tx.item.findMany({ where: { itemType: ITEM_TYPE.RAW_MATERIAL }, select: { id: true, itemCode: true, itemName: true, rawMaterialType: true }, orderBy: { id: 'asc' } });
  }

  findSpecificConsumptions(tx: Tx) {
    return tx.specificConsumption.findMany({ select: { rawMaterialItemId: true, steelGradeId: true, consumptionRate: true } });
  }

  /** 제품 유형(SLAB·COIL)별 제강 계획 수율 */
  findSteelmakingRoutings(tx: Tx) {
    return tx.routing.findMany({ where: { processType: PROCESS_TYPE.STEELMAKING }, select: { itemType: true, plannedYieldRate: true } });
  }

  findSetting(tx: Tx) {
    return tx.productionSetting.findFirst({ orderBy: { id: 'asc' }, select: { heatCapacityTon: true } });
  }

  sumRemainingByItem(tx: Tx) {
    return tx.$queryRawTyped(sumRawMaterialRemainingByItem());
  }

  findOpenPurchaseOrderItems(tx: Tx) {
    return tx.$queryRawTyped(findOpenPurchaseOrderItemsForMrp());
  }

  /** 같은 계획·원료의 기존 구매요청 (MRP를 다시 계산해도 중복 요청하지 않게 보여 준다) */
  findRequisitionsForPlans(tx: Tx, productionPlanIds: number[]) {
    return tx.purchaseRequisition.findMany({
      where: { productionPlanId: { in: productionPlanIds } },
      select: { productionPlanId: true, itemId: true, purchaseRequisitionNo: true },
      orderBy: { id: 'desc' },
    });
  }
}
