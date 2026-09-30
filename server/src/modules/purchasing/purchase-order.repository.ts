import { Injectable } from '@nestjs/common';
import { PURCHASE_REQUISITION_STATUS } from '@fantasteel/shared';
import { Prisma } from '../../generated/prisma/client';
import type { Tx } from '../../prisma/prisma.service';
import { RAW_MATERIAL_BRIEF } from './purchasing.util';

const SUPPLIER_BRIEF = { select: { id: true, supplierCode: true, supplierName: true } } as const;

const LIST_INCLUDE = {
  supplier: SUPPLIER_BRIEF,
  items: { orderBy: { lineNo: 'asc' }, include: { rawMaterial: RAW_MATERIAL_BRIEF } },
} satisfies Prisma.PurchaseOrderInclude;

const DETAIL_INCLUDE = {
  supplier: SUPPLIER_BRIEF,
  items: {
    orderBy: { lineNo: 'asc' },
    include: {
      rawMaterial: RAW_MATERIAL_BRIEF,
      purchaseRequisitionItem: { select: { id: true, lineNo: true, purchaseRequisition: { select: { id: true, purchaseRequisitionNo: true } } } },
      goodsReceipts: {
        orderBy: { id: 'asc' },
        include: { yard: { select: { id: true, yardCode: true, yardName: true } }, lot: { select: { id: true, lotNo: true, remainingTon: true } } },
      },
    },
  },
} satisfies Prisma.PurchaseOrderInclude;

const REQUISITION_ITEM_INCLUDE = {
  rawMaterial: { select: { id: true, materialCode: true, rawMaterialType: true, item: { select: { itemName: true, defaultSupplierId: true, defaultSupplier: SUPPLIER_BRIEF } } } },
  purchaseRequisition: { select: { id: true, purchaseRequisitionNo: true, purchaseRequisitionStatus: true, desiredReceiptDate: true, requesterId: true } },
} satisfies Prisma.PurchaseRequisitionItemInclude;

export type PurchaseOrderListRow = Prisma.PurchaseOrderGetPayload<{ include: typeof LIST_INCLUDE }>;
export type PurchaseOrderDetailRow = Prisma.PurchaseOrderGetPayload<{ include: typeof DETAIL_INCLUDE }>;
export type OrderableRequisitionItemRow = Prisma.PurchaseRequisitionItemGetPayload<{ include: typeof REQUISITION_ITEM_INCLUDE }>;

@Injectable()
export class PurchaseOrderRepository {
  findMany(tx: Tx, where: Prisma.PurchaseOrderWhereInput): Promise<PurchaseOrderListRow[]> {
    return tx.purchaseOrder.findMany({ where, include: LIST_INCLUDE, orderBy: { id: 'desc' } });
  }

  findDetail(tx: Tx, id: number): Promise<PurchaseOrderDetailRow | null> {
    return tx.purchaseOrder.findUnique({ where: { id }, include: DETAIL_INCLUDE });
  }

  findSupplier(tx: Tx, id: number) {
    return tx.supplier.findUnique({ where: { id } });
  }

  findRequisitionItems(tx: Tx, ids: number[]): Promise<OrderableRequisitionItemRow[]> {
    return tx.purchaseRequisitionItem.findMany({ where: { id: { in: ids } }, include: REQUISITION_ITEM_INCLUDE });
  }

  /** 승인됐고 아직 다 발주하지 않은 구매요청 품목 (발주 화면 후보). */
  async findOrderableItems(tx: Tx): Promise<OrderableRequisitionItemRow[]> {
    const rows = await tx.purchaseRequisitionItem.findMany({
      where: { purchaseRequisition: { purchaseRequisitionStatus: PURCHASE_REQUISITION_STATUS.APPROVED } },
      include: REQUISITION_ITEM_INCLUDE,
      orderBy: [{ purchaseRequisitionId: 'asc' }, { lineNo: 'asc' }],
    });
    return rows.filter((r) => r.orderedTon.lt(r.requiredTon));
  }

  create(
    tx: Tx,
    data: {
      purchaseOrderNo: string; supplierId: number; purchaseOrderStatus: string; dueDate: Date; orderedEmployeeId: number; confirmedAt: Date;
      items: { rawMaterialId: number; purchaseRequisitionItemId: number; orderedTon: Prisma.Decimal }[];
    },
  ) {
    return tx.purchaseOrder.create({
      data: {
        purchaseOrderNo: data.purchaseOrderNo,
        supplierId: data.supplierId,
        purchaseOrderStatus: data.purchaseOrderStatus,
        dueDate: data.dueDate,
        orderedEmployeeId: data.orderedEmployeeId,
        confirmedAt: data.confirmedAt,
        items: { create: data.items.map((it, i) => ({ lineNo: i + 1, ...it })) },
      },
    });
  }

  addOrderedTon(tx: Tx, purchaseRequisitionItemId: number, ton: Prisma.Decimal) {
    return tx.purchaseRequisitionItem.update({ where: { id: purchaseRequisitionItemId }, data: { orderedTon: { increment: ton } } });
  }

  findRequisitionItemTons(tx: Tx, purchaseRequisitionId: number) {
    return tx.purchaseRequisitionItem.findMany({ where: { purchaseRequisitionId }, select: { requiredTon: true, orderedTon: true } });
  }

  setRequisitionStatus(tx: Tx, id: number, purchaseRequisitionStatus: string) {
    return tx.purchaseRequisition.update({ where: { id }, data: { purchaseRequisitionStatus } });
  }
}
