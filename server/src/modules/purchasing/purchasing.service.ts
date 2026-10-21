import { Injectable } from '@nestjs/common';
import {
  BUSINESS_EVENT_TYPE,
  ITEM_TYPE,
  LOT_STATUS,
  NOTIFICATION_TYPE,
  PERMISSION,
  PURCHASE_ORDER_STATUS,
  PURCHASE_REQUISITION_STATUS,
  type AuthUser,
  type BusinessEventType,
  type GoodsReceiptView,
  type LotStatus,
  type PageResult,
  type PurchaseOrderStatus,
  type PurchaseOrderStatusChange,
  type PurchaseOrderView,
  type PurchaseRequisitionDetail,
  type PurchaseRequisitionStatus,
  type PurchaseRequisitionSummary,
} from '@fantasteel/shared';
import { hasPermission } from '../../common/auth/auth.guard';
import { assertDepartmentHead } from '../../common/auth/department-head';
import { BusinessEventRecorder } from '../../common/business-event/business-event.recorder';
import { AppException } from '../../common/errors/app.exception';
import { NumberingService } from '../../common/numbering/numbering.service';
import { seoulToday } from '../../common/time/seoul-date';
import { Prisma, type PurchaseRequisition } from '../../generated/prisma/client';
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import type { CancelGoodsReceiptDto, CreateGoodsReceiptDto, ListGoodsReceiptsQuery } from './dto/goods-receipt.dto';
import type { CreatePurchaseOrderDto, ListPurchaseOrdersQuery, PurchaseOrderReasonDto } from './dto/purchase-order.dto';
import type { CreatePurchaseRequisitionDto, ListPurchaseRequisitionsQuery, RejectPurchaseRequisitionDto, ResubmitPurchaseRequisitionDto } from './dto/purchase-requisition.dto';
import { PurchasingRepository, type PurchaseOrderFilter, type RequisitionFilter, type RequisitionStatusChange } from './purchasing.repository';

type RequisitionRow = NonNullable<Awaited<ReturnType<PurchasingRepository['findRequisition']>>>;
type RequisitionChangeRow = NonNullable<Awaited<ReturnType<PurchasingRepository['findRequisitionForChange']>>>;
type PurchaseOrderRow = NonNullable<Awaited<ReturnType<PurchasingRepository['findPurchaseOrder']>>>;
type GoodsReceiptRow = Awaited<ReturnType<PurchasingRepository['findGoodsReceipt']>>;

/** 구매요청 등록 값. REST(DTO)와 Message → ERP 초안 payload가 같은 모양으로 들어온다 */
export interface CreateRequisitionInput {
  itemId: number;
  requestedTon: string;
  desiredReceiptDate: string;
  requestReason?: string | null;
  productionPlanId?: number | null;
}

/** Message → ERP 초안에서 만들 때 연결할 원본 */
export interface RequisitionOrigin {
  actionDraftId: number;
  messageId: number | null;
  /** AI가 채운 초안에서 만들었으면 작업 로그를 AI 경유로 (REQ-AST-010) */
  isAiAssisted?: boolean;
}

const DEFAULT_PAGE_SIZE = 20;
/** decimal(12,3): 정수 9자리·소수 3자리 (Message → ERP 초안도 같은 규칙) */
export const TON_PATTERN = /^\d{1,9}(\.\d{1,3})?$/;

const dateOnly = (d: Date) => d.toISOString().slice(0, 10);
const isRejected = (row: { purchaseRequisitionStatus: string }) => row.purchaseRequisitionStatus === PURCHASE_REQUISITION_STATUS.REJECTED;
export const isValidDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00.000Z`)) && dateOnly(new Date(`${s}T00:00:00.000Z`)) === s;

/** 등록·재요청이 함께 쓰는 값 검사. Message → ERP 초안 payload는 DTO를 거치지 않아 여기서 본다 */
function parseRequestValues(input: { requestedTon: string; desiredReceiptDate: string }): { requestedTon: Prisma.Decimal; desiredReceiptDate: Date } {
  return { requestedTon: parseTon(input.requestedTon, '수량(톤)'), desiredReceiptDate: parseDate(input.desiredReceiptDate, '희망 입고일') };
}

/** 톤: decimal(12,3) 범위의 0보다 큰 값 */
function parseTon(value: string, label: string): Prisma.Decimal {
  if (!TON_PATTERN.test(value)) throw new AppException('COM-004', `${label}은 정수 9자리·소수 3자리 이하의 숫자로 입력해 주세요`);
  const ton = new Prisma.Decimal(value);
  if (ton.lte(0)) throw new AppException('COM-004', `${label}은 0보다 커야 해요`);
  return ton;
}

function parseDate(value: string, label: string): Date {
  if (!isValidDate(value)) throw new AppException('COM-004', `${label} ${value}는 없는 날짜예요`);
  return new Date(`${value}T00:00:00.000Z`);
}

/** 작업 로그 before·after에 남기는 구매요청 값 */
function snapshotOf(row: PurchaseRequisition) {
  return {
    purchaseRequisitionNo: row.purchaseRequisitionNo,
    purchaseRequisitionStatus: row.purchaseRequisitionStatus,
    itemId: row.itemId,
    requestedTon: row.requestedTon.toFixed(3),
    desiredReceiptDate: dateOnly(row.desiredReceiptDate),
    requestReason: row.requestReason,
    requesterId: row.requesterId,
    approverId: row.approverId,
    rejectReason: row.rejectReason,
    productionPlanId: row.productionPlanId,
  };
}

/** 이미 처리된 요청에 다시 승인·반려·재요청할 때 (수주 "이미 취소된 수주"와 같은 COM-001) */
const ALREADY_DONE: Record<PurchaseRequisitionStatus, string> = {
  WAITING_APPROVAL: '이미 승인 대기 중인 요청이에요',
  APPROVED: '이미 승인된 요청이에요',
  REJECTED: '이미 반려된 요청이에요',
  ORDERED: '이미 발주된 요청이에요',
  ORDER_CANCELLED: '발주가 취소된 요청이에요. 같은 원료가 필요하면 새로 구매요청해 주세요',
};

/** 더는 입고하지 않는 발주 (BP-PUR-02 반대 거래) */
const ENDED_PURCHASE_ORDER: Partial<Record<PurchaseOrderStatus, string>> = {
  CANCELLED: '이미 취소된 발주예요',
  CLOSED: '이미 잔량 마감한 발주예요',
};

/** 이미 취소·마감한 발주에 다시 취소·마감할 때 (구매요청 ALREADY_DONE과 같은 COM-001) */
function assertNotEnded(status: PurchaseOrderStatus): void {
  const ended = ENDED_PURCHASE_ORDER[status];
  if (ended) throw new AppException('COM-001', ended);
}

/** 발주 취소·잔량 마감·입고 취소 사유는 필수 (작업 로그 reason) */
function requireReason(value: string): string {
  const reason = value.trim();
  if (!reason) throw new AppException('COM-004', '사유를 입력해 주세요');
  return reason;
}

const sumTon = (tons: { receivedTon: Prisma.Decimal }[]) => tons.reduce((sum, r) => sum.plus(r.receivedTon), new Prisma.Decimal(0));

/**
 * 입고 누계(입고 취소 행까지 더한 값)로 정한 발주 상태: 모든 품목을 다 받았으면 입고 완료, 하나라도 받았으면 부분 입고, 하나도 없으면 발주 확정.
 * 입고 확정과 입고 취소가 함께 쓴다
 */
export function receiptStatusOf(lines: { orderedTon: Prisma.Decimal; receivedTon: Prisma.Decimal }[]): PurchaseOrderStatus {
  if (lines.every((l) => l.receivedTon.gte(l.orderedTon))) return PURCHASE_ORDER_STATUS.RECEIVED;
  if (lines.some((l) => l.receivedTon.gt(0))) return PURCHASE_ORDER_STATUS.PARTIALLY_RECEIVED;
  return PURCHASE_ORDER_STATUS.CONFIRMED;
}

/**
 * 동시에 같은 행을 만들어 unique 위반(P2002)이 나면 트랜잭션 전체를 다시 해서 앞 거래가 커밋한 결과를 보고 판단하게 한다
 * (Message → ERP 초안 실행도 쓴다). 번호(구매요청·작업 로그)는 NumberingService가 앞부분을 잠가 겹치지 않는다.
 */
const NUMBER_CONFLICT_ATTEMPTS = 3;
export async function retryOnNumberConflict<T>(work: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await work();
    } catch (e) {
      const conflict = e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
      if (!conflict || attempt >= NUMBER_CONFLICT_ATTEMPTS) throw e;
    }
  }
}

/**
 * 구매요청 등록·조회 (REQ-PUR-001·002, BP-PUR-01, docs/backend/purchasing.md).
 * createRequisition은 message-action이 초안 실행 트랜잭션 안에서 부른다 (BP-ACT-01).
 * 트랜잭션 안에서는 관계를 여러 개 읽지 않는다: Prisma가 한 연결에 쿼리를 겹쳐 보내 pg 경고가 난다. 응답 모양은 커밋 뒤에 읽는다.
 */
@Injectable()
export class PurchasingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: PurchasingRepository,
    private readonly numbering: NumberingService,
    private readonly businessEventRecorder: BusinessEventRecorder,
    private readonly notifications: NotificationService,
  ) {}

  // ── 조회 ──────────────────────────────────────────────

  /**
   * 권한(VIEW)이 있으면 전체, 없으면 부서장만 자기 부서원의 요청을 본다.
   * approvable이면 승인함: 권한과 상관없이 내가 승인할 요청(내 부서원의 승인 대기, 내 요청 제외)만 준다.
   */
  async listRequisitions(user: AuthUser, query: ListPurchaseRequisitionsQuery): Promise<PageResult<PurchaseRequisitionSummary>> {
    const filter: RequisitionFilter = { purchaseRequisitionStatus: query.purchaseRequisitionStatus };
    if (query.approvable) {
      if (user.headDepartmentIds.length === 0) throw new AppException('COM-002');
      filter.purchaseRequisitionStatus = PURCHASE_REQUISITION_STATUS.WAITING_APPROVAL;
      filter.requesterDepartmentIds = user.headDepartmentIds;
      filter.excludeRequesterId = user.employeeId;
    } else if (!this.canViewAll(user)) {
      if (user.headDepartmentIds.length === 0) throw new AppException('COM-002');
      filter.requesterDepartmentIds = user.headDepartmentIds;
    }
    const page = query.page ?? 1;
    const size = query.size ?? DEFAULT_PAGE_SIZE;
    const [total, rows] = await Promise.all([this.repository.countRequisitions(this.prisma, filter), this.repository.findRequisitions(this.prisma, filter, { skip: (page - 1) * size, take: size })]);
    const rejected = await this.latestEvents(this.prisma, BUSINESS_EVENT_TYPE.PURCHASE_REQUISITION_REJECTED, 'purchase_requisition', rows.filter(isRejected).map((r) => r.id));
    return { items: rows.map((row) => this.toSummary(row, rejected.get(row.id)?.at ?? null)), page, size, total };
  }

  /** 권한(VIEW)이 있거나 그 요청의 승인권자(요청자 소속 부서의 부서장)만 본다 */
  async requisitionDetail(user: AuthUser, id: number): Promise<PurchaseRequisitionDetail> {
    const row = await this.mustFindRequisition(this.prisma, id);
    if (!this.canViewAll(user) && !user.headDepartmentIds.includes(row.requester.departmentId)) throw new AppException('COM-002');
    return this.detailOf(this.prisma, row);
  }

  // ── 등록 (REQ-PUR-001) ────────────────────────────────

  async create(user: AuthUser, dto: CreatePurchaseRequisitionDto): Promise<PurchaseRequisitionDetail> {
    const created = await retryOnNumberConflict(() => this.prisma.$transaction((tx) => this.createRequisition(tx, dto, user)));
    return this.requisitionView(created.id);
  }

  /**
   * 구매요청 1건(원료 1품목) 저장 → 바로 요청자 소속 부서장의 승인 대기(WAITING_APPROVAL, 임시 저장 없음) → 작업 로그.
   * 요청자·부서는 actor에서 가져온다. 부서장이 없거나 요청자가 그 부서장이면 승인할 사람이 없으므로 PUR-001.
   * 저장한 행(관계 없음)을 돌려준다. 화면 응답은 커밋 뒤에 읽는다.
   */
  async createRequisition(tx: Tx, input: CreateRequisitionInput, actor: AuthUser, origin?: RequisitionOrigin): Promise<PurchaseRequisition> {
    const { requestedTon, desiredReceiptDate } = parseRequestValues(input);
    const item = await this.repository.findItem(tx, input.itemId);
    if (!item) throw new AppException('COM-003', '원료 품목을 찾을 수 없어요');
    if (item.itemType !== ITEM_TYPE.RAW_MATERIAL) throw new AppException('COM-004', '원료 품목만 구매요청할 수 있어요');

    const headId = await this.requireApproverId(tx, actor.departmentId, actor.employeeId);

    const productionPlanId = input.productionPlanId ?? null;
    let salesOrderId: number | null = null;
    if (productionPlanId !== null) {
      const plan = await this.repository.findProductionPlan(tx, productionPlanId);
      if (!plan) throw new AppException('COM-003', '생산계획을 찾을 수 없어요');
      salesOrderId = plan.salesOrderItem?.salesOrderId ?? null;
      await this.assertNoOpenRequisitionForPlan(tx, productionPlanId, item.id);
    }

    const row = await this.repository.createRequisition(tx, {
      purchaseRequisitionNo: await this.numbering.nextDocumentNumber(tx, 'PURCHASE_REQUISITION'),
      itemId: item.id,
      requestedTon,
      desiredReceiptDate,
      requesterId: actor.employeeId,
      requestReason: input.requestReason?.trim() || null,
      productionPlanId,
      actionDraftId: origin?.actionDraftId ?? null,
    });
    const event = await this.businessEventRecorder.record(tx, {
      type: BUSINESS_EVENT_TYPE.PURCHASE_REQUISITION_CREATED,
      actor,
      target: { table: 'purchase_requisition', id: row.id },
      salesOrderId,
      after: snapshotOf(row),
      reason: row.requestReason,
      actionDraftId: origin?.actionDraftId ?? null,
      messageId: origin?.messageId ?? null,
      isAiAssisted: origin?.isAiAssisted,
    });
    await this.notifyApprovalRequested(tx, headId, row, actor, event.id);
    return row;
  }

  // ── 승인·반려·재요청 (REQ-PUR-002, REQ-AUTH-004) ────────

  async approve(user: AuthUser, id: number): Promise<PurchaseRequisitionDetail> {
    await retryOnNumberConflict(() =>
      this.prisma.$transaction(async (tx) => {
        const before = await this.mustFindForDecision(tx, user, id);
        await this.changeStatus(tx, before, PURCHASE_REQUISITION_STATUS.WAITING_APPROVAL, { purchaseRequisitionStatus: PURCHASE_REQUISITION_STATUS.APPROVED, approverId: user.employeeId, approvedAt: new Date() });
        const { after, eventId } = await this.recordChange(tx, user, before, BUSINESS_EVENT_TYPE.PURCHASE_REQUISITION_APPROVED, null);
        await this.notifyApprovalResult(tx, after, '승인됨', eventId);
      }),
    );
    return this.requisitionView(id);
  }

  async reject(user: AuthUser, id: number, dto: RejectPurchaseRequisitionDto): Promise<PurchaseRequisitionDetail> {
    const rejectReason = dto.rejectReason.trim();
    if (!rejectReason) throw new AppException('COM-004', '반려 사유를 입력해 주세요');
    await retryOnNumberConflict(() =>
      this.prisma.$transaction(async (tx) => {
        const before = await this.mustFindForDecision(tx, user, id);
        await this.changeStatus(tx, before, PURCHASE_REQUISITION_STATUS.WAITING_APPROVAL, { purchaseRequisitionStatus: PURCHASE_REQUISITION_STATUS.REJECTED, approverId: user.employeeId, rejectReason });
        const { after, eventId } = await this.recordChange(tx, user, before, BUSINESS_EVENT_TYPE.PURCHASE_REQUISITION_REJECTED, rejectReason);
        await this.notifyApprovalResult(tx, after, `반려됨 · ${rejectReason}`, eventId);
      }),
    );
    return this.requisitionView(id);
  }

  /**
   * 반려된 요청을 요청자 본인이 수량·희망 입고일·요청 근거를 고쳐 다시 승인 대기로 보낸다. 원료 품목은 바꾸지 않는다.
   * 승인자·반려 사유는 지금 상태를 나타내는 칸이라 비우고, 이전 반려 기록은 작업 로그 before에 남는다.
   */
  async resubmit(user: AuthUser, id: number, dto: ResubmitPurchaseRequisitionDto): Promise<PurchaseRequisitionDetail> {
    const { requestedTon, desiredReceiptDate } = parseRequestValues(dto);
    await retryOnNumberConflict(() =>
      this.prisma.$transaction(async (tx) => {
        const before = await this.mustFindForChange(tx, id);
        if (before.requesterId !== user.employeeId) throw new AppException('COM-002', '요청자 본인만 재요청할 수 있어요');
        if (before.purchaseRequisitionStatus !== PURCHASE_REQUISITION_STATUS.REJECTED) throw new AppException('COM-001', '반려된 요청만 재요청할 수 있어요');
        const headId = await this.requireApproverId(tx, before.requester.departmentId, before.requesterId);
        // 반려된 사이 같은 계획·원료로 새 요청이 들어왔으면 재요청하면 중복이 된다
        if (before.productionPlanId !== null) await this.assertNoOpenRequisitionForPlan(tx, before.productionPlanId, before.itemId);
        await this.changeStatus(tx, before, PURCHASE_REQUISITION_STATUS.REJECTED, {
          purchaseRequisitionStatus: PURCHASE_REQUISITION_STATUS.WAITING_APPROVAL,
          requestedTon,
          desiredReceiptDate,
          requestReason: dto.requestReason?.trim() || null,
          approverId: null,
          approvedAt: null,
          rejectReason: null,
        });
        // BUSINESS_EVENT_TYPE에 재요청이 없어(docs/backend/purchasing.md 8장) 등록 이벤트로 남기고 사유로 구분한다
        const { after, eventId } = await this.recordChange(tx, user, before, BUSINESS_EVENT_TYPE.PURCHASE_REQUISITION_CREATED, '반려 후 재요청');
        await this.notifyApprovalRequested(tx, headId, after, user, eventId);
      }),
    );
    return this.requisitionView(id);
  }

  // ── 발주 조회 (REQ-PUR-003·004) ───────────────────────

  async listPurchaseOrders(query: ListPurchaseOrdersQuery): Promise<PageResult<PurchaseOrderView>> {
    const filter: PurchaseOrderFilter = { purchaseOrderStatus: query.purchaseOrderStatus, supplierId: query.supplierId };
    const page = query.page ?? 1;
    const size = query.size ?? DEFAULT_PAGE_SIZE;
    const [total, rows] = await Promise.all([this.repository.countPurchaseOrders(this.prisma, filter), this.repository.findPurchaseOrders(this.prisma, filter, { skip: (page - 1) * size, take: size })]);
    return { items: await this.purchaseOrderViews(rows), page, size, total };
  }

  async purchaseOrderDetail(id: number): Promise<PurchaseOrderView> {
    const row = await this.repository.findPurchaseOrder(this.prisma, id);
    if (!row) throw new AppException('COM-003', '발주를 찾을 수 없어요');
    return (await this.purchaseOrderViews([row]))[0];
  }

  /** 발주자(PURCHASE_ORDER_CREATED)와 취소·마감 기록(PURCHASE_ORDER_CANCELLED·CLOSED)을 작업 로그에서 붙인다 */
  private async purchaseOrderViews(rows: PurchaseOrderRow[]): Promise<PurchaseOrderView[]> {
    const idsOf = (status: PurchaseOrderStatus) => rows.filter((r) => r.purchaseOrderStatus === status).map((r) => r.id);
    const [ordered, cancelled, closed] = await Promise.all([
      this.latestEvents(this.prisma, BUSINESS_EVENT_TYPE.PURCHASE_ORDER_CREATED, 'purchase_order', rows.map((r) => r.id)),
      this.latestEvents(this.prisma, BUSINESS_EVENT_TYPE.PURCHASE_ORDER_CANCELLED, 'purchase_order', idsOf(PURCHASE_ORDER_STATUS.CANCELLED)),
      this.latestEvents(this.prisma, BUSINESS_EVENT_TYPE.PURCHASE_ORDER_CLOSED, 'purchase_order', idsOf(PURCHASE_ORDER_STATUS.CLOSED)),
    ]);
    return rows.map((row) => {
      const change = cancelled.get(row.id) ?? closed.get(row.id);
      return this.toPurchaseOrderView(row, ordered.get(row.id)?.actorName ?? null, change ? { reason: change.reason, employeeName: change.actorName, at: change.at.toISOString() } : null);
    });
  }

  // ── 발주 취소·잔량 마감 (BP-PUR-02 반대 거래, 이슈 #500) ──

  /**
   * 입고 누계가 0인 발주(CONFIRMED)를 취소한다. 연결 구매요청은 ORDER_CANCELLED가 되어 같은 계획·원료로 새로 요청할 수 있다.
   * 상태는 조건부 UPDATE로 바꿔 그사이 입고가 들어왔으면 0건이라 COM-001 (입고 확정은 발주 행을 잠그고 상태를 다시 읽어 PUR-007)
   */
  async cancelPurchaseOrder(user: AuthUser, id: number, dto: PurchaseOrderReasonDto): Promise<PurchaseOrderView> {
    const reason = requireReason(dto.reason);
    await retryOnNumberConflict(() =>
      this.prisma.$transaction(async (tx) => {
        const before = await this.mustFindPurchaseOrderStatus(tx, id);
        const status = before.purchaseOrderStatus as PurchaseOrderStatus;
        assertNotEnded(status);
        if (status === PURCHASE_ORDER_STATUS.PARTIALLY_RECEIVED) throw new AppException('PUR-004', '입고된 양이 있어 취소할 수 없어요. 남은 양만 닫으려면 잔량 마감을 해 주세요');
        if (status === PURCHASE_ORDER_STATUS.RECEIVED) throw new AppException('PUR-004', '전량 입고된 발주예요. 잘못 받은 입고가 있으면 입고를 먼저 취소해 주세요');
        await this.changePurchaseOrderStatus(tx, before.id, PURCHASE_ORDER_STATUS.CONFIRMED, PURCHASE_ORDER_STATUS.CANCELLED);

        const lines = await this.repository.findPurchaseOrderLines(tx, before.id);
        // 발주 등록과 같은 순서(id)로 바꿔 교착을 피한다
        const requisitionIds = lines.map((l) => l.purchaseRequisitionId).sort((a, b) => a - b);
        for (const requisitionId of requisitionIds) {
          const changed = await this.repository.updateRequisitionIfStatus(tx, requisitionId, PURCHASE_REQUISITION_STATUS.ORDERED, { purchaseRequisitionStatus: PURCHASE_REQUISITION_STATUS.ORDER_CANCELLED });
          if (changed === 0) throw new AppException('COM-001', '연결된 구매요청의 상태가 바뀌었어요. 다시 조회해 주세요');
        }
        const requisitionNoOf = new Map((await this.repository.findRequisitionNos(tx, requisitionIds)).map((r) => [r.id, r.purchaseRequisitionNo]));
        await this.businessEventRecorder.record(tx, {
          type: BUSINESS_EVENT_TYPE.PURCHASE_ORDER_CANCELLED,
          actor: user,
          target: { table: 'purchase_order', id: before.id },
          before: { purchaseOrderNo: before.purchaseOrderNo, purchaseOrderStatus: status },
          // 구매요청 ORDER_CANCELLED 전환에 맞는 이벤트 종류가 없어 발주 로그에 연결된 요청을 남긴다 (발주 등록과 같다)
          after: {
            purchaseOrderNo: before.purchaseOrderNo,
            purchaseOrderStatus: PURCHASE_ORDER_STATUS.CANCELLED,
            items: lines.map((l) => ({
              purchaseOrderItemId: l.id,
              purchaseRequisitionId: l.purchaseRequisitionId,
              purchaseRequisitionNo: requisitionNoOf.get(l.purchaseRequisitionId) ?? null,
              purchaseRequisitionStatus: PURCHASE_REQUISITION_STATUS.ORDER_CANCELLED,
              itemId: l.itemId,
              orderedTon: l.orderedTon.toFixed(3),
            })),
          },
          reason,
        });
      }),
    );
    return this.purchaseOrderDetail(id);
  }

  /**
   * 일부만 입고된 발주(PARTIALLY_RECEIVED)를 잔량 마감(CLOSED)한다. 남은 양은 MRP 입고예정에서 빠지고 더는 입고하지 않는다.
   * 구매요청은 ORDERED 그대로 두고, 같은 계획·원료의 새 요청은 막지 않는다 (findOpenRequisitionForPlan)
   */
  async closePurchaseOrder(user: AuthUser, id: number, dto: PurchaseOrderReasonDto): Promise<PurchaseOrderView> {
    const reason = requireReason(dto.reason);
    await retryOnNumberConflict(() =>
      this.prisma.$transaction(async (tx) => {
        const before = await this.mustFindPurchaseOrderStatus(tx, id);
        const status = before.purchaseOrderStatus as PurchaseOrderStatus;
        assertNotEnded(status);
        if (status === PURCHASE_ORDER_STATUS.CONFIRMED) throw new AppException('PUR-005', '아직 입고가 없는 발주예요. 잔량 마감 대신 발주 취소를 해 주세요');
        if (status === PURCHASE_ORDER_STATUS.RECEIVED) throw new AppException('PUR-005', '전량 입고된 발주라 마감할 잔량이 없어요');
        await this.changePurchaseOrderStatus(tx, before.id, PURCHASE_ORDER_STATUS.PARTIALLY_RECEIVED, PURCHASE_ORDER_STATUS.CLOSED);

        // 상태를 바꿔 발주 행을 잡은 뒤 읽어 그사이 확정된 입고까지 마감량에 넣는다
        const lines = (await this.repository.findPurchaseOrderLines(tx, before.id)).map((l) => {
          const received = sumTon(l.goodsReceipts);
          return { purchaseOrderItemId: l.id, itemId: l.itemId, orderedTon: l.orderedTon, receivedTon: received, closedTon: Prisma.Decimal.max(l.orderedTon.minus(received), 0) };
        });
        const closedTon = lines.reduce((sum, l) => sum.plus(l.closedTon), new Prisma.Decimal(0)).toFixed(3);
        await this.businessEventRecorder.record(tx, {
          type: BUSINESS_EVENT_TYPE.PURCHASE_ORDER_CLOSED,
          actor: user,
          target: { table: 'purchase_order', id: before.id },
          before: { purchaseOrderNo: before.purchaseOrderNo, purchaseOrderStatus: status, remainingTon: closedTon },
          after: {
            purchaseOrderNo: before.purchaseOrderNo,
            purchaseOrderStatus: PURCHASE_ORDER_STATUS.CLOSED,
            closedTon,
            items: lines.map((l) => ({ purchaseOrderItemId: l.purchaseOrderItemId, itemId: l.itemId, orderedTon: l.orderedTon.toFixed(3), receivedTon: l.receivedTon.toFixed(3), closedTon: l.closedTon.toFixed(3) })),
          },
          reason,
        });
      }),
    );
    return this.purchaseOrderDetail(id);
  }

  // ── 발주 등록 (REQ-PUR-003, BP-PUR-01) ────────────────

  /**
   * 승인된 구매요청을 공급업체 1곳당 발주 1건으로 묶어 확정(CONFIRMED)한다. 공급업체 메일 발송은 범위 밖.
   * 구매요청 APPROVED → ORDERED와 발주 저장·작업 로그를 한 트랜잭션에서 한다.
   */
  async createPurchaseOrder(user: AuthUser, dto: CreatePurchaseOrderDto): Promise<PurchaseOrderView> {
    const ids = dto.items.map((line) => line.purchaseRequisitionId);
    if (new Set(ids).size !== ids.length) throw new AppException('COM-004', '같은 구매요청을 두 번 넣었어요');
    const lines = dto.items.map((line) => ({
      purchaseRequisitionId: line.purchaseRequisitionId,
      orderedTon: parseTon(line.orderedTon, '발주량(톤)'),
      expectedReceiptDate: line.expectedReceiptDate ? parseDate(line.expectedReceiptDate, '입고 예정일') : null,
    }));
    const orderId = await retryOnNumberConflict(() => this.prisma.$transaction((tx) => this.createPurchaseOrderInTx(tx, user, dto.supplierId, lines)));
    return this.purchaseOrderDetail(orderId);
  }

  /** 발주 id를 돌려준다 */
  private async createPurchaseOrderInTx(
    tx: Tx,
    user: AuthUser,
    supplierId: number,
    lines: { purchaseRequisitionId: number; orderedTon: Prisma.Decimal; expectedReceiptDate: Date | null }[],
  ): Promise<number> {
    if (!(await this.repository.findSupplier(tx, supplierId))) throw new AppException('COM-003', '공급업체를 찾을 수 없어요');
    const requisitions = await this.repository.findRequisitionsForOrder(tx, lines.map((l) => l.purchaseRequisitionId));
    const items = lines.map((line) => {
      const pr = requisitions.find((r) => r.id === line.purchaseRequisitionId);
      if (!pr) throw new AppException('COM-003', '구매요청을 찾을 수 없어요');
      if (pr.purchaseRequisitionStatus === PURCHASE_REQUISITION_STATUS.ORDERED) throw new AppException('COM-001', `${pr.purchaseRequisitionNo}는 이미 발주된 요청이에요`);
      // 발주 품목 1행 = 구매요청 1건(unique)이라 취소된 발주의 요청은 다시 발주하지 않는다
      if (pr.purchaseRequisitionStatus === PURCHASE_REQUISITION_STATUS.ORDER_CANCELLED) throw new AppException('COM-001', `${pr.purchaseRequisitionNo}는 발주가 취소된 요청이에요. 새로 구매요청해 주세요`);
      if (pr.purchaseRequisitionStatus !== PURCHASE_REQUISITION_STATUS.APPROVED) throw new AppException('PUR-002', `${pr.purchaseRequisitionNo}는 아직 승인되지 않았어요`);
      if (line.orderedTon.gt(pr.requestedTon)) throw new AppException('COM-004', `${pr.purchaseRequisitionNo}의 발주량이 요청량 ${pr.requestedTon.toFixed(3)}t보다 많아요`);
      // 잘못된 공급업체 차단(API-149): 품목 기본 공급업체가 있으면 그 공급업체로만 발주한다
      if (pr.item.defaultSupplierId !== null && pr.item.defaultSupplierId !== supplierId) throw new AppException('COM-004', `${pr.purchaseRequisitionNo}의 원료는 기본 공급업체로 발주해 주세요`);
      return { pr, purchaseRequisitionId: pr.id, itemId: pr.itemId, orderedTon: line.orderedTon, expectedReceiptDate: line.expectedReceiptDate ?? pr.desiredReceiptDate };
    });

    // 구매요청을 먼저 ORDERED로 바꾼다: 그사이 다른 발주·재요청이 바꿨으면 0건이라 COM-001 (id 순서로 잠가 교착을 피한다)
    for (const id of [...items.map((i) => i.purchaseRequisitionId)].sort((a, b) => a - b)) {
      const changed = await this.repository.updateRequisitionIfStatus(tx, id, PURCHASE_REQUISITION_STATUS.APPROVED, { purchaseRequisitionStatus: PURCHASE_REQUISITION_STATUS.ORDERED });
      if (changed === 0) throw new AppException('COM-001', '다른 사람이 먼저 처리한 구매요청이 있어요. 다시 조회해 주세요');
    }
    const order = await this.repository.createPurchaseOrder(tx, {
      purchaseOrderNo: await this.numbering.nextDocumentNumber(tx, 'PURCHASE_ORDER'),
      supplierId,
      items: items.map(({ purchaseRequisitionId, itemId, orderedTon, expectedReceiptDate }) => ({ purchaseRequisitionId, itemId, orderedTon, expectedReceiptDate })),
    });
    await this.businessEventRecorder.record(tx, {
      type: BUSINESS_EVENT_TYPE.PURCHASE_ORDER_CREATED,
      actor: user,
      target: { table: 'purchase_order', id: order.id },
      // 구매요청 ORDERED 전환에 맞는 이벤트 종류가 없어 발주 로그에 연결된 요청을 남긴다
      after: {
        purchaseOrderNo: order.purchaseOrderNo,
        supplierId,
        purchaseOrderStatus: order.purchaseOrderStatus,
        items: items.map((i) => ({ purchaseRequisitionId: i.purchaseRequisitionId, purchaseRequisitionNo: i.pr.purchaseRequisitionNo, itemId: i.itemId, orderedTon: i.orderedTon.toFixed(3), expectedReceiptDate: dateOnly(i.expectedReceiptDate) })),
      },
    });
    return order.id;
  }

  // ── 입고 (REQ-PUR-004, BP-PUR-02) ─────────────────────

  async listGoodsReceipts(query: ListGoodsReceiptsQuery): Promise<PageResult<GoodsReceiptView>> {
    const page = query.page ?? 1;
    const size = query.size ?? DEFAULT_PAGE_SIZE;
    const [total, rows] = await Promise.all([
      this.repository.countGoodsReceipts(this.prisma, query.purchaseOrderId),
      this.repository.findGoodsReceipts(this.prisma, query.purchaseOrderId, { skip: (page - 1) * size, take: size }),
    ]);
    // 입고 취소 작업 로그의 대상은 원래 입고라 취소 행은 원래 입고 id로 찾는다
    const originalIdOf = (row: GoodsReceiptRow) => row.reversedGoodsReceiptId ?? row.id;
    const [confirmed, cancelled] = await Promise.all([
      this.latestEvents(this.prisma, BUSINESS_EVENT_TYPE.GOODS_RECEIPT_CONFIRMED, 'goods_receipt', rows.filter((r) => r.reversedGoodsReceiptId === null).map((r) => r.id)),
      this.latestEvents(this.prisma, BUSINESS_EVENT_TYPE.GOODS_RECEIPT_CANCELLED, 'goods_receipt', rows.filter((r) => r.reversedGoodsReceiptId !== null || r.reversal !== null).map(originalIdOf)),
    ]);
    return {
      items: rows.map((row) => {
        const cancel = cancelled.get(originalIdOf(row));
        const actorName = row.reversedGoodsReceiptId === null ? confirmed.get(row.id)?.actorName : cancel?.actorName;
        return this.toGoodsReceiptView(row, actorName ?? null, cancel?.reason ?? null);
      }),
      page,
      size,
      total,
    };
  }

  /**
   * 입고 확정(등록이 곧 확정, 부분 입고 허용, 입고 검사 없음): 발주 행 잠금 → 미입고량 확인(PUR-003) → 입고 저장 →
   * 원료 LOT 생성(기본 야드) → 발주 상태 갱신 → 작업 로그. 원료 재고는 원료 LOT 잔량 합계라 따로 늘리지 않는다.
   */
  async confirmGoodsReceipt(user: AuthUser, dto: CreateGoodsReceiptDto): Promise<GoodsReceiptView> {
    const receivedTon = parseTon(dto.receivedTon, '입고량(톤)');
    const receivedDate = parseDate(dto.receivedDate, '입고일');
    // 실제로 들어온 원료를 기록하는 일이라 미래 날짜는 받지 않는다
    if (dto.receivedDate > seoulToday()) throw new AppException('COM-004', '입고일은 오늘 이후로 할 수 없어요');
    const receiptId = await retryOnNumberConflict(() => this.prisma.$transaction((tx) => this.confirmGoodsReceiptInTx(tx, user, dto.purchaseOrderItemId, receivedTon, receivedDate)));
    return this.toGoodsReceiptView(await this.repository.findGoodsReceipt(this.prisma, receiptId), user.employeeName, null);
  }

  /** 입고 id를 돌려준다 */
  private async confirmGoodsReceiptInTx(tx: Tx, user: AuthUser, purchaseOrderItemId: number, receivedTon: Prisma.Decimal, receivedDate: Date): Promise<number> {
    if ((await this.repository.lockPurchaseOrderByItemId(tx, purchaseOrderItemId)).length === 0) throw new AppException('COM-003', '발주 품목을 찾을 수 없어요');
    const line = await this.repository.findPurchaseOrderItemForReceipt(tx, purchaseOrderItemId);
    if (!line) throw new AppException('COM-003', '발주 품목을 찾을 수 없어요');
    const order = line.purchaseOrder;
    // 발주 취소·잔량 마감과 겹치면 잠금을 얻은 뒤 읽은 상태로 막는다
    if (ENDED_PURCHASE_ORDER[order.purchaseOrderStatus as PurchaseOrderStatus]) throw new AppException('PUR-007', `${order.purchaseOrderNo}는 취소·마감된 발주라 입고할 수 없어요`);
    const item = await this.repository.findReceiptItem(tx, line.itemId);
    const receivedOf = (l: (typeof order.purchaseOrderItems)[number]) => sumTon(l.goodsReceipts);
    const self = order.purchaseOrderItems.find((l) => l.id === line.id);
    const receivedBefore = self ? receivedOf(self) : new Prisma.Decimal(0);
    const remaining = line.orderedTon.minus(receivedBefore);
    if (receivedTon.gt(remaining)) throw new AppException('PUR-003', `미입고량 ${remaining.toFixed(3)}t보다 많이 입고할 수 없어요`);

    const goodsReceiptNo = await this.numbering.nextDocumentNumber(tx, 'GOODS_RECEIPT');
    const receipt = await this.repository.createGoodsReceipt(tx, { goodsReceiptNo, purchaseOrderItemId, receivedTon, receivedDate });
    // LOT 번호 날짜는 입고일: 원료 FIFO가 입고일 기준이라 번호와 투입 순서를 맞춘다
    const lot = await this.repository.createRawMaterialLot(tx, {
      lotNo: await this.numbering.nextLotNumber(tx, 'RAW_MATERIAL', item.itemCode, receivedDate),
      itemId: line.itemId,
      goodsReceiptId: receipt.id,
      yardId: item.defaultYardId,
      ton: receivedTon,
    });
    const status = receiptStatusOf(order.purchaseOrderItems.map((l) => ({ orderedTon: l.orderedTon, receivedTon: l.id === line.id ? receivedBefore.plus(receivedTon) : receivedOf(l) })));
    if (status !== order.purchaseOrderStatus) await this.changePurchaseOrderStatus(tx, order.id, order.purchaseOrderStatus as PurchaseOrderStatus, status);

    await this.businessEventRecorder.record(tx, {
      type: BUSINESS_EVENT_TYPE.GOODS_RECEIPT_CONFIRMED,
      actor: user,
      target: { table: 'goods_receipt', id: receipt.id },
      lotIds: [lot.id],
      before: { purchaseOrderStatus: order.purchaseOrderStatus, receivedTon: receivedBefore.toFixed(3) },
      after: {
        goodsReceiptNo,
        purchaseOrderId: order.id,
        purchaseOrderNo: order.purchaseOrderNo,
        purchaseOrderItemId,
        itemId: line.itemId,
        itemCode: item.itemCode,
        receivedTon: receivedTon.toFixed(3),
        receivedDate: dateOnly(receivedDate),
        lotId: lot.id,
        lotNo: lot.lotNo,
        yardId: item.defaultYardId,
        purchaseOrderStatus: status,
        cumulativeReceivedTon: receivedBefore.plus(receivedTon).toFixed(3),
      },
    });
    return receipt.id;
  }

  /**
   * 입고 취소(반대 거래): 원래 입고는 그대로 두고 같은 발주 품목에 음수 입고 1행을 더한다. 그 입고로 만든 원료 LOT을 아직 쓰지 않았을 때만
   * (투입·배정 없음, 잔량 = 처음 양) 잔량 0·RECEIPT_CANCELLED로 바꾸고, 발주 상태는 입고 누계로 다시 정한다. 취소 행을 돌려준다
   */
  async cancelGoodsReceipt(user: AuthUser, id: number, dto: CancelGoodsReceiptDto): Promise<GoodsReceiptView> {
    const reason = requireReason(dto.reason);
    const reversalId = await retryOnNumberConflict(() => this.prisma.$transaction((tx) => this.cancelGoodsReceiptInTx(tx, user, id, reason)));
    return this.toGoodsReceiptView(await this.repository.findGoodsReceipt(this.prisma, reversalId), user.employeeName, reason);
  }

  /** 취소 행 id를 돌려준다. 잠금 순서는 입고 확정과 같은 발주 → 원료 LOT (원료 FIFO 투입은 LOT만 잠가 교착이 없다) */
  private async cancelGoodsReceiptInTx(tx: Tx, user: AuthUser, id: number, reason: string): Promise<number> {
    const receipt = await this.repository.findGoodsReceiptForCancel(tx, id);
    if (!receipt) throw new AppException('COM-003', '입고를 찾을 수 없어요');
    if (receipt.reversedGoodsReceiptId !== null) throw new AppException('COM-004', '입고 취소 기록은 다시 취소할 수 없어요');
    await this.repository.lockPurchaseOrderByItemId(tx, receipt.purchaseOrderItemId);
    // 같은 입고를 두 번 취소하면 뒤 요청은 잠금을 기다린 뒤 여기서 막힌다 (reversed_goods_receipt_id unique도 막는다)
    if (await this.repository.findReversalOf(tx, receipt.id)) throw new AppException('COM-001', `${receipt.goodsReceiptNo}는 이미 취소된 입고예요`);
    const line = await this.repository.findPurchaseOrderItemForReceipt(tx, receipt.purchaseOrderItemId);
    if (!line) throw new AppException('COM-003', '발주 품목을 찾을 수 없어요');
    const order = line.purchaseOrder;
    const orderStatus = order.purchaseOrderStatus as PurchaseOrderStatus;
    // 발주 취소는 입고 누계가 0일 때만 되므로 취소한 발주에 되돌릴 입고는 남지 않는다. 잔량 마감한 발주는 LOT을 안 썼으면 되돌린다
    if (orderStatus === PURCHASE_ORDER_STATUS.CANCELLED) throw new AppException('PUR-007', `${order.purchaseOrderNo}는 취소된 발주라 입고를 취소할 수 없어요`);

    const lot = await this.repository.findLotOfReceipt(tx, receipt.id);
    if (!lot) throw new AppException('COM-003', '이 입고로 만든 원료 LOT을 찾을 수 없어요');
    // 잠금 순서: 발주 → 작업 로그 채번 → 원료 LOT. 제선 실적은 시작 작업 로그(EV 채번 잠금)를 남긴 뒤 원료 LOT을 FIFO로 잠그므로
    // LOT을 먼저 잡고 작업 로그를 남기면 서로 기다린다(교착). 이 번호는 쓰지 않고, 아래 작업 로그가 같은 번호를 다시 받는다
    await this.numbering.nextDocumentNumber(tx, 'BUSINESS_EVENT');
    const lotBefore = await this.repository.cancelRawMaterialLot(tx, lot.id);
    if (!lotBefore) throw new AppException('PUR-006', `원료 LOT ${lot.lotNo} · 이미 투입·배정했거나 잔량이 줄어 입고를 취소할 수 없어요`);

    const item = await this.repository.findReceiptItem(tx, line.itemId);
    const today = seoulToday();
    const reversalNo = await this.numbering.nextDocumentNumber(tx, 'GOODS_RECEIPT');
    const reversal = await this.repository.createGoodsReceipt(tx, {
      goodsReceiptNo: reversalNo,
      purchaseOrderItemId: receipt.purchaseOrderItemId,
      receivedTon: receipt.receivedTon.neg(),
      receivedDate: parseDate(today, '취소일'),
      reversedGoodsReceiptId: receipt.id,
    });
    const receivedOf = (l: (typeof order.purchaseOrderItems)[number]) => sumTon(l.goodsReceipts);
    const self = order.purchaseOrderItems.find((l) => l.id === line.id);
    const receivedBefore = self ? receivedOf(self) : new Prisma.Decimal(0);
    const receivedAfter = receivedBefore.minus(receipt.receivedTon);
    // 잔량 마감한 발주는 닫힌 채로 두고 입고 누계만 줄인다 (MRP 입고예정에서는 이미 빠져 있다)
    const status =
      orderStatus === PURCHASE_ORDER_STATUS.CLOSED
        ? orderStatus
        : receiptStatusOf(order.purchaseOrderItems.map((l) => ({ orderedTon: l.orderedTon, receivedTon: l.id === line.id ? receivedAfter : receivedOf(l) })));
    if (status !== orderStatus) await this.changePurchaseOrderStatus(tx, order.id, orderStatus, status);

    await this.businessEventRecorder.record(tx, {
      type: BUSINESS_EVENT_TYPE.GOODS_RECEIPT_CANCELLED,
      actor: user,
      target: { table: 'goods_receipt', id: receipt.id },
      lotIds: [lot.id],
      // LOT 변경 전 값은 조건부 UPDATE가 돌려준 값이다 (재고 상태였던 것은 UPDATE 조건)
      before: { purchaseOrderStatus: orderStatus, cumulativeReceivedTon: receivedBefore.toFixed(3), lotStatus: LOT_STATUS.AVAILABLE, remainingTon: lotBefore.remainingTonBefore },
      // 대상이 원래 입고라 goodsReceiptNo는 원래 입고 번호(작업 로그 화면의 대상 번호), 취소 행 번호는 따로 둔다
      after: {
        goodsReceiptNo: receipt.goodsReceiptNo,
        reversalGoodsReceiptNo: reversalNo,
        purchaseOrderId: order.id,
        purchaseOrderNo: order.purchaseOrderNo,
        purchaseOrderItemId: receipt.purchaseOrderItemId,
        itemId: line.itemId,
        itemCode: item.itemCode,
        receivedTon: receipt.receivedTon.neg().toFixed(3),
        receivedDate: today,
        lotId: lot.id,
        lotNo: lot.lotNo,
        lotStatus: LOT_STATUS.RECEIPT_CANCELLED,
        remainingTon: '0.000',
        purchaseOrderStatus: status,
        cumulativeReceivedTon: receivedAfter.toFixed(3),
      },
      reason,
    });
    return reversal.id;
  }

  // ── 계산·모양 ─────────────────────────────────────────

  /** 발주 상태가 from일 때만 to로 바꾼다. 그사이 입고 확정·다른 처리로 바뀌었으면 0건이라 COM-001 */
  private async changePurchaseOrderStatus(tx: Tx, id: number, from: PurchaseOrderStatus, to: PurchaseOrderStatus): Promise<void> {
    if ((await this.repository.changePurchaseOrderStatus(tx, id, from, to)) === 0) throw new AppException('COM-001', '다른 사람이 먼저 처리했거나 그사이 입고가 바뀐 발주예요. 다시 조회해 주세요');
  }

  private async mustFindPurchaseOrderStatus(tx: Tx, id: number) {
    const row = await this.repository.findPurchaseOrderStatus(tx, id);
    if (!row) throw new AppException('COM-003', '발주를 찾을 수 없어요');
    return row;
  }

  /** 승인·반려 전 확인: 부서장 지정(PUR-001) → 요청자 소속 부서의 부서장(COM-002) → 본인 요청 아님 → 승인 대기(COM-001) */
  private async mustFindForDecision(tx: Tx, user: AuthUser, id: number): Promise<RequisitionChangeRow> {
    const row = await this.mustFindForChange(tx, id);
    await this.requireDepartmentHeadId(tx, row.requester.departmentId);
    assertDepartmentHead(user, row.requester.departmentId);
    // 부서장 자기 요청의 승인 경로는 TBD(업무 프로세스 16장)이고 자동 승인은 금지라 우선 막는다
    if (row.requesterId === user.employeeId) throw new AppException('COM-002', '본인 요청은 승인·반려할 수 없어요');
    return row;
  }

  /** 상태가 그대로일 때만 바꾼다. 그사이 다른 사람이 처리했으면 0건이라 COM-001 (승인과 재요청이 겹쳐도 한쪽만 반영) */
  private async changeStatus(tx: Tx, row: PurchaseRequisition, from: PurchaseRequisitionStatus, data: RequisitionStatusChange): Promise<void> {
    const status = row.purchaseRequisitionStatus as PurchaseRequisitionStatus;
    if (status !== from) throw new AppException('COM-001', ALREADY_DONE[status]);
    if ((await this.repository.updateRequisitionIfStatus(tx, row.id, from, data)) === 0) throw new AppException('COM-001', '다른 사람이 먼저 처리한 요청이에요. 다시 조회해 주세요');
  }

  private async recordChange(tx: Tx, user: AuthUser, before: PurchaseRequisition, type: BusinessEventType, reason: string | null): Promise<{ after: PurchaseRequisition; eventId: number }> {
    const after = await this.mustFindForChange(tx, before.id);
    const plan = after.productionPlanId === null ? null : await this.repository.findProductionPlan(tx, after.productionPlanId);
    const event = await this.businessEventRecorder.record(tx, {
      type,
      actor: user,
      target: { table: 'purchase_requisition', id: before.id },
      salesOrderId: plan?.salesOrderItem?.salesOrderId ?? null,
      before: snapshotOf(before),
      after: snapshotOf(after),
      reason,
    });
    return { after, eventId: event.id };
  }

  /** 승인권자(요청자 소속 부서의 부서장) id. 없으면 승인할 사람이 없으므로 PUR-001 */
  private async requireDepartmentHeadId(tx: Tx, departmentId: number): Promise<number> {
    const department = await this.repository.findDepartmentHead(tx, departmentId);
    if (!department?.headEmployeeId) throw new AppException('PUR-001');
    return department.headEmployeeId;
  }

  /** 이 사원이 구매요청을 낼 수 있는지(승인권자가 있는지)만 확인한다. Message → ERP 초안이 확정 전에 부른다 */
  async assertCanRequest(tx: Tx, actor: AuthUser): Promise<void> {
    await this.requireApproverId(tx, actor.departmentId, actor.employeeId);
  }

  /**
   * 등록·재요청의 승인권자. 부서장 본인 요청은 승인할 사람이 자기 자신뿐이라 PUR-001로 받지 않는다.
   * 문서는 경로 TBD·자동 승인 금지(8장, [04] 2장)라 승인 대기에 영영 머무는 대신 등록 때 거부한다 (2026-10-12 사용자 결정).
   */
  private async requireApproverId(tx: Tx, departmentId: number, requesterId: number): Promise<number> {
    const headId = await this.requireDepartmentHeadId(tx, departmentId);
    if (headId === requesterId) throw new AppException('PUR-001', '부서장 본인 요청은 승인할 사람이 없어 받을 수 없어요. 부서원이 요청해 주세요');
    return headId;
  }

  /** 등록·재요청 → 승인권자에게 승인 요청 알림 ([04] 13.4). 작업 로그 id로 같은 알림을 두 번 만들지 않는다. */
  private async notifyApprovalRequested(tx: Tx, headId: number, row: { id: number; purchaseRequisitionNo: string }, requester: AuthUser, eventId: number): Promise<void> {
    await this.notifications.notifyEmployees(tx, [headId], {
      notificationType: NOTIFICATION_TYPE.APPROVAL_REQUESTED,
      notificationContent: `구매요청 ${row.purchaseRequisitionNo} 승인 요청 · ${requester.employeeName}님`,
      linkPath: `/approvals?pr=${row.id}`,
      businessEventId: eventId,
    });
  }

  /** 승인·반려 → 요청자에게 결과 알림 */
  private async notifyApprovalResult(tx: Tx, row: PurchaseRequisition, result: string, eventId: number): Promise<void> {
    await this.notifications.notifyEmployees(tx, [row.requesterId], {
      notificationType: NOTIFICATION_TYPE.APPROVAL_RESULT,
      notificationContent: `구매요청 ${row.purchaseRequisitionNo} ${result}`,
      linkPath: `/purchase-requisitions?pr=${row.id}`,
      businessEventId: eventId,
    });
  }

  /** MRP를 다시 계산해도 같은 계획의 구매요청을 중복 생성하지 않는다 (API-143 비고) */
  /**
   * 같은 계획·원료로 진행 중인 구매요청이 없어야 한다. 확인 전에 계획 행을 잠가, MRP '요청' 더블클릭·두 사람 동시 요청이
   * 둘 다 '없음'을 보고 두 건을 만들지 않게 한다 (#478). 잠금 순서는 계획 → 작업 로그(채번)
   */
  private async assertNoOpenRequisitionForPlan(tx: Tx, productionPlanId: number, itemId: number): Promise<void> {
    await this.repository.lockProductionPlan(tx, productionPlanId);
    const open = await this.repository.findOpenRequisitionForPlan(tx, productionPlanId, itemId);
    if (open) throw new AppException('COM-004', `같은 생산계획·원료로 진행 중인 구매요청 ${open.purchaseRequisitionNo}이 있어요`);
  }

  private canViewAll(user: AuthUser): boolean {
    return hasPermission(user, { permission: PERMISSION.PURCHASE_REQUISITION_CREATE, level: 'VIEW' });
  }

  private async mustFindRequisition(tx: Tx, id: number): Promise<RequisitionRow> {
    const row = await this.repository.findRequisition(tx, id);
    if (!row) throw new AppException('COM-003', '구매요청을 찾을 수 없어요');
    return row;
  }

  private async mustFindForChange(tx: Tx, id: number): Promise<RequisitionChangeRow> {
    const row = await this.repository.findRequisitionForChange(tx, id);
    if (!row) throw new AppException('COM-003', '구매요청을 찾을 수 없어요');
    return row;
  }

  /** 커밋 뒤 응답 */
  private async requisitionView(id: number): Promise<PurchaseRequisitionDetail> {
    return this.detailOf(this.prisma, await this.mustFindRequisition(this.prisma, id));
  }

  /** 대상별 가장 최근 작업 로그의 사원·시각·사유 (ERD에 칸이 없는 반려 일시·발주자·입고 확정자·취소·마감 사유) */
  private async latestEvents(tx: Tx, type: BusinessEventType, targetType: string, ids: number[]): Promise<Map<number, { actorName: string | null; at: Date; reason: string | null }>> {
    const latest = new Map<number, { actorName: string | null; at: Date; reason: string | null }>();
    if (ids.length === 0) return latest;
    for (const e of await this.repository.findEvents(tx, type, targetType, ids)) {
      if (!latest.has(e.targetId)) latest.set(e.targetId, { actorName: e.actorEmployee?.employeeName ?? null, at: e.createdAt, reason: e.reason });
    }
    return latest;
  }

  private async detailOf(tx: Tx, row: RequisitionRow): Promise<PurchaseRequisitionDetail> {
    if (!isRejected(row)) return this.toDetail(row);
    const rejected = await this.latestEvents(tx, BUSINESS_EVENT_TYPE.PURCHASE_REQUISITION_REJECTED, 'purchase_requisition', [row.id]);
    return this.toDetail(row, rejected.get(row.id)?.at ?? null);
  }

  private toSummary(row: RequisitionRow, rejectedAt: Date | null = null): PurchaseRequisitionSummary {
    return {
      id: row.id,
      purchaseRequisitionNo: row.purchaseRequisitionNo,
      purchaseRequisitionStatus: row.purchaseRequisitionStatus as PurchaseRequisitionStatus,
      itemId: row.itemId,
      itemCode: row.item.itemCode,
      itemName: row.item.itemName,
      defaultSupplierId: row.item.defaultSupplierId,
      defaultSupplierName: row.item.defaultSupplier?.supplierName ?? null,
      requestedTon: row.requestedTon.toFixed(3),
      desiredReceiptDate: dateOnly(row.desiredReceiptDate),
      requesterId: row.requesterId,
      requesterName: row.requester.employeeName,
      departmentId: row.requester.departmentId,
      departmentName: row.requester.department.departmentName,
      approverId: row.approverId,
      approverName: row.approver?.employeeName ?? null,
      approvedAt: row.approvedAt?.toISOString() ?? null,
      productionPlanId: row.productionPlanId,
      productionPlanNo: row.productionPlan?.productionPlanNo ?? null,
      actionDraftId: row.actionDraftId,
      purchaseOrderNo: row.purchaseOrderItem?.purchaseOrder.purchaseOrderNo ?? null,
      rejectedAt: rejectedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toDetail(row: RequisitionRow, rejectedAt: Date | null = null): PurchaseRequisitionDetail {
    const salesOrder = row.productionPlan?.salesOrderItem?.salesOrder ?? null;
    return {
      ...this.toSummary(row, rejectedAt),
      requestReason: row.requestReason,
      rejectReason: row.rejectReason,
      salesOrderId: salesOrder?.id ?? null,
      salesOrderNo: salesOrder?.salesOrderNo ?? null,
    };
  }

  private toGoodsReceiptView(row: GoodsReceiptRow, confirmedEmployeeName: string | null, cancelReason: string | null): GoodsReceiptView {
    const purchaseOrderStatus = row.purchaseOrderItem.purchaseOrder.purchaseOrderStatus as PurchaseOrderStatus;
    const lot = row.lot;
    // cancelRawMaterialLotForReceipt.sql과 같은 조건 (화면 단추용. 취소할 때 서버가 잠근 뒤 다시 본다)
    const lotUnused = lot !== null && lot.lotStatus === LOT_STATUS.AVAILABLE && lot.remainingTon !== null && lot.initialTon !== null && lot.remainingTon.eq(lot.initialTon) && lot._count.lotRelationsAsParentLot === 0 && lot._count.allocations === 0;
    return {
      id: row.id,
      goodsReceiptNo: row.goodsReceiptNo,
      purchaseOrderId: row.purchaseOrderItem.purchaseOrderId,
      purchaseOrderNo: row.purchaseOrderItem.purchaseOrder.purchaseOrderNo,
      purchaseOrderStatus,
      purchaseOrderItemId: row.purchaseOrderItemId,
      itemId: row.purchaseOrderItem.itemId,
      itemCode: row.purchaseOrderItem.item.itemCode,
      itemName: row.purchaseOrderItem.item.itemName,
      receivedTon: row.receivedTon.toFixed(3),
      receivedDate: dateOnly(row.receivedDate),
      lotId: row.lot?.id ?? null,
      lotNo: row.lot?.lotNo ?? null,
      lotStatus: (row.lot?.lotStatus ?? null) as LotStatus | null,
      yardId: row.lot?.yardId ?? null,
      yardName: row.lot?.yard?.yardName ?? null,
      confirmedEmployeeName,
      reversedGoodsReceiptId: row.reversedGoodsReceiptId,
      reversedGoodsReceiptNo: row.reversedGoodsReceipt?.goodsReceiptNo ?? null,
      reversalGoodsReceiptNo: row.reversal?.goodsReceiptNo ?? null,
      cancelReason,
      isCancellable: row.reversedGoodsReceiptId === null && row.reversal === null && lotUnused && purchaseOrderStatus !== PURCHASE_ORDER_STATUS.CANCELLED,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private toPurchaseOrderView(row: PurchaseOrderRow, orderedEmployeeName: string | null, statusChange: PurchaseOrderStatusChange | null): PurchaseOrderView {
    const zero = new Prisma.Decimal(0);
    // 발주 취소·잔량 마감한 발주는 더 들어올 양이 없어 미입고량을 0으로 두고 남은 양은 닫은 양으로 보인다
    const ended = ENDED_PURCHASE_ORDER[row.purchaseOrderStatus as PurchaseOrderStatus] !== undefined;
    const lines = row.purchaseOrderItems.map((line) => {
      const received = sumTon(line.goodsReceipts);
      const open = Prisma.Decimal.max(line.orderedTon.minus(received), zero);
      return { line, received, remaining: ended ? zero : open, closed: ended ? open : zero };
    });
    const total = (pick: (l: (typeof lines)[number]) => Prisma.Decimal) => lines.reduce((sum, l) => sum.plus(pick(l)), zero).toFixed(3);
    return {
      id: row.id,
      purchaseOrderNo: row.purchaseOrderNo,
      purchaseOrderStatus: row.purchaseOrderStatus as PurchaseOrderStatus,
      supplierId: row.supplierId,
      supplierName: row.supplier.supplierName,
      orderedEmployeeName,
      totalOrderedTon: total((l) => l.line.orderedTon),
      totalReceivedTon: total((l) => l.received),
      totalRemainingTon: total((l) => l.remaining),
      totalClosedTon: total((l) => l.closed),
      statusChange,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      items: lines.map(({ line, received, remaining, closed }) => ({
        purchaseOrderItemId: line.id,
        purchaseRequisitionId: line.purchaseRequisitionId,
        purchaseRequisitionNo: line.purchaseRequisition.purchaseRequisitionNo,
        itemId: line.itemId,
        itemCode: line.item.itemCode,
        itemName: line.item.itemName,
        orderedTon: line.orderedTon.toFixed(3),
        expectedReceiptDate: line.expectedReceiptDate ? dateOnly(line.expectedReceiptDate) : null,
        receivedTon: received.toFixed(3),
        remainingTon: remaining.toFixed(3),
        closedTon: closed.toFixed(3),
      })),
    };
  }
}
