// 수주 api (REQ-SO-001~006, REQ-INV-002~005, BP-SO-01·02, REQ-PRD-006 재생산, REQ-MSG-001 업무방).
// 목록·상세·미리보기·등록·취소·이력은 서버를 부른다 (api/server/salesOrders.ts, 이력은 api/server/businessEvents.ts).
// 업무방은 메신저 어댑터, 생산 연결·재생산 계획은 생산계획 API를 쓴다. 취소 창의 구매 진행 영향도 서버를 부른다.
import type { SalesOrderCancelPurchaseImpactLine } from '@fantasteel/shared';
import type { TimelineEvent } from '@/api/businessEvents';
import type { ProductionPlanView } from '@/api/production';
import { serverBusinessEventApi } from '@/api/server/businessEvents';
import { serverMessengerApi } from '@/api/server/messenger';
import { serverProductionPlanApi } from '@/api/server/production';
import { serverSalesOrderApi } from '@/api/server/salesOrders';
import {
  PERMISSION,
  type Permission,
  type ProductionPlanStatus,
  type ProductItemType,
  type ReservationStatus,
  type SalesOrderItemStatus,
} from '@/codes';
import type { HeatPlan } from '@/lib/heatPlanning';
import type { ItemShortage, ProgressMeasure } from '@/lib/inventoryMath';

// 화면은 데이터 모양을 이 파일에서 가져온다 (컨벤션 9장: 데이터 접근은 api 함수로만)
export type { ProductionPlanView, TimelineEvent };

export interface SalesOrderSummary {
  id: number;
  salesOrderNo: string;
  customerId: number;
  customerName: string;
  ownerEmployeeId: number;
  ownerName: string | null;
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
  cancelReason: string | null;
  /** 헤더 상태 (품목 상태에서 계산, 저장 안 함) */
  status: SalesOrderItemStatus;
  itemCount: number;
  itemTypes: ProductItemType[];
  totalOrderedQty: number;
  totalOrderedTon: string;
  totalShippedQty: number;
  totalActiveReservedQty: number;
  earliestDueDate: string | null;
  isDueRisk: boolean;
  /** 재생산이 필요한 품목이 있는지 (4.5·14.1-6) */
  hasReproductionNeed: boolean;
  workRoomId: number | null;
}

export interface ItemFulfillment {
  salesOrderItemId: number;
  lineNo: number;
  itemId: number;
  itemCode: string;
  itemName: string;
  itemType: ProductItemType;
  theoreticalWeightTon: string;
  orderedQty: number;
  /** 수주 톤 = 매수 × 1매 이론중량 (계산값) */
  orderedTon: string;
  dueDate: string;
  salesOrderItemStatus: SalesOrderItemStatus;
  isDueRisk: boolean;
  shippedQty: number;
  activeReservedQty: number;
  /** 검사합격(확보) = 이 품목 몫으로 확보한 합격 제품 = ACTIVE 예약 + 출고 (예약은 모두 합격 제품이다) */
  securedQty: number;
  /** 생산중 = 진행중(IN_PROGRESS)·완료(COMPLETED) 연결 계획의 잔여 목표 */
  inProductionQty: number;
  /** 시작 전(PLANNED) 연결 계획의 잔여 목표 */
  plannedQty: number;
  shortage: ItemShortage;
  /**
   * SO-004 충족 현황 지표. 분모를 함께 준다(4.5): 단계를 더하지 않는다.
   * reserved/unshipped · inProduction/ordered · secured(검사합격)/ordered · shipped/ordered
   */
  measures: { reserved: ProgressMeasure; inProduction: ProgressMeasure; passed: ProgressMeasure; shipped: ProgressMeasure };
  plans: { productionPlanId: number; productionPlanNo: string; productionPlanStatus: ProductionPlanStatus; isReproduction: boolean; shortageQty: number; heatCount: number; remainingTargetQty: number }[];
}

export interface SalesOrderCancellation {
  /** 품목별로 해제한 예약 매수 (0인 품목 포함) */
  releasedReserved: { lineNo: number; itemType: ProductItemType; qty: number }[];
  /** 취소한 시작 전 생산계획 */
  cancelledPlanNos: string[];
  /** 수주 연결을 풀고 완료 후 여재로 둔 진행중 생산계획 */
  unlinkedPlanNos: string[];
}

export interface SalesOrderDetail extends SalesOrderSummary {
  items: ItemFulfillment[];
  reservations: { id: number; salesOrderItemId: number; lineNo: number; itemCode: string; reservedQty: number; reservationStatus: ReservationStatus; createdAt: string; updatedAt: string }[];
  shipmentRequests: {
    id: number;
    shipmentRequestNo: string;
    shipmentRequestStatus: string;
    requestedShipDate: string;
    issuedAt: string | null;
    lines: { salesOrderItemId: number; lineNo: number; requestQty: number; allocatedQty: number }[];
  }[];
  millSheets: { id: number; millSheetNo: string; shipmentRequestId: number; issuedAt: string; pdfPath: string | null }[];
  /** 취소 가능 여부: null = 가능, 그 밖에는 막는 코드 */
  cancelBlock: 'SO-003' | 'SO-004' | 'CANCELLED' | null;
  /** 취소된 수주: 취소로 실제 일어난 일 (수주 취소 작업 로그의 after_data). 취소 전이면 null */
  cancellation: SalesOrderCancellation | null;
}

export interface SalesOrderPreviewLine {
  itemId: number;
  itemCode: string;
  itemName: string;
  itemType: ProductItemType;
  orderedQty: number;
  theoreticalWeightTon: string;
  /** 수주 톤 = 매수 × 1매 이론중량 (표시값, 저장 안 함) */
  weightTon: string;
  /** 이 줄을 볼 때의 예약 가용 (앞 줄이 같은 규격을 먼저 예약한 뒤) */
  availableQty: number;
  reserveQty: number;
  shortageQty: number;
  /** 부족분 히트 편성 (부족 없으면 null) */
  formation: HeatPlan | null;
}

export interface SalesOrderLineInput {
  itemId: number;
  /** 매수. 문자열이면 그대로 확인한다(글자를 지우지 않는다) */
  orderedQty: number | string;
  dueDate: string;
}

export interface CreateSalesOrderInput {
  customerId: number;
  items: readonly SalesOrderLineInput[];
}

/** 수주 취소 창의 구매 진행 영향 한 줄: 취소·연결 해제될 생산계획에 연결된 구매요청과 발주 (서버와 같은 모양, 표시만 한다) */
export type CancelPurchaseImpactLine = SalesOrderCancelPurchaseImpactLine;

/** 수주 화면을 여는 권한 (screens.ts의 salesOrders와 같다): 수주 등록·취소 중 하나라도 조회 이상 */
export const SALES_ORDER_VIEW_PERMISSIONS: readonly Permission[] = [PERMISSION.SALES_ORDER_CREATE, PERMISSION.SALES_ORDER_CANCEL];

export interface SalesOrderPreviewInputLine {
  itemId: number;
  /** 매수. 문자열이면 그대로 확인한다(SO-002, 글자를 지우지 않는다) */
  orderedQty: number | string;
}

export interface CreateSalesOrderResultView {
  salesOrderId: number;
  salesOrderNo: string;
  /** 재고 우선 예약한 매수 합계 */
  reservedQty: number;
  /** 생산계획으로 넘긴 부족 매수 합계 */
  shortageQty: number;
  productionPlanNos: string[];
}

/** 생산 연결 탭: 이 수주에 연결된(또는 취소로 연결이 풀린) 생산계획과 편성 히트 */
export interface SalesOrderPlanLink {
  /** 지금 연결된 수주 품목 번호. 수주 취소로 연결이 풀린 진행 계획이면 null */
  lineNo: number | null;
  plan: Omit<ProductionPlanView, 'results'>;
}

/** 목록 한 줄: 요약 + 품목 요약(규격 이름·매수) */
export interface SalesOrderListRow extends SalesOrderSummary {
  itemLines: { lineNo: number; itemType: ProductItemType; itemName: string; orderedQty: number }[];
}

export const salesOrderKeys = {
  all: ['sales-orders'] as const,
  list: () => ['sales-orders', 'list'] as const,
  detail: (salesOrderId: number) => ['sales-orders', 'detail', salesOrderId] as const,
  production: (salesOrderId: number) => ['sales-orders', 'production', salesOrderId] as const,
  timeline: (salesOrderId: number) => ['sales-orders', 'timeline', salesOrderId] as const,
  cancelPurchaseImpact: (salesOrderId: number) => ['sales-orders', 'cancel-purchase-impact', salesOrderId] as const,
  preview: (lines: readonly SalesOrderPreviewInputLine[]) => ['sales-orders', 'preview', lines] as const,
  workRoom: (salesOrderId: number) => ['sales-orders', 'work-room', salesOrderId] as const,
};

export interface SalesOrderWorkRoomView {
  chatRoomId: number;
  chatRoomName: string | null;
  memberEmployeeIds: number[];
}

export const salesOrderApi = {
  /** 수주 목록 (최근 것 먼저, 헤더 상태·납기 위험은 계산값) */
  list: (): Promise<SalesOrderListRow[]> => serverSalesOrderApi.listAll(),

  /** 수주 상세: 품목별 충족 현황(SO-004, 분모 포함), 예약, 출하요청, 밀시트, 취소 가능 여부 */
  detail: (salesOrderId: number): Promise<SalesOrderDetail> => serverSalesOrderApi.detail(salesOrderId),

  /** 생산 연결: 연결 계획의 편성표·편성 히트 */
  productionLinks: (salesOrderId: number): Promise<SalesOrderPlanLink[]> => serverSalesOrderApi.productionLinks(salesOrderId),

  /** 이력: 이 수주의 작업 로그를 시간순으로 (REQ-LOG-003) */
  timeline: (salesOrderId: number): Promise<TimelineEvent[]> => serverBusinessEventApi.salesOrderTimeline(salesOrderId),

  /** 등록 전 미리보기 (저장 안 함): 줄마다 예약 가능·부족 매수와 부족분 히트 편성 */
  preview: (lines: readonly SalesOrderPreviewInputLine[]): Promise<SalesOrderPreviewLine[]> => serverSalesOrderApi.preview(lines),

  /** 수주 등록 (REQ-SO-001~003): 재고 우선 예약 + 부족분 생산계획. 작업 로그는 서비스가 남긴다. */
  create: (input: CreateSalesOrderInput): Promise<CreateSalesOrderResultView> => serverSalesOrderApi.create(input),

  /**
   * 수주 취소 창의 구매 진행 영향 (04 BP-PRD-01 "수주 취소·계획 변경 시 구매 진행 영향도 표시한다"):
   * 취소·연결 해제될 생산계획에 연결된 구매요청 품목과 발주. 보여 주기만 하고 아무것도 바꾸지 않는다.
   */
  cancelPurchaseImpact: (salesOrderId: number): Promise<CancelPurchaseImpactLine[]> => serverSalesOrderApi.cancelPurchaseImpact(salesOrderId),

  /** 수주 취소 (REQ-SO-006, BP-SO-02): 출고분 있으면 SO-003, 진행 중 출하요청 있으면 SO-004 */
  cancel: (input: { salesOrderId: number; cancelReason: string; expectedUpdatedAt?: string | null }) => serverSalesOrderApi.cancel(input),

  /** 이 수주의 업무방 (없으면 null)과 지금 멤버 */
  workRoom: (salesOrderId: number): Promise<SalesOrderWorkRoomView | null> => serverMessengerApi.workRoomOf(salesOrderId),

  /** 업무방 열기 (REQ-MSG-001): 수주당 WORK 방 1개, 멤버는 조직도에서 고른다. 이미 있으면 그 방(새 멤버만 더함). */
  openWorkRoom: (input: { salesOrderId: number; memberEmployeeIds: readonly number[] }) => serverMessengerApi.openWorkRoom(input),

  /** 재생산 계획 만들기 (REQ-PRD-006, 14.1-6): 여재로 먼저 채우고 그래도 남는 '추가 계획 필요'만 계획한다. 자동으로 만들지 않는다. */
  createReproduction: (input: { salesOrderItemId: number }) =>
    serverProductionPlanApi.createReproduction(input).then(({ reservedFromSurplusQty, plan }) => ({
      reservedFromSurplusQty,
      productionPlanId: plan?.id ?? null,
      productionPlanNo: plan?.productionPlanNo ?? null,
      shortageQty: plan?.shortageQty ?? 0,
    })),
};
