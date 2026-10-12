import { Injectable } from '@nestjs/common';
import {
  ACTION_TYPE,
  BUSINESS_EVENT_TYPE,
  DRAFT_STATUS,
  ITEM_TYPE,
  MESSAGE_TYPE,
  PERMISSION,
  type ActionDraftCreateResult,
  type ActionDraftView,
  type ActionType,
  type AuthUser,
  type ChatRoomType,
  type DraftStatus,
  type PurchaseRequisitionDraftPayload,
  type PurchaseRequisitionStatus,
} from '@fantasteel/shared';
import { AuthUserService } from '../../common/auth/auth-user.service';
import { hasPermission } from '../../common/auth/auth.guard';
import { BusinessEventRecorder } from '../../common/business-event/business-event.recorder';
import { AppException } from '../../common/errors/app.exception';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import { isValidDate, TON_PATTERN } from '../purchasing/purchasing.service';
import type { ListActionDraftsQuery, UpdateActionDraftDto } from './dto/action-draft.dto';
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
    private readonly authUsers: AuthUserService,
    private readonly businessEventRecorder: BusinessEventRecorder,
  ) {}

  /**
   * 메시지에서 구매요청 초안을 만든다. 만드는 사람은 그 방 멤버여야 한다.
   * 요청자(메시지 작성자)가 확정할 수 없으면(퇴사·구매요청 등록 권한 없음) 초안이 확인 대기에 영영 남으므로 만들지 않는다.
   * 같은 메시지에 미처리 초안이 있으면 새로 만들지 않고 그 초안을 돌려준다.
   */
  async create(user: AuthUser, messageId: number): Promise<ActionDraftCreateResult> {
    return this.prisma.$transaction(async (tx) => {
      const message = await this.repository.findMessage(tx, messageId);
      if (!message) throw new AppException('COM-003', '메시지를 찾을 수 없어요');
      if (!(await this.repository.isRoomMember(tx, message.chatRoomId, user.employeeId))) throw new AppException('COM-002', '채팅방 멤버만 초안을 만들 수 있어요');
      if (message.messageType !== MESSAGE_TYPE.USER || message.senderId === null || message.deletedAt) throw new AppException('COM-004', '사원이 보낸 메시지에서만 초안을 만들 수 있어요');
      await this.assertRequesterCanConfirm(message.senderId);

      const actionType = ACTION_TYPE.PURCHASE_REQUISITION_CREATE;
      const open = await this.repository.findOpenDraft(tx, message.id, actionType);
      if (open) return { id: open.id, created: false };

      const payload: PurchaseRequisitionDraftPayload = { itemId: null, requestedTon: null, desiredReceiptDate: null, requestReason: null, sourceText: message.content };
      const draft = await this.repository.createDraft(tx, { actionType, payload: payload as unknown as Prisma.InputJsonValue, messageId: message.id, requesterId: message.senderId });
      await this.businessEventRecorder.record(tx, {
        type: BUSINESS_EVENT_TYPE.DRAFT_CREATED,
        actor: user,
        target: { table: 'action_draft', id: draft.id },
        salesOrderId: message.chatRoom.salesOrderId,
        after: { draftStatus: draft.draftStatus, actionType, requesterId: draft.requesterId, payload: payload as unknown as Prisma.InputJsonValue },
        reason: 'AI 자동 추출 준비 중 — 요청자가 직접 입력',
        actionDraftId: draft.id,
        messageId: message.id,
      });
      // AI 추출이 없으므로 생성(AI_GENERATED) 직후 요청자 확인 대기로 넘긴다 (업무 프로세스 10장 흐름)
      await this.repository.updateDraft(tx, draft.id, { draftStatus: DRAFT_STATUS.WAITING_APPROVAL });
      return { id: draft.id, created: true };
    });
  }

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

  /** 요청자가 값을 고친다 (확정 전만). 보내지 않은 칸은 그대로, null이면 비운다. 형식이 틀리면 COM-004 */
  async update(user: AuthUser, id: number, dto: UpdateActionDraftDto): Promise<ActionDraftView> {
    const row = await this.prisma.$transaction(async (tx) => {
      const draft = await this.requesterDraft(tx, user, id, dto.expectedUpdatedAt);
      const next = { ...payloadOf(draft.payload) };
      if (dto.itemId !== undefined) {
        if (dto.itemId !== null) {
          const [item] = await this.repository.findItems(tx, [dto.itemId]);
          if (!item || item.itemType !== ITEM_TYPE.RAW_MATERIAL) throw new AppException('COM-004', '원료 품목을 골라 주세요');
        }
        next.itemId = dto.itemId;
      }
      if (dto.requestedTon !== undefined) {
        const text = dto.requestedTon?.trim() ?? '';
        if (text && !isPositiveTon(text)) throw new AppException('COM-004', '수량(톤)은 0보다 큰 숫자로, 소수 3자리까지 입력해 주세요');
        next.requestedTon = text || null;
      }
      if (dto.desiredReceiptDate !== undefined) {
        const text = dto.desiredReceiptDate?.trim() ?? '';
        if (text && !isValidDate(text)) throw new AppException('COM-004', '희망 입고일은 YYYY-MM-DD 형식의 날짜로 입력해 주세요');
        next.desiredReceiptDate = text || null;
      }
      if (dto.requestReason !== undefined) next.requestReason = dto.requestReason?.trim() || null;
      return this.repository.updateDraft(tx, draft.id, { payload: next as unknown as Prisma.InputJsonValue, draftStatus: DRAFT_STATUS.WAITING_APPROVAL });
    });
    const [view] = await this.toViews(this.prisma, [row]);
    return view;
  }

  /** 요청자만, 확정 전(AI_GENERATED·WAITING_APPROVAL) 초안만 바꿀 수 있다 */
  private async requesterDraft(tx: Tx, user: AuthUser, id: number, expectedUpdatedAt: string | null | undefined): Promise<DraftRow> {
    const draft = await this.repository.findDraft(tx, id);
    if (!draft) throw new AppException('COM-003', '초안을 찾을 수 없어요');
    if (expectedUpdatedAt && draft.updatedAt.toISOString() !== expectedUpdatedAt) throw new AppException('COM-001');
    if (draft.requesterId !== user.employeeId) throw new AppException('COM-002', '요청자만 확인·확정할 수 있어요');
    if (draft.draftStatus !== DRAFT_STATUS.AI_GENERATED && draft.draftStatus !== DRAFT_STATUS.WAITING_APPROVAL) throw new AppException('COM-004', '이 상태의 초안은 바꿀 수 없어요');
    return draft;
  }

  /** 요청자가 사용 중이고 구매요청 등록 사용 권한이 있어야 확정(= 구매요청 생성)할 수 있다 */
  private async assertRequesterCanConfirm(requesterId: number): Promise<void> {
    const requester = await this.authUsers.load(requesterId);
    if (!requester) throw new AppException('COM-002', '요청자(메시지 작성자)가 사용 중인 사원이 아니라 초안을 만들 수 없어요');
    if (!hasPermission(requester, { permission: PERMISSION.PURCHASE_REQUISITION_CREATE, level: 'USE' })) {
      throw new AppException('COM-002', '요청자(메시지 작성자)에게 구매요청 등록 권한이 없어 초안을 만들 수 없어요');
    }
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
