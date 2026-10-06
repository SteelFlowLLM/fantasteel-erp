import { Injectable } from '@nestjs/common';
import {
  BUSINESS_EVENT_TYPE,
  ITEM_TYPE,
  PERMISSION,
  type AuthUser,
  type PageResult,
  type PurchaseRequisitionDetail,
  type PurchaseRequisitionStatus,
  type PurchaseRequisitionSummary,
} from '@fantasteel/shared';
import { hasPermission } from '../../common/auth/auth.guard';
import { BusinessEventRecorder } from '../../common/business-event/business-event.recorder';
import { AppException } from '../../common/errors/app.exception';
import { NumberingService } from '../../common/numbering/numbering.service';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import type { CreatePurchaseRequisitionDto, ListPurchaseRequisitionsQuery } from './dto/purchase-requisition.dto';
import { PurchasingRepository, type RequisitionFilter } from './purchasing.repository';

type RequisitionRow = NonNullable<Awaited<ReturnType<PurchasingRepository['findRequisition']>>>;

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
    if (!TON_PATTERN.test(input.requestedTon)) throw new AppException('COM-004', '수량(톤)은 정수 9자리·소수 3자리 이하의 숫자로 입력해 주세요');
    const requestedTon = new Prisma.Decimal(input.requestedTon);
    if (requestedTon.lte(0)) throw new AppException('COM-004', '수량(톤)은 0보다 커야 해요');
    if (!isValidDate(input.desiredReceiptDate)) throw new AppException('COM-004', `희망 입고일 ${input.desiredReceiptDate}는 없는 날짜예요`);

    const item = await this.repository.findItem(tx, input.itemId);
    if (!item) throw new AppException('COM-003', '원료 품목을 찾을 수 없어요');
    if (item.itemType !== ITEM_TYPE.RAW_MATERIAL) throw new AppException('COM-004', '원료 품목만 구매요청할 수 있어요');

    const department = await this.repository.findDepartmentHead(tx, actor.departmentId);
    if (!department?.headEmployeeId) throw new AppException('PUR-001');

    const productionPlanId = input.productionPlanId ?? null;
    let salesOrderId: number | null = null;
    if (productionPlanId !== null) {
      const plan = await this.repository.findProductionPlan(tx, productionPlanId);
      if (!plan) throw new AppException('COM-003', '생산계획을 찾을 수 없어요');
      salesOrderId = plan.salesOrderItem?.salesOrderId ?? null;
      // MRP를 다시 계산해도 같은 계획의 구매요청을 중복 생성하지 않는다 (API-143 비고)
      const open = await this.repository.findOpenRequisitionForPlan(tx, productionPlanId, item.id);
      if (open) throw new AppException('COM-004', `같은 생산계획·원료로 진행 중인 구매요청 ${open.purchaseRequisitionNo}이 있어요`);
    }

    const row = await this.repository.createRequisition(tx, {
      purchaseRequisitionNo: await this.numbering.nextDocumentNumber(tx, 'PURCHASE_REQUISITION'),
      itemId: item.id,
      requestedTon,
      desiredReceiptDate: new Date(`${input.desiredReceiptDate}T00:00:00.000Z`),
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
      after: {
        purchaseRequisitionNo: row.purchaseRequisitionNo,
        purchaseRequisitionStatus: row.purchaseRequisitionStatus,
        itemId: row.itemId,
        requestedTon: row.requestedTon.toFixed(3),
        desiredReceiptDate: dateOnly(row.desiredReceiptDate),
        requesterId: row.requesterId,
        productionPlanId: row.productionPlanId,
      },
      reason: row.requestReason,
      actionDraftId: origin?.actionDraftId ?? null,
      messageId: origin?.messageId ?? null,
    });
    return this.toDetail(row);
  }

  // ── 계산·모양 ─────────────────────────────────────────

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
}
