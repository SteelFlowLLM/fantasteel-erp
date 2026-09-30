// 수주 API (docs/api/sales-order.md). 수량은 정수 매수(슬래브 매, 코일 개), 톤은 서버 계산값 문자열.
import type { ReservationStatus, SalesOrderItemStatus, SalesOrderStatus } from '@fantasteel/shared';
import { api } from './client';

export interface SalesOrderItemView {
  /** salesOrderItemId */
  id: number;
  lineNo: number;
  productSpecId: number;
  specCode: string;
  itemType: 'SLAB' | 'COIL';
  qtyUnit: string;
  steelGradeCode: string;
  thicknessMm: string;
  widthMm: string;
  lengthMm: string;
  theoreticalWeightTon: string;
  salesOrderItemStatus: SalesOrderItemStatus;
  orderedQty: number;
  orderedTon: string;
  /** 누적 출고 확정 매수 */
  shippedQty: number;
  shippedTon: string;
  /** 재고에서 잡은 ACTIVE 예약 매수 */
  reservedQty: number;
  /** 부족분 생산분이 검사 합격해 자동 예약된 ACTIVE 매수 */
  passedQty: number;
  /** 진행 중 생산계획의 남은 목표 매수 (unsecuredQty 안에서만 센다) */
  inProductionQty: number;
  /** 현재 미확보 = max(0, orderedQty − shippedQty − reservedQty − passedQty) */
  unsecuredQty: number;
  /** 추가 계획 필요 = max(0, unsecuredQty − 진행 계획 잔여 목표) */
  additionalPlanNeededQty: number;
  /** 취소된 품목의 미출하 잔량 */
  cancelledQty: number;
  /** % (소수 1자리, 버림) = (reservedQty + passedQty + shippedQty) ÷ orderedQty */
  progressRate: number;
}

export interface SalesOrderView {
  id: number;
  salesOrderNo: string;
  customer: { id: number; customerCode: string; customerName: string };
  /** 'YYYY-MM-DD' */
  dueDate: string;
  ownerEmployee: { id: number; employeeNo: string; employeeName: string };
  note: string | null;
  /** 품목 상태에서 계산한 헤더 상태 */
  salesOrderStatus: SalesOrderStatus;
  isCancelled: boolean;
  cancelledAt: string | null;
  cancelReason: string | null;
  orderedQty: number;
  orderedTon: string;
  shippedQty: number;
  shippedTon: string;
  progressRate: number;
  /** 오늘(Asia/Seoul)부터 납기까지 남은 일수. 오늘 = 0, 지났으면 음수 */
  daysToDue: number;
  /** 규칙 기반 납기 위험 (AI 판단 아님) */
  isDeliveryRisk: boolean;
  workRoomId: number | null;
  createdAt: string;
  items: SalesOrderItemView[];
}

export interface ListSalesOrdersQuery {
  status?: SalesOrderStatus;
  customerId?: number;
  itemType?: 'SLAB' | 'COIL';
  dueFrom?: string;
  dueTo?: string;
  keyword?: string;
  deliveryRiskOnly?: boolean;
  page?: number;
  size?: number;
}
export interface SalesOrderListView { rows: SalesOrderView[]; total: number; page: number; size: number }

export interface FulfillmentPlanView {
  id: number;
  productionPlanNo: string;
  /** PRODUCTION_PLAN_STATUS */
  productionPlanStatus: string;
  isReproduction: boolean;
  /** 계획 목표 매수 */
  shortageQty: number;
  /** 남은 목표 (완료·취소 계획은 0) */
  remainingTargetQty: number;
  heatCount: number;
  plannedSlabQty: number;
  surplusUseQty: number;
}
export interface FulfillmentLotView {
  id: number;
  lotNo: string;
  lotType: string;
  /** LOT_STATUS */
  lotStatus: string;
  isPassed: boolean | null;
  heatNo: string | null;
  isHeatPassed: boolean | null;
  producedAt: string;
  productionPlanId: number | null;
  allocationPurpose: 'SHIPMENT' | 'ROLLING' | null;
  allocationStatus: 'CONFIRMED' | 'CONSUMED' | null;
}
export interface FulfillmentItemView extends SalesOrderItemView {
  productionPlans: FulfillmentPlanView[];
  lots: FulfillmentLotView[];
}
export interface FulfillmentView extends Omit<SalesOrderView, 'items'> {
  items: FulfillmentItemView[];
}

export interface ReservationView {
  id: number;
  salesOrderItemId: number;
  lineNo: number;
  productSpecId: number;
  specCode: string;
  itemType: 'SLAB' | 'COIL';
  reservedQty: number;
  reservedTon: string;
  status: ReservationStatus;
  /** true = 부족분 생산분 검사 합격 시 자동 예약 (시스템) */
  isAutoReserved: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSalesOrderBody {
  customerId: number;
  dueDate: string;
  note?: string;
  items: { productSpecId: number; orderedQty: number }[];
}

export const salesOrderApi = {
  list: (q: ListSalesOrdersQuery = {}) => api.get<SalesOrderListView>('/sales-orders', { ...q, deliveryRiskOnly: q.deliveryRiskOnly ? true : undefined }),
  get: (id: number) => api.get<SalesOrderView>(`/sales-orders/${id}`),
  fulfillment: (id: number) => api.get<FulfillmentView>(`/sales-orders/${id}/fulfillment`),
  reservations: (id: number) => api.get<ReservationView[]>(`/sales-orders/${id}/reservations`),
  /** 같은 키로 다시 보내면 수주를 또 만들지 않고 처음 응답을 돌려준다 (화면을 열 때 만든 키를 넘긴다). */
  create: (body: CreateSalesOrderBody, idempotencyKey: string) => api.post<SalesOrderView>('/sales-orders', body, { 'Idempotency-Key': idempotencyKey }),
  cancel: (id: number, reason?: string) => api.post<SalesOrderView>(`/sales-orders/${id}/cancel`, reason ? { reason } : {}),
  /** 수주 업무방 열기 (docs/api/messenger.md): 찾고, 없으면 만들고, 부른 사람을 멤버로 넣는다. */
  openWorkRoom: (salesOrderId: number) => api.get<{ id: number; displayName: string }>('/chat-rooms/work-room', { salesOrderId }),
};
