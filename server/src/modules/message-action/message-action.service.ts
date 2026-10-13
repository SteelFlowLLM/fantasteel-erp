import { Injectable } from '@nestjs/common';
import {
  ACTION_TYPE,
  BUSINESS_EVENT_TYPE,
  DRAFT_STATUS,
  ITEM_TYPE,
  MESSAGE_TYPE,
  PERMISSION,
  type ActionDraftCreateResult,
  type ActionDraftExecutionResult,
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
import { Prisma } from '../../generated/prisma/client';
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import { isValidDate, PurchasingService, TON_PATTERN } from '../purchasing/purchasing.service';
import type { ConfirmActionDraftDto, ListActionDraftsQuery, RejectActionDraftDto, UpdateActionDraftDto } from './dto/action-draft.dto';
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

/** 확정 전(수정·확정·반려할 수 있는) 상태 */
const EDITABLE_STATUSES: readonly string[] = [DRAFT_STATUS.AI_GENERATED, DRAFT_STATUS.WAITING_APPROVAL];

type DraftHandler = (purchasing: PurchasingService, tx: Tx, draft: DraftRow, actor: AuthUser) => Promise<{ id: number; no: string }>;

/** 업무 유형 등록부 (REQ-ACT-004, 업무 프로세스 12.3): 유형별 실행 핸들러. P1은 구매요청 생성 하나이고 나머지 유형은 준비 중이다 */
const ACTION_HANDLERS: Partial<Record<ActionType, DraftHandler>> = {
  [ACTION_TYPE.PURCHASE_REQUISITION_CREATE]: async (purchasing, tx, draft, actor) => {
    const p = payloadOf(draft.payload);
    const input = { itemId: p.itemId ?? 0, requestedTon: p.requestedTon ?? '', desiredReceiptDate: p.desiredReceiptDate ?? '', requestReason: p.requestReason };
    const requisition = await purchasing.createRequisition(tx, input, actor, { actionDraftId: draft.id, messageId: draft.messageId });
    return { id: requisition.id, no: requisition.purchaseRequisitionNo };
  },
};

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
    private readonly purchasing: PurchasingService,
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
          if (!item) throw new AppException('COM-003', '원료 품목을 찾을 수 없어요');
          if (item.itemType !== ITEM_TYPE.RAW_MATERIAL) throw new AppException('COM-004', '원료 품목을 골라 주세요');
        }
        next.itemId = dto.itemId;
      }
      if (dto.requestedTon !== undefined) {
        const text = dto.requestedTon?.trim() ?? '';
        if (text && !isPositiveTon(text)) throw new AppException('COM-004', '수량(톤)은 0보다 큰 숫자로, 소수 3자리까지 입력해 주세요');
        next.requestedTon = text ? new Prisma.Decimal(text).toFixed(3) : null;
      }
      if (dto.desiredReceiptDate !== undefined) {
        const text = dto.desiredReceiptDate?.trim() ?? '';
        if (text && !isValidDate(text)) throw new AppException('COM-004', '희망 입고일은 YYYY-MM-DD 형식의 날짜로 입력해 주세요');
        next.desiredReceiptDate = text || null;
      }
      if (dto.requestReason !== undefined) next.requestReason = dto.requestReason?.trim() || null;
      await this.changeDraft(tx, draft, { payload: next as unknown as Prisma.InputJsonValue, draftStatus: DRAFT_STATUS.WAITING_APPROVAL });
      return this.repository.findDraft(tx, draft.id);
    });
    if (!row) throw new AppException('COM-003', '초안을 찾을 수 없어요');
    const [view] = await this.toViews(this.prisma, [row]);
    return view;
  }

  /** 요청자 확정 (업무 프로세스 13.4): 필수값(ACT-001)을 확인해 APPROVED·DRAFT_CONFIRMED를 남기고 바로 실행한다 */
  async confirm(user: AuthUser, id: number, dto: ConfirmActionDraftDto): Promise<ActionDraftExecutionResult> {
    await this.prisma.$transaction(async (tx) => {
      const draft = await this.requesterDraft(tx, user, id, dto.expectedUpdatedAt);
      const payload = payloadOf(draft.payload);
      const [item] = payload.itemId === null ? [] : await this.repository.findItems(tx, [payload.itemId]);
      const unresolved = unresolvedFieldsOf(payload, item);
      if (unresolved.length > 0) throw new AppException('ACT-001', `채워야 할 칸: ${unresolved.join(', ')}`);
      await this.changeDraft(tx, draft, { draftStatus: DRAFT_STATUS.APPROVED, confirmedAt: new Date() });
      await this.businessEventRecorder.record(tx, {
        type: BUSINESS_EVENT_TYPE.DRAFT_CONFIRMED,
        actor: user,
        target: { table: 'action_draft', id: draft.id },
        salesOrderId: draft.message?.chatRoom.salesOrderId ?? null,
        before: { draftStatus: draft.draftStatus },
        after: { draftStatus: DRAFT_STATUS.APPROVED, payload: payload as unknown as Prisma.InputJsonValue },
        reason: `DRAFT_CONFIRMED: 요청자 확정 (${item?.itemCode} ${payload.requestedTon}t, 희망 입고일 ${payload.desiredReceiptDate})`,
        actionDraftId: draft.id,
        messageId: draft.messageId,
      });
    });
    return this.execute(user, id);
  }

  /**
   * 승인(APPROVED)된 초안을 등록부의 핸들러로 실행한다. 핸들러가 실패하면 실행 트랜잭션은 롤백되므로,
   * 실패 코드·시도 횟수는 별도 트랜잭션으로 남기고 APPROVED 그대로 둔다(같은 API로 다시 실행한다).
   */
  async execute(user: AuthUser, id: number): Promise<ActionDraftExecutionResult> {
    const draft = await this.requesterDraft(this.prisma, user, id, null, [DRAFT_STATUS.APPROVED]);
    const handler = ACTION_HANDLERS[draft.actionType as ActionType];
    if (!handler) throw new AppException('COM-004', '준비 중인 업무 유형이에요');
    let failure: AppException | null = null;
    try {
      await this.prisma.$transaction(async (tx) => {
        const target = await handler(this.purchasing, tx, draft, user);
        await this.changeDraft(tx, draft, { draftStatus: DRAFT_STATUS.EXECUTED, executionErrorCode: null, executionAttemptCount: { increment: 1 } });
        await this.businessEventRecorder.record(tx, {
          type: BUSINESS_EVENT_TYPE.DRAFT_EXECUTED,
          actor: user,
          target: { table: 'action_draft', id: draft.id },
          salesOrderId: draft.message?.chatRoom.salesOrderId ?? null,
          before: { draftStatus: DRAFT_STATUS.APPROVED },
          after: { draftStatus: DRAFT_STATUS.EXECUTED, purchaseRequisitionId: target.id, purchaseRequisitionNo: target.no },
          actionDraftId: draft.id,
          messageId: draft.messageId,
        });
      });
    } catch (e) {
      // 같은 초안을 동시에 실행한 경합(COM-001)은 실행 실패가 아니다
      if (!(e instanceof AppException) || e.code === 'COM-001') throw e;
      failure = e;
      await this.repository.updateDraft(this.prisma, draft.id, { executionErrorCode: e.code, executionAttemptCount: { increment: 1 } });
    }
    return { draft: await this.get(user, id), executed: failure === null, errorCode: failure?.code ?? null, errorMessage: failure?.message ?? null };
  }

  /** 요청자 반려 (확정 전만, 사유 필수) → REJECTED */
  async reject(user: AuthUser, id: number, dto: RejectActionDraftDto): Promise<ActionDraftView> {
    await this.prisma.$transaction(async (tx) => {
      const draft = await this.requesterDraft(tx, user, id, dto.expectedUpdatedAt);
      const rejectReason = dto.rejectReason.trim();
      if (!rejectReason) throw new AppException('COM-004', '반려 사유를 입력해 주세요');
      await this.changeDraft(tx, draft, { draftStatus: DRAFT_STATUS.REJECTED, rejectReason });
      await this.businessEventRecorder.record(tx, {
        type: BUSINESS_EVENT_TYPE.DRAFT_REJECTED,
        actor: user,
        target: { table: 'action_draft', id: draft.id },
        salesOrderId: draft.message?.chatRoom.salesOrderId ?? null,
        before: { draftStatus: draft.draftStatus },
        after: { draftStatus: DRAFT_STATUS.REJECTED },
        reason: rejectReason,
        actionDraftId: draft.id,
        messageId: draft.messageId,
      });
    });
    return this.get(user, id);
  }

  /** 읽은 뒤 아무도 고치지 않았을 때만 바꾼다 (동시 요청이 앞 요청을 덮어쓰지 않게) */
  private async changeDraft(tx: Tx, draft: DraftRow, data: Prisma.ActionDraftUpdateManyMutationInput): Promise<void> {
    if (!(await this.repository.updateDraftIfUnchanged(tx, draft.id, draft.updatedAt, data))) throw new AppException('COM-001', '그 사이 다른 곳에서 초안을 고쳤어요. 새로 불러와 주세요');
  }

  /**
   * 요청자 본인이고 구매요청 등록 사용 권한이 있어야 고치고 확정·반려할 수 있다(실행은 사용자 권한을 거친다, BP-ACT-01).
   * 기본은 확정 전(AI_GENERATED·WAITING_APPROVAL) 초안만
   */
  private async requesterDraft(tx: Tx, user: AuthUser, id: number, expectedUpdatedAt: string | null | undefined, allowed: readonly string[] = EDITABLE_STATUSES): Promise<DraftRow> {
    const draft = await this.repository.findDraft(tx, id);
    if (!draft) throw new AppException('COM-003', '초안을 찾을 수 없어요');
    if (draft.requesterId !== user.employeeId) throw new AppException('COM-002', '요청자만 확인·확정할 수 있어요');
    if (!hasPermission(user, { permission: PERMISSION.PURCHASE_REQUISITION_CREATE, level: 'USE' })) throw new AppException('COM-002', '구매요청 등록 권한이 있어야 초안을 확인·확정할 수 있어요');
    if (expectedUpdatedAt && new Date(expectedUpdatedAt).getTime() !== draft.updatedAt.getTime()) throw new AppException('COM-001', '그 사이 다른 곳에서 초안을 고쳤어요. 새로 불러와 주세요');
    if (!allowed.includes(draft.draftStatus)) throw new AppException('COM-004', '이 상태의 초안은 바꿀 수 없어요');
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
