import { Injectable } from '@nestjs/common';
import type { ItemType, ProductionPlanStatus } from '@fantasteel/shared';
import type { Tx } from '../../prisma/prisma.service';

/**
 * DB 접근은 여기서만 한다. 함수의 첫 인자는 tx (컨벤션 8장).
 * 집계·3개 이상 JOIN·잠금(FOR UPDATE)은 prisma/sql/*.sql(TypedSQL)로 만들고 tx.$queryRawTyped(...)로 부른다.
 */
@Injectable()
export class ProductionRepository {
  /** 계획 규격과 히트 계산에 필요한 이론중량 (코일이면 대응 슬래브 이론중량까지) */
  findItemForPlan(tx: Tx, itemId: number) {
    return tx.item.findUnique({
      where: { id: itemId },
      select: {
        id: true,
        itemType: true,
        theoreticalWeightTon: true,
        specMappingAsCoilItem: { select: { slabItem: { select: { theoreticalWeightTon: true } } } },
      },
    });
  }

  findRoutings(tx: Tx, itemType: ItemType) {
    return tx.routing.findMany({ where: { itemType }, orderBy: { sequenceNo: 'asc' } });
  }

  findProductionSetting(tx: Tx) {
    return tx.productionSetting.findFirst({ orderBy: { id: 'asc' } });
  }

  createPlan(tx: Tx, data: { productionPlanNo: string; salesOrderItemId: number; itemId: number; shortageQty: number; heatCount: number; productionPlanStatus: ProductionPlanStatus }) {
    return tx.productionPlan.create({ data });
  }

  findPlansOfSalesOrderItem(tx: Tx, salesOrderItemId: number) {
    return tx.productionPlan.findMany({ where: { salesOrderItemId }, orderBy: { id: 'asc' } });
  }

  updatePlan(tx: Tx, id: number, data: { productionPlanStatus?: ProductionPlanStatus; salesOrderItemId?: null }) {
    return tx.productionPlan.update({ where: { id }, data });
  }
}
