import { Injectable } from '@nestjs/common';
import {
  ERROR_CODE, EVENT_REASON_CODE, NOTIFICATION_TYPE, PERMISSION, PURCHASE_REQUISITION_STATUS, REQUISITION_SOURCE_TYPE, ROLE_CODE,
  type AuthUser, type RequisitionSourceType,
} from '@fantasteel/shared';
import { Prisma } from '../../generated/prisma/client';
import { lockRow } from '../../common/concurrency/locks';
import { AppException, badInput, forbidden, invalidState, notFound } from '../../common/errors/app.exception';
import { NumberingService } from '../../common/numbering/numbering.service';
import { RealtimeService } from '../../common/realtime/realtime.service';
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import { BusinessEventRecorder } from '../business-event/business-event.recorder';
import { NotificationSender } from '../notification/notification.sender';
import { ApproverPolicy } from './approver.policy';
import type { CreatePurchaseRequisitionDto, ListPurchaseRequisitionsDto, PurchaseRequisitionItemDto, UpdatePurchaseRequisitionDto } from './dto/purchase-requisition.dto';
import {
  PurchaseRequisitionRepository, type PurchaseRequisitionDetailRow, type PurchaseRequisitionListRow, type RequisitionItemInput,
} from './purchase-requisition.repository';
import { itemsSummary, parsePositiveTon, rawMaterialView, toDateOnly, todayKst, ZERO } from './purchasing.util';

const S = PURCHASE_REQUISITION_STATUS;
const EDITABLE: string[] = [S.DRAFT, S.REJECTED];

export interface SubmitContext {
  /** Message → ERP로 만들어진 구매요청이면 원본을 작업 로그에 잇는다 */
  messageId?: number | null;
  actionDraftId?: number | null;
}

@Injectable()
export class PurchaseRequisitionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: PurchaseRequisitionRepository,
    private readonly approvers: ApproverPolicy,
    private readonly numbering: NumberingService,
    private readonly events: BusinessEventRecorder,
    private readonly notifications: NotificationSender,
    private readonly realtime: RealtimeService,
  ) {}

  // ───────────────────────────── 조회 ─────────────────────────────

  async list(q: ListPurchaseRequisitionsDto, user: AuthUser) {
    const where: Prisma.PurchaseRequisitionWhereInput = {};
    if (q.status) where.purchaseRequisitionStatus = q.status;
    if (q.mine) where.requesterId = user.employeeId;
    if (q.toApprove) {
      where.approverId = user.employeeId;
      where.purchaseRequisitionStatus = S.WAITING_APPROVAL;
    }
    return (await this.repo.findMany(this.prisma, where)).map(toListView);
  }

  /** 요청자·승인권자는 역할 권한이 없어도 자기 건을 볼 수 있다 (다른 역할의 부서장이 승인권자일 수 있다). */
  async detail(id: number, user: AuthUser) {
    const row = await this.repo.findDetail(this.prisma, id);
    if (!row) throw notFound('구매요청');
    const canView = !!user.permissions[PERMISSION.PURCHASE_REQUISITION_CREATE] || !!user.permissions[PERMISSION.PO_CONFIRM];
    if (!canView && row.requesterId !== user.employeeId && row.approverId !== user.employeeId) throw forbidden();
    return toDetailView(row);
  }

  /** 내가 승인할 것. 부서장이 아니면 빈 목록이다. */
  async approvals(user: AuthUser) {
    const rows = await this.repo.findMany(this.prisma, { approverId: user.employeeId, purchaseRequisitionStatus: S.WAITING_APPROVAL });
    return { purchaseRequisitions: rows.map(toListView), counts: { purchaseRequisition: rows.length, total: rows.length } };
  }

  // ───────────────────────────── 등록·수정 ─────────────────────────────

  async create(dto: CreatePurchaseRequisitionDto, user: AuthUser) {
    const id = await this.prisma.tx(async (tx) => {
      const row = await this.createInTx(tx, {
        requester: user, items: dto.items, desiredReceiptDate: dto.desiredReceiptDate, requestReason: dto.requestReason ?? null,
        sourceType: dto.sourceType ?? REQUISITION_SOURCE_TYPE.DIRECT, sourceDraftId: null,
      });
      if (dto.submit) await this.submitInTx(tx, row.id, user);
      this.realtime.changed('purchase-requisitions');
      return row.id;
    });
    return this.detail(id, user);
  }

  async update(id: number, dto: UpdatePurchaseRequisitionDto, user: AuthUser) {
    await this.prisma.tx(async (tx) => {
      await lockRow(tx, 'purchase_requisition', id);
      const row = await this.repo.findWithItems(tx, id);
      if (!row) throw notFound('구매요청');
      if (row.requesterId !== user.employeeId) throw forbidden('요청자만 수정할 수 있습니다');
      if (!EDITABLE.includes(row.purchaseRequisitionStatus)) throw invalidState('작성 중이거나 반려된 구매요청만 수정할 수 있습니다');
      if (dto.items) await this.repo.replaceItems(tx, id, await this.checkItems(tx, dto.items));
      const data: Prisma.PurchaseRequisitionUncheckedUpdateInput = {};
      if (dto.desiredReceiptDate !== undefined) data.desiredReceiptDate = this.checkDesiredReceiptDate(dto.desiredReceiptDate);
      if (dto.requestReason !== undefined) data.requestReason = dto.requestReason.trim() || null;
      await this.repo.update(tx, id, data);
      this.realtime.changed('purchase-requisitions');
    });
    return this.detail(id, user);
  }

  /** 구매요청을 작성 중(DRAFT)으로 만든다. 제출은 submitInTx로 따로 한다. */
  async createInTx(
    tx: Tx,
    input: {
      requester: AuthUser; items: PurchaseRequisitionItemDto[]; desiredReceiptDate: string; requestReason: string | null;
      sourceType: RequisitionSourceType; sourceDraftId: number | null;
    },
  ) {
    const items = await this.checkItems(tx, input.items);
    return this.repo.create(tx, {
      purchaseRequisitionNo: await this.numbering.documentNo(tx, 'PR'),
      requesterId: input.requester.employeeId,
      departmentId: input.requester.departmentId,
      desiredReceiptDate: this.checkDesiredReceiptDate(input.desiredReceiptDate),
      requestReason: input.requestReason?.trim() || null,
      sourceType: input.sourceType,
      sourceDraftId: input.sourceDraftId,
      items,
    });
  }

  private async checkItems(tx: Tx, items: PurchaseRequisitionItemDto[]): Promise<RequisitionItemInput[]> {
    const ids = items.map((it) => it.rawMaterialId);
    if (new Set(ids).size !== ids.length) throw badInput('같은 원료가 두 번 들어 있습니다. 한 줄로 합쳐 주세요');
    const found = new Map((await this.repo.findRawMaterials(tx, ids)).map((rm) => [rm.id, rm]));
    return items.map((it) => {
      const rm = found.get(it.rawMaterialId);
      if (!rm) throw notFound('원료');
      if (!rm.item.isActive) throw badInput(`${rm.item.itemName}은(는) 사용 중지된 원료입니다`);
      return { rawMaterialId: it.rawMaterialId, requiredTon: parsePositiveTon(it.requiredTon, '필요 수량(톤)') };
    });
  }

  private checkDesiredReceiptDate(value: string): Date {
    const date = toDateOnly(value, '희망 입고일');
    if (value < todayKst()) throw badInput('희망 입고일은 오늘 이후로 입력해 주세요');
    return date;
  }

  // ───────────────────────────── 제출·승인·반려 ─────────────────────────────

  async submit(id: number, user: AuthUser) {
    await this.prisma.tx(async (tx) => {
      await this.submitInTx(tx, id, user);
    });
    return this.detail(id, user);
  }

  /**
   * 제출: 승인권자를 찾아 승인 대기로 넘긴다 (REQ-PUR-002). 화면 제출과 Message → ERP 실행 핸들러가 같은 함수를 쓴다.
   * 승인권자를 찾지 못하면 PUR-001. 자동 승인은 없다.
   */
  async submitInTx(tx: Tx, id: number, actor: AuthUser, context: SubmitContext = {}): Promise<void> {
    await lockRow(tx, 'purchase_requisition', id);
    const row = await this.repo.findWithItems(tx, id);
    if (!row) throw notFound('구매요청');
    if (row.requesterId !== actor.employeeId) throw forbidden('요청자만 제출할 수 있습니다');
    if (!EDITABLE.includes(row.purchaseRequisitionStatus)) throw invalidState('작성 중이거나 반려된 구매요청만 제출할 수 있습니다');
    if (!row.items.length) throw badInput('원료 품목을 1개 이상 입력해 주세요');
    if (!row.desiredReceiptDate) throw badInput('희망 입고일을 입력해 주세요');

    const approver = await this.approvers.resolveApprover(tx, row.requesterId);
    if (!approver) throw new AppException(ERROR_CODE.PUR_001, '승인권자(부서장)가 지정되어 있지 않아 제출할 수 없습니다. 관리자에게 부서장 지정을 요청해 주세요');

    const submittedAt = new Date();
    await this.repo.update(tx, id, {
      purchaseRequisitionStatus: S.WAITING_APPROVAL, approverId: approver.approverId, departmentId: approver.departmentId,
      submittedAt, rejectReason: null, rejectedAt: null,
    });
    const approverRow = await tx.employee.findUniqueOrThrow({ where: { id: approver.approverId }, select: { employeeName: true } });
    const summary = itemsSummary(row.items.map((it) => ({ rawMaterial: it.rawMaterial, ton: it.requiredTon })));
    await this.events.record(tx, {
      actor,
      eventType: 'PURCHASE_REQUISITION_CONFIRMED',
      targetType: 'PURCHASE_REQUISITION',
      targetId: row.id,
      targetNo: row.purchaseRequisitionNo,
      summary: `구매요청 ${row.purchaseRequisitionNo} 제출 (${summary}) · 승인권자 ${approverRow.employeeName}`,
      before: { purchaseRequisitionStatus: row.purchaseRequisitionStatus },
      after: { purchaseRequisitionStatus: S.WAITING_APPROVAL, approverId: approver.approverId, departmentId: approver.departmentId, sourceType: row.sourceType },
      reasonCode: context.actionDraftId ? EVENT_REASON_CODE.DRAFT_CONFIRMED : null,
      messageId: context.messageId ?? null,
      actionDraftId: context.actionDraftId ?? null,
    });
    await this.notifications.toEmployees(tx, [approver.approverId], {
      notificationType: NOTIFICATION_TYPE.APPROVAL_REQUEST,
      title: `구매요청 ${row.purchaseRequisitionNo} 승인 요청`,
      body: `${actor.employeeName} · ${summary}`,
      linkPath: `/purchase-requisitions/${row.id}`,
      // 반려 뒤 다시 제출하면 새 알림이 가야 한다
      dedupeKey: `PR_APPROVAL_REQUEST:${row.id}:${submittedAt.getTime()}`,
    });
    this.realtime.changed('purchase-requisitions');
  }

  /** 승인: 지정된 승인권자만. 역할이 아니라 구매요청에 기록된 승인권자와 로그인 사원을 비교한다 (REQ-AUTH-004). */
  async approve(id: number, user: AuthUser) {
    await this.prisma.tx(async (tx) => {
      const row = await this.lockForDecision(tx, id, user);
      const approvedAt = new Date();
      await this.repo.update(tx, id, { purchaseRequisitionStatus: S.APPROVED, approvedAt });
      const summary = itemsSummary(row.items.map((it) => ({ rawMaterial: it.rawMaterial, ton: it.requiredTon })));
      await this.events.record(tx, {
        actor: user,
        eventType: 'PURCHASE_REQUISITION_APPROVED',
        targetType: 'PURCHASE_REQUISITION',
        targetId: row.id,
        targetNo: row.purchaseRequisitionNo,
        summary: `구매요청 ${row.purchaseRequisitionNo} 부서장 승인 (${summary})`,
        before: { purchaseRequisitionStatus: S.WAITING_APPROVAL },
        after: { purchaseRequisitionStatus: S.APPROVED, approverId: user.employeeId },
        actionDraftId: row.sourceDraftId,
      });
      await this.notifications.toEmployees(tx, [row.requesterId], {
        notificationType: NOTIFICATION_TYPE.APPROVAL_RESULT,
        title: `구매요청 ${row.purchaseRequisitionNo} 승인`,
        body: `${user.employeeName} 부서장이 승인했습니다`,
        linkPath: `/purchase-requisitions/${row.id}`,
        dedupeKey: `PR_APPROVED:${row.id}:${approvedAt.getTime()}`,
      });
      await this.notifications.toRole(tx, ROLE_CODE.PURCHASE, {
        notificationType: NOTIFICATION_TYPE.PURCHASE,
        title: `구매요청 ${row.purchaseRequisitionNo} 승인 · 발주 필요`,
        body: summary,
        linkPath: '/purchase-orders',
        dedupeKey: `PR_ORDER_NEEDED:${row.id}`,
        excludeEmployeeId: user.employeeId,
      });
      this.realtime.changed('purchase-requisitions', 'purchase-orders');
    });
    return this.detail(id, user);
  }

  /** 반려: 사유 필수. 요청자가 고쳐서 다시 제출할 수 있다. */
  async reject(id: number, rejectReason: string, user: AuthUser) {
    if (!rejectReason.trim()) throw badInput('반려 사유를 입력해 주세요');
    await this.prisma.tx(async (tx) => {
      const row = await this.lockForDecision(tx, id, user);
      const rejectedAt = new Date();
      await this.repo.update(tx, id, { purchaseRequisitionStatus: S.REJECTED, rejectReason, rejectedAt });
      await this.events.record(tx, {
        actor: user,
        eventType: 'PURCHASE_REQUISITION_REJECTED',
        targetType: 'PURCHASE_REQUISITION',
        targetId: row.id,
        targetNo: row.purchaseRequisitionNo,
        summary: `구매요청 ${row.purchaseRequisitionNo} 반려`,
        before: { purchaseRequisitionStatus: S.WAITING_APPROVAL },
        after: { purchaseRequisitionStatus: S.REJECTED },
        reason: rejectReason,
        actionDraftId: row.sourceDraftId,
      });
      await this.notifications.toEmployees(tx, [row.requesterId], {
        notificationType: NOTIFICATION_TYPE.APPROVAL_RESULT,
        title: `구매요청 ${row.purchaseRequisitionNo} 반려`,
        body: `${user.employeeName} 부서장: ${rejectReason}`,
        linkPath: `/purchase-requisitions/${row.id}`,
        dedupeKey: `PR_REJECTED:${row.id}:${rejectedAt.getTime()}`,
      });
      this.realtime.changed('purchase-requisitions');
    });
    return this.detail(id, user);
  }

  private async lockForDecision(tx: Tx, id: number, user: AuthUser): Promise<PurchaseRequisitionListRow> {
    await lockRow(tx, 'purchase_requisition', id);
    const row = await this.repo.findWithItems(tx, id);
    if (!row) throw notFound('구매요청');
    if (row.requesterId === user.employeeId) throw forbidden('자기가 요청한 구매요청은 승인·반려할 수 없습니다');
    if (row.approverId !== user.employeeId) throw forbidden('이 구매요청의 승인권자(부서장)만 승인·반려할 수 있습니다');
    if (row.purchaseRequisitionStatus !== S.WAITING_APPROVAL) throw invalidState('승인 대기 상태의 구매요청만 승인·반려할 수 있습니다');
    return row;
  }
}

function toListView(row: PurchaseRequisitionListRow) {
  const { items, ...head } = row;
  return {
    ...head,
    totalRequiredTon: items.reduce((sum, it) => sum.add(it.requiredTon), ZERO),
    items: items.map((it) => ({
      id: it.id,
      lineNo: it.lineNo,
      rawMaterial: rawMaterialView(it.rawMaterial),
      requiredTon: it.requiredTon,
      orderedTon: it.orderedTon,
      unorderedTon: Prisma.Decimal.max(ZERO, it.requiredTon.sub(it.orderedTon)),
    })),
  };
}

function toDetailView(row: PurchaseRequisitionDetailRow) {
  const { items, sourceDraft, ...head } = row;
  return {
    ...head,
    totalRequiredTon: items.reduce((sum, it) => sum.add(it.requiredTon), ZERO),
    items: items.map((it) => ({
      id: it.id,
      lineNo: it.lineNo,
      rawMaterial: rawMaterialView(it.rawMaterial),
      requiredTon: it.requiredTon,
      orderedTon: it.orderedTon,
      unorderedTon: Prisma.Decimal.max(ZERO, it.requiredTon.sub(it.orderedTon)),
      purchaseOrderItems: it.purchaseOrderItems.map((poi) => ({
        id: poi.id,
        purchaseOrderId: poi.purchaseOrder.id,
        purchaseOrderNo: poi.purchaseOrder.purchaseOrderNo,
        purchaseOrderStatus: poi.purchaseOrder.purchaseOrderStatus,
        supplier: poi.purchaseOrder.supplier,
        dueDate: poi.purchaseOrder.dueDate,
        orderedTon: poi.orderedTon,
        receivedTon: poi.receivedTon,
      })),
    })),
    sourceDraft,
  };
}
