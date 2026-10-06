import { Injectable } from '@nestjs/common';
import { PURCHASE_REQUISITION_STATUS, type PurchaseRequisitionStatus } from '@fantasteel/shared';
import type { Prisma } from '../../generated/prisma/client';
import type { Tx } from '../../prisma/prisma.service';

/** 목록·상세가 함께 쓰는 읽기 모양: 품목·요청자(부서)·승인자·근거 계획(→ 수주) */
const requisitionInclude = {
  item: { select: { itemCode: true, itemName: true } },
  requester: { select: { employeeName: true, departmentId: true, department: { select: { departmentName: true } } } },
  approver: { select: { employeeName: true } },
  productionPlan: { select: { productionPlanNo: true, salesOrderItem: { select: { salesOrder: { select: { id: true, salesOrderNo: true } } } } } },
} as const;

/** 같은 계획·품목으로 다시 요청하면 중복인 상태. 반려된 요청은 수정·재요청하므로 새 요청을 막지 않는다 */
const OPEN_REQUISITION_STATUSES: PurchaseRequisitionStatus[] = [PURCHASE_REQUISITION_STATUS.WAITING_APPROVAL, PURCHASE_REQUISITION_STATUS.APPROVED, PURCHASE_REQUISITION_STATUS.ORDERED];

export interface RequisitionFilter {
  purchaseRequisitionStatus?: PurchaseRequisitionStatus;
  /** 부서장 조회 범위: 이 부서 소속 요청자의 요청만 */
  requesterDepartmentIds?: number[];
}

/** 승인·반려·재요청이 바꾸는 칸 */
export type RequisitionStatusChange = Pick<
  Prisma.PurchaseRequisitionUncheckedUpdateManyInput,
  'purchaseRequisitionStatus' | 'approverId' | 'approvedAt' | 'rejectReason' | 'requestedTon' | 'desiredReceiptDate' | 'requestReason'
>;

const whereOf =(filter: RequisitionFilter): Prisma.PurchaseRequisitionWhereInput => ({
  ...(filter.purchaseRequisitionStatus ? { purchaseRequisitionStatus: filter.purchaseRequisitionStatus } : {}),
  ...(filter.requesterDepartmentIds ? { requester: { departmentId: { in: filter.requesterDepartmentIds } } } : {}),
});

/**
 * DB 접근은 여기서만 한다. 함수의 첫 인자는 tx (컨벤션 8장).
 * 집계·3개 이상 JOIN·잠금(FOR UPDATE)은 prisma/sql/*.sql(TypedSQL)로 만들고 tx.$queryRawTyped(...)로 부른다.
 */
@Injectable()
export class PurchasingRepository {
  findItem(tx: Tx, id: number) {
    return tx.item.findUnique({ where: { id }, select: { id: true, itemType: true } });
  }

  findDepartmentHead(tx: Tx, departmentId: number) {
    return tx.department.findUnique({ where: { id: departmentId }, select: { headEmployeeId: true } });
  }

  findProductionPlan(tx: Tx, id: number) {
    return tx.productionPlan.findUnique({ where: { id }, select: { id: true, salesOrderItem: { select: { salesOrderId: true } } } });
  }

  findOpenRequisitionForPlan(tx: Tx, productionPlanId: number, itemId: number) {
    return tx.purchaseRequisition.findFirst({
      where: { productionPlanId, itemId, purchaseRequisitionStatus: { in: OPEN_REQUISITION_STATUSES } },
      select: { purchaseRequisitionNo: true },
    });
  }

  createRequisition(
    tx: Tx,
    data: {
      purchaseRequisitionNo: string;
      itemId: number;
      requestedTon: Prisma.Decimal;
      desiredReceiptDate: Date;
      requesterId: number;
      requestReason: string | null;
      productionPlanId: number | null;
      actionDraftId: number | null;
    },
  ) {
    return tx.purchaseRequisition.create({ data, include: requisitionInclude });
  }

  countRequisitions(tx: Tx, filter: RequisitionFilter) {
    return tx.purchaseRequisition.count({ where: whereOf(filter) });
  }

  findRequisitions(tx: Tx, filter: RequisitionFilter, page: { skip: number; take: number }) {
    return tx.purchaseRequisition.findMany({ where: whereOf(filter), include: requisitionInclude, orderBy: { id: 'desc' }, skip: page.skip, take: page.take });
  }

  findRequisition(tx: Tx, id: number) {
    return tx.purchaseRequisition.findUnique({ where: { id }, include: requisitionInclude });
  }

  /** 상태가 from일 때만 바꾸는 조건부 UPDATE. 바뀐 건수(0 또는 1)를 돌려준다 */
  async updateRequisitionIfStatus(tx: Tx, id: number, from: PurchaseRequisitionStatus, data: RequisitionStatusChange): Promise<number> {
    const { count } = await tx.purchaseRequisition.updateMany({ where: { id, purchaseRequisitionStatus: from }, data });
    return count;
  }
}
