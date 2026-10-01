// 작업 로그 대상(target_type = 테이블 DB명)의 화면 이름과 이동할 화면.
// 이름은 용어 사전의 엔티티 한글명(DB명 열)이다. 용어 사전에 없는 테이블은 DB명을 그대로 보인다.
import type { DbTableName } from '@/mock/schema';

export const TARGET_TABLE_LABEL: Partial<Record<DbTableName, string>> = {
  sales_order: '수주',
  sales_order_item: '수주 품목',
  reservation: '예약',
  allocation: '배정',
  production_plan: '생산계획',
  production_result: '작업 실적',
  lot: 'LOT',
  lot_relation: 'LOT 관계',
  quality_inspection: '품질검사',
  quality_inspection_value: '검사 측정값',
  inventory: '재고',
  purchase_requisition: '구매요청',
  purchase_order: '발주',
  goods_receipt: '입고',
  shipment_request: '출하요청',
  shipment_request_item: '출하요청 품목',
  mill_sheet: '밀시트',
  action_draft: 'Action Draft',
  item: '품목',
  steel_grade: '강종',
  customer: '고객사',
  supplier: '공급업체',
  yard: '야드',
  employee: '사원',
  department: '부서',
};

/** 대상 필터에 보이는 테이블: 29개 이벤트가 기록되는 업무 테이블 (REQ-LOG-002) */
export const TARGET_FILTER_TABLES: readonly DbTableName[] = [
  'sales_order',
  'sales_order_item',
  'production_plan',
  'production_result',
  'quality_inspection',
  'lot',
  'reservation',
  'allocation',
  'purchase_requisition',
  'purchase_order',
  'goods_receipt',
  'shipment_request',
  'mill_sheet',
  'action_draft',
];

export const targetTableLabel = (table: string): string => TARGET_TABLE_LABEL[table as DbTableName] ?? table;

export const isTargetFilterTable = (value: string): value is DbTableName => (TARGET_FILTER_TABLES as readonly string[]).includes(value);

export const lotTraceHref = (lotNo: string, direction?: 'backward' | 'forward'): string =>
  `/lots/trace?lot=${encodeURIComponent(lotNo)}${direction ? `&direction=${direction}` : ''}`;

export interface TargetRef {
  targetType: string;
  targetId: number;
  targetNo: string | null;
  salesOrderId: number | null;
  /** 품질검사 대상일 때 검사한 LOT id */
  lotId?: number | null;
  /** 작업 실적 대상일 때 그 생산계획 id (작업 실적 화면은 ?plan=으로 연다) */
  productionPlanId?: number | null;
  /** 입고 대상일 때 그 발주 id (입고 화면은 ?po=로 연다) */
  purchaseOrderId?: number | null;
}

/** 대상 번호를 눌렀을 때 갈 화면 (없으면 null). 화면 주소의 쿼리 이름은 각 화면의 약속을 따른다. */
export function targetHref(target: TargetRef): string | null {
  const { targetType, targetId, targetNo, salesOrderId } = target;
  switch (targetType) {
    case 'sales_order':
      return `/sales-orders/${targetId}`;
    case 'sales_order_item':
    case 'reservation':
      return salesOrderId ? `/sales-orders/${salesOrderId}` : null;
    case 'lot':
      return targetNo ? lotTraceHref(targetNo) : null;
    case 'allocation':
      return salesOrderId ? `/sales-orders/${salesOrderId}` : null;
    case 'production_plan':
      return `/production/plans?plan=${targetId}`;
    case 'production_result':
      return target.productionPlanId ? `/production/results?plan=${target.productionPlanId}` : '/production/results';
    case 'quality_inspection':
      return target.lotId ? `/quality/inspections?lot=${target.lotId}` : '/quality/inspections';
    case 'purchase_requisition':
      return `/purchase-requisitions/${targetId}`;
    case 'purchase_order':
      return `/purchase-orders?po=${targetId}`;
    case 'goods_receipt':
      return target.purchaseOrderId ? `/goods-receipts?po=${target.purchaseOrderId}` : '/goods-receipts';
    case 'shipment_request':
      return `/shipment-requests/${targetId}`;
    case 'mill_sheet':
      return `/mill-sheets?id=${targetId}`;
    case 'action_draft':
      return `/action-drafts/${targetId}`;
    default:
      return null;
  }
}
