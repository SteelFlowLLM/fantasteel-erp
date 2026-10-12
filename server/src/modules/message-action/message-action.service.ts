import { Injectable } from '@nestjs/common';
import {
  ITEM_TYPE,
  type ActionDraftView,
  type ActionType,
  type AuthUser,
  type ChatRoomType,
  type DraftStatus,
  type PurchaseRequisitionDraftPayload,
  type PurchaseRequisitionStatus,
} from '@fantasteel/shared';
import { AppException } from '../../common/errors/app.exception';
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import { isValidDate, TON_PATTERN } from '../purchasing/purchasing.service';
import type { ListActionDraftsQuery } from './dto/action-draft.dto';
import { MessageActionRepository, type DraftRow } from './message-action.repository';

const isPositiveTon = (s: string) => TON_PATTERN.test(s) && Number(s) > 0;

type ItemBrief = Awaited<ReturnType<MessageActionRepository['findItems']>>[number];

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const textOrNull = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v : null);

/** 저장된 payload(jsonb)를 구매요청 초안 값으로 읽는다 */
export function payloadOf(raw: unknown): PurchaseRequisitionDraftPayload {
  const p = isRecord(raw) ? raw : {};
  return {
    itemId: typeof p.itemId === 'number' ? p.itemId : null,
    requestedTon: textOrNull(p.requestedTon),
    desiredReceiptDate: textOrNull(p.desiredReceiptDate),
    requestReason: textOrNull(p.requestReason),
    sourceText: textOrNull(p.sourceText),
  };
}

/** 확정 전에 비어 있거나 기준정보와 맞지 않는 필수 칸 (추출 스키마 REQ-ACT-001: 원료 품목·수량(톤)·희망 입고일) */
export function unresolvedFieldsOf(payload: PurchaseRequisitionDraftPayload, item: ItemBrief | undefined): string[] {
  const missing: string[] = [];
  if (!item || item.itemType !== ITEM_TYPE.RAW_MATERIAL) missing.push('원료 품목');
  if (!payload.requestedTon || !isPositiveTon(payload.requestedTon)) missing.push('수량(톤)');
  if (!payload.desiredReceiptDate || !isValidDate(payload.desiredReceiptDate)) missing.push('희망 입고일');
  return missing;
}

/**
 * Message → ERP 구매요청 초안 (REQ-ACT-001~004, BP-ACT-01, docs/backend/message-action.md).
 * 요청자(확정 주체) = 메시지 작성자. AI 추출은 아직 없어(SPEC 5장) 요청자가 값을 직접 채운다.
 */
@Injectable()
export class MessageActionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: MessageActionRepository,
  ) {}

  /** chatRoomId가 있으면 그 방 메시지의 초안(방 멤버만), 없으면 내가 요청자인 초안. 최근 것 먼저 */
  async list(user: AuthUser, query: ListActionDraftsQuery): Promise<ActionDraftView[]> {
    const chatRoomId = query.chatRoomId;
    if (chatRoomId !== undefined && !(await this.repository.isRoomMember(this.prisma, chatRoomId, user.employeeId))) throw new AppException('COM-002', '채팅방 멤버만 볼 수 있어요');
    const rows = await this.repository.findDrafts(this.prisma, chatRoomId !== undefined ? { message: { chatRoomId } } : { requesterId: user.employeeId });
    return this.toViews(this.prisma, rows);
  }

  /** 요청자 본인 또는 원본 메시지 방의 멤버만 본다 (다른 방 대화가 보이지 않게) */
  async get(user: AuthUser, id: number): Promise<ActionDraftView> {
    const row = await this.repository.findDraft(this.prisma, id);
    if (!row) throw new AppException('COM-003', '초안을 찾을 수 없어요');
    const isRequester = row.requesterId === user.employeeId;
    if (!isRequester && !(row.message && (await this.repository.isRoomMember(this.prisma, row.message.chatRoomId, user.employeeId)))) {
      throw new AppException('COM-002', '요청자나 원본 메시지 채팅방 멤버만 볼 수 있어요');
    }
    const [view] = await this.toViews(this.prisma, [row]);
    return view;
  }

  private async toViews(tx: Tx, rows: DraftRow[]): Promise<ActionDraftView[]> {
    const payloads = rows.map((r) => payloadOf(r.payload));
    const itemIds = [...new Set(payloads.map((p) => p.itemId).filter((itemId): itemId is number => itemId !== null))];
    const items = new Map((itemIds.length > 0 ? await this.repository.findItems(tx, itemIds) : []).map((i) => [i.id, i]));
    return rows.map((r, index) => {
      const payload = payloads[index];
      const item = payload.itemId === null ? undefined : items.get(payload.itemId);
      const message = r.message;
      return {
        id: r.id,
        actionType: r.actionType as ActionType,
        draftStatus: r.draftStatus as DraftStatus,
        payload,
        itemCode: item?.itemCode ?? null,
        itemName: item?.itemName ?? null,
        itemDefaultSupplierName: item?.defaultSupplier?.supplierName ?? null,
        requesterId: r.requesterId,
        requesterName: r.requester?.employeeName ?? null,
        requesterDepartmentName: r.requester?.department.departmentName ?? null,
        requesterJobGradeName: r.requester?.jobGrade.jobGradeName ?? null,
        message: message
          ? {
              id: message.id,
              chatRoomId: message.chatRoomId,
              chatRoomName: message.chatRoom.chatRoomName,
              chatRoomType: message.chatRoom.chatRoomType as ChatRoomType,
              senderName: message.sender?.employeeName ?? null,
              content: message.content,
              createdAt: message.createdAt.toISOString(),
            }
          : null,
        unresolvedFields: unresolvedFieldsOf(payload, item),
        purchaseRequisition: r.purchaseRequisition
          ? { ...r.purchaseRequisition, purchaseRequisitionStatus: r.purchaseRequisition.purchaseRequisitionStatus as PurchaseRequisitionStatus }
          : null,
        executionErrorCode: r.executionErrorCode,
        executionAttemptCount: r.executionAttemptCount,
        rejectReason: r.rejectReason,
        confirmedAt: r.confirmedAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      };
    });
  }
}
