import { Injectable } from '@nestjs/common';
import { GOODS_RECEIPT_STATUS } from '@fantasteel/shared';
import { Prisma } from '../../generated/prisma/client';
import type { Tx } from '../../prisma/prisma.service';
import { RAW_MATERIAL_BRIEF } from './purchasing.util';

const INCLUDE = {
  yard: { select: { id: true, yardCode: true, yardName: true } },
  lot: { select: { id: true, lotNo: true, initialTon: true, remainingTon: true } },
  purchaseOrderItem: {
    include: {
      rawMaterial: RAW_MATERIAL_BRIEF,
      purchaseOrder: { select: { id: true, purchaseOrderNo: true, purchaseOrderStatus: true, supplier: { select: { id: true, supplierCode: true, supplierName: true } } } },
    },
  },
} satisfies Prisma.GoodsReceiptInclude;

export type GoodsReceiptRow = Prisma.GoodsReceiptGetPayload<{ include: typeof INCLUDE }>;

@Injectable()
export class GoodsReceiptRepository {
  findMany(tx: Tx, where: Prisma.GoodsReceiptWhereInput): Promise<GoodsReceiptRow[]> {
    return tx.goodsReceipt.findMany({ where, include: INCLUDE, orderBy: { id: 'desc' } });
  }

  findById(tx: Tx, id: number): Promise<GoodsReceiptRow | null> {
    return tx.goodsReceipt.findUnique({ where: { id }, include: INCLUDE });
  }

  findPurchaseOrderItem(tx: Tx, id: number) {
    return tx.purchaseOrderItem.findUnique({
      where: { id },
      include: { rawMaterial: { select: { id: true, materialCode: true, yardId: true, item: { select: { itemName: true } } } }, purchaseOrder: true },
    });
  }

  findYard(tx: Tx, id: number) {
    return tx.yard.findUnique({ where: { id } });
  }

  create(tx: Tx, data: Prisma.GoodsReceiptUncheckedCreateInput) {
    return tx.goodsReceipt.create({ data });
  }

  confirm(tx: Tx, id: number, confirmedEmployeeId: number, confirmedAt: Date) {
    return tx.goodsReceipt.update({ where: { id }, data: { goodsReceiptStatus: GOODS_RECEIPT_STATUS.CONFIRMED, confirmedEmployeeId, confirmedAt } });
  }

  createRawMaterialLot(tx: Tx, data: Prisma.LotUncheckedCreateInput) {
    return tx.lot.create({ data });
  }

  addReceivedTon(tx: Tx, purchaseOrderItemId: number, ton: Prisma.Decimal) {
    return tx.purchaseOrderItem.update({ where: { id: purchaseOrderItemId }, data: { receivedTon: { increment: ton } } });
  }

  findPurchaseOrderItemTons(tx: Tx, purchaseOrderId: number) {
    return tx.purchaseOrderItem.findMany({ where: { purchaseOrderId }, select: { orderedTon: true, receivedTon: true } });
  }

  setPurchaseOrderStatus(tx: Tx, id: number, purchaseOrderStatus: string) {
    return tx.purchaseOrder.update({ where: { id }, data: { purchaseOrderStatus } });
  }
}
