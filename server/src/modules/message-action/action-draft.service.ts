import { Injectable, Logger } from '@nestjs/common';
import { DRAFT_STATUS, ERROR_CODE, EVENT_REASON_CODE, MESSAGE_TYPE, NOTIFICATION_TYPE, PERMISSION_LEVEL, type ActionType, type AuthUser } from '@fantasteel/shared';
import { Prisma } from '../../generated/prisma/client';
import { lockRow } from '../../common/concurrency/locks';
import { AppException, badInput, forbidden, invalidState, notFound } from '../../common/errors/app.exception';
import { RealtimeService } from '../../common/realtime/realtime.service';
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import { BusinessEventRecorder } from '../business-event/business-event.recorder';
import { NotificationSender } from '../notification/notification.sender';
import type { ActionDefinition } from './action-definition';
import { ActionDraftRepository, type ActionDraftRow } from './action-draft.repository';
import { ActionRegistry } from './action-registry';
import type { ListActionDraftsDto } from './dto/action-draft.dto';

const S = DRAFT_STATUS;
/** 처리가 끝난 상태. 이 밖의 초안이 있으면 같은 메시지·유형으로 새로 만들지 않는다. */
const PROCESSED: string[] = [S.EXECUTED, S.REJECTED];

const json = (value: Record<string, unknown>) => value as Prisma.InputJsonObject;

function attemptCountOf(executionResult: unknown): number {
  if (executionResult === null || typeof executionResult !== 'object') return 0;
  const n = (executionResult as Record<string, unknown>).attemptCount;
  return typeof n === 'number' ? n : 0;
}

/**
 * Action Draft 흐름 (REQ-ACT-001~004, BP-ACT-01): AI_GENERATED → WAITING_APPROVAL → APPROVED → EXECUTED, 반려 시 REJECTED.
 * 유형별 검증·실행은 ActionDefinition에 맡기고 여기서는 상태·확정 주체·중복 실행만 다룬다.
 * v2는 AI 추출을 하지 않는다: 초안 값은 비어 있고 요청자가 직접 입력한다 (SPEC 9장 #2).
 */
@Injectable()
export class ActionDraftService {
  private readonly logger = new Logger(ActionDraftService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: ActionDraftRepository,
    private readonly registry: ActionRegistry,
    private readonly events: BusinessEventRecorder,
    private readonly notifications: NotificationSender,
    private readonly realtime: RealtimeService,
  ) {}

  // ───────────────────────────── 조회 ─────────────────────────────

  async list(q: ListActionDraftsDto, user: AuthUser) {
    const where: Prisma.ActionDraftWhereInput = q.mine
      ? { requesterId: user.employeeId }
      : { OR: [{ requesterId: user.employeeId }, { message: { chatRoom: { members: { some: { employeeId: user.employeeId } } } } }] };
    if (q.status) where.draftStatus = q.status;
    const rows = await this.repo.findMany(this.prisma, where);
    return Promise.all(rows.map((row) => this.toView(this.prisma, row)));
  }

  async detail(id: number, user: AuthUser) {
    const row = await this.repo.findById(this.prisma, id);
    if (!row) throw notFound('초안');
    // 원본 메시지를 볼 수 있는 사람(요청자·그 채팅방 멤버)만 초안을 본다
    const isMember = row.message ? await this.repo.isRoomMember(this.prisma, row.message.chatRoom.id, user.employeeId) : false;
    if (row.requesterId !== user.employeeId && !isMember) throw forbidden('이 초안을 볼 수 없습니다');
    return this.toView(this.prisma, row);
  }

  // ───────────────────────────── 생성 ─────────────────────────────

  /**
   * 메시지에서 초안을 만든다. 요청자(확정 주체)는 메시지 작성자로 고정이다: 다른 사람이 눌러도 작성자 앞으로 만들어지고 작성자에게 알린다.
   * 같은 메시지·유형의 미처리 초안이 있으면 그것을 돌려준다.
   */
  async createFromMessage(messageId: number, actionType: ActionType, user: AuthUser) {
    const def = this.registry.get(actionType);
    this.requirePermission(def, user);
    const id = await this.prisma.tx(async (tx) => {
      const message = await this.repo.findMessage(tx, messageId);
      if (!message) throw notFound('메시지');
      if (!(await this.repo.isRoomMember(tx, message.chatRoomId, user.employeeId))) throw forbidden('채팅방 멤버만 이 메시지로 초안을 만들 수 있습니다');
      if (message.senderId === null || message.messageType === MESSAGE_TYPE.SYSTEM) throw badInput('시스템 메시지로는 초안을 만들 수 없습니다');

      const existing = await this.repo.findUnprocessed(tx, messageId, actionType, PROCESSED);
      if (existing) return existing.id;

      const created = await this.repo.create(tx, {
        actionType, payload: json(def.initialPayload(message.senderId)), draftStatus: S.AI_GENERATED, requesterId: message.senderId, messageId,
      });
      // AI 추출 단계가 없어 곧바로 요청자 확인 대기로 넘긴다 (추출기를 붙이면 이 사이에 들어간다)
      await this.repo.update(tx, created.id, { draftStatus: S.WAITING_APPROVAL });
      await this.events.record(tx, {
        actor: user,
        eventType: 'ACTION_DRAFT_CREATED',
        targetType: 'ACTION_DRAFT',
        targetId: created.id,
        targetNo: `#${created.id}`,
        summary: `메시지에서 ${def.label} 초안 생성 · 요청자 ${message.sender?.employeeName ?? ''}`,
        after: { actionType, draftStatus: S.WAITING_APPROVAL, requesterId: message.senderId },
        messageId,
        actionDraftId: created.id,
      });
      if (message.senderId !== user.employeeId) {
        await this.notifications.toEmployees(tx, [message.senderId], {
          notificationType: NOTIFICATION_TYPE.APPROVAL_REQUEST,
          title: `${def.label} 초안 확인 요청`,
          body: `${user.employeeName} 님이 내 메시지로 ${def.label} 초안을 만들었습니다. 값을 확인하고 확정해 주세요`,
          linkPath: `/action-drafts/${created.id}`,
          dedupeKey: `ACTION_DRAFT_CREATED:${created.id}`,
        });
      }
      this.realtime.changed('action-drafts');
      return created.id;
    });
    return this.detail(id, user);
  }

  // ───────────────────────────── 수정·확정·반려 ─────────────────────────────

  async update(id: number, patch: Record<string, unknown>, user: AuthUser) {
    await this.prisma.tx(async (tx) => {
      const draft = await this.lockForConfirmer(tx, id, user);
      if (draft.draftStatus !== S.WAITING_APPROVAL) throw invalidState('확인 대기 상태의 초안만 수정할 수 있습니다');
      const def = this.registry.get(draft.actionType);
      await this.repo.update(tx, id, { payload: json(await def.applyPatch(tx, draft.payload, patch)) });
      this.realtime.changed('action-drafts');
    });
    return this.detail(id, user);
  }

  /**
   * 확정: 승인(APPROVED)과 실행(EXECUTED)을 서로 다른 tx로 나눈다. 핸들러가 실패해도 승인 이력은 남고,
   * 실행 결과에 에러 코드·시도 횟수만 기록한다 (업무 프로세스 정의서 10장). 다시 확정을 누르면 실행만 재시도한다.
   * 이미 실행된 초안을 다시 확정하면 아무것도 만들지 않고 현재 결과를 돌려준다.
   */
  async confirm(id: number, user: AuthUser) {
    const needsExecution = await this.prisma.tx(async (tx) => {
      const draft = await this.lockForConfirmer(tx, id, user);
      if (draft.draftStatus === S.EXECUTED) return false;
      if (draft.draftStatus === S.APPROVED) return true;
      if (draft.draftStatus !== S.WAITING_APPROVAL) throw invalidState('확인 대기 상태의 초안만 확정할 수 있습니다');
      const def = this.registry.get(draft.actionType);
      this.requirePermission(def, user);
      const unresolved = await def.validate(tx, draft.payload);
      if (unresolved.length) {
        const names = unresolved.map((f) => `${def.fieldLabels[f] ?? f}(${f})`).join(', ');
        throw new AppException(ERROR_CODE.ACT_001, `확정하려면 다음 값을 입력해 주세요: ${names}`);
      }
      await this.repo.update(tx, id, { draftStatus: S.APPROVED, confirmedAt: new Date() });
      await this.events.record(tx, {
        actor: user,
        eventType: 'ACTION_DRAFT_APPROVED',
        targetType: 'ACTION_DRAFT',
        targetId: id,
        targetNo: `#${id}`,
        summary: `${def.label} 초안 요청자 확정`,
        before: { draftStatus: S.WAITING_APPROVAL },
        after: { draftStatus: S.APPROVED, payload: draft.payload },
        reasonCode: EVENT_REASON_CODE.DRAFT_CONFIRMED,
        messageId: draft.messageId,
        actionDraftId: id,
      });
      this.realtime.changed('action-drafts');
      return true;
    });
    if (needsExecution) await this.execute(id, user);
    return this.detail(id, user);
  }

  private async execute(id: number, user: AuthUser): Promise<void> {
    try {
      await this.prisma.tx(async (tx) => {
        const draft = await this.lockForConfirmer(tx, id, user);
        if (draft.draftStatus === S.EXECUTED) return;
        if (draft.draftStatus !== S.APPROVED) throw invalidState('확정된 초안만 실행할 수 있습니다');
        const def = this.registry.get(draft.actionType);
        this.requirePermission(def, user);
        const result = await def.execute(tx, { id: draft.id, messageId: draft.messageId, payload: draft.payload }, user);
        const executionResult = { ...result, attemptCount: attemptCountOf(draft.executionResult) + 1 };
        await this.repo.update(tx, id, { draftStatus: S.EXECUTED, executedAt: new Date(), executionResult: json(executionResult) });
        await this.events.record(tx, {
          actor: user,
          eventType: 'ACTION_DRAFT_EXECUTED',
          targetType: 'ACTION_DRAFT',
          targetId: id,
          targetNo: `#${id}`,
          summary: `${def.label} 초안 ERP 반영${typeof result.purchaseRequisitionNo === 'string' ? ` · 구매요청 ${result.purchaseRequisitionNo} 생성` : ''}`,
          before: { draftStatus: S.APPROVED },
          after: { draftStatus: S.EXECUTED, executionResult },
          reasonCode: EVENT_REASON_CODE.DRAFT_CONFIRMED,
          messageId: draft.messageId,
          actionDraftId: id,
        });
        this.realtime.changed('action-drafts');
      });
    } catch (error) {
      await this.recordFailure(id, error);
      throw error;
    }
  }

  /** 실행 실패는 상태를 바꾸지 않고(APPROVED 유지) 실행 결과에 에러 코드·시도 횟수로 남긴다. */
  private async recordFailure(id: number, error: unknown): Promise<void> {
    try {
      await this.prisma.tx(async (tx) => {
        await lockRow(tx, 'action_draft', id);
        const draft = await this.repo.findById(tx, id);
        if (!draft || draft.draftStatus !== S.APPROVED) return;
        await this.repo.update(tx, id, {
          executionResult: json({
            errorCode: error instanceof AppException ? error.code : null,
            errorMessage: error instanceof Error ? error.message : String(error),
            attemptCount: attemptCountOf(draft.executionResult) + 1,
            lastAttemptAt: new Date().toISOString(),
          }),
        });
        this.realtime.changed('action-drafts');
      });
    } catch (e) {
      this.logger.error(`초안 ${id} 실행 실패 기록 중 오류: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async reject(id: number, rejectReason: string, user: AuthUser) {
    if (!rejectReason.trim()) throw badInput('반려 사유를 입력해 주세요');
    await this.prisma.tx(async (tx) => {
      const draft = await this.lockForConfirmer(tx, id, user);
      // 확정했지만 실행에 실패해 멈춘 초안도 반려로 닫을 수 있다
      if (draft.draftStatus !== S.WAITING_APPROVAL && draft.draftStatus !== S.APPROVED) throw invalidState('이미 처리된 초안입니다');
      const def = this.registry.get(draft.actionType);
      await this.repo.update(tx, id, { draftStatus: S.REJECTED, rejectReason, rejectedAt: new Date() });
      await this.events.record(tx, {
        actor: user,
        eventType: 'ACTION_DRAFT_REJECTED',
        targetType: 'ACTION_DRAFT',
        targetId: id,
        targetNo: `#${id}`,
        summary: `${def.label} 초안 반려`,
        before: { draftStatus: draft.draftStatus },
        after: { draftStatus: S.REJECTED },
        reason: rejectReason,
        messageId: draft.messageId,
        actionDraftId: id,
      });
      this.realtime.changed('action-drafts');
    });
    return this.detail(id, user);
  }

  // ───────────────────────────── 공통 ─────────────────────────────

  /** 초안을 잠그고 로그인 사원이 확정 주체인지 확인한다. */
  private async lockForConfirmer(tx: Tx, id: number, user: AuthUser): Promise<ActionDraftRow> {
    await lockRow(tx, 'action_draft', id);
    const draft = await this.repo.findById(tx, id);
    if (!draft) throw notFound('초안');
    const def = this.registry.get(draft.actionType);
    if (def.confirmer === 'REQUESTER' && draft.requesterId !== user.employeeId) throw forbidden('초안의 요청자만 수정·확정·반려할 수 있습니다');
    return draft;
  }

  private requirePermission(def: ActionDefinition, user: AuthUser): void {
    if (user.permissions[def.requiredPermission] !== PERMISSION_LEVEL.USE) throw forbidden(`${def.label} 등록 권한이 없습니다`);
  }

  private async toView(tx: Tx, row: ActionDraftRow) {
    const def = this.registry.get(row.actionType);
    const open = row.draftStatus === S.WAITING_APPROVAL || row.draftStatus === S.APPROVED;
    return {
      ...row,
      actionTypeLabel: def.label,
      confirmer: def.confirmer,
      fieldLabels: def.fieldLabels,
      unresolvedFields: open ? await def.validate(tx, row.payload) : [],
    };
  }
}
