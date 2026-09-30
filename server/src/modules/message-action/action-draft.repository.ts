import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import type { Tx } from '../../prisma/prisma.service';

const EMPLOYEE_BRIEF = {
  select: { id: true, employeeNo: true, employeeName: true, jobGrade: true, department: { select: { id: true, departmentName: true } } },
} as const;

const INCLUDE = {
  requester: EMPLOYEE_BRIEF,
  message: {
    select: {
      id: true, content: true, messageType: true, createdAt: true,
      sender: EMPLOYEE_BRIEF,
      chatRoom: { select: { id: true, chatRoomType: true, chatRoomName: true } },
    },
  },
  purchaseRequisition: { select: { id: true, purchaseRequisitionNo: true, purchaseRequisitionStatus: true } },
} satisfies Prisma.ActionDraftInclude;

export type ActionDraftRow = Prisma.ActionDraftGetPayload<{ include: typeof INCLUDE }>;

@Injectable()
export class ActionDraftRepository {
  findMany(tx: Tx, where: Prisma.ActionDraftWhereInput): Promise<ActionDraftRow[]> {
    return tx.actionDraft.findMany({ where, include: INCLUDE, orderBy: { id: 'desc' } });
  }

  findById(tx: Tx, id: number): Promise<ActionDraftRow | null> {
    return tx.actionDraft.findUnique({ where: { id }, include: INCLUDE });
  }

  /** 같은 메시지·유형의 미처리 초안 (중복 생성 방지). */
  findUnprocessed(tx: Tx, messageId: number, actionType: string, processedStatuses: string[]) {
    return tx.actionDraft.findFirst({ where: { messageId, actionType, draftStatus: { notIn: processedStatuses } }, orderBy: { id: 'asc' } });
  }

  findMessage(tx: Tx, id: number) {
    return tx.message.findUnique({
      where: { id },
      select: { id: true, senderId: true, messageType: true, chatRoomId: true, content: true, sender: { select: { employeeName: true } } },
    });
  }

  async isRoomMember(tx: Tx, chatRoomId: number, employeeId: number): Promise<boolean> {
    return (await tx.chatRoomMember.count({ where: { chatRoomId, employeeId } })) > 0;
  }

  create(tx: Tx, data: Prisma.ActionDraftUncheckedCreateInput) {
    return tx.actionDraft.create({ data });
  }

  update(tx: Tx, id: number, data: Prisma.ActionDraftUncheckedUpdateInput) {
    return tx.actionDraft.update({ where: { id }, data });
  }
}
