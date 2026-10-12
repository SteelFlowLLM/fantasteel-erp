import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import type { Tx } from '../../prisma/prisma.service';

const draftSelect = {
  id: true,
  actionType: true,
  draftStatus: true,
  payload: true,
  messageId: true,
  requesterId: true,
  confirmedAt: true,
  rejectReason: true,
  executionErrorCode: true,
  executionAttemptCount: true,
  createdAt: true,
  updatedAt: true,
  requester: { select: { employeeName: true, department: { select: { departmentName: true } }, jobGrade: { select: { jobGradeName: true } } } },
  message: {
    select: {
      id: true,
      chatRoomId: true,
      content: true,
      createdAt: true,
      sender: { select: { employeeName: true } },
      chatRoom: { select: { chatRoomName: true, chatRoomType: true, salesOrderId: true } },
    },
  },
  purchaseRequisition: { select: { id: true, purchaseRequisitionNo: true, purchaseRequisitionStatus: true } },
} satisfies Prisma.ActionDraftSelect;

export type DraftRow = Prisma.ActionDraftGetPayload<{ select: typeof draftSelect }>;

/** DB 접근만 둔다. 첫 인자는 항상 tx (컨벤션 6장) */
@Injectable()
export class MessageActionRepository {
  isRoomMember(tx: Tx, chatRoomId: number, employeeId: number) {
    return tx.chatRoomMember.count({ where: { chatRoomId, employeeId } }).then((n) => n > 0);
  }

  findDraft(tx: Tx, id: number) {
    return tx.actionDraft.findUnique({ where: { id }, select: draftSelect });
  }

  findDrafts(tx: Tx, where: Prisma.ActionDraftWhereInput) {
    return tx.actionDraft.findMany({ where, orderBy: { id: 'desc' }, select: draftSelect });
  }

  findItems(tx: Tx, ids: number[]) {
    return tx.item.findMany({ where: { id: { in: ids } }, select: { id: true, itemCode: true, itemName: true, itemType: true, defaultSupplier: { select: { supplierName: true } } } });
  }
}
