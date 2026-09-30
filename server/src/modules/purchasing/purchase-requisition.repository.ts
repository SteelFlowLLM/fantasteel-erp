import { Injectable } from '@nestjs/common';
import { PURCHASE_REQUISITION_STATUS } from '@fantasteel/shared';
import { Prisma } from '../../generated/prisma/client';
import type { Tx } from '../../prisma/prisma.service';
import { EMPLOYEE_BRIEF, RAW_MATERIAL_BRIEF } from './purchasing.util';

const LIST_INCLUDE = {
  requester: EMPLOYEE_BRIEF,
  approver: EMPLOYEE_BRIEF,
  department: { select: { id: true, departmentName: true } },
  items: { orderBy: { lineNo: 'asc' }, include: { rawMaterial: RAW_MATERIAL_BRIEF } },
} satisfies Prisma.PurchaseRequisitionInclude;

const DETAIL_INCLUDE = {
  requester: EMPLOYEE_BRIEF,
  approver: EMPLOYEE_BRIEF,
  department: { select: { id: true, departmentName: true } },
  items: {
    orderBy: { lineNo: 'asc' },
    include: {
      rawMaterial: RAW_MATERIAL_BRIEF,
      purchaseOrderItems: {
        orderBy: { id: 'asc' },
        include: {
          purchaseOrder: {
            select: { id: true, purchaseOrderNo: true, purchaseOrderStatus: true, dueDate: true, supplier: { select: { id: true, supplierCode: true, supplierName: true } } },
          },
        },
      },
    },
  },
  sourceDraft: {
    select: {
      id: true, actionType: true, draftStatus: true, confirmedAt: true, executedAt: true,
      message: {
        select: { id: true, content: true, createdAt: true, sender: EMPLOYEE_BRIEF, chatRoom: { select: { id: true, chatRoomType: true, chatRoomName: true } } },
      },
    },
  },
} satisfies Prisma.PurchaseRequisitionInclude;

export type PurchaseRequisitionListRow = Prisma.PurchaseRequisitionGetPayload<{ include: typeof LIST_INCLUDE }>;
export type PurchaseRequisitionDetailRow = Prisma.PurchaseRequisitionGetPayload<{ include: typeof DETAIL_INCLUDE }>;

export interface RequisitionItemInput {
  rawMaterialId: number;
  requiredTon: Prisma.Decimal;
}

@Injectable()
export class PurchaseRequisitionRepository {
  findMany(tx: Tx, where: Prisma.PurchaseRequisitionWhereInput): Promise<PurchaseRequisitionListRow[]> {
    return tx.purchaseRequisition.findMany({ where, include: LIST_INCLUDE, orderBy: { id: 'desc' } });
  }

  findDetail(tx: Tx, id: number): Promise<PurchaseRequisitionDetailRow | null> {
    return tx.purchaseRequisition.findUnique({ where: { id }, include: DETAIL_INCLUDE });
  }

  findWithItems(tx: Tx, id: number): Promise<PurchaseRequisitionListRow | null> {
    return tx.purchaseRequisition.findUnique({ where: { id }, include: LIST_INCLUDE });
  }

  countWaitingFor(tx: Tx, approverId: number): Promise<number> {
    return tx.purchaseRequisition.count({ where: { approverId, purchaseRequisitionStatus: PURCHASE_REQUISITION_STATUS.WAITING_APPROVAL } });
  }

  findRawMaterials(tx: Tx, ids: number[]) {
    return tx.rawMaterial.findMany({ where: { id: { in: ids } }, select: { id: true, item: { select: { itemName: true, isActive: true } } } });
  }

  create(
    tx: Tx,
    data: {
      purchaseRequisitionNo: string; requesterId: number; departmentId: number; desiredReceiptDate: Date; requestReason: string | null;
      sourceType: string; sourceDraftId: number | null; items: RequisitionItemInput[];
    },
  ) {
    return tx.purchaseRequisition.create({
      data: {
        purchaseRequisitionNo: data.purchaseRequisitionNo,
        requesterId: data.requesterId,
        departmentId: data.departmentId,
        purchaseRequisitionStatus: PURCHASE_REQUISITION_STATUS.DRAFT,
        desiredReceiptDate: data.desiredReceiptDate,
        requestReason: data.requestReason,
        sourceType: data.sourceType,
        sourceDraftId: data.sourceDraftId,
        items: { create: data.items.map((it, i) => ({ lineNo: i + 1, rawMaterialId: it.rawMaterialId, requiredTon: it.requiredTon })) },
      },
    });
  }

  /** 승인 전(작성 중·반려) 구매요청의 품목을 통째로 바꾼다. 발주와 연결되기 전이라 지워도 참조가 없다. */
  async replaceItems(tx: Tx, purchaseRequisitionId: number, items: RequisitionItemInput[]): Promise<void> {
    await tx.purchaseRequisitionItem.deleteMany({ where: { purchaseRequisitionId } });
    await tx.purchaseRequisitionItem.createMany({
      data: items.map((it, i) => ({ purchaseRequisitionId, lineNo: i + 1, rawMaterialId: it.rawMaterialId, requiredTon: it.requiredTon })),
    });
  }

  update(tx: Tx, id: number, data: Prisma.PurchaseRequisitionUncheckedUpdateInput) {
    return tx.purchaseRequisition.update({ where: { id }, data });
  }
}
