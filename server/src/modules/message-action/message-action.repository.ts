import { Injectable } from '@nestjs/common';
import { DRAFT_STATUS } from '@fantasteel/shared';
import type { Prisma } from '../../generated/prisma/client';
import type { Tx } from '../../prisma/prisma.service';

/** 아직 처리되지 않은 초안 상태 (ERD 부분 unique action_draft_open_message_type_key와 같은 목록) */
export const OPEN_DRAFT_STATUSES = [DRAFT_STATUS.AI_GENERATED, DRAFT_STATUS.WAITING_APPROVAL, DRAFT_STATUS.APPROVED];

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
  findMessage(tx: Tx, messageId: number) {
    return tx.message.findUnique({
      where: { id: messageId },
      select: { id: true, chatRoomId: true, messageType: true, senderId: true, content: true, deletedAt: true, chatRoom: { select: { salesOrderId: true } } },
    });
  }

  isRoomMember(tx: Tx, chatRoomId: number, employeeId: number) {
    return tx.chatRoomMember.count({ where: { chatRoomId, employeeId } }).then((n) => n > 0);
  }

  findOpenDraft(tx: Tx, messageId: number, actionType: string) {
    return tx.actionDraft.findFirst({ where: { messageId, actionType, draftStatus: { in: OPEN_DRAFT_STATUSES } }, select: { id: true } });
  }

  createDraft(tx: Tx, data: { actionType: string; payload: Prisma.InputJsonValue; messageId: number; requesterId: number }) {
    return tx.actionDraft.create({ data, select: draftSelect });
  }

  updateDraft(tx: Tx, id: number, data: Prisma.ActionDraftUpdateInput) {
    return tx.actionDraft.update({ where: { id }, data, select: draftSelect });
  }

  /** 읽은 뒤 아무도 고치지 않았을 때만 바꾼다. 바꿨으면 true */
  async updateDraftIfUnchanged(tx: Tx, id: number, readUpdatedAt: Date, data: Prisma.ActionDraftUpdateManyMutationInput): Promise<boolean> {
    const { count } = await tx.actionDraft.updateMany({ where: { id, updatedAt: readUpdatedAt }, data });
    return count === 1;
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
