// 입고 API (REQ-PUR-004, REQ-LOT-003·004, BP-PUR-02, 업무 프로세스 10장 "입고: 상태값 없음").
// 입고 등록 = 입고 확정(수정 없음). 미입고량을 넘으면 PUR-003. 야드는 원료의 기본 야드로 자동 지정하고,
// 입고 1건마다 원료 LOT(RM-원료코드-YYMMDD-NNN) 1개를 만든다. 규칙·작업 로그는 core 서비스(receiveGoods)가 한다.
// NEXT_PUBLIC_DATA_SOURCE=server면 실제 서버를 부른다 (api/server/purchaseOrders.ts).
import { PERMISSION, type Permission, type PurchaseOrderStatus } from '@/codes';
import { requireActor } from '@/api/actor';
import { mockMutation, mockQuery } from '@/api/client';
import { isServerDataSource } from '@/api/http';
import type { PurchaseOrderView } from '@/api/purchasing';
import { serverMasterDataApi } from '@/api/server/masterData';
import { serverGoodsReceiptApi, serverPurchaseOrderApi } from '@/api/server/purchaseOrders';
import { decCmp } from '@/lib/decimal';
import {
  findById,
  goodsReceiptView,
  listGoodsReceipts,
  listPurchaseOrders,
  mustGet,
  receivedTonOf,
  receiveGoods,
  remainingTonOf,
  userActor,
} from '@/mock/services';

/** 입고 화면을 볼 수 있는 권한 (조회 이상) */
export const GOODS_RECEIPT_VIEW_PERMISSIONS: readonly Permission[] = [PERMISSION.GOODS_RECEIPT_CONFIRM, PERMISSION.PURCHASE_ORDER_CONFIRM];

export const goodsReceiptKeys = {
  all: ['goods-receipts'] as const,
  list: () => ['goods-receipts', 'list'] as const,
  lines: () => ['goods-receipts', 'purchase-order-lines'] as const,
};

/** 입고 1건과 원료 LOT (서버 GoodsReceiptView와 같은 모양 + 화면용 공급업체·확정자) */
export interface GoodsReceiptView {
  id: number;
  goodsReceiptNo: string;
  purchaseOrderId: number;
  purchaseOrderNo: string;
  purchaseOrderItemId: number;
  itemId: number;
  itemCode: string;
  itemName: string;
  receivedTon: string;
  receivedDate: string;
  lotId: number | null;
  lotNo: string | null;
  yardId: number | null;
  yardName: string | null;
  createdAt: string;
  supplierName: string;
  /** 입고를 확정한 사원 (ERD에 칸이 없어 작업 로그 GOODS_RECEIPT_CONFIRMED로 본다) */
  confirmedEmployeeName: string | null;
}

/** 입고할 발주 품목 (미입고량 = 발주량 − 입고 누계, 저장하지 않고 계산) */
export interface ReceiptLine {
  purchaseOrderItemId: number;
  purchaseOrderId: number;
  purchaseOrderNo: string;
  purchaseOrderStatus: PurchaseOrderStatus;
  supplierName: string;
  /** 발주 품목의 입고 예정일 */
  expectedReceiptDate: string | null;
  itemId: number;
  itemCode: string;
  itemName: string;
  purchaseRequisitionNo: string | null;
  orderedTon: string;
  receivedTon: string;
  remainingTon: string;
  /** 입고하면 들어갈 원료 기본 야드 */
  defaultYardName: string | null;
  isFullyReceived: boolean;
}

export interface GoodsReceiptInput {
  purchaseOrderItemId: number;
  /** 톤 (소수 3자리) */
  receivedTon: string;
  /** YYYY-MM-DD, 오늘 이후는 안 된다 */
  receivedDate: string;
}

export interface GoodsReceiptResult {
  goodsReceiptId: number;
  goodsReceiptNo: string;
  receivedTon: string;
  receivedDate: string;
  yardName: string | null;
  lotId: number;
  lotNo: string;
  purchaseOrderNo: string;
  purchaseOrderStatus: PurchaseOrderStatus;
  /** 이 발주 품목의 입고 누계·미입고량 */
  lineReceivedTon: string;
  lineRemainingTon: string;
}

/** 발주 목록 → 입고할 발주 품목 줄 (미입고량이 남은 것 먼저, 입고 예정일 순). 야드는 원료 코드로 찾는다 */
function receiptLinesOf(orders: readonly PurchaseOrderView[], defaultYardNameOf: (itemCode: string) => string | null): ReceiptLine[] {
  return orders
    .flatMap((po) =>
      po.items.map(
        (line): ReceiptLine => ({
          purchaseOrderItemId: line.id,
          purchaseOrderId: po.id,
          purchaseOrderNo: po.purchaseOrderNo,
          purchaseOrderStatus: po.purchaseOrderStatus,
          supplierName: po.supplierName,
          expectedReceiptDate: line.expectedReceiptDate,
          itemId: line.itemId,
          itemCode: line.itemCode,
          itemName: line.itemName,
          purchaseRequisitionNo: line.purchaseRequisitionNo,
          orderedTon: line.orderedTon,
          receivedTon: line.receivedTon,
          remainingTon: line.remainingTon,
          defaultYardName: defaultYardNameOf(line.itemCode),
          isFullyReceived: decCmp(line.remainingTon, 0) <= 0,
        }),
      ),
    )
    .sort(
      (a, b) =>
        Number(a.isFullyReceived) - Number(b.isFullyReceived) ||
        (a.expectedReceiptDate ?? '9999-12-31').localeCompare(b.expectedReceiptDate ?? '9999-12-31') ||
        a.purchaseOrderNo.localeCompare(b.purchaseOrderNo) ||
        a.purchaseOrderItemId - b.purchaseOrderItemId,
    );
}

export const goodsReceiptApi = {
  /** 모든 발주 품목 (미입고량이 남은 것 먼저, 입고 예정일 순) */
  lines: async (): Promise<ReceiptLine[]> =>
    isServerDataSource()
      ? receiptLinesOf(await serverPurchaseOrderApi.list(), await serverMasterDataApi.rawMaterialYardNames())
      : mockQuery((tables) => {
          requireActor(tables, { view: GOODS_RECEIPT_VIEW_PERMISSIONS });
          const yardNameOf = (itemCode: string) => findById(tables, 'yard', tables.item.find((i) => i.itemCode === itemCode)?.defaultYardId)?.yardName ?? null;
          return receiptLinesOf(listPurchaseOrders(tables), yardNameOf);
        }),

  /** 입고 내역 (최근 것부터) */
  list: (): Promise<GoodsReceiptView[]> =>
    isServerDataSource()
      ? serverGoodsReceiptApi.list()
      : mockQuery((tables) => {
          requireActor(tables, { view: GOODS_RECEIPT_VIEW_PERMISSIONS });
          return listGoodsReceipts(tables);
        }),

  /** 입고 확정 (등록 = 확정): 원료 LOT 생성, 발주 상태 갱신 (입고 누계·미입고량은 계산값) */
  receive: (input: GoodsReceiptInput): Promise<GoodsReceiptResult> =>
    isServerDataSource() ? serverGoodsReceiptApi.receive(input) : mockMutation((tx) => {
      const actor = requireActor(tx.tables, { use: [PERMISSION.GOODS_RECEIPT_CONFIRM] });
      const { goodsReceipt, lot, purchaseOrder } = receiveGoods(tx, userActor(actor.employee.id), {
        purchaseOrderItemId: input.purchaseOrderItemId,
        receivedTon: input.receivedTon,
        receivedDate: input.receivedDate,
      });
      return {
        goodsReceiptId: goodsReceipt.id,
        goodsReceiptNo: goodsReceipt.goodsReceiptNo,
        receivedTon: goodsReceipt.receivedTon,
        receivedDate: goodsReceipt.receivedDate,
        yardName: goodsReceiptView(tx.tables, goodsReceipt).yardName,
        lotId: lot.id,
        lotNo: lot.lotNo,
        purchaseOrderNo: purchaseOrder.purchaseOrderNo,
        purchaseOrderStatus: purchaseOrder.purchaseOrderStatus,
        lineReceivedTon: receivedTonOf(tx.tables, input.purchaseOrderItemId),
        lineRemainingTon: remainingTonOf(tx.tables, mustGet(tx.tables, 'purchaseOrderItem', input.purchaseOrderItemId, '발주 품목')),
      };
    }),
};
