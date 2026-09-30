import { Injectable } from '@nestjs/common';
import { ALLOCATION_STATUS, ITEM_TYPE, LOT_STATUS, LOT_TYPE, PURCHASE_ORDER_STATUS } from '@fantasteel/shared';
import type { Prisma } from '../../generated/prisma/client';
import type { Tx } from '../../prisma/prisma.service';

/** 귀속 여부 판단에 필요한 수주 품목 정보. */
const EARMARK_ITEM = { select: { salesOrderItemStatus: true, productSpec: { select: { item: { select: { itemType: true } } } } } } satisfies Prisma.Lot$salesOrderItemArgs;

@Injectable()
export class InventoryRepository {
  /** 제품 규격과 재고 풀. */
  findProductSpecs(tx: Tx, filter: { itemType?: 'SLAB' | 'COIL'; steelGradeCode?: string; productSpecId?: number }) {
    return tx.productSpec.findMany({
      where: {
        item: { itemType: filter.itemType ?? { in: [ITEM_TYPE.SLAB, ITEM_TYPE.COIL] } },
        ...(filter.steelGradeCode ? { steelGrade: { steelGradeCode: filter.steelGradeCode } } : {}),
        ...(filter.productSpecId ? { id: filter.productSpecId } : {}),
      },
      orderBy: { id: 'asc' },
      include: {
        item: { select: { itemType: true } },
        steelGrade: { select: { id: true, steelGradeCode: true } },
        yard: { select: { yardName: true } },
        inventories: { select: { onHandQty: true, reservedQty: true } },
      },
    });
  }

  /** 미소진 제품 LOT (검사 대기·불합격·귀속을 세기 위해). */
  findInStockProductLots(tx: Tx, productSpecIds: number[]) {
    return tx.lot.findMany({
      where: { productSpecId: { in: productSpecIds }, lotStatus: LOT_STATUS.IN_STOCK, lotType: { in: [LOT_TYPE.SLAB, LOT_TYPE.COIL] } },
      select: { productSpecId: true, lotType: true, isPassed: true, heatLot: { select: { isPassed: true } }, salesOrderItem: EARMARK_ITEM },
    });
  }

  findRawMaterials(tx: Tx) {
    return tx.rawMaterial.findMany({
      orderBy: { id: 'asc' },
      include: { item: { select: { itemCode: true, itemName: true } }, yard: { select: { yardName: true } }, inventories: { select: { onHandTon: true } } },
    });
  }

  /** 입고예정 = 확정 발주(입고 완료 전)의 발주량 − 입고 누계. */
  findOpenPurchaseOrderItems(tx: Tx) {
    return tx.purchaseOrderItem.findMany({
      where: { purchaseOrder: { purchaseOrderStatus: { in: [PURCHASE_ORDER_STATUS.CONFIRMED, PURCHASE_ORDER_STATUS.PARTIALLY_RECEIVED] } } },
      select: { rawMaterialId: true, orderedTon: true, receivedTon: true },
    });
  }

  /** 여재: 적격·미소진·수주에 묶이지 않음·확정 배정 없는 슬래브 (REQ-INV-008). */
  findSurplusSlabs(tx: Tx, filter: { steelGradeCode?: string; productSpecId?: number }) {
    return tx.lot.findMany({
      where: {
        lotType: LOT_TYPE.SLAB,
        lotStatus: LOT_STATUS.IN_STOCK,
        isPassed: true,
        heatLot: { isPassed: true },
        salesOrderItemId: null,
        allocations: { none: { status: ALLOCATION_STATUS.CONFIRMED } },
        ...(filter.productSpecId ? { productSpecId: filter.productSpecId } : {}),
        ...(filter.steelGradeCode ? { steelGrade: { steelGradeCode: filter.steelGradeCode } } : {}),
      },
      orderBy: [{ producedAt: 'asc' }, { lotNo: 'asc' }],
      select: {
        id: true, lotNo: true, producedAt: true, productionPlanId: true,
        heatLot: { select: { lotNo: true } },
        yard: { select: { yardName: true } },
        productSpec: { select: { id: true, specCode: true, theoreticalWeightTon: true, steelGrade: { select: { steelGradeCode: true } }, inventories: { select: { onHandQty: true, reservedQty: true } } } },
      },
    });
  }
}
