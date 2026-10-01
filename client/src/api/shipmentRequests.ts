// 출하요청·출하 배정 API (REQ-SHP-001, REQ-INV-006·007·009, BP-SHP-01).
// 규칙·작업 로그는 core 서비스(@/mock/services)가 맡는다. 이 파일은 권한 확인(requireActor) + 서비스 호출 + 화면용 덧붙임만 한다.
import { PERMISSION, type ProductItemType, type SalesOrderItemStatus } from '@/codes';
import { mockMutation, mockQuery } from '@/api/client';
import { requireActor } from '@/api/actor';
import type { MockTables } from '@/mock/schema';
import {
  cancelShipmentRequest,
  changeShipmentAllocation,
  confirmShipmentAllocations,
  createShipmentRequest,
  findById,
  listShipmentRequests,
  releaseShipmentAllocation,
  shipmentRecommendation,
  shipmentRequestDetail,
  shippableItemsOf,
  steelGradeCodeOf,
  userActor,
  type ShipmentLotView,
  type ShipmentRecommendationLine,
  type ShipmentRequestDetail,
  type ShipmentRequestLineView,
  type ShipmentRequestSummary,
  type ShippableItem,
} from '@/mock/services';

type Tables = Readonly<MockTables>;

/** 출하요청 화면을 여는 권한: 출하요청(영업 USE·물류 VIEW) 또는 출고 확정 화면에서도 읽는다 */
const READ_RULE = { view: [PERMISSION.SHIPMENT_REQUEST_MANAGE, PERMISSION.GOODS_ISSUE_CONFIRM] } as const;
const MANAGE_RULE = { use: [PERMISSION.SHIPMENT_REQUEST_MANAGE] } as const;

export const shipmentRequestKeys = {
  all: ['shipmentRequests'] as const,
  list: () => [...shipmentRequestKeys.all, 'list'] as const,
  detail: (id: number) => [...shipmentRequestKeys.all, 'detail', id] as const,
  shippableCustomers: () => [...shipmentRequestKeys.all, 'shippableCustomers'] as const,
  shippableItems: (customerId: number) => [...shipmentRequestKeys.all, 'shippableItems', customerId] as const,
};

export type { ShipmentRequestSummary, ShippableItem };

export interface ShipmentListRow extends ShipmentRequestSummary {
  /** 품목 규격 코드 (표의 '품목' 칸) */
  itemCodes: string[];
  itemTypes: ProductItemType[];
  salesOrderIds: number[];
  millSheets: { id: number; millSheetNo: string }[];
}

export interface ShipmentLotOption extends ShipmentLotView {
  yardName: string | null;
}

export interface ShipmentLineDetail extends Omit<ShipmentRequestLineView, 'allocations'> {
  steelGradeCode: string | null;
  orderedQty: number;
  shippedQty: number;
  dueDate: string;
  salesOrderItemStatus: SalesOrderItemStatus;
  allocations: (ShipmentRequestLineView['allocations'][number] & { yardName: string | null })[];
  /** FIFO 추천 (배정 대기 매수만큼, 저장 안 함 — SHP-001) */
  recommendedLots: ShipmentLotOption[];
  /** 고를 수 있는 적격·미배정 LOT 전부 (FIFO 순) */
  candidateLots: ShipmentLotOption[];
}

export interface ShipmentRequestDetailView extends Omit<ShipmentRequestDetail, 'lines'> {
  lines: ShipmentLineDetail[];
  /** 배정·취소를 바꿀 수 있는 상태 (배정 대기·배정 확정) */
  editable: boolean;
}

export interface ShippableCustomer {
  customerId: number;
  customerCode: string;
  customerName: string;
  /** 출하할 수 있는 수주 품목 수 */
  itemCount: number;
  /** 그 품목들의 수주 id (수주 화면에서 ?salesOrderId=로 들어올 때 고객사를 고른다) */
  salesOrderIds: number[];
}

export interface CreateShipmentRequestForm {
  customerId: number;
  requestedShipDate: string;
  /** 출하 매수는 입력한 글자 그대로 넘긴다 (지우거나 바꾸지 않는다, SO-002) */
  items: { salesOrderItemId: number; requestQty: string }[];
}

/**
 * 같은 규격 품목이 한 요청에 여러 줄이면 core 추천은 줄마다 같은 앞쪽 LOT을 고른다.
 * 화면 추천은 줄 순서대로 나눠 준다(앞 줄이 고른 LOT은 뒤 줄 추천에서 뺀다) — FIFO 순서는 그대로라 [추천대로 모두 확정]이 INV-003에 걸리지 않는다.
 * core의 확정 함수도 줄을 차례로 처리하며 앞 줄 배정을 뺀 FIFO를 추천으로 남기므로 작업 로그와 같다.
 */
export function distributeRecommendation(lines: readonly ShipmentRecommendationLine[]): ShipmentRecommendationLine[] {
  const taken = new Set<number>();
  return lines.map((line) => {
    const recommendedLots = line.candidateLots.filter((lot) => !taken.has(lot.lotId)).slice(0, line.unallocatedQty);
    for (const lot of recommendedLots) taken.add(lot.lotId);
    return { ...line, recommendedLots };
  });
}

const yardNameOf = (tables: Tables, yardId: number | null) => findById(tables, 'yard', yardId)?.yardName ?? null;
const withYard = (tables: Tables, lot: ShipmentLotView): ShipmentLotOption => ({ ...lot, yardName: yardNameOf(tables, lot.yardId) });

function listRows(tables: Tables): ShipmentListRow[] {
  return listShipmentRequests(tables).map((summary) => {
    const detail = shipmentRequestDetail(tables, summary.id);
    return {
      ...summary,
      itemCodes: [...new Set(detail.lines.map((l) => l.itemCode))],
      itemTypes: [...new Set(detail.lines.map((l) => l.itemType))],
      salesOrderIds: [...new Set(detail.lines.map((l) => l.salesOrderId))],
      millSheets: detail.millSheets.map((m) => ({ id: m.id, millSheetNo: m.millSheetNo })),
    };
  });
}

function detailView(tables: Tables, id: number): ShipmentRequestDetailView {
  const detail = shipmentRequestDetail(tables, id);
  const editable = detail.shipmentRequestStatus === 'REQUESTED' || detail.shipmentRequestStatus === 'ALLOCATED';
  const recommendation = editable ? distributeRecommendation(shipmentRecommendation(tables, id)) : [];
  return {
    ...detail,
    editable,
    lines: detail.lines.map((line) => {
      const soItem = findById(tables, 'salesOrderItem', line.salesOrderItemId);
      const item = findById(tables, 'item', line.itemId);
      const rec = recommendation.find((r) => r.shipmentRequestItemId === line.shipmentRequestItemId);
      return {
        ...line,
        steelGradeCode: steelGradeCodeOf(tables, item?.steelGradeId ?? null),
        orderedQty: soItem?.orderedQty ?? 0,
        shippedQty: soItem?.shippedQty ?? 0,
        dueDate: soItem?.dueDate ?? '',
        salesOrderItemStatus: soItem?.salesOrderItemStatus ?? 'OPEN',
        allocations: line.allocations.map((a) => ({ ...a, yardName: yardNameOf(tables, a.yardId) })),
        recommendedLots: (rec?.recommendedLots ?? []).map((l) => withYard(tables, l)),
        candidateLots: (rec?.candidateLots ?? []).map((l) => withYard(tables, l)),
      };
    }),
  };
}

function shippableCustomers(tables: Tables): ShippableCustomer[] {
  return [...tables.customer]
    .sort((a, b) => a.customerCode.localeCompare(b.customerCode))
    .map((c) => {
      const items = shippableItemsOf(tables, c.id);
      return {
        customerId: c.id,
        customerCode: c.customerCode,
        customerName: c.customerName,
        itemCount: items.length,
        salesOrderIds: [...new Set(items.map((i) => i.salesOrderId))],
      };
    });
}

export const shipmentRequestApi = {
  list: () =>
    mockQuery((tables) => {
      requireActor(tables, READ_RULE);
      return listRows(tables);
    }),
  detail: (id: number) =>
    mockQuery((tables) => {
      requireActor(tables, READ_RULE);
      return detailView(tables, id);
    }),
  /** 출하요청 등록: 고객사마다 출하할 수 있는 품목 수 */
  shippableCustomers: () =>
    mockQuery((tables) => {
      requireActor(tables, READ_RULE);
      return shippableCustomers(tables);
    }),
  /** 이 고객사의 출하할 수 있는 수주 품목 (출하 가능 잔량 = ACTIVE 예약 − 진행 중 출하요청 매수) */
  shippableItems: (customerId: number) =>
    mockQuery((tables) => {
      requireActor(tables, READ_RULE);
      return shippableItemsOf(tables, customerId).map((i) => ({ ...i, steelGradeCode: steelGradeCodeOf(tables, findById(tables, 'item', i.itemId)?.steelGradeId ?? null) }));
    }),
  /** 등록. 결과에 FIFO 추천이 함께 온다 (화면은 바로 배정 화면으로 가서 추천을 연다) */
  create: (input: CreateShipmentRequestForm) =>
    mockMutation((tx) => {
      const actor = requireActor(tx.tables, MANAGE_RULE);
      const result = createShipmentRequest(tx, userActor(actor.employee.id), input);
      return { id: result.shipmentRequest.id, shipmentRequestNo: result.shipmentRequest.shipmentRequestNo, recommendation: distributeRecommendation(result.recommendation) };
    }),
  /** 배정 확정 (품목마다 고른 LOT → CONFIRMED) */
  confirmAllocations: (input: { shipmentRequestId: number; lines: { shipmentRequestItemId: number; lotIds: number[] }[] }) =>
    mockMutation((tx) => {
      const actor = requireActor(tx.tables, MANAGE_RULE);
      const created = confirmShipmentAllocations(tx, userActor(actor.employee.id), input);
      const request = findById(tx.tables, 'shipmentRequest', input.shipmentRequestId);
      return { confirmedQty: created.length, shipmentRequestStatus: request?.shipmentRequestStatus ?? 'REQUESTED' };
    }),
  /** 배정 변경 = 기존 해제 + 새 배정 (사유 필수) */
  changeAllocation: (input: { allocationId: number; newLotId: number; reasonText: string }) =>
    mockMutation((tx) => {
      const actor = requireActor(tx.tables, MANAGE_RULE);
      const created = changeShipmentAllocation(tx, userActor(actor.employee.id), input);
      return { allocationId: created.id, lotNo: findById(tx.tables, 'lot', created.lotId)?.lotNo ?? '' };
    }),
  releaseAllocation: (input: { allocationId: number; reasonText?: string | null }) =>
    mockMutation((tx) => {
      const actor = requireActor(tx.tables, MANAGE_RULE);
      const released = releaseShipmentAllocation(tx, userActor(actor.employee.id), input);
      return { allocationId: released.id, lotNo: findById(tx.tables, 'lot', released.lotId)?.lotNo ?? '' };
    }),
  /** 취소: 출고 확정이면 SHP-003. 배정은 해제, 예약은 ACTIVE 그대로 */
  cancel: (input: { shipmentRequestId: number; expectedUpdatedAt?: string | null }) =>
    mockMutation((tx) => {
      const actor = requireActor(tx.tables, MANAGE_RULE);
      const row = cancelShipmentRequest(tx, userActor(actor.employee.id), input);
      return { id: row.id, shipmentRequestNo: row.shipmentRequestNo };
    }),
};
