import { Injectable } from '@nestjs/common';
import { BUSINESS_EVENT_TYPE, DRAFT_STATUS, ITEM_TYPE } from '@fantasteel/shared';
import type { Prisma } from '../../generated/prisma/client';
import { lockActionDraft } from '../../generated/prisma/sql';
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
  meetingMinutes: { select: { id: true, meetingMinutesTitle: true } },
  purchaseRequisition: { select: { id: true, purchaseRequisitionNo: true, purchaseRequisitionStatus: true } },
  // 구매요청 밖의 유형은 만든 업무를 DRAFT_EXECUTED after(결과 테이블·id·번호)로 잇는다 (모듈 문서 10장 결과 연결)
  businessEvents: { where: { businessEventType: BUSINESS_EVENT_TYPE.DRAFT_EXECUTED }, orderBy: { id: 'desc' }, take: 1, select: { afterData: true } },
} satisfies Prisma.ActionDraftSelect;

export type DraftRow = Prisma.ActionDraftGetPayload<{ select: typeof draftSelect }>;

/** 수주 품목 한 줄을 사람이 알아볼 정보 (수주번호·줄 번호·고객사·규격) */
const salesOrderItemSelect = {
  id: true,
  salesOrderItemStatus: true,
  orderedQty: true,
  dueDate: true,
  item: { select: { itemCode: true, itemName: true } },
  salesOrder: { select: { id: true, salesOrderNo: true, customerId: true, customer: { select: { customerName: true } }, salesOrderItems: { select: { id: true }, orderBy: { id: 'asc' } } } },
} satisfies Prisma.SalesOrderItemSelect;

export type SalesOrderItemBrief = Prisma.SalesOrderItemGetPayload<{ select: typeof salesOrderItemSelect }>;

/** 출하요청 품목 한 줄을 사람이 알아볼 정보 (출하요청 번호·줄 번호·상태·수주 품목) */
const shipmentRequestItemSelect = {
  id: true,
  requestQty: true,
  shipmentRequest: { select: { id: true, shipmentRequestNo: true, shipmentRequestStatus: true, customer: { select: { customerName: true } }, shipmentRequestItems: { select: { id: true }, orderBy: { id: 'asc' } } } },
  salesOrderItem: { select: salesOrderItemSelect },
} satisfies Prisma.ShipmentRequestItemSelect;

export type ShipmentRequestItemBrief = Prisma.ShipmentRequestItemGetPayload<{ select: typeof shipmentRequestItemSelect }>;

/** DB 접근만 둔다. 첫 인자는 항상 tx (컨벤션 6장) */
@Injectable()
export class MessageActionRepository {
  findMessage(tx: Tx, messageId: number) {
    return tx.message.findUnique({
      where: { id: messageId },
      select: { id: true, chatRoomId: true, messageType: true, senderId: true, content: true, createdAt: true, deletedAt: true, chatRoom: { select: { salesOrderId: true } } },
    });
  }

  isRoomMember(tx: Tx, chatRoomId: number, employeeId: number) {
    return tx.chatRoomMember.count({ where: { chatRoomId, employeeId } }).then((n) => n > 0);
  }

  findOpenDraft(tx: Tx, messageId: number, actionType: string) {
    return tx.actionDraft.findFirst({ where: { messageId, actionType, draftStatus: { in: OPEN_DRAFT_STATUSES } }, select: { id: true, requesterId: true, requester: { select: { employeeName: true } } } });
  }

  /** 같은 메시지·유형에서 이미 ERP에 반영된 초안 (있으면 새 초안을 만들지 않는다, #496) */
  findExecutedDraft(tx: Tx, messageId: number, actionType: string) {
    return tx.actionDraft.findFirst({ where: { messageId, actionType, draftStatus: DRAFT_STATUS.EXECUTED }, orderBy: { id: 'desc' }, select: draftSelect });
  }

  createDraft(tx: Tx, data: { actionType: string; payload: Prisma.InputJsonValue; messageId?: number; meetingMinutesId?: number; requesterId: number }) {
    return tx.actionDraft.create({ data, select: draftSelect });
  }

  updateDraft(tx: Tx, id: number, data: Prisma.ActionDraftUpdateInput) {
    return tx.actionDraft.update({ where: { id }, data, select: draftSelect });
  }

  /** 초안 행을 트랜잭션 끝까지 잠근다. 잠근 뒤 읽어야 동시 요청이 같은 상태를 보고 둘 다 바꾸지 않는다 (#531) */
  async lockDraft(tx: Tx, id: number): Promise<void> {
    await tx.$queryRawTyped(lockActionDraft(id));
  }

  /** 읽은 뒤 아무도 고치지 않았을 때만 바꾼다. 바꿨으면 true */
  async updateDraftIfUnchanged(tx: Tx, id: number, readUpdatedAt: Date, data: Prisma.ActionDraftUpdateManyMutationInput): Promise<boolean> {
    const { count } = await tx.actionDraft.updateMany({ where: { id, updatedAt: readUpdatedAt }, data });
    return count === 1;
  }

  findDraft(tx: Tx, id: number) {
    return tx.actionDraft.findUnique({ where: { id }, select: draftSelect });
  }

  /** 메시지·회의록에서 만든 초안만 (원본이 없는 Agent 대응 후보는 factory-agent가 다룬다) */
  findDrafts(tx: Tx, where: Prisma.ActionDraftWhereInput) {
    return tx.actionDraft.findMany({
      where: { ...where, OR: [{ messageId: { not: null } }, { meetingMinutesId: { not: null } }] },
      orderBy: { id: 'desc' },
      select: draftSelect,
    });
  }

  /** AI 추출 후보로 보낼 원료 (코드 순) */
  findRawMaterials(tx: Tx) {
    return tx.item.findMany({ where: { itemType: ITEM_TYPE.RAW_MATERIAL }, select: { id: true, itemCode: true, itemName: true }, orderBy: { itemCode: 'asc' } });
  }

  /** 고객사 (AI 추출 후보·이름 맞추기, 코드 순) */
  findCustomers(tx: Tx) {
    return tx.customer.findMany({ select: { id: true, customerCode: true, customerName: true }, orderBy: { customerCode: 'asc' } });
  }

  /** 수주할 수 있는 제품 규격: 이론중량이 있는 슬래브·코일 (수주 등록과 같은 조건, 코드 순) */
  findProductItems(tx: Tx) {
    return tx.item.findMany({
      where: { itemType: { in: [ITEM_TYPE.SLAB, ITEM_TYPE.COIL] }, theoreticalWeightTon: { not: null } },
      select: { id: true, itemCode: true, itemName: true, itemType: true },
      orderBy: { itemCode: 'asc' },
    });
  }

  /** 수주 품목 (최근 것 먼저). take가 없으면 모두 */
  findSalesOrderItems(tx: Tx, where: Prisma.SalesOrderItemWhereInput, take?: number) {
    return tx.salesOrderItem.findMany({ where, orderBy: { id: 'desc' }, take, select: salesOrderItemSelect });
  }

  /** 출하요청 품목 (최근 것 먼저). take가 없으면 모두 */
  findShipmentRequestItems(tx: Tx, where: Prisma.ShipmentRequestItemWhereInput, take?: number) {
    return tx.shipmentRequestItem.findMany({ where, orderBy: { id: 'desc' }, take, select: shipmentRequestItemSelect });
  }

  /** 메시지에서 만든 미처리 초안의 payload (한 유형). 배정 확정 추천이 다른 초안의 LOT을 뺄 때 쓴다 */
  findOpenDraftPayloads(tx: Tx, actionType: string) {
    return tx.actionDraft.findMany({ where: { actionType, messageId: { not: null }, draftStatus: { in: OPEN_DRAFT_STATUSES } }, select: { id: true, payload: true } });
  }

  findLots(tx: Tx, ids: number[]) {
    return tx.lot.findMany({ where: { id: { in: ids } }, select: { id: true, lotNo: true }, orderBy: { id: 'asc' } });
  }

  findItems(tx: Tx, ids: number[]) {
    return tx.item.findMany({ where: { id: { in: ids } }, select: { id: true, itemCode: true, itemName: true, itemType: true, defaultSupplier: { select: { supplierName: true } } } });
  }
}
