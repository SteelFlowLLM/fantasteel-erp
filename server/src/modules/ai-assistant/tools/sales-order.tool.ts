import { PERMISSION, SALES_ORDER_ITEM_STATUS_LABEL, type SalesOrderFulfillment, type SalesOrderSummary } from '@fantasteel/shared';
import { AppException } from '../../../common/errors/app.exception';
import { seoulToday } from '../../../common/time/seoul-date';
import type { SalesOrderService } from '../../sales-order/sales-order.service';
import { daysUntil, limitRows, qtyUnitOf, optionalBoolean, optionalPositiveInt, optionalString, percentText, ToolArgumentError, type AssistantTool } from './assistant-tool';

/** 목록에서 납기 위험만 고를 때 한 번에 읽는 수주 수 (API 상한 100) */
const SCAN_SIZE = 100;

/**
 * 수주 진행 (GET /sales-orders·/sales-orders/:id/fulfillment, 수주 등록 VIEW).
 * 납기까지 남은 일수는 서버가 계산해 넣는다: 모델이 날짜를 직접 셈하면 틀리거나 결과에 없는 말을 덧붙인다.
 */
export function salesOrderTool(salesOrders: SalesOrderService, today: () => string = seoulToday): AssistantTool {
  return {
    access: { checkedBy: 'TOOLBOX', permissions: [PERMISSION.SALES_ORDER_CREATE] },
    definition: {
      name: 'get_sales_orders',
      description:
        '수주 목록과 진행 상황(수주 충족 현황)을 조회한다. 수주번호나 수주 id를 주면 그 수주의 품목별 출하·예약·생산중·미확보 매수를 준다. 미확보 = 미출하 − 예약(재고로 아직 확보하지 못한 매수)이고, 생산중·시작 전 계획 매수가 그 미확보를 채우는 중일 수 있다. 계획을 더 세워야 하는 매수는 "추가 계획 필요 매수"다. 납기 위험 수주를 물으면 dueRiskOnly=true.',
      parameters: {
        type: 'object',
        properties: {
          salesOrderNo: { type: 'string', description: '수주번호 일부 (예: SO-2610-001)' },
          salesOrderId: { type: 'integer', description: '수주 id. 보고 있는 화면 주소에 있으면 쓴다' },
          dueRiskOnly: { type: 'boolean', description: 'true면 납기 위험 수주만' },
        },
      },
    },
    async run(args) {
      const salesOrderNo = optionalString(args, 'salesOrderNo', 30);
      const salesOrderId = optionalPositiveInt(args, 'salesOrderId');
      const dueRiskOnly = optionalBoolean(args, 'dueRiskOnly') ?? false;

      if (salesOrderId !== undefined) {
        const found = await fulfillmentOf(salesOrders, salesOrderId);
        return detailOutput(found, await salesOrders.detail(salesOrderId), today());
      }

      const page = await salesOrders.list({ salesOrderNo, page: 1, size: SCAN_SIZE });
      const rows = dueRiskOnly ? page.items.filter((s) => s.isDueRisk) : page.items;
      const exact = salesOrderNo ? rows.find((s) => s.salesOrderNo.toLowerCase() === salesOrderNo.toLowerCase()) : undefined;
      const one = exact ?? (salesOrderNo && rows.length === 1 ? rows[0] : undefined);
      if (one) return detailOutput(await fulfillmentOf(salesOrders, one.id), one, today());

      const limited = limitRows(rows);
      const unscanned = Math.max(0, page.total - page.items.length);
      return {
        label: `수주${dueRiskOnly ? ' · 납기 위험' : ''}${salesOrderNo ? ` · ${salesOrderNo}` : ''}`,
        // 거른 뒤의 수만 준다: 거르기 전 전체 수를 함께 주면 모델이 그 수를 납기 위험 건수로 말한다
        data: {
          [dueRiskOnly ? '납기 위험 수주 수' : '수주 수']: rows.length,
          수주: limited.rows.map((s) => summaryRow(s, today())),
          '생략 줄 수': limited.omitted,
          ...(unscanned ? { '확인하지 못한 수주 수': unscanned } : {}),
        },
      };
    },
  };
}

async function fulfillmentOf(salesOrders: SalesOrderService, id: number): Promise<SalesOrderFulfillment> {
  try {
    return await salesOrders.fulfillment(id);
  } catch (error) {
    if (error instanceof AppException && error.code === 'COM-003') throw new ToolArgumentError(`수주 id ${id}가 없어요`);
    throw error;
  }
}

function summaryRow(s: SalesOrderSummary, today: string) {
  return {
    수주번호: s.salesOrderNo,
    수주id: s.id,
    고객사: s.customerName,
    담당: s.ownerEmployeeName,
    상태: SALES_ORDER_ITEM_STATUS_LABEL[s.salesOrderStatus],
    '가장 이른 납기': s.earliestDueDate,
    '가장 이른 납기까지 남은 일수': s.earliestDueDate ? daysUntil(s.earliestDueDate, today) : null,
    '납기 위험': s.isDueRisk,
    '수주 매수': s.totalOrderedQty,
    '수주 톤': s.totalOrderedTon,
    '출하 매수': s.totalShippedQty,
    '예약 매수': s.totalActiveReservedQty,
    진행률: percentText(s.progress.ratio),
    '재생산 필요': s.hasReproductionNeed,
  };
}

/** 고객사·담당은 충족 현황에 없어 목록 행(상세)에서 채운다: 'SO-2610-004 담당 누구야?'에 수주 한 건만 찾았을 때도 답하게 */
function detailOutput(f: SalesOrderFulfillment, s: Pick<SalesOrderSummary, 'customerName' | 'ownerEmployeeName'>, today: string) {
  return {
    label: `수주 충족 현황 · ${f.salesOrderNo}`,
    data: {
      수주번호: f.salesOrderNo,
      고객사: s.customerName,
      담당: s.ownerEmployeeName,
      상태: SALES_ORDER_ITEM_STATUS_LABEL[f.salesOrderStatus],
      진행률: percentText(f.progress.ratio),
      품목: f.items.map((i) => ({
        규격: i.itemCode,
        품목: i.itemName,
        '수량 단위': qtyUnitOf(i.itemType),
        납기: i.dueDate,
        '납기까지 남은 일수': daysUntil(i.dueDate, today),
        상태: SALES_ORDER_ITEM_STATUS_LABEL[i.salesOrderItemStatus],
        '납기 위험': i.isDueRisk,
        '수주 매수': i.orderedQty,
        '수주 톤': i.orderedTon,
        '출하 매수': i.shippedQty,
        '미출하 매수': i.unshippedQty,
        '예약 매수': i.activeReservedQty,
        '생산중 매수': i.inProductionQty,
        '시작 전 계획 매수': i.plannedQty,
        '미확보 매수': i.unsecuredQty,
        '추가 계획 필요 매수': i.additionalPlanQty,
        '재생산 필요 매수': i.reproductionNeedQty,
        진행률: percentText(i.progress.ratio),
      })),
    },
  };
}
