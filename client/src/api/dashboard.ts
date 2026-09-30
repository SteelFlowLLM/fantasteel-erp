// 대시보드 API (docs/api/dashboard.md). 응답 모양은 문서 그대로다.
import type { WidgetCode, WidgetPlacement } from '@fantasteel/shared';
import { api } from './client';

export interface DashboardLayoutResponse {
  placements: WidgetPlacement[];
  /** 저장한 배치가 없어 기본 배치를 준 경우 true */
  isDefault: boolean;
}

interface WidgetHead<C extends WidgetCode> { widgetCode: C; available: true; generatedAt: string }
/** P2 위젯 (AGENT_RISK, AI_USAGE) — 데이터 없음 */
export interface WidgetUnavailable { widgetCode: 'AGENT_RISK' | 'AI_USAGE'; available: false; grade: 'P2' }

export interface ProcessFlowWidget extends WidgetHead<'PROCESS_FLOW'> {
  stages: { key: string; label: string; count: number; unit: string; linkPath: string | null }[];
  issuedToday: { date: string; goodsIssueCount: number; lotCount: number };
}

export interface OrderFulfillmentItem {
  salesOrderItemId: number; lineNo: number; specCode: string;
  orderedQty: number; orderedTon: string; reservedQty: number; inProductionQty: number; shippedQty: number;
  remainingQty: number; progressRate: string | null; isDeliveryRisk: boolean;
}
export interface OrderFulfillmentOrder {
  salesOrderId: number; salesOrderNo: string; customerName: string;
  dueDate: string; daysToDue: number; isDeliveryRisk: boolean;
  orderedQty: number; orderedTon: string; reservedQty: number; inProductionQty: number; shippedQty: number;
  progressRate: string | null; linkPath: string;
  items: OrderFulfillmentItem[];
}
export interface OrderFulfillmentWidget extends WidgetHead<'ORDER_FULFILLMENT'> {
  deliveryRiskDays: number;
  definitions: { progressRate: string; reservedQty: string; inProductionQty: string; note: string };
  totalOpenSalesOrders: number;
  salesOrders: OrderFulfillmentOrder[];
}

export interface RecentEventItem {
  id: number; occurredAt: string; eventType: string; eventTypeLabel: string; actorType: 'USER' | 'SYSTEM'; actorLabel: string;
  summary: string; targetType: string; targetNo: string | null; salesOrderId: number | null; isAiAssisted: boolean;
  linkPath: string | null;
}
export interface RecentEventsWidget extends WidgetHead<'RECENT_EVENTS'> { items: RecentEventItem[] }

export interface ProductStockQty { onHandQty: number; reservedQty: number; availableQty: number; onHandTon: string; reservedTon: string; availableTon: string }
export interface ProductStockItem extends ProductStockQty {
  productSpecId: number; specCode: string; itemType: 'SLAB' | 'COIL'; itemTypeLabel: string; unit: '매' | '개'; steelGradeCode: string; theoreticalWeightTon: string;
}
export interface ProductStockTotal extends ProductStockQty { itemType: 'SLAB' | 'COIL'; itemTypeLabel: string }
export interface ProductStockWidget extends WidgetHead<'PRODUCT_STOCK'> { note: string; items: ProductStockItem[]; totals: ProductStockTotal[] }

export interface ProcessYieldRow {
  processCode: 'IRONMAKING' | 'STEELMAKING' | 'CASTING' | 'HOT_ROLLING'; processLabel: string;
  resultCount: number; inputTon: string; outputTon: string;
  plannedQty: number; outputQty: number; lossQty: number;
  plannedYieldRate: string | null; actualYieldRate: string | null; qtyAttainmentRate: string | null;
}
export interface ProcessYieldWidget extends WidgetHead<'PROCESS_YIELD'> {
  definitions: { plannedYieldRate: string; actualYieldRate: string; qtyAttainmentRate: string };
  processes: ProcessYieldRow[];
}

export interface RawMaterialBalanceItem {
  rawMaterialId: number; materialCode: string; materialName: string; rawMaterialType: string; rawMaterialTypeLabel: string;
  onHandTon: string; scheduledReceiptTon: string; grossRequiredTon: string | null; netRequiredTon: string | null;
}
export interface RawMaterialBalanceWidget extends WidgetHead<'RAW_MATERIAL_BALANCE'> {
  mrpRun: { mrpRunId: number; mrpRunNo: string; createdAt: string } | null;
  items: RawMaterialBalanceItem[];
}

export interface RejectRateGrade {
  steelGradeId: number; steelGradeCode: string; inspectedCount: number; failedCount: number; rejectRate: string | null;
  byProcess: { processCode: 'STEELMAKING' | 'CASTING' | 'HOT_ROLLING'; processLabel: string; inspectedCount: number; failedCount: number; rejectRate: string | null }[];
}
export interface RejectRateWidget extends WidgetHead<'REJECT_RATE'> {
  days: number; from: string; to: string;
  definitions: { rejectRate: string; note: string };
  grades: RejectRateGrade[];
}

export interface DeliveryRiskItem {
  salesOrderId: number; salesOrderNo: string; salesOrderItemId: number; lineNo: number; customerName: string; specCode: string;
  orderedQty: number; shippedQty: number; remainingQty: number; remainingTon: string;
  dueDate: string; daysToDue: number; isOverdue: boolean; linkPath: string;
}
export interface DeliveryRiskWidget extends WidgetHead<'DELIVERY_RISK'> { deliveryRiskDays: number; rule: string; total: number; items: DeliveryRiskItem[] }

export interface PurchaseProgressWidget extends WidgetHead<'PURCHASE_PROGRESS'> {
  requisitionsByStatus: { status: 'DRAFT' | 'WAITING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'ORDERED'; label: string; count: number }[];
  openPurchaseOrders: {
    count: number; outstandingTon: string;
    purchaseOrders: { purchaseOrderId: number; purchaseOrderNo: string; supplierName: string; dueDate: string | null; outstandingTon: string; lineCount: number }[];
  };
}

export interface ShipmentResultWidget extends WidgetHead<'SHIPMENT_RESULT'> {
  days: number;
  series: { date: string; issuedQty: number; slabQty: number; coilQty: number; issuedTon: string }[];
  totalQty: number; totalTon: string;
}

export interface SurplusAgeItem {
  lotId: number; lotNo: string; specCode: string | null; steelGradeCode: string | null; weightTon: string | null;
  producedAt: string; ageDays: number; linkPath: string;
}
export interface SurplusAgeWidget extends WidgetHead<'SURPLUS_AGE'> {
  definition: string;
  summary: { count: number; totalTon: string; maxAgeDays: number | null; avgAgeDays: number | null };
  items: SurplusAgeItem[];
}

export interface ProductionVolumeWidget extends WidgetHead<'PRODUCTION_VOLUME'> {
  days: number; definition: string;
  series: { date: string; slabQty: number; coilQty: number }[];
  totalSlabQty: number; totalCoilQty: number;
}

/** 데이터가 있는 위젯 응답 (widgetCode로 구분) */
export type WidgetAvailableData =
  | ProcessFlowWidget | OrderFulfillmentWidget | RecentEventsWidget | ProductStockWidget | ProcessYieldWidget | RawMaterialBalanceWidget
  | RejectRateWidget | DeliveryRiskWidget | PurchaseProgressWidget | ShipmentResultWidget | SurplusAgeWidget | ProductionVolumeWidget;
export type WidgetData = WidgetAvailableData | WidgetUnavailable;

export type SearchKind = 'SALES_ORDER' | 'LOT' | 'PRODUCTION_PLAN' | 'PURCHASE_REQUISITION' | 'SHIPMENT_REQUEST' | 'MILL_SHEET';
export interface SearchResult { kind: SearchKind; kindLabel: string; label: string; linkPath: string }

export const dashboardApi = {
  layout: () => api.get<DashboardLayoutResponse>('/dashboard/layout'),
  saveLayout: (placements: WidgetPlacement[]) => api.put<DashboardLayoutResponse>('/dashboard/layout', { placements }),
  widget: (widgetCode: WidgetCode) => api.get<WidgetData>(`/dashboard/widgets/${widgetCode}`),
  search: (q: string) => api.get<SearchResult[]>('/search', { q }),
};

export const dashboardKeys = {
  layout: ['dashboard', 'layout'] as const,
  widgets: ['dashboard', 'widget'] as const,
  widget: (widgetCode: WidgetCode) => ['dashboard', 'widget', widgetCode] as const,
};
