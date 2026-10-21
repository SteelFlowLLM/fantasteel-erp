import { Injectable, Logger } from '@nestjs/common';
import {
  ACTION_TYPE,
  AGENT_RISK_TYPE_LABEL,
  BUSINESS_EVENT_TYPE,
  DRAFT_STATUS,
  INSPECTION_RESULT,
  NOTIFICATION_TYPE,
  PERMISSION,
  type ActionType,
  type AgentCandidateExecutionResult,
  type AgentCandidateView,
  type AgentDraftMeta,
  type AgentExplainView,
  type AgentRiskType,
  type AuthUser,
  type DraftStatus,
  type Permission,
} from '@fantasteel/shared';
import { hasPermission } from '../../common/auth/auth.guard';
import { BusinessEventRecorder } from '../../common/business-event/business-event.recorder';
import { AppException } from '../../common/errors/app.exception';
import { seoulToday } from '../../common/time/seoul-date';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { NotificationService } from '../notification/notification.service';
import { OrganizationService } from '../organization/organization.service';
import { LlmClient, LlmRequestError } from '../llm/llm.client';
import { LlmSettingsStore } from '../llm/llm-settings.store';
import { LLM_PROFILE } from '../llm/llm-profiles';
import { MrpService } from '../mrp/mrp.service';
import { ProductionService } from '../production/production.service';
import { PurchasingService, retryOnNumberConflict } from '../purchasing/purchasing.service';
import {
  agedSurplusCandidate,
  dayDiff,
  dueRiskAlerts,
  qualityRateAlerts,
  QUALITY_RATE_WINDOW_DAYS,
  type AgedSurplusCandidate,
  type GradeInspectionCount,
  type WaitingOrder,
} from './agent-alert-rules';
import {
  addDays,
  agentMetaOf,
  goodQtyShortageCandidate,
  RAW_SHORTAGE_HORIZON_DAYS,
  rawShortageCandidates,
  type GoodQtyShortageCandidate,
  type RawShortageCandidate,
} from './agent-rules';
import { buildExplainMessages } from './agent-explain';
import { FactoryAgentRepository, type AgentDraftRow } from './factory-agent.repository';

export interface AgentScanResult {
  riskType: AgentRiskType;
  /** 규칙이 찾은 후보 수 */
  detected: number;
  /** 새로 만든 초안 수 (같은 대상의 미처리 초안이 있으면 만들지 않는다) */
  created: number;
}

/** 확정 전(수정·확정·반려할 수 있는) 상태 */
const CONFIRMABLE_STATUSES: readonly string[] = [DRAFT_STATUS.AI_GENERATED, DRAFT_STATUS.WAITING_APPROVAL];

/** 후보가 만드는 업무의 권한을 따른다 (REQ-AGT-006). 등록부에 없는 유형은 아직 후보로 만들지 않는다 */
const CONFIRM_PERMISSION: Partial<Record<ActionType, Permission>> = {
  [ACTION_TYPE.PURCHASE_REQUISITION_CREATE]: PERMISSION.PURCHASE_REQUISITION_CREATE,
  [ACTION_TYPE.REPRODUCTION_PLAN_CREATE]: PERMISSION.PRODUCTION_PLAN_CONFIRM,
  [ACTION_TYPE.ALLOCATION_CONFIRM]: PERMISSION.SHIPMENT_REQUEST_MANAGE,
};

/** 품질 부서 코드 (시드 조직) */
const QUALITY_DEPARTMENT_CODE = 'QC';

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const numberOrNull = (v: unknown) => (typeof v === 'number' ? v : null);
const textOrNull = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v : null);

interface ExecutionTarget {
  kind: 'PURCHASE_REQUISITION' | 'PRODUCTION_PLAN';
  id: number;
  no: string;
}

/**
 * AI Factory Agent (REQ-AGT-001~006, BP-AGT-01, docs/backend/factory-agent.md).
 * 규칙이 위험을 감지해 대응 후보를 Action Draft로 만들고, 담당 부서원이 후보별로 확정하면 해당 모듈 핸들러가 실행한다.
 * LLM은 상황 설명(explain)만 한다. 후보를 정하거나 데이터를 바꾸지 않는다.
 */
@Injectable()
export class FactoryAgentService {
  private readonly logger = new Logger(FactoryAgentService.name);
  /** 감지(스케줄·이벤트)는 한 번에 하나씩 돌려 같은 대상의 초안이 겹쳐 생기지 않게 한다 */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: FactoryAgentRepository,
    private readonly businessEventRecorder: BusinessEventRecorder,
    private readonly mrp: MrpService,
    private readonly production: ProductionService,
    private readonly purchasing: PurchasingService,
    private readonly inventory: InventoryService,
    private readonly notification: NotificationService,
    private readonly organization: OrganizationService,
    private readonly llm: LlmClient,
    private readonly llmSettings: LlmSettingsStore,
  ) {}

  // ── 감지 (REQ-AGT-001: 스케줄·이벤트 트리거) ───────────────

  /** 스케줄 트리거: 규칙을 차례로 돌린다. 한 규칙이 실패해도 나머지는 돌리고, 실패는 로그에 남긴다 */
  scanAll(): Promise<AgentScanResult[]> {
    return this.serial(async () => {
      const results: AgentScanResult[] = [];
      const scans: [AgentRiskType, () => Promise<AgentScanResult>][] = [
        ['RAW_SHORTAGE', () => this.detectRawShortage()],
        ['DUE_RISK', () => this.detectDueRisk()],
        ['AGED_SURPLUS', () => this.detectAgedSurplus()],
        ['QUALITY_RATE_RISE', () => this.detectQualityRateRise()],
      ];
      for (const [riskType, scan] of scans) {
        try {
          results.push(await scan());
        } catch (e) {
          this.logger.warn(`${riskType} 감지에 실패했어요: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      return results;
    });
  }

  /**
   * 이벤트 트리거: 검사를 등록하면 그 LOT이 속한 수주 품목의 합격 매수 부족을 본다.
   * 검사 거래 밖에서 부르고(커밋 뒤) 실패해도 검사에는 영향이 없게 오류를 삼킨다.
   */
  async onInspectionRegistered(lotId: number): Promise<void> {
    try {
      await this.serial(async () => {
        const lot = await this.repository.findSalesOrderItemOfLot(this.prisma, lotId);
        const salesOrderItemId = lot?.productionResult?.productionPlan?.salesOrderItemId;
        if (salesOrderItemId) await this.detectGoodQtyShortage(salesOrderItemId);
      });
    } catch (e) {
      this.logger.warn(`검사 등록 뒤 합격 매수 부족 감지에 실패했어요 (LOT ${lotId}): ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** RAW_SHORTAGE (REQ-AGT-002): MRP 순소요가 있는 계획·원료마다 구매요청 후보 */
  private async detectRawShortage(): Promise<AgentScanResult> {
    const today = seoulToday();
    const view = await this.mrp.requirements({ from: today, to: addDays(today, RAW_SHORTAGE_HORIZON_DAYS) });
    const candidates = rawShortageCandidates(view.requisitionLines, today);
    let created = 0;
    for (const candidate of candidates) {
      if (await this.prisma.$transaction((tx) => this.createRawShortageDraft(tx, candidate))) created++;
    }
    return { riskType: 'RAW_SHORTAGE', detected: candidates.length, created };
  }

  /** GOOD_QTY_SHORTAGE (REQ-AGT-003) */
  private async detectGoodQtyShortage(salesOrderItemId: number): Promise<AgentScanResult> {
    const check = await this.production.reproductionCheck(this.prisma, salesOrderItemId);
    const candidate = check && goodQtyShortageCandidate(check, seoulToday());
    if (!check || !candidate) return { riskType: 'GOOD_QTY_SHORTAGE', detected: 0, created: 0 };
    const created = await this.prisma.$transaction((tx) => this.createReproductionDraft(tx, candidate, check.salesOrderId));
    return { riskType: 'GOOD_QTY_SHORTAGE', detected: 1, created: created ? 1 : 0 };
  }

  /**
   * DUE_RISK (REQ-AGT-004): 납기가 기준일(REQ-MST-009) 이내이고 출하가 모자란 수주 품목을 수주 담당 영업에게 알린다.
   * 출하 매수는 재생산 판단과 같은 값(shippedQty)을 쓴다. 안 읽은 같은 알림이 있으면 다시 보내지 않는다.
   */
  private async detectDueRisk(): Promise<AgentScanResult> {
    const today = seoulToday();
    const setting = await this.repository.findProductionSetting(this.prisma);
    if (!setting) throw new AppException('MST-001', '납기 위험 기준일 설정이 없어요');
    const rows = await this.repository.findOpenSalesOrderItemsDueUntil(this.prisma, new Date(`${addDays(today, setting.deliveryRiskDays)}T00:00:00.000Z`));
    const items = [];
    for (const row of rows) {
      const check = await this.production.reproductionCheck(this.prisma, row.id);
      if (!check) continue;
      items.push({
        salesOrderItemId: row.id,
        salesOrderId: row.salesOrderId,
        salesOrderNo: row.salesOrder.salesOrderNo,
        lineNo: row.salesOrder.salesOrderItems.findIndex((i) => i.id === row.id) + 1,
        ownerEmployeeId: row.salesOrder.ownerEmployeeId,
        dueDate: row.dueDate.toISOString().slice(0, 10),
        orderedQty: check.orderedQty,
        shippedQty: check.shippedQty,
      });
    }
    const alerts = dueRiskAlerts(items, today, setting.deliveryRiskDays);
    let created = 0;
    for (const alert of alerts) {
      const sent = await this.prisma.$transaction(async (tx) => {
        if (await this.repository.hasUnreadSameNotification(tx, alert.ownerEmployeeId, NOTIFICATION_TYPE.DUE_RISK, alert.content)) return 0;
        return this.notification.notifyEmployees(tx, [alert.ownerEmployeeId], { notificationType: NOTIFICATION_TYPE.DUE_RISK, notificationContent: alert.content, linkPath: `/sales-orders/${alert.salesOrderId}` });
      });
      created += sent;
    }
    return { riskType: 'DUE_RISK', detected: alerts.length, created };
  }

  /** QUALITY_RATE_RISE (REQ-AGT-004): 강종별 최근 판정 결과의 불합격률이 기준을 넘으면 품질 부서원에게 알린다 */
  private async detectQualityRateRise(): Promise<AgentScanResult> {
    const today = seoulToday();
    const since = new Date(Date.now() - QUALITY_RATE_WINDOW_DAYS * 86_400_000);
    const inspections = await this.repository.findJudgedInspectionsSince(this.prisma, since);
    const byGrade = new Map<string, GradeInspectionCount>();
    for (const inspection of inspections) {
      const code = inspection.lot.steelGrade?.steelGradeCode ?? inspection.lot.item?.steelGrade?.steelGradeCode;
      if (!code) continue;
      const count = byGrade.get(code) ?? { steelGradeCode: code, passCount: 0, failCount: 0 };
      if (inspection.inspectionResult === INSPECTION_RESULT.FAIL) count.failCount++;
      else count.passCount++;
      byGrade.set(code, count);
    }
    const alerts = qualityRateAlerts([...byGrade.values()], today);
    if (alerts.length === 0) return { riskType: 'QUALITY_RATE_RISE', detected: 0, created: 0 };
    const department = await this.repository.findDepartmentIdByCode(this.prisma, QUALITY_DEPARTMENT_CODE);
    if (!department) throw new AppException('COM-003', '품질 부서를 찾을 수 없어요');
    let created = 0;
    for (const alert of alerts) {
      created += await this.prisma.$transaction(async (tx) => {
        const members = await this.organization.findActiveMemberIds(tx, department.id);
        const unread = new Set<number>();
        for (const id of members) if (await this.repository.hasUnreadSameNotification(tx, id, NOTIFICATION_TYPE.QUALITY_RATE_RISE, alert.content)) unread.add(id);
        const targets = members.filter((id) => !unread.has(id));
        return this.notification.notifyEmployees(tx, targets, { notificationType: NOTIFICATION_TYPE.QUALITY_RATE_RISE, notificationContent: alert.content });
      });
    }
    return { riskType: 'QUALITY_RATE_RISE', detected: alerts.length, created };
  }

  /** AGED_SURPLUS (REQ-AGT-004): 오래 보유한 여재를 대기 수주에 배정하라는 추천 후보 (추천만, 실행은 기존 화면) */
  private async detectAgedSurplus(): Promise<AgentScanResult> {
    const today = seoulToday();
    const candidates = await this.agedSurplusCandidates(today);
    let created = 0;
    for (const c of candidates) {
      if (await this.prisma.$transaction((tx) => this.createAgedSurplusDraft(tx, c))) created++;
    }
    return { riskType: 'AGED_SURPLUS', detected: candidates.length, created };
  }

  private async agedSurplusCandidates(today: string): Promise<AgedSurplusCandidate[]> {
    const surplus = await this.inventory.surplusSlabs(this.prisma);
    const candidates: AgedSurplusCandidate[] = [];
    for (const row of surplus) {
      const rows = await this.repository.findOpenSalesOrderItemsOfItem(this.prisma, row.itemId);
      const waiting: WaitingOrder[] = [];
      for (const r of rows) {
        const check = await this.production.reproductionCheck(this.prisma, r.id);
        if (!check || check.unsecuredQty <= 0) continue;
        waiting.push({ salesOrderItemId: r.id, salesOrderNo: r.salesOrder.salesOrderNo, lineNo: r.salesOrder.salesOrderItems.findIndex((i) => i.id === r.id) + 1, dueDate: r.dueDate.toISOString().slice(0, 10), unsecuredQty: check.unsecuredQty });
      }
      const candidate = agedSurplusCandidate({ itemId: row.itemId, itemCode: row.itemCode, lots: row.lots }, waiting, today);
      if (candidate) candidates.push(candidate);
    }
    return candidates;
  }

  private createAgedSurplusDraft(tx: Tx, c: AgedSurplusCandidate): Promise<boolean> {
    return this.createCandidate(tx, {
      actionType: ACTION_TYPE.ALLOCATION_CONFIRM,
      meta: c.meta,
      salesOrderId: null,
      fields: { itemId: c.itemId, agedLotNos: c.agedLotNos, recommendations: c.recommendations.map((r) => ({ ...r })) },
    });
  }

  private createRawShortageDraft(tx: Tx, c: RawShortageCandidate): Promise<boolean> {
    return this.createCandidate(tx, {
      actionType: ACTION_TYPE.PURCHASE_REQUISITION_CREATE,
      meta: c.meta,
      salesOrderId: null,
      fields: { itemId: c.itemId, requestedTon: c.requestedTon, desiredReceiptDate: c.desiredReceiptDate, requestReason: c.requestReason, productionPlanId: c.productionPlanId },
    });
  }

  private createReproductionDraft(tx: Tx, c: GoodQtyShortageCandidate, salesOrderId: number): Promise<boolean> {
    return this.createCandidate(tx, {
      actionType: ACTION_TYPE.REPRODUCTION_PLAN_CREATE,
      meta: c.meta,
      salesOrderId,
      fields: { salesOrderItemId: c.salesOrderItemId, salesOrderId, additionalPlanQty: c.additionalPlanQty },
    });
  }

  /**
   * 후보를 Action Draft로 저장한다 (REQ-AGT-005). 같은 대상(targetKey)의 미처리 초안이 있으면 새로 만들지 않는다.
   * 먼저 확인하고, 그 사이에 다른 서버가 먼저 만들었으면 DB 부분 unique(action_draft_open_agent_target_key)가 막는다.
   * 만든 직후 확정 대기(WAITING_APPROVAL)로 넘기고 확정 권한이 있는 사원에게 알린다. 확정 주체는 확정하는 부서원이라 requester는 비워 둔다.
   */
  private async createCandidate(tx: Tx, input: { actionType: ActionType; meta: AgentDraftMeta; salesOrderId: number | null; fields: Record<string, Prisma.InputJsonValue | null> }): Promise<boolean> {
    if (await this.repository.findOpenDraftByTarget(tx, input.meta.targetKey)) return false;
    const payload = { ...input.fields, agent: input.meta };
    const draft = await this.repository.createDraftIfNew(tx, { actionType: input.actionType, payload: payload as unknown as Prisma.InputJsonValue });
    if (!draft) return false;
    const event = await this.businessEventRecorder.record(tx, {
      type: BUSINESS_EVENT_TYPE.DRAFT_CREATED,
      actor: 'SYSTEM',
      target: { table: 'action_draft', id: draft.id },
      salesOrderId: input.salesOrderId,
      after: { draftStatus: draft.draftStatus, actionType: input.actionType, payload: payload as unknown as Prisma.InputJsonValue },
      reason: `AGENT_${input.meta.riskType}: ${input.meta.summary}`,
      actionDraftId: draft.id,
    });
    await this.repository.update(tx, draft.id, { draftStatus: DRAFT_STATUS.WAITING_APPROVAL });
    await this.notifyCandidate(tx, input.actionType, input.meta, event.id);
    return true;
  }

  /**
   * 후보가 생겼다고 그 업무의 확정 권한(USE)이 있는 재직 사원에게 알린다. 작업 로그(DRAFT_CREATED)로 만든 알림이라
   * 같은 후보를 같은 사람에게 두 번 보내지 않고(알림 부분 unique), 안 읽은 같은 내용의 알림이 있으면 다시 보내지 않는다.
   */
  private async notifyCandidate(tx: Tx, actionType: ActionType, meta: AgentDraftMeta, businessEventId: number): Promise<void> {
    const permission = CONFIRM_PERMISSION[actionType];
    if (!permission) return;
    const content = `[Agent 대응 후보] ${AGENT_RISK_TYPE_LABEL[meta.riskType]}: ${meta.summary}`;
    const members = await this.repository.findActiveEmployeeIdsWithPermission(tx, permission);
    const targets: number[] = [];
    for (const id of members) if (!(await this.repository.hasUnreadSameNotification(tx, id, NOTIFICATION_TYPE.AGENT_CANDIDATE, content))) targets.push(id);
    await this.notification.notifyEmployees(tx, targets, { notificationType: NOTIFICATION_TYPE.AGENT_CANDIDATE, notificationContent: content, linkPath: '/agent', businessEventId });
  }

  // ── 후보 조회 ─────────────────────────────────────────

  /** GET action-drafts?source=agent. 후보가 만드는 업무의 조회 권한이 있는 사원만 본다 */
  async list(user: AuthUser): Promise<AgentCandidateView[]> {
    const rows = await this.repository.findAgentDrafts(this.prisma);
    return rows.filter((row) => this.canView(user, row)).flatMap((row) => this.toView(row) ?? []);
  }

  /** Agent 후보이면 상세, 아니면 null (메시지 초안은 message-action이 다룬다) */
  async findCandidate(user: AuthUser, id: number): Promise<AgentCandidateView | null> {
    const row = await this.repository.findDraft(this.prisma, id);
    if (!row || !this.toView(row)) return null;
    this.assertView(user, row);
    return this.toView(row);
  }

  /** 초안이 Agent 후보인지 (message-action이 요청을 넘길지 판단) */
  async isCandidate(id: number): Promise<boolean> {
    const row = await this.repository.findDraft(this.prisma, id);
    return row !== null && agentMetaOf(row.payload) !== null;
  }

  // ── 확정·실행·반려 (REQ-AGT-006) ────────────────────────

  /**
   * 담당 부서원이 후보를 확정한다. 확정한 사원이 확정 주체(요청자)가 된다.
   * 먼저 위험이 아직 남았는지 다시 확인한다: 해소됐으면 실행하지 않고 후보를 닫는다.
   */
  async confirm(user: AuthUser, id: number, expectedUpdatedAt?: string | null): Promise<AgentCandidateExecutionResult> {
    const draft = await this.confirmableDraft(this.prisma, user, id, expectedUpdatedAt);
    const staleReason = await this.staleReason(draft);
    if (staleReason) return this.closeAsStale(user, draft, staleReason);

    await this.prisma.$transaction(async (tx) => {
      const current = await this.confirmableDraft(tx, user, id, expectedUpdatedAt);
      // 승인권자가 없으면 실행이 늘 실패해 APPROVED에 갇히므로 확정 전에 막는다
      if (current.actionType === ACTION_TYPE.PURCHASE_REQUISITION_CREATE) await this.purchasing.assertCanRequest(tx, user);
      await this.change(tx, current, { draftStatus: DRAFT_STATUS.APPROVED, confirmedAt: new Date(), requesterId: user.employeeId });
      await this.businessEventRecorder.record(tx, {
        type: BUSINESS_EVENT_TYPE.DRAFT_CONFIRMED,
        actor: user,
        target: { table: 'action_draft', id: current.id },
        salesOrderId: salesOrderIdOf(current.payload),
        before: { draftStatus: current.draftStatus },
        after: { draftStatus: DRAFT_STATUS.APPROVED, payload: current.payload as Prisma.InputJsonValue },
        reason: `DRAFT_CONFIRMED: Agent 후보 확정 (${this.metaOf(current).summary})`,
        actionDraftId: current.id,
      });
    });
    return this.execute(user, id);
  }

  /**
   * 승인(APPROVED)된 후보를 실행한다. 실행이 실패하면 트랜잭션은 롤백되므로 실패 코드·시도 횟수는 별도 트랜잭션으로 남기고
   * APPROVED 그대로 둔다 (같은 API로 다시 실행). 확정한 사원만 다시 실행한다.
   */
  async execute(user: AuthUser, id: number): Promise<AgentCandidateExecutionResult> {
    const draft = await this.loadDraft(this.prisma, id);
    if (draft.requesterId !== user.employeeId) throw new AppException('COM-002', '후보를 확정한 사원만 실행할 수 있어요');
    this.assertPermission(user, draft);
    if (draft.draftStatus !== DRAFT_STATUS.APPROVED) throw new AppException('COM-004', '이 상태의 후보는 실행할 수 없어요');
    let failure: AppException | null = null;
    try {
      await retryOnNumberConflict(() =>
        this.prisma.$transaction(async (tx) => {
          const target = await this.runHandler(tx, draft, user);
          await this.change(tx, draft, {
            draftStatus: DRAFT_STATUS.EXECUTED,
            executionErrorCode: null,
            executionAttemptCount: { increment: 1 },
            payload: { ...(isRecord(draft.payload) ? draft.payload : {}), result: target } as unknown as Prisma.InputJsonValue,
          });
          await this.businessEventRecorder.record(tx, {
            type: BUSINESS_EVENT_TYPE.DRAFT_EXECUTED,
            actor: user,
            target: { table: 'action_draft', id: draft.id },
            salesOrderId: salesOrderIdOf(draft.payload),
            before: { draftStatus: DRAFT_STATUS.APPROVED },
            after: { draftStatus: DRAFT_STATUS.EXECUTED, resultKind: target?.kind ?? null, resultId: target?.id ?? null, resultNo: target?.no ?? null },
            actionDraftId: draft.id,
          });
        }),
      );
    } catch (e) {
      // 같은 후보를 동시에 실행한 경합(COM-001)은 실행 실패가 아니다
      if (!(e instanceof AppException) || e.code === 'COM-001') throw e;
      failure = e;
      await this.repository.updateIfUnchanged(this.prisma, draft.id, draft.updatedAt, { executionErrorCode: e.code, executionAttemptCount: { increment: 1 } });
    }
    return { draft: await this.requireView(user, id), executed: failure === null, errorCode: failure?.code ?? null, errorMessage: failure?.message ?? null };
  }

  /** 후보 반려 (확정 전만, 사유 필수) → REJECTED. 반려한 뒤에는 같은 대상의 새 후보를 만들 수 있다 */
  async reject(user: AuthUser, id: number, rejectReasonText: string, expectedUpdatedAt?: string | null): Promise<AgentCandidateView> {
    await this.prisma.$transaction(async (tx) => {
      const draft = await this.confirmableDraft(tx, user, id, expectedUpdatedAt);
      const rejectReason = rejectReasonText.trim();
      if (!rejectReason) throw new AppException('COM-004', '반려 사유를 입력해 주세요');
      await this.change(tx, draft, { draftStatus: DRAFT_STATUS.REJECTED, rejectReason });
      await this.businessEventRecorder.record(tx, {
        type: BUSINESS_EVENT_TYPE.DRAFT_REJECTED,
        actor: user,
        target: { table: 'action_draft', id: draft.id },
        salesOrderId: salesOrderIdOf(draft.payload),
        before: { draftStatus: draft.draftStatus },
        after: { draftStatus: DRAFT_STATUS.REJECTED },
        reason: rejectReason,
        actionDraftId: draft.id,
      });
    });
    return this.requireView(user, id);
  }

  // ── 상황 설명 (REQ-AGT-006, API-264) ────────────────────

  /**
   * AI가 조회 근거로 상황만 설명한다. 후보를 정하거나 바꾸지 않고 데이터를 쓰지 않는다.
   * LLM 설정이 없거나 호출이 실패하면 규칙이 만든 요약을 그대로 돌려준다(generatedByAi: false).
   */
  async explain(user: AuthUser, id: number): Promise<AgentExplainView> {
    const view = await this.requireView(user, id);
    const basis = Object.entries(view.evidence).map(([key, value]) => `${key}: ${value ?? '-'}`);
    const fallback = { draftId: id, explanation: view.summary, basis, generatedByAi: false };
    const settings = await this.llmSettings.read();
    if (!settings.model) return fallback;
    try {
      const messages = buildExplainMessages({ riskLabel: AGENT_RISK_TYPE_LABEL[view.riskType], summary: view.summary, basis, today: seoulToday() });
      const reply = await this.llm.chat(settings, settings.model, messages, LLM_PROFILE.AGENT_EXPLAIN);
      return reply ? { draftId: id, explanation: reply, basis, generatedByAi: true } : fallback;
    } catch (e) {
      if (!(e instanceof LlmRequestError)) throw e;
      this.logger.warn(`Agent 상황 설명 LLM 호출에 실패해 규칙 요약을 돌려줘요: ${e.message}`);
      return fallback;
    }
  }

  // ── 내부 ─────────────────────────────────────────────

  private async runHandler(tx: Tx, draft: AgentDraftRow, actor: AuthUser): Promise<ExecutionTarget | null> {
    const p = isRecord(draft.payload) ? draft.payload : {};
    if (draft.actionType === ACTION_TYPE.PURCHASE_REQUISITION_CREATE) {
      const requisition = await this.purchasing.createRequisition(
        tx,
        {
          itemId: numberOrNull(p.itemId) ?? 0,
          requestedTon: textOrNull(p.requestedTon) ?? '',
          desiredReceiptDate: textOrNull(p.desiredReceiptDate) ?? '',
          requestReason: textOrNull(p.requestReason),
          productionPlanId: numberOrNull(p.productionPlanId),
        },
        actor,
        { actionDraftId: draft.id, messageId: null },
      );
      return { kind: 'PURCHASE_REQUISITION', id: requisition.id, no: requisition.purchaseRequisitionNo };
    }
    if (draft.actionType === ACTION_TYPE.REPRODUCTION_PLAN_CREATE) {
      const result = await this.production.createReproductionPlanInTx(tx, actor, numberOrNull(p.salesOrderItemId) ?? 0);
      // 여재 예약만으로 채워지면 새 계획이 없다
      return result.plan ? { kind: 'PRODUCTION_PLAN', id: result.plan.id, no: result.plan.productionPlanNo } : null;
    }
    // 배정 추천은 추천만 한다: 실행은 기존 배정·예약 화면에서 하고, 확정은 추천을 확인했다는 기록이다 (docs/backend/factory-agent.md)
    if (draft.actionType === ACTION_TYPE.ALLOCATION_CONFIRM) return null;
    throw new AppException('COM-004', '준비 중인 업무 유형이에요');
  }

  /** 승인 전 위험이 해소됐는지 다시 본다 (BP-AGT-01 구현 제안). 해소됐으면 이유를, 아직 남았으면 null */
  private async staleReason(draft: AgentDraftRow): Promise<string | null> {
    const p = isRecord(draft.payload) ? draft.payload : {};
    if (draft.actionType === ACTION_TYPE.PURCHASE_REQUISITION_CREATE) {
      const today = seoulToday();
      const view = await this.mrp.requirements({ from: today, to: addDays(today, RAW_SHORTAGE_HORIZON_DAYS) });
      const stillShort = view.requisitionLines.some(
        (l) => l.productionPlanId === numberOrNull(p.productionPlanId) && l.itemId === numberOrNull(p.itemId) && Number(l.netRequirementTon) > 0 && l.existingPurchaseRequisitionNo === null,
      );
      return stillShort ? null : '원료 부족이 해소됐거나 이미 구매요청이 있어 실행하지 않아요';
    }
    if (draft.actionType === ACTION_TYPE.REPRODUCTION_PLAN_CREATE) {
      const check = await this.production.reproductionCheck(this.prisma, numberOrNull(p.salesOrderItemId) ?? 0);
      return check && goodQtyShortageCandidate(check, seoulToday()) ? null : '합격 매수 부족이 해소돼 실행하지 않아요';
    }
    if (draft.actionType === ACTION_TYPE.ALLOCATION_CONFIRM) {
      const itemId = numberOrNull(p.itemId);
      const stillAged = (await this.agedSurplusCandidates(seoulToday())).some((c) => c.itemId === itemId);
      return stillAged ? null : '오래된 여재가 없어졌거나 대기 수주가 없어 추천을 닫아요';
    }
    return null;
  }

  private async closeAsStale(user: AuthUser, draft: AgentDraftRow, reason: string): Promise<AgentCandidateExecutionResult> {
    await this.prisma.$transaction(async (tx) => {
      await this.change(tx, draft, { draftStatus: DRAFT_STATUS.REJECTED, rejectReason: `[자동] ${reason}` });
      await this.businessEventRecorder.record(tx, {
        type: BUSINESS_EVENT_TYPE.DRAFT_REJECTED,
        actor: user,
        target: { table: 'action_draft', id: draft.id },
        salesOrderId: salesOrderIdOf(draft.payload),
        before: { draftStatus: draft.draftStatus },
        after: { draftStatus: DRAFT_STATUS.REJECTED },
        reason: `[자동] ${reason}`,
        actionDraftId: draft.id,
      });
    });
    return { draft: await this.requireView(user, draft.id), executed: false, errorCode: 'COM-001', errorMessage: reason };
  }

  /** 읽은 뒤 아무도 고치지 않았을 때만 바꾼다 (동시 요청이 앞 요청을 덮어쓰지 않게) */
  private async change(tx: Tx, draft: AgentDraftRow, data: Prisma.ActionDraftUncheckedUpdateManyInput): Promise<void> {
    if (!(await this.repository.updateIfUnchanged(tx, draft.id, draft.updatedAt, data))) throw new AppException('COM-001', '그 사이 다른 곳에서 후보를 고쳤어요. 새로 불러와 주세요');
  }

  private async loadDraft(tx: Tx, id: number): Promise<AgentDraftRow> {
    const draft = await this.repository.findDraft(tx, id);
    if (!draft || !agentMetaOf(draft.payload)) throw new AppException('COM-003', '대응 후보를 찾을 수 없어요');
    return draft;
  }

  /** 확정·반려할 수 있는 후보: 후보 업무의 사용 권한이 있고 확정 전 상태 */
  private async confirmableDraft(tx: Tx, user: AuthUser, id: number, expectedUpdatedAt?: string | null): Promise<AgentDraftRow> {
    const draft = await this.loadDraft(tx, id);
    this.assertPermission(user, draft);
    if (expectedUpdatedAt && new Date(expectedUpdatedAt).getTime() !== draft.updatedAt.getTime()) throw new AppException('COM-001', '그 사이 다른 곳에서 후보를 고쳤어요. 새로 불러와 주세요');
    if (!CONFIRMABLE_STATUSES.includes(draft.draftStatus)) throw new AppException('COM-004', '이 상태의 후보는 바꿀 수 없어요');
    return draft;
  }

  private permissionOf(draft: AgentDraftRow): Permission | undefined {
    return CONFIRM_PERMISSION[draft.actionType as ActionType];
  }

  private assertPermission(user: AuthUser, draft: AgentDraftRow): void {
    const permission = this.permissionOf(draft);
    if (!permission || !hasPermission(user, { permission, level: 'USE' })) throw new AppException('COM-002', '이 후보가 만드는 업무의 권한이 있는 부서원만 확정할 수 있어요');
  }

  private canView(user: AuthUser, draft: AgentDraftRow): boolean {
    const permission = this.permissionOf(draft);
    return permission !== undefined && hasPermission(user, { permission, level: 'VIEW' });
  }

  private assertView(user: AuthUser, draft: AgentDraftRow): void {
    if (!this.canView(user, draft)) throw new AppException('COM-002', '이 후보가 만드는 업무의 권한이 있는 부서원만 볼 수 있어요');
  }

  private metaOf(draft: AgentDraftRow): AgentDraftMeta {
    const meta = agentMetaOf(draft.payload);
    if (!meta) throw new AppException('COM-003', '대응 후보를 찾을 수 없어요');
    return meta;
  }

  private async requireView(user: AuthUser, id: number): Promise<AgentCandidateView> {
    const view = await this.findCandidate(user, id);
    if (!view) throw new AppException('COM-003', '대응 후보를 찾을 수 없어요');
    return view;
  }

  private toView(row: AgentDraftRow): AgentCandidateView | null {
    const meta = agentMetaOf(row.payload);
    if (!meta) return null;
    const { agent: _agent, result: _result, ...fields } = isRecord(row.payload) ? row.payload : {};
    const saved = isRecord(row.payload) && isRecord(row.payload.result) ? row.payload.result : null;
    const result: ExecutionTarget | null = row.purchaseRequisition
      ? { kind: 'PURCHASE_REQUISITION', id: row.purchaseRequisition.id, no: row.purchaseRequisition.purchaseRequisitionNo }
      : saved && typeof saved.id === 'number' && typeof saved.no === 'string' && saved.kind === 'PRODUCTION_PLAN'
        ? { kind: 'PRODUCTION_PLAN', id: saved.id, no: saved.no }
        : null;
    return {
      id: row.id,
      actionType: row.actionType as ActionType,
      draftStatus: row.draftStatus as DraftStatus,
      riskType: meta.riskType,
      summary: meta.summary,
      evidence: meta.evidence,
      payload: fields,
      confirmerId: row.requesterId,
      confirmerName: row.requester?.employeeName ?? null,
      result,
      executionErrorCode: row.executionErrorCode,
      executionAttemptCount: row.executionAttemptCount,
      rejectReason: row.rejectReason,
      confirmedAt: row.confirmedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const run = this.queue.then(work, work);
    this.queue = run.catch(() => undefined);
    return run;
  }
}

function salesOrderIdOf(payload: unknown): number | null {
  return isRecord(payload) ? numberOrNull(payload.salesOrderId) : null;
}
