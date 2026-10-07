// 대시보드 위젯 응답 타입 (REQ-DSH-001·002, BP-DSH-01 "권한 내 집계"). 권한이 없는 단계는 null로 준다.
import type { ItemType, ProcessType } from './codes';
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

/** 하루 단위 제품 매수·톤 (톤 = 매수 × 1매 이론중량) */
export interface DailyProductPoint {
  date: string;
  slabQty: number;
  coilQty: number;
  ton: string;
}

/** 출하 실적: 오늘 포함 최근 days일에 출고 확정한 슬래브·코일 LOT (출고 확정 시각 = shipment_request.issued_at, 서울 날짜) */
export interface ShipmentResultWidget {
  from: string;
  to: string;
  days: number;
  /** 기간 안 출고 확정 출하요청 수 */
  issuedRequestCount: number;
  totalSlabQty: number;
  totalCoilQty: number;
  totalTon: string;
  series: DailyProductPoint[];
}

/** 공정별 수율 한 줄: 완료된 작업 실적의 투입·산출 톤 합계 */
export interface ProcessYieldRow {
  processType: ProcessType;
  /** 완료된 작업 실적 수 */
  resultCount: number;
  inputTon: string;
  outputTon: string;
  /** 실적 수율 = Σ산출 ÷ Σ투입 (소수 4자리). 제선은 계획 수율을 쓰지 않아 null */
  actualYieldRate: string | null;
  /** 계획 수율(라우팅·규격 매핑)을 투입량으로 가중한 값. 계획 수율이 없는 실적이 섞이면 null. 제선은 null */
  plannedYieldRate: string | null;
}

/** 공정별 수율 (REQ-DSH-001) */
export interface ProcessYieldWidget {
  processes: ProcessYieldRow[];
}
