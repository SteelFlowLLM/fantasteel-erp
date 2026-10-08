// 수주 api (REQ-SO-001~006, REQ-INV-002~005, BP-SO-01·02, REQ-PRD-006 재생산, REQ-MSG-001 업무방).
// 이 층은 권한 확인(requireActor)만 하고 업무 규칙·작업 로그·불변조건은 core 서비스(@/mock/services)가 맡는다.
// NEXT_PUBLIC_DATA_SOURCE=server면 목록·상세·미리보기·등록·취소·이력은 실제 서버를 부른다 (api/server/salesOrders.ts, 이력은 api/server/businessEvents.ts).
// 서버에 아직 없는 생산 연결·구매 영향·업무방·재생산은 서버 모드에서 비어 있거나 "연결 전" 오류다.
import { requireActor } from '@/api/actor';
import { ApiError, mockMutation, mockQuery } from '@/api/client';
import { isServerDataSource } from '@/api/http';
import { serverBusinessEventApi } from '@/api/server/businessEvents';
import { serverMessengerApi } from '@/api/server/messenger';
import { serverSalesOrderApi } from '@/api/server/salesOrders';
import { PERMISSION, type Permission, type ProductItemType } from '@/codes';
import { todayStr } from '@/lib/format';
import type { MockTables } from '@/mock/schema';
import {
  cancelPurchaseImpactOf,
  cancelSalesOrder,
  createReproductionPlan,
  createSalesOrder,
  listSalesOrders,
  openWorkRoom,
  previewSalesOrder,
  productionPlanView,
  salesOrderDetail,
  salesOrderTimeline,
  userActor,
  workRoomOfSalesOrder,
  type CancelPurchaseImpactLine,
  type CreateSalesOrderInput,
  type ProductionPlanView,
  type SalesOrderDetail,
  type SalesOrderPreviewLine,
  type SalesOrderSummary,
  type TimelineEvent,
} from '@/mock/services';

type Tables = Readonly<MockTables>;

// 화면은 데이터 모양을 이 파일에서 가져온다 (컨벤션 9장: 데이터 접근은 api 함수로만)
export type {
  CancelPurchaseImpactLine,
  CreateSalesOrderInput,
  ItemFulfillment,
  ProductionPlanView,
  SalesOrderCancellation,
  SalesOrderDetail,
  SalesOrderPreviewLine,
  SalesOrderSummary,
  TimelineEvent,
} from '@/mock/services';

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

const SALES_ORDER_VIEW_RULE = { view: [...SALES_ORDER_VIEW_PERMISSIONS] };

/** 미리보기는 납기를 쓰지 않는다. 서비스의 입력 확인을 지나도록 오늘 날짜를 넣는다(저장하지 않음). */
const previewLinesOf = (lines: readonly SalesOrderPreviewInputLine[]) => {
  const dueDate = todayStr();
  return lines.map((line) => ({ itemId: line.itemId, orderedQty: line.orderedQty, dueDate }));
};

/** 이 수주와 이어진 생산계획 id: 지금 연결된 계획 + 작업 로그에 이 수주로 남은 계획(취소로 연결이 풀린 진행 계획) */
function linkedPlanIdsOf(tables: Tables, salesOrderId: number): number[] {
  const itemIds = new Set(tables.salesOrderItem.filter((i) => i.salesOrderId === salesOrderId).map((i) => i.id));
  const ids = new Set<number>();
  for (const plan of tables.productionPlan) if (plan.salesOrderItemId !== null && itemIds.has(plan.salesOrderItemId)) ids.add(plan.id);
  for (const event of tables.businessEvent) if (event.salesOrderId === salesOrderId && event.targetType === 'production_plan') ids.add(event.targetId);
  return [...ids].filter((id) => tables.productionPlan.some((p) => p.id === id)).sort((a, b) => a - b);
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
  list: (): Promise<SalesOrderListRow[]> =>
    isServerDataSource()
      ? serverSalesOrderApi.listAll()
      : mockQuery((tables) => {
      requireActor(tables, SALES_ORDER_VIEW_RULE);
      return listSalesOrders(tables).map((summary) => ({
        ...summary,
        itemLines: tables.salesOrderItem
          .filter((i) => i.salesOrderId === summary.id)
          .sort((a, b) => a.lineNo - b.lineNo)
          .map((i) => {
            const item = tables.item.find((x) => x.id === i.itemId);
            const itemType: ProductItemType = item?.itemType === 'COIL' ? 'COIL' : 'SLAB';
            return { lineNo: i.lineNo, itemType, itemName: item?.itemName ?? '-', orderedQty: i.orderedQty };
          }),
      }));
    }),

  /** 수주 상세: 품목별 충족 현황(SO-004, 분모 포함), 예약, 출하요청, 밀시트, 취소 가능 여부 */
  detail: (salesOrderId: number): Promise<SalesOrderDetail> =>
    isServerDataSource()
      ? serverSalesOrderApi.detail(salesOrderId)
      : mockQuery((tables) => {
      requireActor(tables, SALES_ORDER_VIEW_RULE);
      return salesOrderDetail(tables, salesOrderId);
    }),

  /** 생산 연결: 연결 계획의 편성표·편성 히트 */
  productionLinks: (salesOrderId: number): Promise<SalesOrderPlanLink[]> =>
    isServerDataSource()
      ? Promise.resolve([])
      : mockQuery((tables) => {
      requireActor(tables, SALES_ORDER_VIEW_RULE);
      salesOrderDetail(tables, salesOrderId); // 없는 수주면 COM-003
      const lineNoOf = (soItemId: number | null) => tables.salesOrderItem.find((i) => i.id === soItemId)?.lineNo ?? null;
      return linkedPlanIdsOf(tables, salesOrderId).map((planId) => {
        const { results: _results, ...plan } = productionPlanView(tables, planId);
        const row = tables.productionPlan.find((p) => p.id === planId);
        return { lineNo: lineNoOf(row?.salesOrderItemId ?? null), plan };
      });
    }),

  /** 이력: 이 수주의 작업 로그를 시간순으로 (REQ-LOG-003) */
  timeline: (salesOrderId: number): Promise<TimelineEvent[]> =>
    isServerDataSource()
      ? serverBusinessEventApi.salesOrderTimeline(salesOrderId)
      : mockQuery((tables) => {
      requireActor(tables, SALES_ORDER_VIEW_RULE);
      salesOrderDetail(tables, salesOrderId);
      return salesOrderTimeline(tables, salesOrderId);
    }),

  /** 등록 전 미리보기 (저장 안 함): 줄마다 예약 가능·부족 매수와 부족분 히트 편성 */
  preview: (lines: readonly SalesOrderPreviewInputLine[]): Promise<SalesOrderPreviewLine[]> =>
    isServerDataSource()
      ? serverSalesOrderApi.preview(lines)
      : mockQuery((tables) => {
      requireActor(tables, { view: [PERMISSION.SALES_ORDER_CREATE] });
      return previewSalesOrder(tables, previewLinesOf(lines));
    }),

  /** 수주 등록 (REQ-SO-001~003): 재고 우선 예약 + 부족분 생산계획. 작업 로그는 서비스가 남긴다. */
  create: (input: CreateSalesOrderInput): Promise<CreateSalesOrderResultView> =>
    isServerDataSource()
      ? serverSalesOrderApi.create(input)
      : mockMutation((tx) => {
      const actor = requireActor(tx.tables, { use: [PERMISSION.SALES_ORDER_CREATE] });
      const result = createSalesOrder(tx, userActor(actor.employee.id), input);
      return {
        salesOrderId: result.salesOrder.id,
        salesOrderNo: result.salesOrder.salesOrderNo,
        reservedQty: result.reservations.reduce((sum, r) => sum + r.reservedQty, 0),
        shortageQty: result.productionPlans.reduce((sum, p) => sum + p.shortageQty, 0),
        productionPlanNos: result.productionPlans.map((p) => p.productionPlanNo),
      };
    }),

  /**
   * 수주 취소 창의 구매 진행 영향 (04 BP-PRD-01 "수주 취소·계획 변경 시 구매 진행 영향도 표시한다"):
   * 취소·연결 해제될 생산계획에 연결된 구매요청 품목과 발주. 보여 주기만 하고 아무것도 바꾸지 않는다.
   */
  cancelPurchaseImpact: (salesOrderId: number): Promise<CancelPurchaseImpactLine[]> =>
    isServerDataSource()
      ? Promise.resolve([])
      : mockQuery((tables) => {
      requireActor(tables, SALES_ORDER_VIEW_RULE);
      return cancelPurchaseImpactOf(tables, salesOrderId);
    }),

  /** 수주 취소 (REQ-SO-006, BP-SO-02): 출고분 있으면 SO-003, 진행 중 출하요청 있으면 SO-004 */
  cancel: (input: { salesOrderId: number; cancelReason: string; expectedUpdatedAt?: string | null }) =>
    isServerDataSource()
      ? serverSalesOrderApi.cancel(input)
      : mockMutation((tx) => {
      const actor = requireActor(tx.tables, { use: [PERMISSION.SALES_ORDER_CANCEL] });
      const cancelled = cancelSalesOrder(tx, userActor(actor.employee.id), input);
      return { salesOrderId: cancelled.id, salesOrderNo: cancelled.salesOrderNo };
    }),

  /** 이 수주의 업무방 (없으면 null)과 지금 멤버 */
  workRoom: (salesOrderId: number): Promise<SalesOrderWorkRoomView | null> =>
    isServerDataSource()
      ? serverMessengerApi.workRoomOf(salesOrderId)
      : mockQuery((tables) => {
      requireActor(tables, SALES_ORDER_VIEW_RULE);
      const room = workRoomOfSalesOrder(tables, salesOrderId);
      if (!room) return null;
      return {
        chatRoomId: room.id,
        chatRoomName: room.chatRoomName,
        memberEmployeeIds: tables.chatRoomMember.filter((m) => m.chatRoomId === room.id).map((m) => m.employeeId),
      };
    }),

  /** 업무방 열기 (REQ-MSG-001): 수주당 WORK 방 1개, 멤버는 조직도에서 고른다. 이미 있으면 그 방(새 멤버만 더함). */
  openWorkRoom: (input: { salesOrderId: number; memberEmployeeIds: readonly number[] }) =>
    isServerDataSource()
      ? serverMessengerApi.openWorkRoom(input)
      : mockMutation((tx) => {
      const actor = requireActor(tx.tables, SALES_ORDER_VIEW_RULE);
      const { chatRoom, created } = openWorkRoom(tx, userActor(actor.employee.id), input);
      return { chatRoomId: chatRoom.id, chatRoomName: chatRoom.chatRoomName, created };
    }),

  /** 재생산 계획 만들기 (REQ-PRD-006, 14.1-6): 여재로 먼저 채우고 그래도 남는 '추가 계획 필요'만 계획한다. 자동으로 만들지 않는다. */
  createReproduction: (input: { salesOrderItemId: number }) =>
    isServerDataSource()
      ? Promise.reject<{ reservedFromSurplusQty: number; productionPlanId: number | null; productionPlanNo: string | null; shortageQty: number }>(
          new Error('재생산 계획은 아직 서버와 연결되지 않았어요'),
        )
      : mockMutation((tx) => {
      const actor = requireActor(tx.tables, { use: [PERMISSION.PRODUCTION_PLAN_CONFIRM] });
      const soItem = tx.tables.salesOrderItem.find((i) => i.id === input.salesOrderItemId);
      if (!soItem) throw new ApiError('COM-003', '수주 품목');
      const { reservedFromSurplusQty, plan } = createReproductionPlan(tx, userActor(actor.employee.id), input);
      return {
        reservedFromSurplusQty,
        productionPlanId: plan?.id ?? null,
        productionPlanNo: plan?.productionPlanNo ?? null,
        shortageQty: plan?.shortageQty ?? 0,
      };
    }),
};
