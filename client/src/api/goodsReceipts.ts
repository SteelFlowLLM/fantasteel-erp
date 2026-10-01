// 입고 API (REQ-PUR-004, REQ-LOT-003·004, BP-PUR-02, 업무 프로세스 10장 "입고: 상태값 없음").
// 입고 등록 = 입고 확정(수정 없음). 미입고량을 넘으면 PUR-003. 야드는 원료의 기본 야드로 자동 지정하고,
// 입고 1건마다 원료 LOT(RM-원료코드-YYMMDD-NNN) 1개를 만든다. 규칙·작업 로그는 core 서비스(receiveGoods)가 한다.
import { PERMISSION, type Permission, type PurchaseOrderStatus } from '@/codes';
import { requireActor } from '@/api/actor';
import { mockMutation, mockQuery } from '@/api/client';
import { decCmp } from '@/lib/decimal';
import { findById, listGoodsReceipts, listPurchaseOrders, receiveGoods, userActor } from '@/mock/services';

/** 입고 화면을 볼 수 있는 권한 (조회 이상) */
export const GOODS_RECEIPT_VIEW_PERMISSIONS: readonly Permission[] = [PERMISSION.GOODS_RECEIPT_CONFIRM, PERMISSION.PURCHASE_ORDER_CONFIRM];

export const goodsReceiptKeys = {
  all: ['goods-receipts'] as const,
  list: () => ['goods-receipts', 'list'] as const,
  lines: () => ['goods-receipts', 'purchase-order-lines'] as const,
};

/** 입고할 발주 품목 줄 (입고예정 = 발주 − 입고 누계) */
export interface ReceiptLine {
  purchaseOrderItemId: number;
  purchaseOrderId: number;
  purchaseOrderNo: string;
  purchaseOrderStatus: PurchaseOrderStatus;
  supplierName: string;
  dueDate: string | null;
  lineNo: number;
  itemId: number;
  itemCode: string;
  itemName: string;
  purchaseRequisitionNo: string | null;
  orderedTon: string;
  receivedTon: string;
  scheduledReceiptTon: string;
  /** 입고하면 들어갈 원료 기본 야드 */
  defaultYardName: string | null;
  isFullyReceived: boolean;
}

export type GoodsReceiptView = ReturnType<typeof listGoodsReceipts>[number] & { purchaseOrderItemId: number; lotId: number | null };

export interface GoodsReceiptInput {
  purchaseOrderItemId: number;
  /** 톤 (소수 3자리) */
  receivedTon: string;
  /** YYYY-MM-DD */
  receiptDate: string;
}

export interface GoodsReceiptResult {
  goodsReceiptId: number;
  goodsReceiptNo: string;
  receivedTon: string;
  receiptDate: string;
  yardName: string | null;
  lotId: number;
  lotNo: string;
  purchaseOrderNo: string;
  purchaseOrderStatus: PurchaseOrderStatus;
  /** 이 발주 품목의 입고 누계·남은 입고예정 */
  lineReceivedTon: string;
  lineScheduledReceiptTon: string;
}

export const goodsReceiptApi = {
  /** 모든 발주 품목 줄 (입고예정이 남은 줄 먼저, 납기순) */
  lines: (): Promise<ReceiptLine[]> =>
    mockQuery((tables) => {
      requireActor(tables, { view: GOODS_RECEIPT_VIEW_PERMISSIONS });
      return listPurchaseOrders(tables)
        .flatMap((po) =>
          po.items.map((line): ReceiptLine => {
            const item = findById(tables, 'item', line.itemId);
            return {
              purchaseOrderItemId: line.id,
              purchaseOrderId: po.id,
              purchaseOrderNo: po.purchaseOrderNo,
              purchaseOrderStatus: po.purchaseOrderStatus,
              supplierName: po.supplierName,
              dueDate: po.dueDate,
              lineNo: line.lineNo,
              itemId: line.itemId,
              itemCode: line.itemCode,
              itemName: line.itemName,
              purchaseRequisitionNo: line.purchaseRequisitionNo,
              orderedTon: line.orderedTon,
              receivedTon: line.receivedTon,
              scheduledReceiptTon: line.scheduledReceiptTon,
              defaultYardName: findById(tables, 'yard', item?.defaultYardId)?.yardName ?? null,
              isFullyReceived: decCmp(line.scheduledReceiptTon, 0) <= 0,
            };
          }),
        )
        .sort(
          (a, b) =>
            Number(a.isFullyReceived) - Number(b.isFullyReceived) ||
            (a.dueDate ?? '9999-12-31').localeCompare(b.dueDate ?? '9999-12-31') ||
            a.purchaseOrderNo.localeCompare(b.purchaseOrderNo) ||
            a.lineNo - b.lineNo,
        );
    }),

  /** 입고 내역 (최근 것부터) */
  list: (): Promise<GoodsReceiptView[]> =>
    mockQuery((tables) => {
      requireActor(tables, { view: GOODS_RECEIPT_VIEW_PERMISSIONS });
      return listGoodsReceipts(tables).map((receipt) => ({
        ...receipt,
        purchaseOrderItemId: findById(tables, 'goodsReceipt', receipt.id)?.purchaseOrderItemId ?? 0,
        lotId: tables.lot.find((lot) => lot.goodsReceiptId === receipt.id)?.id ?? null,
      }));
    }),

  /** 입고 확정 (등록 = 확정): 원료 LOT 생성, 발주 입고 누계·입고예정·상태 갱신 */
  receive: (input: GoodsReceiptInput): Promise<GoodsReceiptResult> =>
    mockMutation((tx) => {
      const actor = requireActor(tx.tables, { use: [PERMISSION.GOODS_RECEIPT_CONFIRM] });
      const { goodsReceipt, lot, purchaseOrder } = receiveGoods(tx, userActor(actor.employee.id), {
        purchaseOrderItemId: input.purchaseOrderItemId,
        receivedTon: input.receivedTon,
        receiptDate: input.receiptDate,
      });
      const line = findById(tx.tables, 'purchaseOrderItem', input.purchaseOrderItemId);
      return {
        goodsReceiptId: goodsReceipt.id,
        goodsReceiptNo: goodsReceipt.goodsReceiptNo,
        receivedTon: goodsReceipt.receivedTon,
        receiptDate: goodsReceipt.receiptDate,
        yardName: findById(tx.tables, 'yard', goodsReceipt.yardId)?.yardName ?? null,
        lotId: lot.id,
        lotNo: lot.lotNo,
        purchaseOrderNo: purchaseOrder.purchaseOrderNo,
        purchaseOrderStatus: purchaseOrder.purchaseOrderStatus,
        lineReceivedTon: line?.receivedTon ?? goodsReceipt.receivedTon,
        lineScheduledReceiptTon: line?.scheduledReceiptTon ?? '0.000',
      };
    }),
};
