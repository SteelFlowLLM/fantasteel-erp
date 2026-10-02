// 대시보드 위젯 응답 타입 (REQ-DSH-001·002, BP-DSH-01 "권한 내 집계"). 권한이 없는 단계는 null로 준다.
import type { ItemType } from './codes';
import type { ProgressMeasure, SalesOrderItemFulfillment } from './sales-order';

/** 서버가 데이터를 주는 위젯. AGENT_RISK(Agent 위험 감지)·대응 후보는 P2라 없다 */
export const DASHBOARD_WIDGET_KEY = {
  PROCESS_FLOW: 'PROCESS_FLOW',
  ORDER_FULFILLMENT: 'ORDER_FULFILLMENT',
  PRODUCT_STOCK: 'PRODUCT_STOCK',
} as const;
export type DashboardWidgetKey = (typeof DASHBOARD_WIDGET_KEY)[keyof typeof DASHBOARD_WIDGET_KEY];

/** 공정 흐름 현황: 수주 → 생산계획 → 검사 → 재고 → 출하요청 → 출고 */
export interface ProcessFlowWidget {
  today: string;
  /** 진행 중 수주(진행중·부분출하)와 그중 납기 위험 */
  salesOrders: { openCount: number; dueRiskCount: number } | null;
  productionPlans: { plannedCount: number; inProgressCount: number } | null;
  /** 판정 대기 LOT (검사가 없거나 판정 대기) */
  inspections: { pendingCount: number; heatCount: number; slabCount: number; coilCount: number } | null;
  /** 제품 가용 매수 (on_hand − reserved − rolling) */
  inventories: { slabAvailableQty: number; coilAvailableQty: number };
  shipmentRequests: { requestedCount: number; allocatedCount: number } | null;
  /** 오늘(서울) 출고 확정 */
  goodsIssues: { issuedRequestCount: number; issuedLotCount: number } | null;
}

export interface OrderFulfillmentWidgetItem extends SalesOrderItemFulfillment {
  /** 납기까지 남은 일수 (지났으면 음수) */
  daysToDue: number;
}

export interface OrderFulfillmentWidget {
  today: string;
  /** 납기 위험 기준일 (생산 설정값) */
  deliveryRiskDays: number;
  /** 진행 중 수주, 가장 이른 납기 순 */
  salesOrders: {
    salesOrderId: number;
    salesOrderNo: string;
    customerName: string;
    earliestDueDate: string | null;
    isDueRisk: boolean;
    progress: ProgressMeasure;
    /** 취소 품목 제외 */
    items: OrderFulfillmentWidgetItem[];
  }[];
}

export interface ProductStockRow {
  itemId: number;
  itemCode: string;
  itemName: string;
  itemType: ItemType;
  steelGradeCode: string | null;
  /** 합격 재고 (적격·미소진·미출고) */
  onHandQty: number;
  reservedQty: number;
  rollingAllocatedQty: number;
  availableQty: number;
  onHandTon: string;
  availableTon: string;
}

export interface ProductStockWidget {
  totals: Omit<ProductStockRow, 'itemId' | 'itemCode' | 'itemName' | 'steelGradeCode'>[];
  /** 재고가 있는 규격만 */
  items: ProductStockRow[];
}
