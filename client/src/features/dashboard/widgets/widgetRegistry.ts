// 위젯 키 → 카드 컴포넌트
import type { ComponentType } from 'react';
import type { DashboardWidgetKey } from '@/api/dashboard';
import type { WidgetProps } from '@/features/dashboard/components/WidgetFrame';
import {
  DeliveryRiskWidget,
  ProductionVolumeWidget,
  PurchaseProgressWidget,
  RawMaterialBalanceWidget,
  RejectRateWidget,
  ShipmentResultWidget,
  SurplusAgeWidget,
} from '@/features/dashboard/widgets/CandidateWidgets';
import { OrderFulfillmentWidget } from '@/features/dashboard/widgets/OrderFulfillmentWidget';
import { ProcessFlowWidget } from '@/features/dashboard/widgets/ProcessFlowWidget';
import { ProcessYieldWidget } from '@/features/dashboard/widgets/ProcessYieldWidget';
import { ProductStockWidget } from '@/features/dashboard/widgets/ProductStockWidget';
import { RecentEventsWidget } from '@/features/dashboard/widgets/RecentEventsWidget';
import { AgentRiskWidget, AiUsageWidget } from '@/features/dashboard/widgets/SoonWidgets';

export const WIDGET_COMPONENTS: Record<DashboardWidgetKey, ComponentType<WidgetProps>> = {
  PROCESS_FLOW: ProcessFlowWidget,
  ORDER_FULFILLMENT: OrderFulfillmentWidget,
  AGENT_RISK: AgentRiskWidget,
  RECENT_EVENTS: RecentEventsWidget,
  PRODUCT_STOCK: ProductStockWidget,
  PROCESS_YIELD: ProcessYieldWidget,
  RAW_MATERIAL_BALANCE: RawMaterialBalanceWidget,
  REJECT_RATE: RejectRateWidget,
  DELIVERY_RISK: DeliveryRiskWidget,
  PURCHASE_PROGRESS: PurchaseProgressWidget,
  SHIPMENT_RESULT: ShipmentResultWidget,
  SURPLUS_AGE: SurplusAgeWidget,
  PRODUCTION_VOLUME: ProductionVolumeWidget,
  AI_USAGE: AiUsageWidget,
};
