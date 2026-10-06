import { Injectable } from '@nestjs/common';
import {
  BUSINESS_EVENT_TYPE,
  ITEM_TYPE,
  PERMISSION,
  PURCHASE_REQUISITION_STATUS,
  type AuthUser,
  type BusinessEventType,
  type PageResult,
  type PurchaseOrderStatus,
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
import { Prisma } from '../../generated/prisma/client';
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import type { CreatePurchaseOrderDto, ListPurchaseOrdersQuery } from './dto/purchase-order.dto';
import type { CreatePurchaseRequisitionDto, ListPurchaseRequisitionsQuery, RejectPurchaseRequisitionDto, ResubmitPurchaseRequisitionDto } from './dto/purchase-requisition.dto';
import { PurchasingRepository, type PurchaseOrderFilter, type RequisitionFilter, type RequisitionStatusChange } from './purchasing.repository';

type RequisitionRow = NonNullable<Awaited<ReturnType<PurchasingRepository['findRequisition']>>>;
type PurchaseOrderRow = NonNullable<Awaited<ReturnType<PurchasingRepository['findPurchaseOrder']>>>;

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
}

const DEFAULT_PAGE_SIZE = 20;
/** decimal(12,3): 정수 9자리·소수 3자리 */
const TON_PATTERN = /^\d{1,9}(\.\d{1,3})?$/;

const dateOnly = (d: Date) => d.toISOString().slice(0, 10);
const isValidDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00.000Z`)) && dateOnly(new Date(`${s}T00:00:00.000Z`)) === s;

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
function snapshotOf(row: RequisitionRow) {
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
};

/** 채번은 "최댓값 + 1"이라 동시에 저장하면 번호(구매요청·작업 로그)가 겹쳐 unique 위반이 난다. 트랜잭션 전체를 다시 하면 새 번호를 받는다 */
const NUMBER_CONFLICT_ATTEMPTS = 3;
async function retryOnNumberConflict<T>(work: () => Promise<T>): Promise<T> {
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
 * createRequisition은 message-action이 초안 확정 트랜잭션 안에서 부른다 (BP-ACT-01).
 */
@Injectable()
export class PurchasingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: PurchasingRepository,
    private readonly numbering: NumberingService,
    private readonly businessEventRecorder: BusinessEventRecorder,
  ) {}

  // ── 조회 ──────────────────────────────────────────────

  /** 권한(VIEW)이 있으면 전체, 없으면 부서장만 자기 부서원의 요청을 본다 (승인 대기 목록도 이 API) */
  async listRequisitions(user: AuthUser, query: ListPurchaseRequisitionsQuery): Promise<PageResult<PurchaseRequisitionSummary>> {
    const filter: RequisitionFilter = { purchaseRequisitionStatus: query.purchaseRequisitionStatus };
    if (!this.canViewAll(user)) {
      if (user.headDepartmentIds.length === 0) throw new AppException('COM-002');
      filter.requesterDepartmentIds = user.headDepartmentIds;
    }
    const page = query.page ?? 1;
    const size = query.size ?? DEFAULT_PAGE_SIZE;
    const [total, rows] = await Promise.all([this.repository.countRequisitions(this.prisma, filter), this.repository.findRequisitions(this.prisma, filter, { skip: (page - 1) * size, take: size })]);
    return { items: rows.map((row) => this.toSummary(row)), page, size, total };
  }

  /** 권한(VIEW)이 있거나 그 요청의 승인권자(요청자 소속 부서의 부서장)만 본다 */
  async requisitionDetail(user: AuthUser, id: number): Promise<PurchaseRequisitionDetail> {
    const row = await this.mustFindRequisition(this.prisma, id);
    if (!this.canViewAll(user) && !user.headDepartmentIds.includes(row.requester.departmentId)) throw new AppException('COM-002');
    return this.toDetail(row);
  }

  // ── 등록 (REQ-PUR-001) ────────────────────────────────

  create(user: AuthUser, dto: CreatePurchaseRequisitionDto): Promise<PurchaseRequisitionDetail> {
    return retryOnNumberConflict(() => this.prisma.$transaction((tx) => this.createRequisition(tx, dto, user)));
  }

  /**
   * 구매요청 1건(원료 1품목) 저장 → 바로 요청자 소속 부서장의 승인 대기(WAITING_APPROVAL, 임시 저장 없음) → 작업 로그.
   * 요청자·부서는 actor에서 가져온다. 부서장이 없으면 승인할 사람이 없으므로 PUR-001.
   */
  async createRequisition(tx: Tx, input: CreateRequisitionInput, actor: AuthUser, origin?: RequisitionOrigin): Promise<PurchaseRequisitionDetail> {
    const { requestedTon, desiredReceiptDate } = parseRequestValues(input);
    const item = await this.repository.findItem(tx, input.itemId);
    if (!item) throw new AppException('COM-003', '원료 품목을 찾을 수 없어요');
    if (item.itemType !== ITEM_TYPE.RAW_MATERIAL) throw new AppException('COM-004', '원료 품목만 구매요청할 수 있어요');

    await this.assertHasDepartmentHead(tx, actor.departmentId);

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
    await this.businessEventRecorder.record(tx, {
      type: BUSINESS_EVENT_TYPE.PURCHASE_REQUISITION_CREATED,
      actor,
      target: { table: 'purchase_requisition', id: row.id },
      salesOrderId,
      after: snapshotOf(row),
      reason: row.requestReason,
      actionDraftId: origin?.actionDraftId ?? null,
      messageId: origin?.messageId ?? null,
    });
    return this.toDetail(row);
  }

  // ── 승인·반려·재요청 (REQ-PUR-002, REQ-AUTH-004) ────────

  approve(user: AuthUser, id: number): Promise<PurchaseRequisitionDetail> {
    return retryOnNumberConflict(() =>
      this.prisma.$transaction(async (tx) => {
        const before = await this.mustFindForDecision(tx, user, id);
        await this.changeStatus(tx, before, PURCHASE_REQUISITION_STATUS.WAITING_APPROVAL, { purchaseRequisitionStatus: PURCHASE_REQUISITION_STATUS.APPROVED, approverId: user.employeeId, approvedAt: new Date() });
        return this.recordChange(tx, user, before, BUSINESS_EVENT_TYPE.PURCHASE_REQUISITION_APPROVED, null);
      }),
    );
  }

  async reject(user: AuthUser, id: number, dto: RejectPurchaseRequisitionDto): Promise<PurchaseRequisitionDetail> {
    const rejectReason = dto.rejectReason.trim();
    if (!rejectReason) throw new AppException('COM-004', '반려 사유를 입력해 주세요');
    return retryOnNumberConflict(() =>
      this.prisma.$transaction(async (tx) => {
        const before = await this.mustFindForDecision(tx, user, id);
        await this.changeStatus(tx, before, PURCHASE_REQUISITION_STATUS.WAITING_APPROVAL, { purchaseRequisitionStatus: PURCHASE_REQUISITION_STATUS.REJECTED, approverId: user.employeeId, rejectReason });
        return this.recordChange(tx, user, before, BUSINESS_EVENT_TYPE.PURCHASE_REQUISITION_REJECTED, rejectReason);
      }),
    );
  }

  /**
   * 반려된 요청을 요청자 본인이 수량·희망 입고일·요청 근거를 고쳐 다시 승인 대기로 보낸다. 원료 품목은 바꾸지 않는다.
   * 승인자·반려 사유는 지금 상태를 나타내는 칸이라 비우고, 이전 반려 기록은 작업 로그 before에 남는다.
   */
  async resubmit(user: AuthUser, id: number, dto: ResubmitPurchaseRequisitionDto): Promise<PurchaseRequisitionDetail> {
    const { requestedTon, desiredReceiptDate } = parseRequestValues(dto);
    return retryOnNumberConflict(() =>
      this.prisma.$transaction(async (tx) => {
        const before = await this.mustFindRequisition(tx, id);
        if (before.requesterId !== user.employeeId) throw new AppException('COM-002', '요청자 본인만 재요청할 수 있어요');
        if (before.purchaseRequisitionStatus !== PURCHASE_REQUISITION_STATUS.REJECTED) throw new AppException('COM-001', '반려된 요청만 재요청할 수 있어요');
        await this.assertHasDepartmentHead(tx, before.requester.departmentId);
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
        return this.recordChange(tx, user, before, BUSINESS_EVENT_TYPE.PURCHASE_REQUISITION_CREATED, '반려 후 재요청');
      }),
    );
  }

  // ── 발주 조회 (REQ-PUR-003·004) ───────────────────────

  async listPurchaseOrders(query: ListPurchaseOrdersQuery): Promise<PageResult<PurchaseOrderView>> {
    const filter: PurchaseOrderFilter = { purchaseOrderStatus: query.purchaseOrderStatus, supplierId: query.supplierId };
    const page = query.page ?? 1;
    const size = query.size ?? DEFAULT_PAGE_SIZE;
    const [total, rows] = await Promise.all([this.repository.countPurchaseOrders(this.prisma, filter), this.repository.findPurchaseOrders(this.prisma, filter, { skip: (page - 1) * size, take: size })]);
    return { items: rows.map((row) => this.toPurchaseOrderView(row)), page, size, total };
  }

  async purchaseOrderDetail(id: number): Promise<PurchaseOrderView> {
    const row = await this.repository.findPurchaseOrder(this.prisma, id);
    if (!row) throw new AppException('COM-003', '발주를 찾을 수 없어요');
    return this.toPurchaseOrderView(row);
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
    return retryOnNumberConflict(() => this.prisma.$transaction((tx) => this.createPurchaseOrderInTx(tx, user, dto.supplierId, lines)));
  }

  private async createPurchaseOrderInTx(
    tx: Tx,
    user: AuthUser,
    supplierId: number,
    lines: { purchaseRequisitionId: number; orderedTon: Prisma.Decimal; expectedReceiptDate: Date | null }[],
  ): Promise<PurchaseOrderView> {
    if (!(await this.repository.findSupplier(tx, supplierId))) throw new AppException('COM-003', '공급업체를 찾을 수 없어요');
    const requisitions = await this.repository.findRequisitionsForOrder(tx, lines.map((l) => l.purchaseRequisitionId));
    const items = lines.map((line) => {
      const pr = requisitions.find((r) => r.id === line.purchaseRequisitionId);
      if (!pr) throw new AppException('COM-003', '구매요청을 찾을 수 없어요');
      if (pr.purchaseRequisitionStatus === PURCHASE_REQUISITION_STATUS.ORDERED) throw new AppException('COM-001', `${pr.purchaseRequisitionNo}는 이미 발주된 요청이에요`);
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
    return this.toPurchaseOrderView(order);
  }

  // ── 계산·모양 ─────────────────────────────────────────

  /** 승인·반려 전 확인: 부서장 지정(PUR-001) → 요청자 소속 부서의 부서장(COM-002) → 본인 요청 아님 → 승인 대기(COM-001) */
  private async mustFindForDecision(tx: Tx, user: AuthUser, id: number): Promise<RequisitionRow> {
    const row = await this.mustFindRequisition(tx, id);
    await this.assertHasDepartmentHead(tx, row.requester.departmentId);
    assertDepartmentHead(user, row.requester.departmentId);
    // 부서장 자기 요청의 승인 경로는 TBD(업무 프로세스 16장)이고 자동 승인은 금지라 우선 막는다
    if (row.requesterId === user.employeeId) throw new AppException('COM-002', '본인 요청은 승인·반려할 수 없어요');
    return row;
  }

  /** 상태가 그대로일 때만 바꾼다. 그사이 다른 사람이 처리했으면 0건이라 COM-001 (승인과 재요청이 겹쳐도 한쪽만 반영) */
  private async changeStatus(tx: Tx, row: RequisitionRow, from: PurchaseRequisitionStatus, data: RequisitionStatusChange): Promise<void> {
    const status = row.purchaseRequisitionStatus as PurchaseRequisitionStatus;
    if (status !== from) throw new AppException('COM-001', ALREADY_DONE[status]);
    if ((await this.repository.updateRequisitionIfStatus(tx, row.id, from, data)) === 0) throw new AppException('COM-001', '다른 사람이 먼저 처리한 요청이에요. 다시 조회해 주세요');
  }

  private async recordChange(tx: Tx, user: AuthUser, before: RequisitionRow, type: BusinessEventType, reason: string | null): Promise<PurchaseRequisitionDetail> {
    const after = await this.mustFindRequisition(tx, before.id);
    await this.businessEventRecorder.record(tx, {
      type,
      actor: user,
      target: { table: 'purchase_requisition', id: before.id },
      salesOrderId: after.productionPlan?.salesOrderItem?.salesOrder.id ?? null,
      before: snapshotOf(before),
      after: snapshotOf(after),
      reason,
    });
    return this.toDetail(after);
  }

  private async assertHasDepartmentHead(tx: Tx, departmentId: number): Promise<void> {
    const department = await this.repository.findDepartmentHead(tx, departmentId);
    if (!department?.headEmployeeId) throw new AppException('PUR-001');
  }

  /** MRP를 다시 계산해도 같은 계획의 구매요청을 중복 생성하지 않는다 (API-143 비고) */
  private async assertNoOpenRequisitionForPlan(tx: Tx, productionPlanId: number, itemId: number): Promise<void> {
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

  private toSummary(row: RequisitionRow): PurchaseRequisitionSummary {
    return {
      id: row.id,
      purchaseRequisitionNo: row.purchaseRequisitionNo,
      purchaseRequisitionStatus: row.purchaseRequisitionStatus as PurchaseRequisitionStatus,
      itemId: row.itemId,
      itemCode: row.item.itemCode,
      itemName: row.item.itemName,
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
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toDetail(row: RequisitionRow): PurchaseRequisitionDetail {
    const salesOrder = row.productionPlan?.salesOrderItem?.salesOrder ?? null;
    return {
      ...this.toSummary(row),
      requestReason: row.requestReason,
      rejectReason: row.rejectReason,
      salesOrderId: salesOrder?.id ?? null,
      salesOrderNo: salesOrder?.salesOrderNo ?? null,
    };
  }

  private toPurchaseOrderView(row: PurchaseOrderRow): PurchaseOrderView {
    const zero = new Prisma.Decimal(0);
    const lines = row.purchaseOrderItems.map((line) => {
      const received = line.goodsReceipts.reduce((sum, r) => sum.plus(r.receivedTon), zero);
      return { line, received, remaining: line.orderedTon.minus(received) };
    });
    const total = (pick: (l: (typeof lines)[number]) => Prisma.Decimal) => lines.reduce((sum, l) => sum.plus(pick(l)), zero).toFixed(3);
    return {
      id: row.id,
      purchaseOrderNo: row.purchaseOrderNo,
      purchaseOrderStatus: row.purchaseOrderStatus as PurchaseOrderStatus,
      supplierId: row.supplierId,
      supplierName: row.supplier.supplierName,
      totalOrderedTon: total((l) => l.line.orderedTon),
      totalReceivedTon: total((l) => l.received),
      totalRemainingTon: total((l) => l.remaining),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      items: lines.map(({ line, received, remaining }) => ({
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
      })),
    };
  }
}
