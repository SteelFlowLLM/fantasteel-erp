import { Injectable, Logger } from '@nestjs/common';
import {
  ACTION_TYPE,
  ACTION_TYPE_LABEL,
  BUSINESS_EVENT_TYPE,
  DRAFT_STATUS,
  MESSAGE_TYPE,
  PERMISSION_LABEL,
  type ActionDraftCreateResult,
  type ActionDraftExecutionResult,
  type ActionDraftView,
  type ActionType,
  type AuthUser,
  type ChatRoomType,
  type DraftStatus,
  type PurchaseRequisitionDraftPayload,
} from '@fantasteel/shared';
import { AuthUserService } from '../../common/auth/auth-user.service';
import { hasPermission } from '../../common/auth/auth.guard';
import { runAsAiAssisted } from '../../common/business-event/ai-assisted.context';
import { BusinessEventRecorder } from '../../common/business-event/business-event.recorder';
import { AppException } from '../../common/errors/app.exception';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import { retryOnNumberConflict } from '../purchasing/purchasing.service';
import { isAiAssisted, type ActionDefinition, type LookupMemo } from './action-types/action-definition';
import { ActionTypeRegistry } from './action-types/action-type.registry';
import { filledExtractedFields } from './action-types/purchase-requisition.action';
import { DraftExtractor } from './draft-extractor';
import type { ConfirmActionDraftDto, ListActionDraftsQuery, RejectActionDraftDto, UpdateActionDraftDto } from './dto/action-draft.dto';
import { MessageActionRepository, type DraftRow } from './message-action.repository';

/** 확정 전(수정·확정·반려할 수 있는) 상태 */
const EDITABLE_STATUSES: readonly string[] = [DRAFT_STATUS.AI_GENERATED, DRAFT_STATUS.WAITING_APPROVAL];

const toJson = (payload: object) => payload as Prisma.InputJsonValue;

/** 실행 트랜잭션 제한 시간: 수주 등록은 품목마다 예약·계획·작업 로그가 돌아 기본 5초를 넘을 수 있다 (sales-order와 같은 값) */
const EXECUTE_TX = { maxWait: 5_000, timeout: 30_000 };

/**
 * 읽은 뒤 다른 요청이 초안을 바꿨다(동시 수정·동시 실행). 업무 핸들러도 상태 오류에 COM-001을 쓰므로,
 * 실행 실패로 남기지 않을 경합은 이 예외로만 가린다 (#471 리뷰)
 */
class DraftChangedError extends AppException {
  constructor() {
    super('COM-001', '그 사이 다른 곳에서 초안을 고쳤어요. 새로 불러와 주세요');
  }
}

/** 같은 초안을 동시에 실행해 결과 행의 unique(구매요청 action_draft_id 등)에 걸렸다 */
const isUniqueConflict = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

const openResult = (open: { id: number; requesterId: number | null; requester: { employeeName: string } | null }): ActionDraftCreateResult => ({
  id: open.id,
  created: false,
  requesterId: open.requesterId,
  requesterName: open.requester?.employeeName ?? null,
});

/** 초안 값의 원료·규격 품목 id (화면에 품목 이름을 붙일 때) */
const itemIdOf = (payload: object): number | null => ('itemId' in payload && typeof payload.itemId === 'number' ? payload.itemId : null);

/**
 * Message → ERP 초안 (REQ-ACT-001~005, BP-ACT-01·02, docs/backend/message-action.md).
 * 유형마다 다른 칸·검증·확정 주체·실행은 업무 유형 등록부(ActionTypeRegistry)의 정의가 맡고, 이 서비스는 상태 흐름과 작업 로그를 맡는다.
 * 만들 때 LLM이 칸을 채우고(DraftExtractor, SPEC 5장 결정 2), LLM이 없거나 실패하면 확정 주체가 값을 직접 채운다.
 */
@Injectable()
export class MessageActionService {
  private readonly logger = new Logger(MessageActionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: MessageActionRepository,
    private readonly authUsers: AuthUserService,
    private readonly businessEventRecorder: BusinessEventRecorder,
    private readonly registry: ActionTypeRegistry,
    private readonly extractor: DraftExtractor,
  ) {}

  /**
   * 메시지에서 초안을 만든다. 만드는 사람은 그 방 멤버여야 한다.
   * 확정 주체(구매요청은 메시지 작성자, 확장 유형은 만든 사원)가 확정할 수 없으면 초안이 확인 대기에 영영 남으므로 만들지 않는다.
   * 같은 메시지·유형에 미처리 초안이 있으면 새로 만들지 않고 그 초안을 돌려준다.
   * AI 추출(모듈 문서 10장)은 느려서 트랜잭션 밖에서 부른다. 헛호출을 막으려고 먼저 확인하고, 저장할 때 같은 확인을 다시 한다.
   */
  async create(user: AuthUser, messageId: number, actionType: ActionType = ACTION_TYPE.PURCHASE_REQUISITION_CREATE): Promise<ActionDraftCreateResult> {
    const definition = this.registry.get(actionType);
    const checked = await this.creatable(this.prisma, user, messageId, definition);
    if (checked.open) return openResult(checked.open);
    const content = checked.message.content?.trim();
    const extraction = content ? await this.extractor.extract(() => definition.extractionGuide(this.prisma), content, checked.message.createdAt) : null;

    // 그 사이 같은 메시지·유형 초안이 생겨 부분 unique에 걸리면 다시 확인해 그 초안을 돌려준다
    return retryOnNumberConflict(() => this.prisma.$transaction(async (tx) => {
      const { message, requester, open } = await this.creatable(tx, user, messageId, definition);
      if (open) return openResult(open);

      const filled = extraction?.values ? await definition.fromExtraction(tx, extraction.values, message.content) : definition.empty(message.content);
      // 빈 초안이면 왜 비었는지 화면에 보이려고 AI 추출 결과를 남긴다 (이슈 #472). 글이 없는 메시지는 추출하지 않는다
      const aiExtraction = extraction ? (extraction.status ?? (isAiAssisted(filled) ? 'FILLED' : 'NOTHING_FOUND')) : null;
      const payload = { ...filled, aiExtraction };
      const draft = await this.repository.createDraft(tx, { actionType: definition.actionType, payload: toJson(payload), messageId: message.id, requesterId: requester.employeeId });
      await this.businessEventRecorder.record(tx, {
        type: BUSINESS_EVENT_TYPE.DRAFT_CREATED,
        actor: user,
        target: { table: 'action_draft', id: draft.id },
        salesOrderId: message.chatRoom.salesOrderId,
        after: { draftStatus: draft.draftStatus, actionType: definition.actionType, requesterId: draft.requesterId, payload: toJson(payload) },
        // AI가 칸을 채운 초안은 생성 로그부터 AI 경유로 남긴다: 회의록·철강맨AI 초안과 같은 기준 (이슈 #530)
        isAiAssisted: isAiAssisted(filled),
        actionDraftId: draft.id,
        messageId: message.id,
      });
      // AI가 채운 값도 확정 주체가 확인해야 하므로 생성(AI_GENERATED) 직후 확인 대기로 넘긴다 (업무 프로세스 10장 흐름)
      await this.repository.updateDraft(tx, draft.id, { draftStatus: DRAFT_STATUS.WAITING_APPROVAL });
      return { id: draft.id, created: true, requesterId: requester.employeeId, requesterName: requester.employeeName };
    }));
  }

  /**
   * 초안을 만들 수 있는 메시지인지와 확정 주체를 확인하고, 같은 메시지·유형의 미처리 초안을 찾는다.
   * 이미 ERP에 반영된 초안이 있으면 막는다: 다시 만들면 같은 수주·구매요청이 두 번 등록된다(#496). 반려된 초안만 있으면 다시 만들 수 있다
   */
  private async creatable(tx: Tx, user: AuthUser, messageId: number, definition: ActionDefinition) {
    const message = await this.repository.findMessage(tx, messageId);
    if (!message) throw new AppException('COM-003', '메시지를 찾을 수 없어요');
    if (!(await this.repository.isRoomMember(tx, message.chatRoomId, user.employeeId))) throw new AppException('COM-002', '채팅방 멤버만 초안을 만들 수 있어요');
    if (message.messageType !== MESSAGE_TYPE.USER || message.senderId === null || message.deletedAt) throw new AppException('COM-004', '사원이 보낸 메시지에서만 초안을 만들 수 있어요');
    const requester = definition.confirmer === 'MESSAGE_SENDER' ? await this.senderWhoCanConfirm(definition, message.senderId) : this.creatorWhoCanConfirm(definition, user);
    await definition.assertCanExecute(tx, requester);
    const open = await this.repository.findOpenDraft(tx, message.id, definition.actionType);
    if (!open) {
      const executed = await this.repository.findExecutedDraft(tx, message.id, definition.actionType);
      if (executed) {
        const resultNo = definition.resultOf(executed)?.no;
        throw new AppException(
          'COM-004',
          `이 메시지로 만든 ${ACTION_TYPE_LABEL[definition.actionType]} 초안(#${executed.id})은 이미 ERP에 반영했어요${resultNo ? ` (${resultNo})` : ''}. 같은 업무가 두 번 등록되지 않게 새 초안은 만들 수 없어요`,
        );
      }
    }
    return { message, requester, open };
  }

  /** 회의록 작성자가 구매요청 초안의 요청자가 될 수 있는지. 허가할 때 미리 막아 확정 단계에서 전체가 취소되지 않게 한다 */
  async assertCanRequestFromMeeting(tx: Tx, requester: AuthUser): Promise<void> {
    const definition = this.registry.get(ACTION_TYPE.PURCHASE_REQUISITION_CREATE);
    if (!hasPermission(requester, { permission: definition.permission, level: 'USE' })) {
      throw new AppException('COM-002', '구매요청 등록 권한이 없어 구매요청 초안을 만들 수 없어요. 구매요청 후보는 제외하거나 구매 담당자가 확정해 주세요');
    }
    await definition.assertCanExecute(tx, requester);
  }

  /**
   * 회의록 확정 트랜잭션 안에서 구매요청 초안을 만든다 (REQ-VOC-004). 만드는 사람 = 회의록 작성자(creator), 요청자 = 후보에 정한 사원(없으면 작성자, 이슈 #530).
   * 사람이 허가한 후보만 부르므로 AI_GENERATED는 거치지 않고 바로 요청자 확인 대기로 둔다. 요청자가 나중에 확정할 수 없는 초안은 만들지 않는다.
   */
  async createFromMeeting(tx: Tx, requester: AuthUser, meetingMinutesId: number, payload: PurchaseRequisitionDraftPayload, salesOrderId: number | null, creator: AuthUser = requester): Promise<number> {
    return this.createAiDraft(tx, requester, { meetingMinutesId }, payload, salesOrderId, creator);
  }

  /**
   * AI 어시스턴트 실행 카드를 사용자가 실행했을 때 구매요청 초안을 만든다 (REQ-AST-005). 원본 메시지·회의록 없이 요청자 = 카드를 실행한 사람이다.
   * 회의록 후보와 같이 바로 요청자 확인 대기로 두고, 이후 기존 초안 흐름(확정 → 구매요청 → 부서장 승인)을 탄다.
   */
  async createFromAssistant(tx: Tx, requester: AuthUser, payload: PurchaseRequisitionDraftPayload): Promise<number> {
    return this.createAiDraft(tx, requester, {}, payload, null);
  }

  private async createAiDraft(tx: Tx, requester: AuthUser, origin: { meetingMinutesId?: number }, payload: PurchaseRequisitionDraftPayload, salesOrderId: number | null, creator: AuthUser = requester): Promise<number> {
    await this.assertCanRequestFromMeeting(tx, requester);
    const actionType = ACTION_TYPE.PURCHASE_REQUISITION_CREATE;
    const { meetingMinutesId } = origin;
    // AI가 뽑은 값이라 채워진 칸을 AI가 채운 칸으로 남겨 확정·실행 로그도 AI 경유로 한다 (모듈 문서 10장)
    const stored = { ...payload, aiFilledFields: filledExtractedFields(payload) };
    const draft = await this.repository.createDraft(tx, {
      actionType,
      payload: toJson(stored),
      meetingMinutesId,
      requesterId: requester.employeeId,
    });
    await this.businessEventRecorder.record(tx, {
      type: BUSINESS_EVENT_TYPE.DRAFT_CREATED,
      // 초안을 만든 사람(회의록 작성자). 요청자는 after.requesterId에 남는다
      actor: creator,
      target: { table: 'action_draft', id: draft.id },
      salesOrderId,
      after: {
        draftStatus: draft.draftStatus,
        actionType,
        requesterId: requester.employeeId,
        meetingMinutesId,
        payload: toJson(stored),
      },
      isAiAssisted: true,
      actionDraftId: draft.id,
    });
    await this.repository.updateDraft(tx, draft.id, {
      draftStatus: DRAFT_STATUS.WAITING_APPROVAL,
    });
    return draft.id;
  }

  /** chatRoomId가 있으면 그 방 메시지의 초안(방 멤버만), 없으면 내가 확정 주체인 초안(메시지·회의록에서 만든 것). 최근 것 먼저 */
  async list(user: AuthUser, query: ListActionDraftsQuery): Promise<ActionDraftView[]> {
    const chatRoomId = query.chatRoomId;
    if (chatRoomId !== undefined && !(await this.repository.isRoomMember(this.prisma, chatRoomId, user.employeeId))) throw new AppException('COM-002', '채팅방 멤버만 볼 수 있어요');
    const rows = await this.repository.findDrafts(this.prisma, chatRoomId !== undefined ? { message: { chatRoomId } } : { requesterId: user.employeeId });
    return this.toViews(this.prisma, rows);
  }

  /** 확정 주체 본인 또는 원본 메시지 방의 멤버만 본다 (다른 방 대화가 보이지 않게) */
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

  /** 확정 주체가 값을 고친다 (확정 전만). 칸 검증은 유형 정의가 한다 */
  async update(user: AuthUser, id: number, dto: UpdateActionDraftDto): Promise<ActionDraftView> {
    const row = await this.prisma.$transaction(async (tx) => {
      const { draft, definition } = await this.requesterDraft(tx, user, id, dto.expectedUpdatedAt);
      const next = await definition.applyPatch(tx, definition.parse(draft.payload), dto.payload ?? {});
      await this.changeDraft(tx, draft, { payload: toJson(next), draftStatus: DRAFT_STATUS.WAITING_APPROVAL });
      return this.repository.findDraft(tx, draft.id);
    });
    if (!row) throw new AppException('COM-003', '초안을 찾을 수 없어요');
    const [view] = await this.toViews(this.prisma, [row]);
    return view;
  }

  /** 확정 주체 확정 (업무 프로세스 13.4): 필수값(ACT-001)을 확인해 APPROVED·DRAFT_CONFIRMED를 남기고 바로 실행한다 */
  async confirm(user: AuthUser, id: number, dto: ConfirmActionDraftDto): Promise<ActionDraftExecutionResult> {
    await this.prisma.$transaction(async (tx) => {
      const { draft, definition } = await this.requesterDraft(tx, user, id, dto.expectedUpdatedAt);
      const payload = definition.parse(draft.payload);
      const unresolved = await definition.unresolvedFields(tx, payload);
      if (unresolved.length > 0) throw new AppException('ACT-001', `채워야 할 칸: ${unresolved.join(', ')}`);
      // 실행이 늘 실패하면(예: 구매요청 승인권자 없음, 출하 가능 매수 초과) APPROVED에 갇히므로 확정 전에 막는다
      await definition.assertCanExecute(tx, user);
      await definition.assertPayloadExecutable?.(tx, payload);
      await this.changeDraft(tx, draft, { draftStatus: DRAFT_STATUS.APPROVED, confirmedAt: new Date() });
      await this.businessEventRecorder.record(tx, {
        type: BUSINESS_EVENT_TYPE.DRAFT_CONFIRMED,
        actor: user,
        target: { table: 'action_draft', id: draft.id },
        salesOrderId: draft.message?.chatRoom.salesOrderId ?? null,
        before: { draftStatus: draft.draftStatus },
        after: { draftStatus: DRAFT_STATUS.APPROVED, payload: toJson(payload) },
        reason: await definition.confirmReason(tx, payload),
        actionDraftId: draft.id,
        messageId: draft.messageId,
        isAiAssisted: isAiAssisted(payload),
      });
    });
    return this.execute(user, id);
  }

  /**
   * 승인(APPROVED)된 초안을 유형 정의의 핸들러로 실행한다. 핸들러가 실패하면 실행 트랜잭션은 롤백되므로,
   * 실패 코드·시도 횟수는 별도 트랜잭션으로 남기고 APPROVED 그대로 둔다(같은 API로 다시 실행한다).
   */
  async execute(user: AuthUser, id: number): Promise<ActionDraftExecutionResult> {
    const { draft, definition } = await this.requesterDraft(this.prisma, user, id, null, [DRAFT_STATUS.APPROVED]);
    const aiAssisted = isAiAssisted(definition.parse(draft.payload));
    let failure: AppException | null = null;
    // AI가 채운 초안이면 핸들러 안에서 이어 남는 작업 로그(자동 예약·생산계획 등)도 AI 경유로 남긴다 (REQ-AST-010)
    const run = <T>(work: () => Promise<T>) => (aiAssisted ? runAsAiAssisted(work) : work());
    try {
      await retryOnNumberConflict(() =>
        run(() => this.prisma.$transaction(async (tx) => {
          const result = await definition.execute(tx, draft, user);
          await this.changeDraft(tx, draft, { draftStatus: DRAFT_STATUS.EXECUTED, executionErrorCode: null, executionAttemptCount: { increment: 1 } });
          await this.businessEventRecorder.record(tx, {
            type: BUSINESS_EVENT_TYPE.DRAFT_EXECUTED,
            actor: user,
            target: { table: 'action_draft', id: draft.id },
            salesOrderId: draft.message?.chatRoom.salesOrderId ?? null,
            before: { draftStatus: DRAFT_STATUS.APPROVED },
            after: { draftStatus: DRAFT_STATUS.EXECUTED, resultTable: result.table, resultId: result.id, resultNo: result.no },
            actionDraftId: draft.id,
            messageId: draft.messageId,
            isAiAssisted: aiAssisted,
          });
        }, EXECUTE_TX)),
      );
    } catch (e) {
      // 같은 초안을 동시에 실행한 경합은 실행 실패가 아니다 (먼저 끝난 실행이 결과다)
      if (e instanceof DraftChangedError) throw e;
      if (isUniqueConflict(e)) throw new DraftChangedError();
      // 업무 규칙 오류는 그대로, 예상 못 한 오류(DB 등)는 COM-999로 남겨 시도 기록이 빠지지 않게 한다
      if (!(e instanceof AppException)) this.logger.error(`초안 ${draft.id} 실행 중 예상 못 한 오류: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
      failure = e instanceof AppException ? e : new AppException('COM-999', '실행 중 예상하지 못한 오류가 났어요. 잠시 뒤 다시 실행하거나 반려해 주세요');
      // 그 사이 다른 요청이 실행을 끝냈으면 그 결과를 덮어쓰지 않는다
      await this.repository.updateDraftIfUnchanged(this.prisma, draft.id, draft.updatedAt, { executionErrorCode: failure.code, executionAttemptCount: { increment: 1 } });
    }
    return { draft: await this.get(user, id), executed: failure === null, errorCode: failure?.code ?? null, errorMessage: failure?.message ?? null };
  }

  /** 확정 주체 반려 (확정 전, 또는 확정했지만 실행에 실패한 초안. 사유 필수) → REJECTED */
  async reject(user: AuthUser, id: number, dto: RejectActionDraftDto): Promise<ActionDraftView> {
    await this.prisma.$transaction(async (tx) => {
      const { draft } = await this.requesterDraft(tx, user, id, dto.expectedUpdatedAt, [...EDITABLE_STATUSES, DRAFT_STATUS.APPROVED]);
      // 확정한 초안은 실행에 실패했을 때만 반려할 수 있다 (실행할 수 없는 초안이 승인(APPROVED)에 갇히지 않게, #471 리뷰)
      if (draft.draftStatus === DRAFT_STATUS.APPROVED && draft.executionErrorCode === null) throw new AppException('COM-004', '확정한 초안은 실행에 실패했을 때만 반려할 수 있어요');
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
    if (!(await this.repository.updateDraftIfUnchanged(tx, draft.id, draft.updatedAt, data))) throw new DraftChangedError();
  }

  /**
   * 확정 주체 본인이고 그 유형의 사용 권한이 있어야 고치고 확정·반려할 수 있다(실행은 사용자 권한을 거친다, BP-ACT-01).
   * 기본은 확정 전(AI_GENERATED·WAITING_APPROVAL) 초안만
   */
  private async requesterDraft(
    tx: Tx,
    user: AuthUser,
    id: number,
    expectedUpdatedAt: string | null | undefined,
    allowed: readonly string[] = EDITABLE_STATUSES,
  ): Promise<{ draft: DraftRow; definition: ActionDefinition }> {
    const draft = await this.repository.findDraft(tx, id);
    if (!draft) throw new AppException('COM-003', '초안을 찾을 수 없어요');
    const definition = this.registry.get(draft.actionType);
    if (draft.requesterId !== user.employeeId) throw new AppException('COM-002', '요청자만 확인·확정할 수 있어요');
    if (!hasPermission(user, { permission: definition.permission, level: 'USE' })) {
      throw new AppException('COM-002', `${PERMISSION_LABEL[definition.permission]} 권한이 있어야 초안을 확인·확정할 수 있어요`);
    }
    if (expectedUpdatedAt && new Date(expectedUpdatedAt).getTime() !== draft.updatedAt.getTime()) throw new AppException('COM-001', '그 사이 다른 곳에서 초안을 고쳤어요. 새로 불러와 주세요');
    if (!allowed.includes(draft.draftStatus)) throw new AppException('COM-004', '이 상태의 초안은 바꿀 수 없어요');
    return { draft, definition };
  }

  /** 메시지 작성자가 사용 중이고 그 유형의 사용 권한이 있어야 확정할 수 있다 (구매요청 초안, BP-ACT-01) */
  private async senderWhoCanConfirm(definition: ActionDefinition, senderId: number): Promise<AuthUser> {
    const sender = await this.authUsers.load(senderId);
    if (!sender) throw new AppException('COM-002', '요청자(메시지 작성자)가 사용 중인 사원이 아니라 초안을 만들 수 없어요');
    if (!hasPermission(sender, { permission: definition.permission, level: 'USE' })) {
      throw new AppException('COM-002', `요청자(메시지 작성자)에게 ${PERMISSION_LABEL[definition.permission]} 권한이 없어 초안을 만들 수 없어요`);
    }
    return sender;
  }

  /** 초안을 만든 사원이 그 유형의 사용 권한이 있어야 한다 (확장 유형, BP-ACT-02) */
  private creatorWhoCanConfirm(definition: ActionDefinition, user: AuthUser): AuthUser {
    if (!hasPermission(user, { permission: definition.permission, level: 'USE' })) {
      throw new AppException('COM-002', `${PERMISSION_LABEL[definition.permission]} 권한이 있어야 이 초안을 만들 수 있어요`);
    }
    return user;
  }

  private async toViews(tx: Tx, rows: DraftRow[]): Promise<ActionDraftView[]> {
    const definitions = rows.map((r) => this.registry.get(r.actionType));
    const payloads = rows.map((r, index) => definitions[index].parse(r.payload));
    const itemIds = [...new Set(payloads.map(itemIdOf).filter((itemId): itemId is number => itemId !== null))];
    const items = new Map((itemIds.length > 0 ? await this.repository.findItems(tx, itemIds) : []).map((i) => [i.id, i]));
    // 트랜잭션 안에서 부를 수도 있어 한 연결에 쿼리를 겹쳐 보내지 않고 차례로 읽는다 (pg 다음 버전에서 오류)
    const unresolved: string[][] = [];
    const labels: Record<string, string>[] = [];
    // 고객사·규격 목록은 초안마다 다시 읽지 않고 이 응답 안에서 한 번만 읽는다
    const memo: LookupMemo = new Map();
    for (const [index, payload] of payloads.entries()) {
      unresolved.push(await definitions[index].unresolvedFields(tx, payload, memo));
      labels.push(await definitions[index].payloadLabels(tx, payload, memo));
    }
    return rows.map((r, index) => {
      const payload = payloads[index];
      const itemId = itemIdOf(payload);
      const item = itemId === null ? undefined : items.get(itemId);
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
        meetingMinutes: r.meetingMinutes ? { id: r.meetingMinutes.id, title: r.meetingMinutes.meetingMinutesTitle } : null,
        unresolvedFields: unresolved[index],
        payloadLabels: labels[index],
        result: definitions[index].resultOf(r),
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
