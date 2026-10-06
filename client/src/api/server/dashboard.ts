// 대시보드 위젯 ↔ 서버 API (server/src/modules/dashboard). 서버가 데이터를 주는 영업 위젯 3개만 바꾼다.
// 나머지 위젯(작업 로그·수율·원료·불합격률 …)은 아직 가짜 DB를 읽는다.
import type { OrderFulfillmentWidget, ProcessFlowWidget, ProductStockWidget } from '@fantasteel/shared';
import type { OrderFulfillmentData, ProcessFlowData, ProductStockData } from '@/api/dashboard';
import { serverRequest } from '@/api/http';
import { mockItemOf } from '@/api/server/masterIds';
import type { ProductItemType } from '@/codes';

const productType = (itemType: string): ProductItemType => (itemType === 'COIL' ? 'COIL' : 'SLAB');

/** 공정 흐름 현황: 서버도 단계마다 권한을 보고 없으면 null을 준다 */
async function processFlow(): Promise<ProcessFlowData> {
  return serverRequest<ProcessFlowWidget>('GET', '/dashboard/widgets/process-flow');
}

/** 수주 충족 현황: 진행 중 수주, 가장 이른 납기 순. 납기 위험은 서버가 생산 설정값(기준일)으로 계산한다 */
async function orderFulfillment(): Promise<OrderFulfillmentData> {
  const w = await serverRequest<OrderFulfillmentWidget>('GET', '/dashboard/widgets/order-fulfillment');
  return {
    today: w.today,
    deliveryRiskDays: w.deliveryRiskDays,
    salesOrders: w.salesOrders.map((so) => ({
      salesOrderId: so.salesOrderId,
      salesOrderNo: so.salesOrderNo,
      customerName: so.customerName,
      earliestDueDate: so.earliestDueDate,
      isDueRisk: so.isDueRisk,
      items: so.items.map((i, index) => ({
        salesOrderItemId: i.salesOrderItemId,
        lineNo: index + 1,
        itemCode: i.itemCode,
        itemType: productType(i.itemType),
        orderedQty: i.orderedQty,
        orderedTon: i.orderedTon,
        inProductionQty: i.inProductionQty,
        passedQty: i.passedQty,
        reservedQty: i.activeReservedQty,
        unshippedQty: i.unshippedQty,
        shippedQty: i.shippedQty,
        shippedRatio: i.progress.ratio,
        dueDate: i.dueDate,
        daysToDue: i.daysToDue,
        isDueRisk: i.isDueRisk,
      })),
    })),
  };
}

/** 제품 재고: 서버 on_hand가 곧 합격 재고(적격·미소진·미출고)라 passedQty에 같은 값을 둔다 */
async function productStock(): Promise<ProductStockData> {
  const w = await serverRequest<ProductStockWidget>('GET', '/dashboard/widgets/product-stock');
  return {
    totals: w.totals.map((t) => ({
      itemType: productType(t.itemType),
      onHandQty: t.onHandQty,
      passedQty: t.onHandQty,
      reservedQty: t.reservedQty,
      availableQty: t.availableQty,
      onHandTon: t.onHandTon,
      availableTon: t.availableTon,
    })),
    items: w.items.map((r) => ({
      itemId: mockItemOf(r.itemCode)?.id ?? r.itemId,
      itemCode: r.itemCode,
      itemType: productType(r.itemType),
      steelGradeCode: r.steelGradeCode,
      onHandQty: r.onHandQty,
      passedQty: r.onHandQty,
      reservedQty: r.reservedQty,
      availableQty: r.availableQty,
      onHandTon: r.onHandTon,
      availableTon: r.availableTon,
    })),
  };
}

export const serverDashboardApi = { processFlow, orderFulfillment, productStock };
