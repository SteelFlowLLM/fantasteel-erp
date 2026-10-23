import { Injectable } from '@nestjs/common';
import { LOT_STATUS, LOT_TYPE, PURCHASE_ORDER_STATUS, PURCHASE_REQUISITION_STATUS, type PurchaseOrderStatus, type PurchaseRequisitionStatus } from '@fantasteel/shared';
import type { Prisma } from '../../generated/prisma/client';
import { cancelRawMaterialLotForReceipt, changePurchaseOrderStatus, lockProductionPlan, lockPurchaseOrderByItemId } from '../../generated/prisma/sql';
import type { Tx } from '../../prisma/prisma.service';

/** 목록·상세가 함께 쓰는 읽기 모양: 품목·요청자(부서)·승인자·근거 계획(→ 수주) */
const requisitionInclude = {
  item: { select: { itemCode: true, itemName: true, defaultSupplierId: true, defaultSupplier: { select: { supplierName: true } } } },
  requester: { select: { employeeName: true, departmentId: true, department: { select: { departmentName: true } } } },
  approver: { select: { employeeName: true } },
  productionPlan: { select: { productionPlanNo: true, salesOrderItem: { select: { salesOrder: { select: { id: true, salesOrderNo: true } } } } } },
  purchaseOrderItem: { select: { purchaseOrder: { select: { purchaseOrderNo: true } } } },
} as const;

/**
 * 같은 계획·품목으로 다시 요청하면 중복인 상태. 반려된 요청은 수정·재요청하므로 새 요청을 막지 않는다.
 * 발주 취소(ORDER_CANCELLED)된 요청과 잔량 마감한 발주의 요청은 더 들어올 원료가 없어 막지 않는다 (BP-PUR-02, 이슈 #500)
 */
const OPEN_REQUISITION_STATUSES: PurchaseRequisitionStatus[] = [PURCHASE_REQUISITION_STATUS.WAITING_APPROVAL, PURCHASE_REQUISITION_STATUS.APPROVED, PURCHASE_REQUISITION_STATUS.ORDERED];
const ON_CLOSED_PURCHASE_ORDER: Prisma.PurchaseRequisitionWhereInput = { purchaseOrderItem: { is: { purchaseOrder: { is: { purchaseOrderStatus: PURCHASE_ORDER_STATUS.CLOSED } } } } };

export interface RequisitionFilter {
  purchaseRequisitionStatus?: PurchaseRequisitionStatus;
  /** 부서장 조회 범위: 이 부서 소속 요청자의 요청만 */
  requesterDepartmentIds?: number[];
  /** 승인함: 이 사원의 요청은 빼고 (본인 요청은 본인이 승인하지 않는다) */
  excludeRequesterId?: number;
}

/** 승인·반려·재요청이 바꾸는 칸 */
export type RequisitionStatusChange = Pick<
  Prisma.PurchaseRequisitionUncheckedUpdateManyInput,
  'purchaseRequisitionStatus' | 'approverId' | 'approvedAt' | 'rejectReason' | 'requestedTon' | 'desiredReceiptDate' | 'requestReason'
>;

const whereOf = (filter: RequisitionFilter): Prisma.PurchaseRequisitionWhereInput => ({
  ...(filter.purchaseRequisitionStatus ? { purchaseRequisitionStatus: filter.purchaseRequisitionStatus } : {}),
  ...(filter.requesterDepartmentIds ? { requester: { departmentId: { in: filter.requesterDepartmentIds } } } : {}),
  ...(filter.excludeRequesterId !== undefined ? { requesterId: { not: filter.excludeRequesterId } } : {}),
});

/** 발주 목록·상세가 함께 쓰는 읽기 모양: 공급업체·품목별 원료·구매요청·입고 기록(입고 누계 계산용) */
const purchaseOrderInclude = {
  supplier: { select: { supplierName: true } },
  purchaseOrderItems: {
    orderBy: { id: 'asc' },
    include: {
      item: { select: { itemCode: true, itemName: true } },
      purchaseRequisition: { select: { purchaseRequisitionNo: true } },
      goodsReceipts: { select: { receivedTon: true } },
    },
  },
} as const;

/** 입고 목록 읽기 모양: 발주·원료·생성된 원료 LOT(야드)·입고 취소로 이어진 입고 */
const goodsReceiptInclude = {
  lot: {
    select: {
      id: true,
      lotNo: true,
      lotStatus: true,
      initialTon: true,
      remainingTon: true,
      yardId: true,
      yard: { select: { yardName: true } },
      _count: { select: { lotRelationsAsParentLot: true, allocations: true } },
    },
  },
  reversedGoodsReceipt: { select: { goodsReceiptNo: true } },
  reversal: { select: { goodsReceiptNo: true } },
  purchaseOrderItem: {
    select: { purchaseOrderId: true, itemId: true, item: { select: { itemCode: true, itemName: true } }, purchaseOrder: { select: { purchaseOrderNo: true, purchaseOrderStatus: true } } },
  },
} as const;

const goodsReceiptWhereOf = (purchaseOrderId?: number): Prisma.GoodsReceiptWhereInput => (purchaseOrderId !== undefined ? { purchaseOrderItem: { purchaseOrderId } } : {});

export interface PurchaseOrderFilter {
  purchaseOrderStatus?: PurchaseOrderStatus;
  supplierId?: number;
}

const purchaseOrderWhereOf = (filter: PurchaseOrderFilter): Prisma.PurchaseOrderWhereInput => ({
  ...(filter.purchaseOrderStatus ? { purchaseOrderStatus: filter.purchaseOrderStatus } : {}),
  ...(filter.supplierId !== undefined ? { supplierId: filter.supplierId } : {}),
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

  /** 생산계획 행을 잠근다 (같은 계획의 원료 구매요청을 동시에 두 건 만들지 않게). 없으면 null */
  async lockProductionPlan(tx: Tx, productionPlanId: number) {
    return (await tx.$queryRawTyped(lockProductionPlan(productionPlanId)))[0] ?? null;
  }

  findOpenRequisitionForPlan(tx: Tx, productionPlanId: number, itemId: number) {
    return tx.purchaseRequisition.findFirst({
      where: { productionPlanId, itemId, purchaseRequisitionStatus: { in: OPEN_REQUISITION_STATUSES }, NOT: ON_CLOSED_PURCHASE_ORDER },
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
    return tx.purchaseRequisition.create({ data });
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

  /** 승인·반려·재요청 트랜잭션용: 구매요청과 요청자 부서만 (관계를 여러 개 읽으면 트랜잭션 연결에 쿼리가 겹친다) */
  findRequisitionForChange(tx: Tx, id: number) {
    return tx.purchaseRequisition.findUnique({ where: { id }, include: { requester: { select: { departmentId: true } } } });
  }

  /** 상태가 from일 때만 바꾸는 조건부 UPDATE. 바뀐 건수(0 또는 1)를 돌려준다 */
  async updateRequisitionIfStatus(tx: Tx, id: number, from: PurchaseRequisitionStatus, data: RequisitionStatusChange): Promise<number> {
    const { count } = await tx.purchaseRequisition.updateMany({ where: { id, purchaseRequisitionStatus: from }, data });
    return count;
  }

  findSupplier(tx: Tx, id: number) {
    return tx.supplier.findUnique({ where: { id }, select: { id: true } });
  }

  /** 발주할 구매요청: 상태·요청량·희망 입고일과 원료의 기본 공급업체 */
  findRequisitionsForOrder(tx: Tx, ids: number[]) {
    return tx.purchaseRequisition.findMany({
      where: { id: { in: ids } },
      select: { id: true, purchaseRequisitionNo: true, purchaseRequisitionStatus: true, itemId: true, requestedTon: true, desiredReceiptDate: true, item: { select: { defaultSupplierId: true } } },
    });
  }

  createPurchaseOrder(tx: Tx, data: { purchaseOrderNo: string; supplierId: number; items: { purchaseRequisitionId: number; itemId: number; orderedTon: Prisma.Decimal; expectedReceiptDate: Date }[] }) {
    return tx.purchaseOrder.create({
      data: { purchaseOrderNo: data.purchaseOrderNo, supplierId: data.supplierId, purchaseOrderItems: { create: data.items } },
      select: { id: true, purchaseOrderNo: true, purchaseOrderStatus: true },
    });
  }

  countPurchaseOrders(tx: Tx, filter: PurchaseOrderFilter) {
    return tx.purchaseOrder.count({ where: purchaseOrderWhereOf(filter) });
  }

  findPurchaseOrders(tx: Tx, filter: PurchaseOrderFilter, page: { skip: number; take: number }) {
    return tx.purchaseOrder.findMany({ where: purchaseOrderWhereOf(filter), include: purchaseOrderInclude, orderBy: { id: 'desc' }, skip: page.skip, take: page.take });
  }

  findPurchaseOrder(tx: Tx, id: number) {
    return tx.purchaseOrder.findUnique({ where: { id }, include: purchaseOrderInclude });
  }

  /** 대상별 작업 로그(최근 것부터). ERD에 칸이 없는 반려 일시·발주자·입고 확정자·취소 사유를 여기서 읽는다 */
  findEvents(tx: Tx, businessEventType: string, targetType: string, targetIds: number[]) {
    return tx.businessEvent.findMany({
      where: { businessEventType, targetType, targetId: { in: targetIds } },
      select: { targetId: true, createdAt: true, reason: true, actorEmployee: { select: { employeeName: true } } },
      orderBy: { id: 'desc' },
    });
  }

  /** 발주 취소·잔량 마감 전 확인용 상태 */
  findPurchaseOrderStatus(tx: Tx, id: number) {
    return tx.purchaseOrder.findUnique({ where: { id }, select: { id: true, purchaseOrderNo: true, purchaseOrderStatus: true } });
  }

  /** 발주 취소·잔량 마감 작업 로그용 품목별 발주량·입고 기록 (상태를 바꿔 발주 행을 잡은 뒤 읽는다) */
  findPurchaseOrderLines(tx: Tx, purchaseOrderId: number) {
    return tx.purchaseOrderItem.findMany({
      where: { purchaseOrderId },
      orderBy: { id: 'asc' },
      select: { id: true, purchaseRequisitionId: true, itemId: true, orderedTon: true, goodsReceipts: { select: { receivedTon: true } } },
    });
  }

  findRequisitionNos(tx: Tx, ids: number[]) {
    return tx.purchaseRequisition.findMany({ where: { id: { in: ids } }, select: { id: true, purchaseRequisitionNo: true } });
  }

  /** 발주 상태가 from일 때만 바꾸는 조건부 UPDATE(TypedSQL). 바뀐 건수(0 또는 1)를 돌려준다 */
  async changePurchaseOrderStatus(tx: Tx, id: number, from: PurchaseOrderStatus, to: PurchaseOrderStatus): Promise<number> {
    return (await tx.$queryRawTyped(changePurchaseOrderStatus(id, from, to))).length;
  }

  /** 발주 행 잠금(TypedSQL). 발주 품목이 없으면 빈 배열 */
  lockPurchaseOrderByItemId(tx: Tx, purchaseOrderItemId: number) {
    return tx.$queryRawTyped(lockPurchaseOrderByItemId(purchaseOrderItemId));
  }

  /** 입고할 발주 품목과 같은 발주의 모든 품목 입고 기록(미입고량·발주 상태 계산용). 원료는 findReceiptItem으로 따로 읽는다 */
  findPurchaseOrderItemForReceipt(tx: Tx, id: number) {
    return tx.purchaseOrderItem.findUnique({
      where: { id },
      select: {
        id: true,
        itemId: true,
        orderedTon: true,
        purchaseOrder: {
          select: { id: true, purchaseOrderNo: true, purchaseOrderStatus: true, purchaseOrderItems: { select: { id: true, orderedTon: true, goodsReceipts: { select: { receivedTon: true } } } } },
        },
      },
    });
  }

  /** 원료 LOT 번호·야드에 쓰는 원료 코드·기본 야드 */
  findReceiptItem(tx: Tx, id: number) {
    return tx.item.findUniqueOrThrow({ where: { id }, select: { itemCode: true, defaultYardId: true } });
  }

  /** 입고 취소는 reversedGoodsReceiptId(취소한 입고)와 음수 receivedTon으로 남긴다 */
  createGoodsReceipt(tx: Tx, data: { goodsReceiptNo: string; purchaseOrderItemId: number; receivedTon: Prisma.Decimal; receivedDate: Date; reversedGoodsReceiptId?: number }) {
    return tx.goodsReceipt.create({ data, select: { id: true } });
  }

  /** 입고 취소 확인용 (관계 없이) */
  findGoodsReceiptForCancel(tx: Tx, id: number) {
    return tx.goodsReceipt.findUnique({ where: { id }, select: { id: true, goodsReceiptNo: true, purchaseOrderItemId: true, receivedTon: true, reversedGoodsReceiptId: true } });
  }

  /** 이 입고를 취소한 행 (없으면 null) */
  findReversalOf(tx: Tx, goodsReceiptId: number) {
    return tx.goodsReceipt.findUnique({ where: { reversedGoodsReceiptId: goodsReceiptId }, select: { id: true } });
  }

  /** 입고 1건 = 원료 LOT 1개 */
  findLotOfReceipt(tx: Tx, goodsReceiptId: number) {
    return tx.lot.findUnique({ where: { goodsReceiptId }, select: { id: true, lotNo: true } });
  }

  /** 쓰지 않은 원료 LOT만 입고 취소로 바꾼다(TypedSQL 조건부 UPDATE). 바꾸기 전 잔량을 돌려주고, 투입·배정했거나 잔량이 줄었으면 null */
  async cancelRawMaterialLot(tx: Tx, lotId: number): Promise<{ remainingTonBefore: string } | null> {
    const row = (await tx.$queryRawTyped(cancelRawMaterialLotForReceipt(lotId)))[0];
    return row ? { remainingTonBefore: row.initial_ton?.toFixed(3) ?? '0.000' } : null;
  }

  /** 입고 1건 = 원료 LOT 1개. 처음 양·잔량 = 입고량 */
  createRawMaterialLot(tx: Tx, data: { lotNo: string; itemId: number; goodsReceiptId: number; yardId: number; ton: Prisma.Decimal }) {
    return tx.lot.create({
      data: { lotNo: data.lotNo, lotType: LOT_TYPE.RAW_MATERIAL, itemId: data.itemId, goodsReceiptId: data.goodsReceiptId, yardId: data.yardId, lotStatus: LOT_STATUS.AVAILABLE, initialTon: data.ton, remainingTon: data.ton },
      select: { id: true, lotNo: true },
    });
  }

  countGoodsReceipts(tx: Tx, purchaseOrderId?: number) {
    return tx.goodsReceipt.count({ where: goodsReceiptWhereOf(purchaseOrderId) });
  }

  findGoodsReceipts(tx: Tx, purchaseOrderId: number | undefined, page: { skip: number; take: number }) {
    return tx.goodsReceipt.findMany({ where: goodsReceiptWhereOf(purchaseOrderId), include: goodsReceiptInclude, orderBy: { id: 'desc' }, skip: page.skip, take: page.take });
  }

  findGoodsReceipt(tx: Tx, id: number) {
    return tx.goodsReceipt.findUniqueOrThrow({ where: { id }, include: goodsReceiptInclude });
  }
}
