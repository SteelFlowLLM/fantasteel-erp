import {
  PERMISSION,
  PURCHASE_ORDER_STATUS,
  PURCHASE_ORDER_STATUS_LABEL,
  PURCHASE_REQUISITION_STATUS,
  PURCHASE_REQUISITION_STATUS_LABEL,
  type GoodsReceiptView,
  type PurchaseOrderStatus,
  type PurchaseOrderView,
  type PurchaseRequisitionStatus,
  type PurchaseRequisitionSummary,
} from '@fantasteel/shared';
import type { PurchasingService } from '../../purchasing/purchasing.service';
import { codeLabelList, limitRows, looseIncludes, optionalEnum, optionalString, scanFiltered, TOOL_ROW_LIMIT, unscannedField, type AssistantTool } from './assistant-tool';

const REQUISITION_STATUSES = Object.values(PURCHASE_REQUISITION_STATUS) as PurchaseRequisitionStatus[];
const ORDER_STATUSES = Object.values(PURCHASE_ORDER_STATUS) as PurchaseOrderStatus[];

/** 구매요청 (GET /purchase-requisitions). 권한이 "구매요청 등록 VIEW 또는 요청자 소속 부서장"이라 service가 확인한다 */
export function purchaseRequisitionTool(purchasing: PurchasingService): AssistantTool {
  return {
    access: { checkedBy: 'SERVICE', permissions: [PERMISSION.PURCHASE_REQUISITION_CREATE], note: '부서장은 자기 부서 사원의 구매요청을 볼 수 있어요' },
    definition: {
      name: 'get_purchase_requisitions',
      description: '구매요청(원료·요청 톤·희망 입고일·요청자·승인·반려한 부서장·발주 번호)을 조회한다. "승인 대기 구매요청"을 물으면 status=WAITING_APPROVAL.',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: REQUISITION_STATUSES, description: `구매요청 상태: ${codeLabelList(PURCHASE_REQUISITION_STATUS_LABEL)}` },
          keyword: { type: 'string', description: '구매요청 번호·원료 코드·원료 이름 일부' },
        },
      },
    },
    async run(args, user) {
      const status = optionalEnum(args, 'status', REQUISITION_STATUSES);
      const keyword = optionalString(args, 'keyword');
      // 번호·원료는 API에 거를 칸이 없어 쪽을 읽어 거른다. 거르지 않으면 전체 수는 API의 total
      const scan = keyword
        ? await scanFiltered((page, size) => purchasing.listRequisitions(user, { purchaseRequisitionStatus: status, page, size }), (r) => looseIncludes([r.purchaseRequisitionNo, r.itemCode, r.itemName], keyword))
        : await purchasing.listRequisitions(user, { purchaseRequisitionStatus: status, page: 1, size: TOOL_ROW_LIMIT }).then((page) => ({ rows: page.items, total: page.total, unscanned: 0 }));
      const limited = limitRows(scan.rows);
      return {
        label: `구매요청${status ? ` · ${PURCHASE_REQUISITION_STATUS_LABEL[status]}` : ''}${keyword ? ` · ${keyword}` : ''}`,
        data: {
          '구매요청 수': keyword ? scan.rows.length : scan.total,
          구매요청: limited.rows.map(requisitionRow),
          '생략 줄 수': keyword ? limited.omitted : Math.max(0, scan.total - limited.rows.length),
          ...unscannedField('구매요청', scan.unscanned),
        },
      };
    },
  };
}

/** 발주와 입고예정 (GET /purchase-orders, 발주 확정 VIEW). 입고예정 = 발주 품목의 미입고 톤 (TRM 입고예정) */
export function purchaseOrderTool(purchasing: PurchasingService): AssistantTool {
  return {
    access: { checkedBy: 'TOOLBOX', permissions: [PERMISSION.PURCHASE_ORDER_CONFIRM] },
    definition: {
      name: 'get_purchase_orders',
      description:
        '발주와 입고예정을 조회한다. 발주 품목별 발주 톤·입고예정일·입고 톤·미입고 톤(= 입고예정)을 준다. "입고예정"을 물으면 쓴다. 발주 취소·잔량 마감한 발주는 미입고 톤이 0이고 닫은 양은 마감 톤에 있다.',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ORDER_STATUSES, description: `발주 상태: ${codeLabelList(PURCHASE_ORDER_STATUS_LABEL)}` },
          keyword: { type: 'string', description: '발주 번호·공급업체·원료 코드·원료 이름 일부' },
        },
      },
    },
    async run(args) {
      const status = optionalEnum(args, 'status', ORDER_STATUSES);
      const keyword = optionalString(args, 'keyword');
      const scan = keyword
        ? await scanFiltered(
            (page, size) => purchasing.listPurchaseOrders({ purchaseOrderStatus: status, page, size }),
            (o) => looseIncludes([o.purchaseOrderNo, o.supplierName, ...o.items.flatMap((i) => [i.itemCode, i.itemName])], keyword),
          )
        : await purchasing.listPurchaseOrders({ purchaseOrderStatus: status, page: 1, size: TOOL_ROW_LIMIT }).then((page) => ({ rows: page.items, total: page.total, unscanned: 0 }));
      const limited = limitRows(scan.rows);
      return {
        label: `발주·입고예정${status ? ` · ${PURCHASE_ORDER_STATUS_LABEL[status]}` : ''}${keyword ? ` · ${keyword}` : ''}`,
        data: {
          '발주 수': keyword ? scan.rows.length : scan.total,
          발주: limited.rows.map(orderRow),
          '생략 줄 수': keyword ? limited.omitted : Math.max(0, scan.total - limited.rows.length),
          ...unscannedField('발주', scan.unscanned),
        },
      };
    },
  };
}

/** 입고 (GET /goods-receipts, 입고 확정 VIEW). 최신순 */
export function goodsReceiptTool(purchasing: PurchasingService): AssistantTool {
  return {
    access: { checkedBy: 'TOOLBOX', permissions: [PERMISSION.GOODS_RECEIPT_CONFIRM] },
    definition: {
      name: 'get_goods_receipts',
      description: '입고 확정된 원료 입고(입고일·발주 번호·원료·입고 톤·원료 LOT·야드)를 조회한다. 입고 취소는 음수 입고 톤의 입고 취소 줄로 남고, 취소된 입고에는 취소 번호가 있다.',
      parameters: {
        type: 'object',
        properties: { keyword: { type: 'string', description: '입고 번호·발주 번호·원료 코드·원료 이름 일부' } },
      },
    },
    async run(args) {
      const keyword = optionalString(args, 'keyword');
      const scan = keyword
        ? await scanFiltered((page, size) => purchasing.listGoodsReceipts({ page, size }), (g) => looseIncludes([g.goodsReceiptNo, g.purchaseOrderNo, g.itemCode, g.itemName], keyword))
        : await purchasing.listGoodsReceipts({ page: 1, size: TOOL_ROW_LIMIT }).then((page) => ({ rows: page.items, total: page.total, unscanned: 0 }));
      const limited = limitRows(scan.rows);
      return {
        label: `입고${keyword ? ` · ${keyword}` : ''}`,
        data: {
          '입고 수': keyword ? scan.rows.length : scan.total,
          입고: limited.rows.map(receiptRow),
          '생략 줄 수': keyword ? limited.omitted : Math.max(0, scan.total - limited.rows.length),
          ...unscannedField('입고', scan.unscanned),
        },
      };
    },
  };
}

function requisitionRow(r: PurchaseRequisitionSummary) {
  return {
    '구매요청 번호': r.purchaseRequisitionNo,
    상태: PURCHASE_REQUISITION_STATUS_LABEL[r.purchaseRequisitionStatus],
    원료: r.itemCode,
    '원료 이름': r.itemName,
    '요청 톤': r.requestedTon,
    '희망 입고일': r.desiredReceiptDate,
    요청자: r.requesterName,
    부서: r.departmentName,
    // 승인 전에는 비어 있다. '승인권자'(요청자 소속 부서장)로 쓰면 모델이 승인권자 미지정으로 읽는다
    '승인·반려한 부서장': r.approverName,
    '발주 번호': r.purchaseOrderNo,
    '생산계획 번호': r.productionPlanNo,
  };
}

function orderRow(o: PurchaseOrderView) {
  return {
    '발주 번호': o.purchaseOrderNo,
    상태: PURCHASE_ORDER_STATUS_LABEL[o.purchaseOrderStatus],
    공급업체: o.supplierName,
    '발주 톤': o.totalOrderedTon,
    '입고 톤': o.totalReceivedTon,
    '미입고 톤': o.totalRemainingTon,
    '마감 톤': o.totalClosedTon,
    '취소·마감 사유': o.statusChange?.reason ?? null,
    품목: o.items.map((i) => ({ 원료: i.itemCode, '원료 이름': i.itemName, '발주 톤': i.orderedTon, 입고예정일: i.expectedReceiptDate, '입고 톤': i.receivedTon, '미입고 톤': i.remainingTon, '마감 톤': i.closedTon })),
  };
}

function receiptRow(g: GoodsReceiptView) {
  return {
    '입고 번호': g.goodsReceiptNo,
    // 취소 행은 입고일이 취소한 날이다
    구분: g.reversedGoodsReceiptId === null ? '입고' : '입고 취소',
    '취소한 입고 번호': g.reversedGoodsReceiptNo,
    '취소 번호': g.reversalGoodsReceiptNo,
    '취소 사유': g.cancelReason,
    입고일: g.receivedDate,
    '발주 번호': g.purchaseOrderNo,
    원료: g.itemCode,
    '원료 이름': g.itemName,
    '입고 톤': g.receivedTon,
    '원료 LOT': g.lotNo,
    야드: g.yardName,
    확정자: g.confirmedEmployeeName,
  };
}
