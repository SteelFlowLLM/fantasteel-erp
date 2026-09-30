// 위젯 응답 → 본문. 응답의 widgetCode로 어떤 위젯인지 가른다.
import type { WidgetCode } from '@fantasteel/shared';
import type { WidgetData } from '@/api/dashboard';
import { fmtHM, fmtMDHM } from '@/lib/format';
import { AgentRiskWidget } from './widgets/AgentRiskWidget';
import { AiUsageWidget } from './widgets/AiUsageWidget';
import { DeliveryRiskWidget } from './widgets/DeliveryRiskWidget';
import { OrderFulfillmentWidget } from './widgets/OrderFulfillmentWidget';
import { ProcessFlowWidget } from './widgets/ProcessFlowWidget';
import { ProcessYieldWidget } from './widgets/ProcessYieldWidget';
import { ProductStockWidget } from './widgets/ProductStockWidget';
import { ProductionVolumeWidget } from './widgets/ProductionVolumeWidget';
import { PurchaseProgressWidget } from './widgets/PurchaseProgressWidget';
import { RawMaterialBalanceWidget } from './widgets/RawMaterialBalanceWidget';
import { RecentEventsWidget } from './widgets/RecentEventsWidget';
import { RejectRateWidget } from './widgets/RejectRateWidget';
import { ShipmentResultWidget } from './widgets/ShipmentResultWidget';
import { SurplusAgeWidget } from './widgets/SurplusAgeWidget';

/** P2 위젯의 자리 표시 본문 (데이터 없음) */
export function SoonWidgetBody({ code }: { code: WidgetCode }) {
  return code === 'AI_USAGE' ? <AiUsageWidget /> : <AgentRiskWidget />;
}

export function WidgetBody({ data }: { data: WidgetData }) {
  if (!data.available) return <SoonWidgetBody code={data.widgetCode} />;
  switch (data.widgetCode) {
    case 'PROCESS_FLOW': return <ProcessFlowWidget data={data} />;
    case 'ORDER_FULFILLMENT': return <OrderFulfillmentWidget data={data} />;
    case 'RECENT_EVENTS': return <RecentEventsWidget data={data} />;
    case 'PRODUCT_STOCK': return <ProductStockWidget data={data} />;
    case 'PROCESS_YIELD': return <ProcessYieldWidget data={data} />;
    case 'RAW_MATERIAL_BALANCE': return <RawMaterialBalanceWidget data={data} />;
    case 'REJECT_RATE': return <RejectRateWidget data={data} />;
    case 'DELIVERY_RISK': return <DeliveryRiskWidget data={data} />;
    case 'PURCHASE_PROGRESS': return <PurchaseProgressWidget data={data} />;
    case 'SHIPMENT_RESULT': return <ShipmentResultWidget data={data} />;
    case 'SURPLUS_AGE': return <SurplusAgeWidget data={data} />;
    case 'PRODUCTION_VOLUME': return <ProductionVolumeWidget data={data} />;
    default: return null;
  }
}

/** 카드 머리의 짧은 보조 문구 (응답에서 온 값만 쓴다) */
export function widgetMeta(data: WidgetData): string | null {
  if (!data.available) return null;
  switch (data.widgetCode) {
    case 'PROCESS_FLOW': return `오늘 출고 ${data.issuedToday.goodsIssueCount}건 · ${fmtHM(data.generatedAt)} 기준`;
    case 'ORDER_FULFILLMENT':
      return data.totalOpenSalesOrders > data.salesOrders.length ? `${data.totalOpenSalesOrders}건 중 ${data.salesOrders.length}건 · 납기 빠른 순` : `${data.totalOpenSalesOrders}건 · 납기 빠른 순`;
    case 'RECENT_EVENTS': return `최근 ${data.items.length}건`;
    case 'PRODUCT_STOCK': return '합격 · 매수';
    case 'PROCESS_YIELD': return '완료 실적 기준';
    case 'RAW_MATERIAL_BALANCE': return data.mrpRun ? `${data.mrpRun.mrpRunNo} · ${fmtMDHM(data.mrpRun.createdAt)}` : 'MRP 실행 기록 없음';
    case 'REJECT_RATE': return `최근 ${data.days}일`;
    case 'DELIVERY_RISK': return data.total > data.items.length ? `${data.total}건 중 ${data.items.length}건 · 납기 ${data.deliveryRiskDays}일 이내` : `${data.total}건 · 납기 ${data.deliveryRiskDays}일 이내`;
    case 'PURCHASE_PROGRESS': return `미입고 발주 ${data.openPurchaseOrders.count}건`;
    case 'SHIPMENT_RESULT': return `최근 ${data.days}일`;
    case 'SURPLUS_AGE': return data.summary.count > data.items.length ? `${data.summary.count}매 중 오래된 ${data.items.length}매` : '오래된 순';
    case 'PRODUCTION_VOLUME': return `최근 ${data.days}일`;
    default: return null;
  }
}
