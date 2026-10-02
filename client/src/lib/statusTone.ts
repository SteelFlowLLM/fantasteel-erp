// 상태 배지 색: 공통 코드 그룹마다 한 곳에서 정한다. 같은 상태는 어느 화면에서든 같은 색으로 보인다.
// 두 화면 이상에 나오는 그룹만 여기에 둔다. 한 화면에서만 쓰는 그룹(구매 발주 상태·예약 상태·초안 상태 등)은 그 화면 폴더에 둔다.
// 새 화면에서 이 그룹의 상태를 배지로 보일 때는 여기 맵을 쓴다 (화면마다 자기 맵을 만들지 않는다).
import type {
  AllocationStatus,
  InspectionResult,
  LotStatus,
  ProductionPlanStatus,
  PurchaseRequisitionStatus,
  SalesOrderItemStatus,
  ShipmentRequestStatus,
} from '@/codes';
import type { BadgeTone } from '@/components/Badge';

/** 생산계획 상태 (생산·수주·구매 화면) */
export const PRODUCTION_PLAN_STATUS_TONE: Record<ProductionPlanStatus, BadgeTone> = {
  PLANNED: 'wait',
  IN_PROGRESS: 'run',
  COMPLETED: 'ok',
  CANCELLED: 'neutral',
};

/** 수주 품목 상태 (수주·출하·메신저 화면) */
export const SALES_ORDER_ITEM_STATUS_TONE: Record<SalesOrderItemStatus, BadgeTone> = {
  OPEN: 'run',
  PARTIALLY_SHIPPED: 'wait',
  SHIPPED: 'ok',
  CANCELLED: 'danger',
};

/** 출하요청 상태 (출하·수주·LOT 추적 화면) */
export const SHIPMENT_REQUEST_STATUS_TONE: Record<ShipmentRequestStatus, BadgeTone> = {
  REQUESTED: 'wait',
  ALLOCATED: 'run',
  ISSUED: 'ok',
  CANCELLED: 'neutral',
};

/** 배정 상태 (출하·재고·LOT 추적 화면) */
export const ALLOCATION_STATUS_TONE: Record<AllocationStatus, BadgeTone> = {
  CONFIRMED: 'run',
  CONSUMED: 'ok',
  RELEASED: 'neutral',
};

/** 검사 판정 (품질·재고·생산·출하·LOT 추적·수주 화면) */
export const INSPECTION_RESULT_TONE: Record<InspectionResult, BadgeTone> = {
  PENDING: 'wait',
  PASS: 'ok',
  FAIL: 'danger',
};

/** LOT 상태 (재고·LOT 추적·출하 화면) */
export const LOT_STATUS_TONE: Record<LotStatus, BadgeTone> = {
  AVAILABLE: 'run',
  CONSUMED: 'neutral',
  SHIPPED: 'neutral',
};

/** 구매요청 상태 (구매·메시지 초안 화면) */
export const PURCHASE_REQUISITION_STATUS_TONE: Record<PurchaseRequisitionStatus, BadgeTone> = {
  WAITING_APPROVAL: 'wait',
  APPROVED: 'run',
  REJECTED: 'danger',
  ORDERED: 'ok',
};
