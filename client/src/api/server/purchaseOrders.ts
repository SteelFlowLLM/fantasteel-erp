// 발주·입고 화면 ↔ 서버 API (server/src/modules/purchasing). 서버 응답을 화면이 쓰는 모양(가짜 DB와 같은 타입)으로 바꾼다.
// 발주·발주 품목·입고·공급업체·원료 id는 서버 id를 그대로 쓴다.
import type { GoodsReceiptView as ServerGoodsReceiptView, PageResult, PurchaseOrderView as ServerPurchaseOrderView } from '@fantasteel/shared';
import { ApiError, InputError } from '@/api/errors';
import type { GoodsReceiptInput, GoodsReceiptResult, GoodsReceiptView } from '@/api/goodsReceipts';
import { serverRequest } from '@/api/http';
import type { PurchaseOrderCreateInput, PurchaseOrderView, RequisitionPurchaseOrderLine } from '@/api/purchasing';

const PAGE_SIZE = 100;


async function listAll<T>(path: string): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 1; ; page++) {
    const result = await serverRequest<PageResult<T>>('GET', path, { query: { page, size: PAGE_SIZE } });
    rows.push(...result.items);
    if (rows.length >= result.total || result.items.length === 0) return rows;
  }
}

/** 조회 권한이 없으면(COM-002) 빈 목록 */
async function orEmpty<T>(work: Promise<T[]>): Promise<T[]> {
  try {
    return await work;
  } catch (e) {
    if (e instanceof ApiError && e.code === 'COM-002') return [];
    throw e;
  }
}

const allOrders = () => listAll<ServerPurchaseOrderView>('/purchase-orders');
const allReceipts = () => listAll<ServerGoodsReceiptView>('/goods-receipts');

function toOrderView(po: ServerPurchaseOrderView, receipts: readonly ServerGoodsReceiptView[]): PurchaseOrderView {
  return {
    id: po.id,
    purchaseOrderNo: po.purchaseOrderNo,
    supplierId: po.supplierId,
    supplierName: po.supplierName,
    purchaseOrderStatus: po.purchaseOrderStatus,
    orderedEmployeeName: po.orderedEmployeeName,
    createdAt: po.createdAt,
    items: po.items.map((i) => ({
      id: i.purchaseOrderItemId,
      purchaseRequisitionId: i.purchaseRequisitionId,
      itemId: i.itemId,
      itemCode: i.itemCode,
      itemName: i.itemName,
      purchaseRequisitionNo: i.purchaseRequisitionNo,
      orderedTon: i.orderedTon,
      expectedReceiptDate: i.expectedReceiptDate,
      receivedTon: i.receivedTon,
      remainingTon: i.remainingTon,
      goodsReceipts: receipts
        .filter((g) => g.purchaseOrderItemId === i.purchaseOrderItemId)
        .sort((a, b) => a.id - b.id)
        .map((g) => ({ id: g.id, goodsReceiptNo: g.goodsReceiptNo, receivedTon: g.receivedTon, receivedDate: g.receivedDate, lotNo: g.lotNo })),
    })),
  };
}

function toReceiptView(g: ServerGoodsReceiptView, supplierNameOf: ReadonlyMap<number, string>): GoodsReceiptView {
  return { ...g, supplierName: supplierNameOf.get(g.purchaseOrderId) ?? '' };
}

/** 이미 만든 발주가 있으면 오류 문구에 덧붙인다 (서버는 공급업체마다 따로 거래라 앞의 발주는 남는다) */
function withCreated(error: unknown, created: readonly PurchaseOrderView[]): unknown {
  if (created.length === 0) return error;
  const note = `먼저 확정된 발주: ${created.map((po) => po.purchaseOrderNo).join(', ')}`;
  if (error instanceof ApiError) return new ApiError(error.code, [error.detail, note].filter(Boolean).join(' · '));
  if (error instanceof InputError) return new InputError(`${error.message} · ${note}`, { ...error.fieldErrors });
  return new Error(`${error instanceof Error ? error.message : String(error)} · ${note}`);
}

export const serverPurchaseOrderApi = {
  /** 발주 목록: 품목별 입고 내역은 입고 목록에서 붙인다 (입고 조회 권한이 없으면 비운다) */
  list: async (): Promise<PurchaseOrderView[]> => {
    const [orders, receipts] = await Promise.all([allOrders(), orEmpty(allReceipts())]);
    return orders.map((po) => toOrderView(po, receipts));
  },

  /** 공급업체마다 차례로 발주한다. 중간에 실패하면 멈추고 이미 만든 발주 번호를 알린다 */
  create: async (orders: readonly PurchaseOrderCreateInput[]): Promise<PurchaseOrderView[]> => {
    const created: PurchaseOrderView[] = [];
    for (const order of orders) {
      try {
        const po = await serverRequest<ServerPurchaseOrderView>('POST', '/purchase-orders', {
          body: { supplierId: order.supplierId, items: order.items.map((i) => ({ purchaseRequisitionId: i.purchaseRequisitionId, orderedTon: i.orderedTon, expectedReceiptDate: i.expectedReceiptDate || undefined })) },
        });
        created.push(toOrderView(po, []));
      } catch (e) {
        throw withCreated(e, created);
      }
    }
    return created;
  },
};

export const serverGoodsReceiptApi = {
  /** 입고 내역 (최근 것부터). 공급업체 이름은 발주 목록에서 채운다 */
  list: async (): Promise<GoodsReceiptView[]> => {
    const [receipts, orders] = await Promise.all([allReceipts(), orEmpty(allOrders())]);
    const supplierNameOf = new Map(orders.map((po) => [po.id, po.supplierName]));
    return receipts.map((g) => toReceiptView(g, supplierNameOf)).sort((a, b) => b.id - a.id);
  },

  /** 입고 확정. 결과 배너의 발주 상태·입고 누계·미입고량은 그 발주를 다시 읽어 채운다 */
  receive: async (input: GoodsReceiptInput): Promise<GoodsReceiptResult> => {
    const receipt = await serverRequest<ServerGoodsReceiptView>('POST', '/goods-receipts', { body: input });
    const po = await serverRequest<ServerPurchaseOrderView>('GET', `/purchase-orders/${receipt.purchaseOrderId}`);
    const line = po.items.find((i) => i.purchaseOrderItemId === receipt.purchaseOrderItemId);
    return {
      goodsReceiptId: receipt.id,
      goodsReceiptNo: receipt.goodsReceiptNo,
      receivedTon: receipt.receivedTon,
      receivedDate: receipt.receivedDate,
      yardName: receipt.yardName,
      lotId: receipt.lotId ?? 0,
      lotNo: receipt.lotNo ?? '',
      purchaseOrderNo: po.purchaseOrderNo,
      purchaseOrderStatus: po.purchaseOrderStatus,
      lineReceivedTon: line?.receivedTon ?? receipt.receivedTon,
      lineRemainingTon: line?.remainingTon ?? '0.000',
    };
  },
};

/** 구매요청 상세의 "연결 발주": 그 요청을 담은 발주 품목 (발주 조회 권한이 없으면 비운다) */
export async function serverRequisitionPurchaseOrderLines(purchaseRequisitionId: number): Promise<RequisitionPurchaseOrderLine[]> {
  const orders = await orEmpty(allOrders());
  return orders.flatMap((po) =>
    po.items
      .filter((i) => i.purchaseRequisitionId === purchaseRequisitionId)
      .map((i) => ({
        purchaseOrderId: po.id,
        purchaseOrderNo: po.purchaseOrderNo,
        purchaseOrderStatus: po.purchaseOrderStatus,
        supplierName: po.supplierName,
        expectedReceiptDate: i.expectedReceiptDate,
        itemName: i.itemName,
        orderedTon: i.orderedTon,
        receivedTon: i.receivedTon,
        remainingTon: i.remainingTon,
      })),
  );
}
